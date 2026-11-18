const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const OpenAI = require('openai');
const { DefaultAzureCredential } = require('@azure/identity');
const { createFoundryModelService, ModelServiceError } = require('../src/foundry/model-service');
const { createServices } = require('../src/services');
const { verify } = require('../src/verify-foundry');

const env = {
  AZURE_AI_MODEL_ENDPOINT: 'https://example.test/',
  AZURE_AI_MODEL_DEPLOYMENT: 'deployment',
};

function fakeService(result) {
  const calls = [];
  const service = createFoundryModelService({
    env,
    createClient: endpoint => ({
      responses: {
        create: async request => {
          calls.push({ endpoint, request });
          if (result instanceof Error) throw result;
          return result;
        },
      },
    }),
  });
  return { service, calls };
}

test('completion abstraction sends model and input and returns text', async () => {
  const { service, calls } = fakeService({ status: 'completed', output_text: 'Hello!' });
  assert.equal(await service.complete('Hi'), 'Hello!');
  await verify(service);
  assert.deepEqual(calls, [
    { endpoint: 'https://example.test', request: { model: 'deployment', input: 'Hi' } },
    { endpoint: 'https://example.test', request: {
      model: 'deployment', input: 'Reply with a short greeting.', max_output_tokens: 128,
    } },
  ]);
  assert.equal(createServices({ modelService: service }).model, service);
});

test('configuration is lazy, required, and rejects unsafe endpoint URLs', async () => {
  const withUserInfo = new URL('https://example.test');
  withUserInfo.username = 'user';
  withUserInfo.password = 'password';
  const createClient = mock.fn(() => assert.fail('Invalid configuration must not create a client.'));
  for (const settings of [
    {}, { ...env, AZURE_AI_MODEL_DEPLOYMENT: ' ' },
    { ...env, AZURE_AI_MODEL_ENDPOINT: ' ' },
    { AZURE_AI_PROJECT_ENDPOINT: 'https://example.test/api/projects/demo', AZURE_AI_MODEL_DEPLOYMENT: 'deployment' },
    { ...env, AZURE_AI_MODEL_ENDPOINT: 'not a url' },
    { ...env, AZURE_AI_MODEL_ENDPOINT: 'http://example.test' },
    { ...env, AZURE_AI_MODEL_ENDPOINT: withUserInfo.href },
    { ...env, AZURE_AI_MODEL_ENDPOINT: 'https://example.test/?secret=value' },
    { ...env, AZURE_AI_MODEL_ENDPOINT: 'https://example.test/#fragment' },
    { ...env, AZURE_AI_MODEL_ENDPOINT: 'https://example.test/api/projects/demo/' },
    { ...env, AZURE_AI_MODEL_ENDPOINT: 'https://example.test/openai/v1/' },
    { ...env, AZURE_AI_MODEL_ENDPOINT: 'https://example.test/models' },
  ]) {
    const service = createFoundryModelService({ env: settings, createClient });
    await assert.rejects(service.complete('Hi'), { code: 'CONFIGURATION_ERROR' });
  }
  assert.equal(createClient.mock.calls.length, 0);
  await assert.rejects(fakeService({}).service.complete('  '), { code: 'INVALID_INPUT' });
});

test('empty, invalid, and incomplete model responses fail safely', async () => {
  for (const response of [null, {}, { status: 'completed', output_text: '  ' },
    { status: 'incomplete', output_text: 'partial' },
    { status: 'failed', output_text: 'private partial text' },
    { status: 'completed', output_text: 'private text',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private refusal' }] }] }]) {
    await assert.rejects(verify(fakeService(response).service), { code: 'INVALID_MODEL_RESPONSE' });
  }
});

test('real SDK forwards strict structured output and per-call budget without live Azure access', async t => {
  const outputFormat = {
    type: 'json_schema', name: 'example', strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['title'],
      properties: { title: { type: 'string' } },
    },
  };
  const getToken = mock.method(DefaultAzureCredential.prototype, 'getToken', async () => ({
    token: 'test-token', expiresOnTimestamp: Date.now() + 3600000,
  }));
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      model: 'deployment', input: 'Generate', max_output_tokens: 4096,
      text: { format: outputFormat },
    });
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify({
      object: 'response', status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"title":"Quest"}' }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  t.after(() => { getToken.mock.restore(); fetchMock.mock.restore(); });
  assert.equal(await createFoundryModelService({ env }).complete('Generate', {
    outputFormat, maxOutputTokens: 4096,
  }), '{"title":"Quest"}');
  assert.equal(fetchMock.mock.calls.length, 1);
});

