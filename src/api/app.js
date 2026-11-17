const http = require('node:http');
const { createServices } = require('../services');
const { ApiError, validateInput, validateFilters } = require('../domain/validation');
const { ModelServiceError } = require('../foundry/model-service');
const openapi = require('../../openapi.json');
const { serveDocs } = require('./docs');

function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    request.resume();
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 65536) {
        chunks.length = 0;
        reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 64 KiB.'));
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (size > 65536) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, 'INVALID_JSON', 'Body must contain valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function send(response, status, data, headers = {}) {
  response.writeHead(status, {
    ...(data === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...headers,
  });
  response.end(data === undefined ? undefined : JSON.stringify(data));
}

function createApp({ services = createServices() } = {}) {

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && serveDocs(url.pathname, response)) return;
      if (url.pathname === '/openapi.json' && request.method === 'GET') {
        return send(response, 200, openapi);
      }
      if (url.pathname === '/model/test' || url.pathname === '/model/test/') {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        }
        const { input } = validateInput('modelTest', await readJson(request));
        const text = await services.model.complete(input, { maxOutputTokens: 128 });
        return send(response, 200, { text });
      }
      const match = url.pathname.match(/^\/(quests|adventurers)(?:\/([^/]+))?\/?$/);
      if (!match) throw new ApiError(404, 'NOT_FOUND', 'Route not found.');
      const [, resource, id] = match;
      const service = services.guild[resource];
      const methods = id ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
      if (!methods.includes(request.method)) {
        response.setHeader('Allow', methods.join(', '));
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
      if (request.method === 'GET') {
        const filters = resource === 'quests' && !id
          ? validateFilters(url.searchParams) : undefined;
        return send(response, 200, id ? service.get(id) : service.list(filters));
      }
      if (request.method === 'POST') {
        const item = service.create(await readJson(request));
        return send(response, 201, item, { Location: `/${resource}/${item.id}` });
      }
      if (request.method === 'PUT') {
        return send(response, 200, service.update(id, await readJson(request)));
      }
      service.delete(id);
      return send(response, 204);
    } catch (error) {
      if (error instanceof ModelServiceError) {
        const status = {
          CONFIGURATION_ERROR: 500,
          AUTHENTICATION_ERROR: 502,
          MODEL_UNAVAILABLE: 503,
          MODEL_TIMEOUT: 504,
          INVALID_MODEL_RESPONSE: 502,
        }[error.code];
        if (status) error = new ApiError(status, error.code, error.message);
      }
      const known = error instanceof ApiError;
      send(response, known ? error.status : 500, {
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'An unexpected error occurred.',
          ...(known && error.details ? { details: error.details } : {}),
        },
      });
    }
  });
}

module.exports = { createApp };
