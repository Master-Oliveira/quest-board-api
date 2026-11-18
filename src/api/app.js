const http = require('node:http');
const { randomUUID } = require('node:crypto');
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

// ModelServiceError codes not listed here (INVALID_INPUT, MODEL_CANCELLED) cannot
// occur after route validation, so they fall through to the generic 500 response.
const modelErrorStatus = {
  CONFIGURATION_ERROR: 500,
  AUTHENTICATION_ERROR: 502,
  MODEL_REQUEST_REJECTED: 502,
  MODEL_NOT_FOUND: 502,
  INVALID_MODEL_RESPONSE: 502,
  MODEL_UNAVAILABLE: 503,
  MODEL_TIMEOUT: 504,
};
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
const maxConcurrentModelRequests = 2;
const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

// Reuses a safe client-supplied correlation ID; anything else is replaced to prevent log injection.
function requestIdFor(request) {
  const id = request.headers['x-request-id'];
  return typeof id === 'string' && requestIdPattern.test(id) ? id : randomUUID();
}

function modelTestMaxOutputTokens(env) {
  const value = env.MODEL_TEST_MAX_OUTPUT_TOKENS?.trim();
  if (!value) return 512;
  const tokens = Number(value);
  if (!/^\d+$/.test(value) || tokens < 16 || tokens > 4096) {
    throw new Error('MODEL_TEST_MAX_OUTPUT_TOKENS must be an integer between 16 and 4096.');
  }
  return tokens;
}

// Rejects remote clients and DNS-rebinding requests whose Host is not a local name.
function isLocalRequest(request) {
  if (!loopbackAddresses.has(request.socket?.remoteAddress)) return false;
  try {
    return localHostnames.has(new URL(`http://${request.headers.host}`).hostname);
  } catch {
    return false;
  }
}

function createApp({ services = createServices(), env = process.env } = {}) {
  const maxOutputTokens = modelTestMaxOutputTokens(env);
  let activeModelRequests = 0;

  // Shared guard for billable model endpoints: local-only, POST-only, bounded concurrency,
  // and cancellation of the model call when the client disconnects.
  async function handleModelRequest(request, response, { label, validate, run }) {
    if (!isLocalRequest(request)) {
      request.resume();
      throw new ApiError(403, 'FORBIDDEN', `The ${label} endpoint accepts only local requests.`);
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }
    const body = validate(await readJson(request));
    if (activeModelRequests >= maxConcurrentModelRequests) {
      response.setHeader('Retry-After', '1');
      throw new ApiError(429, 'TOO_MANY_REQUESTS', 'Too many model requests are in progress. Try again shortly.');
    }
    const controller = new AbortController();
    const cancel = () => { if (!response.writableFinished) controller.abort(); };
    response.on('close', cancel);
    activeModelRequests++;
    try {
      return await run(body, controller.signal);
    } catch (error) {
      // The client disconnected, so there is no one to send a response to.
      if (controller.signal.aborted) return undefined;
      throw error;
    } finally {
      activeModelRequests--;
      response.off('close', cancel);
    }
  }

  function testModel(request, response) {
    return handleModelRequest(request, response, {
      label: 'model test',
      validate: body => validateInput('modelTest', body),
      run: async ({ input }, signal) => {
        const text = await services.model.complete(input, { maxOutputTokens, signal });
        return send(response, 200, { text });
      },
    });
  }

  function generateQuest(request, response) {
    const requestId = requestIdFor(request);
    response.setHeader('X-Request-Id', requestId);
    return handleModelRequest(request, response, {
      label: 'quest generation',
      // Validates and loads the adventurer before the concurrency check, so invalid requests get 400/404, not 429.
      validate: body => services.questGenerator.prepare(body, { requestId }),
      run: async (prepared, signal) => {
        const quest = await services.questGenerator.run(prepared, { signal });
        return send(response, 201, quest, { Location: `/quests/${quest.id}` });
      },
    });
  }

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && serveDocs(url.pathname, response)) return;
      if (url.pathname === '/openapi.json' && request.method === 'GET') {
        return send(response, 200, openapi);
      }
      if (url.pathname === '/model/test' || url.pathname === '/model/test/') {
        return await testModel(request, response);
      }
      if (url.pathname === '/quests/generate' || url.pathname === '/quests/generate/') {
        return await generateQuest(request, response);
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
      if (error instanceof ModelServiceError && Object.hasOwn(modelErrorStatus, error.code)) {
        error = new ApiError(modelErrorStatus[error.code], error.code, error.message);
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

module.exports = { createApp, isLocalRequest };