test('client errors are classified without exposing raw error details', async () => {
  const timeout = new OpenAI.APIConnectionTimeoutError();
  for (const [error, code] of [
    [timeout, 'MODEL_TIMEOUT'],
    [Object.assign(new Error('private data'), { status: 401 }), 'AUTHENTICATION_ERROR'],
    [Object.assign(new Error('private data'), { status: 403 }), 'AUTHENTICATION_ERROR'],
    [Object.assign(new Error('private data'), { status: 400 }), 'MODEL_REQUEST_REJECTED'],
    [Object.assign(new Error('private data'), { status: 404 }), 'MODEL_NOT_FOUND'],
    [Object.assign(new Error('private data'), { status: 429 }), 'MODEL_UNAVAILABLE'],
    [Object.assign(new Error('private data'), { status: 503 }), 'MODEL_UNAVAILABLE'],
    [new Error('private data'), 'MODEL_UNAVAILABLE'],
  ]) {
    await assert.rejects(fakeService(error).service.complete('Hi'), caught => {
      assert.equal(caught.code, code);
      assert.doesNotMatch(caught.message, /private data/);
      return true;
    });
  }
  const service = createFoundryModelService({
    env, createClient: () => { throw new Error('private data'); },
  });
  await assert.rejects(service.complete('Hi'), error => {
    assert.equal(error.code, 'MODEL_UNAVAILABLE');
    assert.doesNotMatch(error.message, /private data/);
    return true;
  });
});

test('real SDK sends a Responses request using Azure Identity without live Azure access', async t => {
  let expectedUrl;
  const getToken = mock.method(DefaultAzureCredential.prototype, 'getToken', async () => ({
    token: 'test-token', expiresOnTimestamp: Date.now() + 3600000,
  }));
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), expectedUrl);
    assert.equal(new Headers(init.headers).get('authorization'), ['Bearer', 'test-token'].join(' '));
    assert.deepEqual(JSON.parse(init.body), { model: 'deployment', input: 'Hi' });
    return new Response(JSON.stringify({
      object: 'response', status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello!' }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  t.after(() => { getToken.mock.restore(); fetchMock.mock.restore(); });
  const endpoints = [
    ['https://example.test/', 'https://example.test/openai/v1/responses'],
    ['https://resource.services.ai.azure.com', 'https://resource.services.ai.azure.com/openai/v1/responses'],
    ['https://resource.openai.azure.com/', 'https://resource.openai.azure.com/openai/v1/responses'],
    ['  https://resource.services.ai.azure.com/  ', 'https://resource.services.ai.azure.com/openai/v1/responses'],
  ];
  for (const [endpoint, requestUrl] of endpoints) {
    expectedUrl = requestUrl;
    const service = createFoundryModelService({ env: { ...env, AZURE_AI_MODEL_ENDPOINT: endpoint } });
    assert.equal(await service.complete('Hi'), 'Hello!');
  }
  assert.equal(getToken.mock.calls.length, endpoints.length);
  assert.equal(getToken.mock.calls[0].arguments[0], 'https://ai.azure.com/.default');
  assert.ok(getToken.mock.calls[0].arguments[1].abortSignal instanceof AbortSignal);
  assert.equal(fetchMock.mock.calls.length, endpoints.length);
});

test('real SDK failures distinguish rejected requests, missing deployments, and connection failures safely', async t => {
  const getToken = mock.method(DefaultAzureCredential.prototype, 'getToken', async () => ({
    token: 'test-token', expiresOnTimestamp: Date.now() + 3600000,
  }));
  let upstreamStatus;
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    if (upstreamStatus === undefined) throw new TypeError('private connection details');
    return new Response(JSON.stringify({
      error: { code: 'private upstream code', message: 'private upstream details' },
    }), { status: upstreamStatus, headers: { 'content-type': 'application/json' } });
  });
  t.after(() => { getToken.mock.restore(); fetchMock.mock.restore(); });
  for (const [status, code, message] of [
    [400, 'MODEL_REQUEST_REJECTED', /rejected the request \(HTTP 400\)/],
    [422, 'MODEL_REQUEST_REJECTED', /rejected the request \(HTTP 422\)/],
    [404, 'MODEL_NOT_FOUND', /HTTP 404.*exact deployment name/],
    [undefined, 'MODEL_UNAVAILABLE', /No HTTP response.*DNS, TLS certificates, proxy/],
  ]) {
    upstreamStatus = status;
    await assert.rejects(createFoundryModelService({ env }).complete('Hi'), error => {
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /private|test-token|example\.test/);
      return true;
    });
  }
  assert.equal(fetchMock.mock.calls.length, 4);
});

