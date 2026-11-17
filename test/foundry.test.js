const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const OpenAI = require('openai');
const { DefaultAzureCredential } = require('@azure/identity');
const { createFoundryModelService, ModelServiceError } = require('../src/foundry/model-service');
const { createServices } = require('../src/services');
const { verify } = require('../src/verify-foundry');

const env = {
  AZURE_AI_PROJECT_ENDPOINT: 'https://example.test/api/projects/demo/',
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
    { endpoint: 'https://example.test/api/projects/demo', request: { model: 'deployment', input: 'Hi' } },
    { endpoint: 'https://example.test/api/projects/demo', request: {
      model: 'deployment', input: 'Reply with a short greeting.', max_output_tokens: 128,
    } },
  ]);
  assert.equal(createServices({ modelService: service }).model, service);
});

test('configuration is lazy, required, and rejects unsafe endpoint URLs', async () => {
  const withUserInfo = new URL('https://example.test');
  withUserInfo.username = 'user';
  withUserInfo.password = 'password';
  for (const settings of [
    {}, { ...env, AZURE_AI_MODEL_DEPLOYMENT: ' ' },
    { ...env, AZURE_AI_PROJECT_ENDPOINT: 'not a url' },
    { ...env, AZURE_AI_PROJECT_ENDPOINT: 'http://example.test' },
    { ...env, AZURE_AI_PROJECT_ENDPOINT: withUserInfo.href },
    { ...env, AZURE_AI_PROJECT_ENDPOINT: 'https://example.test/?secret=value' },
    { ...env, AZURE_AI_PROJECT_ENDPOINT: 'https://example.test/#fragment' },
  ]) {
    const service = createFoundryModelService({ env: settings });
    await assert.rejects(service.complete('Hi'), { code: 'CONFIGURATION_ERROR' });
  }
  await assert.rejects(fakeService({}).service.complete('  '), { code: 'INVALID_INPUT' });
});

test('empty, invalid, and incomplete model responses fail safely', async () => {
  for (const response of [null, {}, { status: 'completed', output_text: '  ' },
    { status: 'incomplete', output_text: 'partial' }]) {
    await assert.rejects(verify(fakeService(response).service), { code: 'INVALID_MODEL_RESPONSE' });
  }
});

test('client errors are classified without exposing raw error details', async () => {
  const timeout = new OpenAI.APIConnectionTimeoutError();
  for (const [error, code] of [
    [timeout, 'MODEL_TIMEOUT'],
    [Object.assign(new Error('private data'), { status: 401 }), 'AUTHENTICATION_ERROR'],
    [Object.assign(new Error('private data'), { status: 403 }), 'AUTHENTICATION_ERROR'],
    [Object.assign(new Error('private data'), { status: 404 }), 'MODEL_UNAVAILABLE'],
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
  const getToken = mock.method(DefaultAzureCredential.prototype, 'getToken', async () => ({
    token: 'test-token', expiresOnTimestamp: Date.now() + 3600000,
  }));
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://example.test/api/projects/demo/openai/v1/responses');
    assert.equal(new Headers(init.headers).get('authorization'), ['Bearer', 'test-token'].join(' '));
    assert.deepEqual(JSON.parse(init.body), { model: 'deployment', input: 'Hi' });
    return new Response(JSON.stringify({
      object: 'response', status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello!' }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  t.after(() => { getToken.mock.restore(); fetchMock.mock.restore(); });
  assert.equal(await createFoundryModelService({ env }).complete('Hi'), 'Hello!');
  assert.equal(getToken.mock.calls.length, 1);
  assert.equal(getToken.mock.calls[0].arguments[0], 'https://ai.azure.com/.default');
  assert.ok(getToken.mock.calls[0].arguments[1].abortSignal instanceof AbortSignal);
  assert.equal(fetchMock.mock.calls.length, 1);
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
