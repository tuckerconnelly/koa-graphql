'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
exports['default'] = graphqlHTTP;

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _httpErrors = require('http-errors');

var _httpErrors2 = _interopRequireDefault(_httpErrors);

var _graphqlError = require('graphql/error');

var _graphqlExecution = require('graphql/execution');

var _graphqlLanguage = require('graphql/language');

var _graphqlValidation = require('graphql/validation');

var _graphqlUtilitiesGetOperationAST = require('graphql/utilities/getOperationAST');

var _parseBody = require('./parseBody');

var _renderGraphiQL = require('./renderGraphiQL');

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var parseBody = _bluebird2['default'].promisify(_parseBody.parseBody);

/**
 * Used to configure the graphQLHTTP middleware by providing a schema
 * and other configuration options.
 */

/**
 * Middleware for express; takes an options object or function as input to
 * configure behavior, and returns an express middleware.
 */

function graphqlHTTP(options) {
  if (!options) {
    throw new Error('GraphQL middleware requires options.');
  }

  return function* middleware() {
    var req = this.req;
    var request = this.request;
    var response = this.response;

    // Get GraphQL options given this request.

    var _getOptions = getOptions(options, request, this);

    var schema = _getOptions.schema;
    var rootValue = _getOptions.rootValue;
    var pretty = _getOptions.pretty;
    var graphiql = _getOptions.graphiql;

    // GraphQL HTTP only supports GET and POST methods.
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.set('Allow', 'GET, POST');
      return sendError(response, (0, _httpErrors2['default'])(405, 'GraphQL only supports GET and POST requests.'), pretty);
    }

    // Parse the Request body.
    var data;
    try {
      data = yield parseBody(req, request);
      data = data || {};

      // Get GraphQL params from the request and POST body data.

      var _getGraphQLParams = getGraphQLParams(request, data);

      var query = _getGraphQLParams.query;
      var variables = _getGraphQLParams.variables;
      var operationName = _getGraphQLParams.operationName;

      // If there is no query, present an empty GraphiQL if possible, otherwise
      // return a 400 level error.
      if (!query) {
        if (graphiql && canDisplayGraphiQL(request, data)) {
          response.type = 'text/html';
          response.body = (0, _renderGraphiQL.renderGraphiQL)();
          return;
        }
        throw (0, _httpErrors2['default'])(400, 'Must provide query string.');
      }

      // Run GraphQL query.
      try {
        var result = yield new _bluebird2['default'](function (resolve) {
          var source = new _graphqlLanguage.Source(query, 'GraphQL request');
          var documentAST = (0, _graphqlLanguage.parse)(source);
          var validationErrors = (0, _graphqlValidation.validate)(schema, documentAST);
          if (validationErrors.length > 0) {
            resolve({ errors: validationErrors });
          } else {

            // Only query operations are allowed on GET requests.
            if (request.method === 'GET') {
              // Determine if this GET request will perform a non-query.
              var operationAST = (0, _graphqlUtilitiesGetOperationAST.getOperationAST)(documentAST, operationName);
              if (operationAST && operationAST.operation !== 'query') {
                // If GraphiQL can be shown, do not perform this query, but
                // provide it to GraphiQL so that the requester may perform it
                // themselves if desired.
                if (graphiql && canDisplayGraphiQL(request, data)) {
                  response.type = 'text/html';
                  response.body = (0, _renderGraphiQL.renderGraphiQL)({ query: query, variables: variables });
                  resolve({ pass: true });
                  return;
                }

                // Otherwise, report a 405 Method Not Allowed error.
                response.set('Allow', 'POST');
                sendError(response, (0, _httpErrors2['default'])(405, 'Can only perform a ' + operationAST.operation + ' operation ' + 'from a POST request.'), pretty);
                resolve({ pass: true });
              }
            }

            // Perform the execution.
            resolve((0, _graphqlExecution.execute)(schema, documentAST, rootValue, variables, operationName));
          }
        });
      } catch (error) {
        result = { errors: [error] };
      }

      if (result.pass) {
        return;
      }

      // Format any encountered errors.
      if (result.errors) {
        result.errors = result.errors.map(_graphqlError.formatError);
      }

      // Report 200:Success if a data key exists,
      // Otherwise 400:BadRequest if only errors exist.
      response.status = result.hasOwnProperty('data') ? 200 : 400;

      // If allowed to show GraphiQL, present it instead of JSON.
      if (graphiql && canDisplayGraphiQL(request, data)) {
        response.type = 'text/html';
        response.body = (0, _renderGraphiQL.renderGraphiQL)({ query: query, variables: variables, result: result });
      } else {
        // Otherwise, present JSON directly.
        response.type = 'application/json';
        response.body = JSON.stringify(result, null, pretty ? 2 : 0);
      }
    } catch (parseError) {
      // Format any request errors the same as GraphQL errors.
      return sendError(response, parseError, pretty);
    }
  };
}

/**
 * Get the options that the middleware was configured with, sanity
 * checking them.
 */
function getOptions(options, request, context) {
  var optionsData = typeof options === 'function' ? options(request, context) : options;

  if (!optionsData || typeof optionsData !== 'object') {
    throw new Error('GraphQL middleware option function must return an options object.');
  }

  if (!optionsData.schema) {
    throw new Error('GraphQL middleware options must contain a schema.');
  }

  return optionsData;
}

/**
 * Helper function to get the GraphQL params from the request.
 */
function getGraphQLParams(request, data) {
  // GraphQL Query string.
  var query = request.query.query || data.query;

  // Parse the variables if needed.
  var variables = request.query.variables || data.variables;
  if (variables && typeof variables === 'string') {
    try {
      variables = JSON.parse(variables);
    } catch (error) {
      throw (0, _httpErrors2['default'])(400, 'Variables are invalid JSON.');
    }
  }

  // Name of GraphQL operation to execute.
  var operationName = request.query.operationName || data.operationName;

  return { query: query, variables: variables, operationName: operationName };
}

/**
 * Helper function to determine if GraphiQL can be displayed.
 */
function canDisplayGraphiQL(request, data) {
  // If `raw` exists, GraphiQL mode is not enabled.
  var raw = request.query.raw !== undefined || data.raw !== undefined;
  // Allowed to show GraphiQL if not requested as raw and this request
  // prefers HTML over JSON.
  return !raw && request.accepts(['json', 'html']) === 'html';
}

/**
 * Helper for formatting errors
 */
function sendError(response, error, pretty) {
  var errorResponse = { errors: [(0, _graphqlError.formatError)(error)] };
  response.status = error.status || 500;
  response.type = 'application/json';
  response.body = JSON.stringify(errorResponse, null, pretty ? 2 : 0);
}
module.exports = exports['default'];

/**
 * A GraphQL schema from graphql-js.
 */

/**
 * An object to pass as the rootValue to the graphql() function.
 */

/**
 * A boolean to configure whether the output should be pretty-printed.
 */

/**
 * A boolean to optionally enable GraphiQL mode
 */