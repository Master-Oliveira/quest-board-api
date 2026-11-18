const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createApp, isLocalRequest } = require('../src/api/app');
const { createServices } = require('../src/services');
const { ModelServiceError } = require('../src/foundry/model-service');
const { InMemoryRepository } = require('../src/data/repository');
const { createSeeds } = require('../src/data/seeds');
const specification = require('../openapi.json');

const quest = {
  title: 'Find the crystal', description: 'Search the ancient forest.',
  difficulty: 'easy', minimumLevel: 1, goldReward: 0, experienceReward: 50, status: 'open',
};
const adventurer = { name: 'Elara', level: 1, experience: 0, gold: 0, status: 'active' };

async function setup(t, options) {
  const server = createApp(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, method = 'GET', body, headers = {}, signal) => fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

for (const [resource, input, minimumSeeds] of [
  ['quests', quest, 10], ['adventurers', adventurer, 5],
]) {
  test(`${resource}: seeded list and full CRUD lifecycle`, async t => {
    const request = await setup(t);
    const list = await request(`/${resource}`);
    assert.equal(list.status, 200);
    const seeds = await list.json();
    assert.ok(seeds.length >= minimumSeeds);
    assert.equal(new Set(seeds.map(item => item.id)).size, seeds.length);
    for (const seed of seeds) {
      for (const field of Object.keys(input)) assert.ok(Object.hasOwn(seed, field));
    }

    const created = await request(`/${resource}`, 'POST', input);
    assert.equal(created.status, 201);
    const item = await created.json();
    assert.match(item.id, /^[0-9a-f-]{36}$/);
    assert.equal(created.headers.get('location'), `/${resource}/${item.id}`);
    if (resource === 'quests') assert.ok(Number.isFinite(Date.parse(item.createdAt)));
    assert.deepEqual(await (await request(created.headers.get('location'))).json(), item);

    const updatedInput = resource === 'quests'
      ? { ...input, title: 'A new title', status: 'completed', difficulty: 'legendary' }
      : { ...input, name: 'A new name', status: 'inactive', level: 20 };
    const updated = await request(`/${resource}/${item.id}`, 'PUT', updatedInput);
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { ...item, ...updatedInput });
    const listed = await (await request(`/${resource}`)).json();
    assert.deepEqual(listed.find(entry => entry.id === item.id), { ...item, ...updatedInput });

    const deleted = await request(`/${resource}/${item.id}`, 'DELETE');
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), '');
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const missing = await request(`/${resource}/${item.id}`, method,
        method === 'PUT' ? input : undefined);
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).error.code, 'NOT_FOUND');
    }
    assert.equal((await (await request(`/${resource}`)).json()).length, seeds.length);
  });

  test(`${resource}: rejects invalid bodies on create and update without mutating data`, async t => {
    const request = await setup(t);
    const seed = (await (await request(`/${resource}`)).json())[0];
    const invalid = [null, [], 'text', 123, {}, { ...input, extra: true }, { ...input, id: 'custom' }];
    for (const field of Object.keys(input)) {
      const missing = { ...input };
      delete missing[field];
      invalid.push(missing, { ...input, [field]: null });
      if (typeof input[field] === 'number') {
        for (const value of [-1, 0.5, '1', true, Number.MAX_SAFE_INTEGER + 1]) {
          invalid.push({ ...input, [field]: value });
        }
      } else {
        invalid.push({ ...input, [field]: '' }, { ...input, [field]: '   ' });
      }
    }
    invalid.push({ ...input, status: 'unknown' });
    if (resource === 'quests') {
      invalid.push(
        { ...input, difficulty: 'impossible' }, { ...input, minimumLevel: 0 },
        { ...input, createdAt: '2020-01-01' }, { ...input, title: 'x'.repeat(201) },
        { ...input, description: 'x'.repeat(5001) },
      );
    } else {
      invalid.push({ ...input, level: 0 }, { ...input, name: 'x'.repeat(201) });
    }
    for (const body of invalid) {
      for (const [method, path] of [['POST', `/${resource}`], ['PUT', `/${resource}/${seed.id}`]]) {
        const response = await request(path, method, body);
        assert.equal(response.status, 400, `${method}: ${JSON.stringify(body)}`);
        const result = await response.json();
        assert.equal(result.error.code, 'VALIDATION_ERROR');
        assert.equal(typeof result.error.message, 'string');
      }
    }
    assert.deepEqual(await (await request(`/${resource}/${seed.id}`)).json(), seed);
    assert.equal((await (await request(`/${resource}`)).json()).length, minimumSeeds);
  });
}