test('Azure credential errors are sanitized', async t => {
  const getToken = mock.method(DefaultAzureCredential.prototype, 'getToken', async () => {
    throw new Error('private credential details');
  });
  t.after(() => getToken.mock.restore());
  await assert.rejects(createFoundryModelService({ env }).complete('Hi'), error => {
    assert.ok(error instanceof ModelServiceError);
    assert.equal(error.code, 'AUTHENTICATION_ERROR');
    assert.doesNotMatch(error.message, /private credential details/);
    return true;
  });
});

test('deadline covers stalled requests and aborts the client', async () => {
  let signal;
  const service = createFoundryModelService({
    env, timeoutMs: 10,
    createClient: () => ({ responses: { create: (request, options) => {
      signal = options.signal;
      return new Promise(() => {});
    } } }),
  });
  await assert.rejects(service.complete('Hi'), { code: 'MODEL_TIMEOUT' });
  assert.equal(signal.aborted, true);
});

test('caller cancellation aborts the client request and skips already-cancelled calls', async () => {
  let clientSignal;
  const create = mock.fn((request, options) => {
    clientSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new OpenAI.APIUserAbortError()), { once: true });
    });
  });
  const service = createFoundryModelService({ env, createClient: () => ({ responses: { create } }) });
  const caller = new AbortController();
  const pending = service.complete('Hi', { signal: caller.signal });
  await new Promise(resolve => setImmediate(resolve));
  caller.abort();
  await assert.rejects(pending, { code: 'MODEL_CANCELLED' });
  assert.equal(clientSignal.aborted, true);
  await assert.rejects(service.complete('Hi', { signal: AbortSignal.abort() }), { code: 'MODEL_CANCELLED' });
  assert.equal(create.mock.calls.length, 1);
});

test('deadline covers stalled Azure authentication', async t => {
  let signal;
  const getToken = mock.method(DefaultAzureCredential.prototype, 'getToken', (scopes, options) => {
    signal = options.abortSignal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  t.after(() => getToken.mock.restore());
  await assert.rejects(createFoundryModelService({ env, timeoutMs: 10 }).complete('Hi'),
    { code: 'MODEL_TIMEOUT' });
  assert.equal(signal.aborted, true);
});

test('concurrent completions use independent Azure token cancellation signals', async t => {
  const signals = [];
  const getToken = mock.method(DefaultAzureCredential.prototype, 'getToken', (scopes, options) => {
    const { abortSignal } = options;
    signals.push(abortSignal);
    return new Promise((resolve, reject) => {
      abortSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  t.after(() => getToken.mock.restore());
  const service = createFoundryModelService({ env, timeoutMs: 10 });
  const results = await Promise.allSettled([service.complete('First'), service.complete('Second')]);
  assert.deepEqual(results.map(result => result.reason.code), ['MODEL_TIMEOUT', 'MODEL_TIMEOUT']);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.ok(signals.every(signal => signal.aborted));
});

test('SDK debug logging is disabled even when enabled in the environment', async t => {
  const previous = process.env.OPENAI_LOG;
  process.env.OPENAI_LOG = 'debug';
  const logs = [];
  const methods = ['debug', 'info', 'warn', 'error'].map(name =>
    mock.method(console, name, (...args) => logs.push(args)));
  const getToken = mock.method(DefaultAzureCredential.prototype, 'getToken', async () => ({
    token: 'test-token', expiresOnTimestamp: Date.now() + 3600000,
  }));
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    new Response('private response body', { status: 503 }));
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_LOG;
    else process.env.OPENAI_LOG = previous;
    methods.forEach(method => method.mock.restore());
    getToken.mock.restore();
    fetchMock.mock.restore();
  });
  await assert.rejects(createFoundryModelService({ env }).complete('Hi'), { code: 'MODEL_UNAVAILABLE' });
  assert.deepEqual(logs, []);
});