test('quest filters work separately and together, with empty results and validation', async t => {
  const request = await setup(t);
  const all = await (await request('/quests')).json();
  for (const query of [
    'status=open', 'status=in-progress', 'status=completed',
    'difficulty=easy', 'difficulty=medium', 'difficulty=hard', 'difficulty=legendary',
    'status=completed&difficulty=legendary',
  ]) {
    const response = await request(`/quests?${query}`);
    assert.equal(response.status, 200);
    const filters = [...new URLSearchParams(query)];
    assert.deepEqual(await response.json(),
      all.filter(item => filters.every(([key, value]) => item[key] === value)));
  }
  for (const item of all.filter(entry => entry.status === 'open')) {
    await request(`/quests/${item.id}`, 'DELETE');
  }
  assert.deepEqual(await (await request('/quests?status=open')).json(), []);
  for (const query of ['status=unknown', 'difficulty=HARD', 'status=', 'other=x',
    'status=open&status=completed', 'difficulty=easy&difficulty=easy', '__proto__=x']) {
    const response = await request(`/quests?${query}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
});

test('JSON parsing, media type, size limits, and routing return consistent errors', async t => {
  const request = await setup(t);
  for (const resource of ['quests', 'adventurers']) {
    const seed = (await (await request(`/${resource}`)).json())[0];
    for (const [method, path] of [['POST', `/${resource}`], ['PUT', `/${resource}/${seed.id}`]]) {
      const invalid = await request(path, method);
      assert.equal(invalid.status, 415);
      assert.equal((await invalid.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
      const wrongType = await request(path, method, {}, { 'Content-Type': 'text/plain' });
      assert.equal(wrongType.status, 415);
      const tooLarge = await request(path, method, { description: 'x'.repeat(65536) });
      assert.equal(tooLarge.status, 413);
      assert.equal((await tooLarge.json()).error.code, 'PAYLOAD_TOO_LARGE');
    }
  }
  const server = await request('/quests');
  const base = new URL(server.url).origin;
  for (const body of ['', '{', '{"title":']) {
    const response = await fetch(`${base}/quests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_JSON');
  }
  for (const path of ['/unknown', '/quests/missing/extra', '/adventurers/missing']) {
    const response = await request(path);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
  for (const [path, allow] of [['/quests', 'GET, POST'], ['/adventurers/id', 'GET, PUT, DELETE']]) {
    const response = await request(path, 'PATCH', {});
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), allow);
    assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED');
  }
});

test('valid boundary values and whitespace normalization', async t => {
  const request = await setup(t);
  const body = {
    ...quest, title: '  A quest  ', description: 'x'.repeat(5000),
    goldReward: Number.MAX_SAFE_INTEGER,
  };
  const response = await request('/quests', 'POST', body,
    { 'Content-Type': 'application/json; charset=utf-8' });
  assert.equal(response.status, 201);
  const item = await response.json();
  assert.equal(item.title, 'A quest');
  assert.equal(item.description.length, 5000);
  assert.equal(item.goldReward, Number.MAX_SAFE_INTEGER);
});

test('text maxLength uses Unicode code points consistently on create and update', async t => {
  const request = await setup(t);
  const unicodeQuest = {
    ...quest, title: '🐉'.repeat(200), description: '🧙'.repeat(5000),
  };
  const createdQuest = await request('/quests', 'POST', unicodeQuest);
  assert.equal(createdQuest.status, 201);
  const questItem = await createdQuest.json();
  assert.equal(Array.from(questItem.title).length, 200);
  assert.equal(Array.from(questItem.description).length, 5000);
  assert.equal((await request(`/quests/${questItem.id}`, 'PUT', unicodeQuest)).status, 200);

  const unicodeAdventurer = { ...adventurer, name: '🧝'.repeat(200) };
  const createdAdventurer = await request('/adventurers', 'POST', unicodeAdventurer);
  assert.equal(createdAdventurer.status, 201);
  const adventurerItem = await createdAdventurer.json();
  assert.equal(Array.from(adventurerItem.name).length, 200);
  assert.equal((await request(
    `/adventurers/${adventurerItem.id}`, 'PUT', unicodeAdventurer,
  )).status, 200);

  for (const [method, path, body] of [
    ['POST', '/quests', { ...unicodeQuest, title: '🐉'.repeat(201) }],
    ['POST', '/quests', { ...unicodeQuest, description: '🧙'.repeat(5001) }],
    ['PUT', `/quests/${questItem.id}`, { ...unicodeQuest, title: '🐉'.repeat(201) }],
    ['PUT', `/quests/${questItem.id}`, { ...unicodeQuest, description: '🧙'.repeat(5001) }],
    ['POST', '/adventurers', { ...unicodeAdventurer, name: '🧝'.repeat(201) }],
    ['PUT', `/adventurers/${adventurerItem.id}`, { ...unicodeAdventurer, name: '🧝'.repeat(201) }],
  ]) {
    const response = await request(path, method, body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
});

test('each app starts with independent seed data', async t => {
  const first = await setup(t);
  const second = await setup(t);
  await first('/quests/quest-1', 'DELETE');
  assert.equal((await second('/quests/quest-1')).status, 200);
});

test('repository does not expose mutable internal records', () => {
  const seeds = createSeeds();
  const repository = new InMemoryRepository(seeds.quests);
  seeds.quests[0].title = 'mutated seed';
  const item = repository.get('quest-1');
  item.title = 'mutated get';
  repository.list()[0].title = 'mutated list';
  assert.equal(repository.get('quest-1').title, 'Rats in the Cellar');
  const created = repository.create(quest);
  created.title = 'mutated create';
  assert.equal(repository.get(created.id).title, quest.title);
  const updated = repository.update(created.id, quest);
  updated.title = 'mutated update';
  assert.equal(repository.get(created.id).title, quest.title);
  assert.equal(repository.update('missing', quest), undefined);
  const withObjectives = repository.create({ ...quest, objectives: ['Find the cave'] });
  withObjectives.objectives.push('mutated create');
  repository.get(withObjectives.id).objectives.push('mutated get');
  repository.list().find(item => item.id === withObjectives.id).objectives.push('mutated list');
  assert.deepEqual(repository.get(withObjectives.id).objectives, ['Find the cave']);
});

test('model test returns model text and forwards validated input with a bounded output', async t => {
  const calls = [];
  const services = createServices({ modelService: {
    complete: async (...args) => { calls.push(args); return 'Hello from Foundry!'; },
  } });
  const request = await setup(t, { services, env: {} });
  for (const [path, input, expected] of [
    ['/model/test', '  Say hello  ', 'Say hello'],
    ['/model/test/', '\u{1F409}'.repeat(5000), '\u{1F409}'.repeat(5000)],
  ]) {
    const response = await request(path, 'POST', { input });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { text: 'Hello from Foundry!' });
    const [forwarded, options] = calls.at(-1);
    assert.equal(forwarded, expected);
    assert.equal(options.maxOutputTokens, 512);
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(calls.length, 2);
  for (const value of ['16', ' 4096 ']) {
    const configured = await setup(t, { services, env: { MODEL_TEST_MAX_OUTPUT_TOKENS: value } });
    assert.equal((await configured('/model/test', 'POST', { input: 'Hi' })).status, 200);
    assert.equal(calls.at(-1)[1].maxOutputTokens, Number(value));
  }
  for (const value of ['15', '4097', '1.5', '1e3', '-20', 'many']) {
    assert.throws(() => createApp({ services, env: { MODEL_TEST_MAX_OUTPUT_TOKENS: value } }),
      /MODEL_TEST_MAX_OUTPUT_TOKENS must be an integer between 16 and 4096/);
  }
});

test('model test accepts only local clients and local Host names', async t => {
  let calls = 0;
  const server = createApp({ services: createServices({ modelService: {
    complete: async () => { calls++; return 'Hello!'; },
  } }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  const post = host => new Promise((resolve, reject) => {
    const body = JSON.stringify({ input: 'Hi' });
    const outgoing = http.request({
      host: '127.0.0.1', port: server.address().port, path: '/model/test', method: 'POST',
      headers: { Host: host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, incoming => {
      const chunks = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.on('end', () => resolve({
        status: incoming.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
  for (const host of ['evil.example', 'evil.example:3000', '127.0.0.1.nip.io']) {
    const response = await post(host);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  }
  assert.equal(calls, 0);
  for (const host of ['localhost:3000', '127.0.0.1', '[::1]:3000']) {
    assert.equal((await post(host)).status, 200);
  }
  assert.equal(calls, 3);
  const remote = { socket: { remoteAddress: '192.0.2.10' }, headers: { host: 'localhost' } };
  assert.equal(isLocalRequest(remote), false);
  for (const host of [undefined, '']) {
    assert.equal(isLocalRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host } }), false);
  }
  assert.equal(isLocalRequest({ socket: { remoteAddress: '::1' }, headers: { host: 'localhost' } }), true);
});

test('model test limits concurrent model calls', async t => {
  const pending = [];
  const request = await setup(t, { services: createServices({ modelService: {
    complete: () => new Promise(resolve => pending.push(resolve)),
  } }) });
  const first = request('/model/test', 'POST', { input: 'One' });
  const second = request('/model/test', 'POST', { input: 'Two' });
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  const rejected = await request('/model/test', 'POST', { input: 'Three' });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get('retry-after'), '1');
  assert.equal((await rejected.json()).error.code, 'TOO_MANY_REQUESTS');
  assert.equal(pending.length, 2);
  pending.forEach(resolve => resolve('Done'));
  assert.deepEqual(await Promise.all([first, second].map(async response => (await response).status)), [200, 200]);
  const next = request('/model/test', 'POST', { input: 'Four' });
  while (pending.length < 3) await new Promise(resolve => setImmediate(resolve));
  pending[2]('Done');
  assert.equal((await next).status, 200);
});

test('model test cancels the model call when the client disconnects', async t => {
  let started;
  let cancelled;
  const modelStarted = new Promise(resolve => { started = resolve; });
  const modelCancelled = new Promise(resolve => { cancelled = resolve; });
  const request = await setup(t, { services: createServices({ modelService: {
    complete: (input, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        cancelled();
        reject(new ModelServiceError('MODEL_CANCELLED', 'The model request was cancelled.'));
      }, { once: true });
      started();
    }),
  } }) });
  const client = new AbortController();
  const response = request('/model/test', 'POST', { input: 'Hi' }, {}, client.signal);
  await modelStarted;
  client.abort();
  await assert.rejects(response, { name: 'AbortError' });
  await modelCancelled;
});

test('model test rejects invalid requests before invoking the model', async t => {
  let calls = 0;
  const request = await setup(t, { services: createServices({ modelService: {
    complete: async () => { calls++; return 'Must not be called'; },
  } }) });
  for (const body of [null, [], 'hello', {}, { input: null }, { input: 42 },
    { input: '' }, { input: '   ' }, { input: 'x'.repeat(5001) },
    { input: ` ${'x'.repeat(5000)} ` }, { input: '\u{1F409}'.repeat(5001) },
    { input: 'Hi', extra: true }, { input: 'Hi', maxOutputTokens: 10000 }]) {
    const response = await request('/model/test', 'POST', body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
  for (const [body, headers, status, code] of [
    [undefined, {}, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ input: 'Hi' }, { 'Content-Type': 'text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ input: 'x'.repeat(65536) }, {}, 413, 'PAYLOAD_TOO_LARGE'],
  ]) {
    const response = await request('/model/test', 'POST', body, headers);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  const response = await request('/model/test');
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  const malformed = await fetch(response.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  assert.equal(calls, 0);
});

test('model test translates safe model errors and hides unexpected failures', async t => {
  let failure;
  const request = await setup(t, { services: createServices({ modelService: {
    complete: async () => { throw failure; },
  } }) });
  for (const [code, status] of [
    ['CONFIGURATION_ERROR', 500], ['AUTHENTICATION_ERROR', 502],
    ['MODEL_REQUEST_REJECTED', 502], ['MODEL_NOT_FOUND', 502],
    ['MODEL_UNAVAILABLE', 503], ['MODEL_TIMEOUT', 504], ['INVALID_MODEL_RESPONSE', 502],
  ]) {
    failure = new ModelServiceError(code, 'Safe model diagnostic.');
    const response = await request('/model/test', 'POST', { input: 'Hi' });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code, message: 'Safe model diagnostic.' } });
  }
  failure = new Error('private SDK details');
  const response = await request('/model/test', 'POST', { input: 'Hi' });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
});

test('model configuration is optional for CRUD but required for model requests', async t => {
  const request = await setup(t, { services: createServices({ env: {} }) });
  assert.equal((await request('/quests')).status, 200);
  const response = await request('/model/test', 'POST', { input: 'Hi' });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'CONFIGURATION_ERROR');
});

test('OpenAPI is served and describes CRUD and model operations with resolvable references', async t => {
  const request = await setup(t);
  const response = await request('/openapi.json');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), specification);
  const modelTest = specification.paths['/model/test'].post;
  assert.ok(modelTest.requestBody.required);
  assert.deepEqual(modelTest.requestBody.content['application/json'].schema,
    { $ref: '#/components/schemas/ModelTestInput' });
  assert.deepEqual(modelTest.responses['200'].content['application/json'].schema,
    { $ref: '#/components/schemas/ModelTestResult' });
  for (const resource of ['quests', 'adventurers']) {
    for (const method of ['get', 'post']) assert.ok(specification.paths[`/${resource}`][method]);
    for (const method of ['get', 'put', 'delete']) {
      assert.ok(specification.paths[`/${resource}/{id}`][method]);
    }
  }
  function checkReferences(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith('#/'));
      assert.ok(value.$ref.slice(2).split('/').reduce((result, key) => result?.[key], specification));
    }
    Object.values(value).forEach(checkReferences);
  }
  checkReferences(specification);
});

test('Swagger UI serves local assets and loads the same-origin OpenAPI specification', async t => {
  const request = await setup(t);
  for (const path of ['/docs', '/docs/']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, /id="swagger-ui"/);
    assert.doesNotMatch(html, /https?:\/\//);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
    assert.equal(assets.length, 3);
    for (const asset of assets) {
      assert.ok(asset.startsWith('/docs/'));
      const result = await request(asset);
      assert.equal(result.status, 200);
      assert.match(result.headers.get('content-type'),
        asset.endsWith('.css') ? /text\/css/ : /text\/javascript/);
      assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
      assert.ok((await result.text()).length > 0);
    }
  }
  const initializer = await (await request('/docs/initializer.js')).text();
  assert.match(initializer, /url: '\/openapi.json'/);
  assert.match(initializer, /validatorUrl: null/);
  const spec = await (await request('/openapi.json')).json();
  assert.deepEqual(spec.servers, [{ url: '/' }]);
  for (const path of ['/docs/unknown.js', '/docs/package.json', '/docs/%2e%2e%2fpackage.json']) {
    const response = await request(path);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
  assert.equal((await request('/docs', 'POST', {})).status, 404);
});

const generatedQuest = {
  title: 'The Lantern Wraith',
  description: 'A restless spirit has darkened the coastal lighthouse.',
  difficulty: 'medium', minimumLevel: 4, goldReward: 150, experienceReward: 300,
  objectives: ['Reach the lighthouse', 'Relight the lantern', 'Banish the wraith'],
};
const generationRequest = { adventurerId: 'adventurer-1', theme: 'haunted lighthouse', difficulty: 'medium' };

function generationServices(output) {
  const calls = [];
  const logs = [];
  const services = createServices({
    modelService: { complete: async (...args) => {
      calls.push(args);
      const value = typeof output === 'function' ? await output(...args) : output;
      if (value instanceof Error) throw value;
      return typeof value === 'string' ? value : JSON.stringify(value);
    } },
    logger: { info: entry => logs.push(entry), error: entry => logs.push(entry) },
  });
  return { services, calls, logs };
}

test('quest generation creates an AI quest that behaves like other quests', async t => {
  const { services, calls, logs } = generationServices(generatedQuest);
  const request = await setup(t, { services });
  const created = await request('/quests/generate', 'POST', generationRequest, { 'X-Request-Id': 'trace-123' });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('x-request-id'), 'trace-123');
  const quest = await created.json();
  assert.equal(created.headers.get('location'), `/quests/${quest.id}`);
  assert.deepEqual(quest, {
    ...generatedQuest, id: quest.id, status: 'open', createdAt: quest.createdAt, aiGenerated: true,
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.equal(logs[0].requestId, 'trace-123');
  assert.equal(logs[0].outcome, 'succeeded');

  assert.deepEqual(await (await request(`/quests/${quest.id}`)).json(), quest);
  const open = await (await request('/quests?status=open&difficulty=medium')).json();
  assert.ok(open.some(item => item.id === quest.id));
  const replacement = { title: 'Renamed', description: 'Updated.', difficulty: 'hard', minimumLevel: 5,
    goldReward: 500, experienceReward: 900, status: 'in-progress' };
  const updated = await request(`/quests/${quest.id}`, 'PUT', replacement);
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { ...quest, ...replacement });
  for (const field of ['objectives', 'aiGenerated']) {
    const rejected = await request(`/quests/${quest.id}`, 'PUT', { ...replacement, [field]: quest[field] });
    assert.equal(rejected.status, 400);
  }
  assert.equal((await request(`/quests/${quest.id}`, 'DELETE')).status, 204);
  assert.equal((await request(`/quests/${quest.id}`)).status, 404);
});

test('manual and seed quests expose empty objectives and are not AI generated', async t => {
  const request = await setup(t);
  const seeds = await (await request('/quests')).json();
  assert.ok(seeds.every(item => item.aiGenerated === false && Array.isArray(item.objectives)
    && item.objectives.length === 0));
  const created = await (await request('/quests', 'POST', quest)).json();
  assert.equal(created.aiGenerated, false);
  assert.deepEqual(created.objectives, []);
  for (const extra of [{ objectives: ['Sneak in'] }, { aiGenerated: true }]) {
    const response = await request('/quests', 'POST', { ...quest, ...extra });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
});

test('quest generation rejects unknown adventurers and invalid requests without calling the model', async t => {
  const { services, calls } = generationServices(generatedQuest);
  const request = await setup(t, { services });
  const count = async () => (await (await request('/quests')).json()).length;
  const before = await count();
  for (const [body, status, code] of [
    [{ ...generationRequest, adventurerId: 'adventurer-404' }, 404, 'NOT_FOUND'],
    [{ ...generationRequest, difficulty: 'impossible' }, 400, 'VALIDATION_ERROR'],
    [{ ...generationRequest, extra: true }, 400, 'VALIDATION_ERROR'],
    [[], 400, 'VALIDATION_ERROR'],
  ]) {
    const response = await request('/quests/generate', 'POST', body);
    assert.equal(response.status, status);
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.equal((await response.json()).error.code, code);
  }
  const wrongType = await request('/quests/generate', 'POST', generationRequest, { 'Content-Type': 'text/plain' });
  assert.equal(wrongType.status, 415);
  const getResponse = await request('/quests/generate/');
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get('allow'), 'POST');
  assert.equal(calls.length, 0);
  assert.equal(await count(), before);
});

test('quest generation maps model and output failures to API errors without persisting', async t => {
  let output;
  const { services } = generationServices(() => output);
  const request = await setup(t, { services });
  const count = async () => (await (await request('/quests')).json()).length;
  const before = await count();
  for (const [value, status, code] of [
    [new ModelServiceError('MODEL_UNAVAILABLE', 'The Foundry model is temporarily unavailable. Try again.'), 503, 'MODEL_UNAVAILABLE'],
    [new ModelServiceError('MODEL_TIMEOUT', 'The Foundry model request timed out. Try again.'), 504, 'MODEL_TIMEOUT'],
    [new ModelServiceError('CONFIGURATION_ERROR', 'Set the model variables.'), 500, 'CONFIGURATION_ERROR'],
    ['{"title":', 502, 'INVALID_MODEL_RESPONSE'],
    [{ ...generatedQuest, objectives: ['Only one'] }, 502, 'INVALID_GENERATED_QUEST'],
    [{ ...generatedQuest, goldReward: -10 }, 502, 'INVALID_GENERATED_QUEST'],
    [new Error('private SDK details'), 500, 'INTERNAL_ERROR'],
  ]) {
    output = value;
    const response = await request('/quests/generate', 'POST', generationRequest, { 'X-Request-Id': 'bad id!' });
    assert.equal(response.status, status);
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.doesNotMatch(JSON.stringify(body), /private SDK details/);
    if (code === 'INVALID_GENERATED_QUEST') assert.ok(body.error.details.length > 0);
  }
  assert.equal(await count(), before);
});

test('quest generation is local-only and shares the model concurrency limit', async t => {
  const pending = [];
  const { services } = generationServices(() => new Promise(resolve => pending.push(resolve)));
  const server = createApp({ services });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const remote = await new Promise((resolve, reject) => {
    const body = JSON.stringify(generationRequest);
    const outgoing = http.request(`${base}/quests/generate`, {
      method: 'POST',
      headers: { Host: 'evil.example', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, incoming => { incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode)); });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
  assert.equal(remote, 403);
  assert.equal(pending.length, 0);

  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const first = post('/model/test', { input: 'One' });
  const second = post('/model/test', { input: 'Two' });
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  const busy = await post('/quests/generate', generationRequest);
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('retry-after'), '1');
  pending.forEach(resolve => resolve('Done'));
  await Promise.all([first, second]);
});

test('OpenAPI describes quest generation and AI quest fields', () => {
  const generate = specification.paths['/quests/generate'].post;
  assert.deepEqual(generate.requestBody.content['application/json'].schema,
    { $ref: '#/components/schemas/QuestGenerationRequest' });
  assert.deepEqual(generate.responses['201'].content['application/json'].schema,
    { $ref: '#/components/schemas/Quest' });
  for (const status of ['400', '403', '404', '405', '429', '500', '502', '503', '504']) {
    assert.ok(generate.responses[status], `missing ${status}`);
  }
  const questSchema = specification.components.schemas.Quest;
  assert.ok(questSchema.required.includes('objectives') && questSchema.required.includes('aiGenerated'));
  assert.equal(questSchema.properties.objectives.readOnly, true);
  assert.equal(questSchema.properties.aiGenerated.readOnly, true);
});

test('invalid quest generation requests get 400 or 404 even when the model limit is reached', async t => {
  const pending = [];
  const { services } = generationServices(() => new Promise(resolve => pending.push(resolve)));
  const request = await setup(t, { services });
  const first = request('/model/test', 'POST', { input: 'One' });
  const second = request('/model/test', 'POST', { input: 'Two' });
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  for (const [body, status, code] of [
    [{ ...generationRequest, difficulty: 'impossible' }, 400, 'VALIDATION_ERROR'],
    [{ ...generationRequest, adventurerId: 'adventurer-404' }, 404, 'NOT_FOUND'],
    [generationRequest, 429, 'TOO_MANY_REQUESTS'],
  ]) {
    const response = await request('/quests/generate', 'POST', body);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  assert.equal(pending.length, 2);
  pending.forEach(resolve => resolve('Done'));
  await Promise.all([first, second]);
});
