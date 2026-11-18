const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createApp, isLocalRequest } = require('../src/api/app');
const { createServices } = require('../src/services');
const { ModelServiceError } = require('../src/foundry/model-service');
const { InMemoryRepository } = require('../src/data/repository');
const { createSeeds } = require('../src/data/seeds');
const { GuildService } = require('../src/domain/guild-service');
const specification = require('../openapi.json');

const quest = {
  title: 'Find the crystal', description: 'Search the ancient forest.',
  difficulty: 'easy', minimumLevel: 1, goldReward: 0, experienceReward: 50, status: 'open',
};
const adventurer = { name: 'Elara', level: 1, experience: 0, gold: 0, status: 'active' };
const generationInput = { adventurerId: 'adventurer-1', theme: 'forest exploration', difficulty: 'easy' };
const generatedProposal = {
  title: 'Find the crystal', description: 'Search the ancient forest.',
  difficulty: 'easy', minimumLevel: 3, goldReward: 25, experienceReward: 60,
  objectives: ['Find the trail', 'Reach the grove', 'Recover the crystal'],
};

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
        { ...input, objectives: ['One', 'Two', 'Three'] }, { ...input, aiGenerated: true },
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
});

test('repository isolates nested objectives at every input and output boundary', () => {
  const data = { ...quest, objectives: ['One', 'Two', 'Three'], aiGenerated: true };
  const seed = { ...structuredClone(data), id: 'generated-seed' };
  const repository = new InMemoryRepository([seed]);
  seed.objectives[0] = 'mutated constructor input';
  assert.deepEqual(repository.get(seed.id).objectives, data.objectives);
  const created = repository.create(data);
  data.objectives[0] = 'mutated create input';
  created.objectives[0] = 'mutated create output';
  assert.equal(repository.get(created.id).objectives[0], 'One');
  const replacement = { ...quest, objectives: ['Four', 'Five', 'Six'], aiGenerated: true };
  const updated = repository.update(created.id, replacement);
  replacement.objectives[0] = 'mutated update input';
  updated.objectives[0] = 'mutated update output';
  repository.get(created.id).objectives.push('mutated get');
  repository.list().find(item => item.id === created.id).objectives[0] = 'mutated list';
  assert.deepEqual(repository.get(created.id).objectives, ['Four', 'Five', 'Six']);
});

test('quest PUT preserves generated-only metadata without changing legacy write fields', () => {
  const services = createServices();
  const generated = {
    ...quest, objectives: ['One', 'Two', 'Three'], aiGenerated: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const repository = new InMemoryRepository([{ ...generated, id: 'generated' }]);
  const guild = new GuildService('quests', repository);
  const replacement = { ...quest, title: 'Updated', status: 'completed' };
  const updated = guild.update('generated', replacement);
  assert.deepEqual(updated, { ...generated, ...replacement, id: 'generated' });
  updated.objectives[0] = 'mutated';
  assert.equal(guild.get('generated').objectives[0], 'One');
  for (const metadata of [{ objectives: generated.objectives }, { aiGenerated: false }]) {
    assert.throws(() => guild.update('generated', { ...replacement, ...metadata }),
      { code: 'VALIDATION_ERROR' });
  }
  const manual = services.guild.quests.create(quest);
  assert.equal(Object.hasOwn(manual, 'aiGenerated'), false);
  assert.equal(Object.hasOwn(services.guild.quests.update(manual.id, replacement), 'objectives'), false);
  assert.throws(() => guild.update('missing', replacement), { status: 404 });
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

test('quest generation returns a saved quest usable throughout the existing CRUD API', async t => {
  const events = [];
  const services = createServices({
    modelService: { complete: async () => JSON.stringify(generatedProposal) },
    logGeneration: event => events.push(event),
  });
  const request = await setup(t, { services });
  for (const path of ['/quests/generate', '/quests/generate/']) {
    const response = await request(path, 'POST', generationInput);
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.deepEqual(saved, {
      ...generatedProposal, id: saved.id, createdAt: saved.createdAt, status: 'open', aiGenerated: true,
    });
    const location = response.headers.get('location');
    assert.equal(location, `/quests/${saved.id}`);
    assert.deepEqual(await (await request(location)).json(), saved);
    const filtered = await (await request('/quests?status=open&difficulty=easy')).json();
    assert.deepEqual(filtered.find(item => item.id === saved.id), saved);
    for (const metadata of [{ objectives: ['Changed'] }, { aiGenerated: false }]) {
      assert.equal((await request(location, 'PUT', { ...quest, ...metadata })).status, 400);
    }
    const replacement = { ...quest, title: 'Edited quest', status: 'completed' };
    const updated = await request(location, 'PUT', replacement);
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { ...saved, ...replacement });
    assert.equal((await request(location, 'DELETE')).status, 204);
    assert.equal((await request(location)).status, 404);
  }
  assert.equal(services.guild.quests.list().length, 10);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].requestId, events[1].requestId);
  assert.ok(events.every(event => event.outcome === 'succeeded' && event.modelDurationMs >= 0));
  assert.ok(events.every(event => /^[0-9a-f-]{36}$/.test(event.requestId)));
});

test('quest generation enforces local method and body policies before model invocation', async t => {
  let calls = 0;
  const services = createServices({
    modelService: { complete: async () => { calls++; return JSON.stringify(generatedProposal); } },
    logGeneration: () => assert.fail('Invalid requests must not invoke the model'),
  });
  const request = await setup(t, { services });
  for (const body of [null, [], {}, { ...generationInput, difficulty: 'impossible' },
    { ...generationInput, theme: ' ' }, { ...generationInput, theme: 'x'.repeat(201) },
    { ...generationInput, aiGenerated: true }, { ...generationInput, outputFormat: {} }]) {
    const response = await request('/quests/generate', 'POST', body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
  const missing = await request('/quests/generate', 'POST', { ...generationInput, adventurerId: 'missing' });
  assert.equal(missing.status, 404);
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const response = await request('/quests/generate/', method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
  for (const host of ['evil.example', '127.0.0.1.nip.io']) {
    const url = new URL(missing.url);
    const status = await new Promise((resolve, reject) => {
      const outgoing = http.request({
        host: url.hostname, port: url.port, path: url.pathname, method: 'POST',
        headers: { Host: host, 'Content-Type': 'application/json' },
      }, incoming => {
        incoming.resume();
        incoming.on('end', () => resolve(incoming.statusCode));
      });
      outgoing.on('error', reject);
      outgoing.end(JSON.stringify(generationInput));
    });
    assert.equal(status, 403);
  }
  for (const [body, headers, status] of [
    [undefined, {}, 415], [generationInput, { 'Content-Type': 'text/plain' }, 415],
    [{ ...generationInput, theme: 'x'.repeat(65536) }, {}, 413],
  ]) {
    assert.equal((await request('/quests/generate', 'POST', body, headers)).status, status);
  }
  const malformed = await fetch((await request('/quests/generate')).url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  assert.equal(calls, 0);
  assert.equal(services.guild.quests.list().length, 10);
});

test('quest generation maps model and invalid-output failures safely without persisting', async t => {
  let result;
  const events = [];
  const services = createServices({
    modelService: { complete: async () => { if (result instanceof Error) throw result; return result; } },
    logGeneration: event => events.push(event),
  });
  const request = await setup(t, { services });
  for (const [code, status] of [
    ['CONFIGURATION_ERROR', 500], ['AUTHENTICATION_ERROR', 502], ['MODEL_REQUEST_REJECTED', 502],
    ['MODEL_NOT_FOUND', 502], ['INVALID_MODEL_RESPONSE', 502], ['MODEL_UNAVAILABLE', 503], ['MODEL_TIMEOUT', 504],
  ]) {
    result = new ModelServiceError(code, 'Safe diagnostic.');
    const response = await request('/quests/generate', 'POST', generationInput);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code, message: 'Safe diagnostic.' } });
  }
  for (const output of ['private non-JSON text', JSON.stringify({ ...generatedProposal, goldReward: -1 })]) {
    result = output;
    const response = await request('/quests/generate', 'POST', generationInput);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'INVALID_MODEL_RESPONSE');
  }
  result = new Error('private SDK details');
  const unexpected = await request('/quests/generate', 'POST', generationInput);
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
  assert.equal(services.guild.quests.list().length, 10);
  assert.ok(events.every(event => event.outcome === 'failed' && Number.isFinite(event.modelDurationMs)));
  assert.doesNotMatch(JSON.stringify(events), /private|diagnostic|crystal/);
  const unconfigured = await setup(t, { services: createServices({ env: {}, logGeneration: () => {} }) });
  assert.equal((await unconfigured('/quests')).status, 200);
  assert.equal((await unconfigured('/quests/generate', 'POST', generationInput)).status, 500);
});

test('quest generation and model testing share two slots and recover from failed calls', async t => {
  const pending = [];
  const services = createServices({
    modelService: { complete: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    logGeneration: () => {},
  });
  const request = await setup(t, { services });
  const first = request('/model/test', 'POST', { input: 'Hi' });
  const second = request('/quests/generate', 'POST', generationInput);
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  try {
    for (const [path, body] of [['/model/test', { input: 'Third' }], ['/quests/generate', generationInput]]) {
      const saturated = await request(path, 'POST', body);
      assert.equal(saturated.status, 429);
      assert.equal(saturated.headers.get('retry-after'), '1');
      assert.equal((await saturated.json()).error.code, 'TOO_MANY_REQUESTS');
    }
    pending[0].reject(new ModelServiceError('MODEL_UNAVAILABLE', 'Safe diagnostic.'));
    assert.equal((await first).status, 503);
    const third = request('/quests/generate', 'POST', generationInput);
    while (pending.length < 3) await new Promise(resolve => setImmediate(resolve));
    pending[1].resolve(JSON.stringify(generatedProposal));
    pending[2].resolve(JSON.stringify(generatedProposal));
    assert.equal((await second).status, 201);
    assert.equal((await third).status, 201);
    assert.equal(services.guild.quests.list().length, 12);
  } finally {
    pending.forEach(call => call.resolve(JSON.stringify(generatedProposal)));
  }
});

test('disconnected generation cancels the model and rejects a late result without saving', async t => {
  let resolveModel;
  let started;
  let cancelled;
  let logged;
  const modelStarted = new Promise(resolve => { started = resolve; });
  const modelCancelled = new Promise(resolve => { cancelled = resolve; });
  const completionLogged = new Promise(resolve => { logged = resolve; });
  let calls = 0;
  const services = createServices({
    modelService: { complete: (input, { signal }) => {
      if (++calls > 1) return Promise.resolve(JSON.stringify(generatedProposal));
      signal.addEventListener('abort', cancelled, { once: true });
      started();
      return new Promise(resolve => { resolveModel = resolve; });
    } },
    logGeneration: logged,
  });
  const request = await setup(t, { services });
  const client = new AbortController();
  const response = request('/quests/generate', 'POST', generationInput, {}, client.signal);
  await modelStarted;
  client.abort();
  await assert.rejects(response, { name: 'AbortError' });
  await modelCancelled;
  resolveModel(JSON.stringify(generatedProposal));
  assert.equal((await completionLogged).code, 'MODEL_CANCELLED');
  assert.equal(services.guild.quests.list().length, 10);
  const recovered = await Promise.all([
    request('/quests/generate', 'POST', generationInput),
    request('/quests/generate', 'POST', generationInput),
  ]);
  assert.deepEqual(recovered.map(item => item.status), [201, 201]);
  await Promise.all(recovered.map(item => item.json()));
});

test('quest generation rejects adventurer deletion and level conflicts through HTTP', async t => {
  for (const change of ['delete', 'level-down', 'unrelated']) {
    let resolveModel;
    let started;
    const modelStarted = new Promise(resolve => { started = resolve; });
    const services = createServices({
      modelService: { complete: () => { started(); return new Promise(resolve => { resolveModel = resolve; }); } },
      logGeneration: () => {},
    });
    const request = await setup(t, { services });
    const generated = request('/quests/generate', 'POST', generationInput);
    await modelStarted;
    const { id, ...fields } = services.guild.adventurers.get('adventurer-1');
    if (change === 'delete') {
      assert.equal((await request(`/adventurers/${id}`, 'DELETE')).status, 204);
    } else {
      const response = await request(`/adventurers/${id}`, 'PUT', {
        ...fields, ...(change === 'level-down' ? { level: 1 } : { gold: 999 }),
      });
      assert.equal(response.status, 200);
    }
    resolveModel(JSON.stringify(generatedProposal));
    const response = await generated;
    assert.equal(response.status, { delete: 404, 'level-down': 409, unrelated: 201 }[change]);
    if (change !== 'unrelated') {
      assert.equal((await response.json()).error.code,
        change === 'delete' ? 'NOT_FOUND' : 'GENERATION_CONFLICT');
    }
    assert.equal(services.guild.quests.list().length, change === 'unrelated' ? 11 : 10);
  }
});

test('OpenAPI is served and describes CRUD and model operations with resolvable references', async t => {
  const request = await setup(t, {
    services: createServices({
      modelService: { async complete() { return JSON.stringify(generatedProposal); } },
      logGeneration() {},
    }),
  });
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
  const generation = specification.paths['/quests/generate'].post;
  assert.ok(generation.requestBody.required);
  assert.deepEqual(generation.requestBody.content['application/json'].schema,
    { $ref: '#/components/schemas/QuestGenerationInput' });
  assert.deepEqual(Object.keys(generation.responses).sort(),
    ['201', '400', '403', '404', '405', '409', '413', '415', '429', '500', '502', '503', '504']);
  assert.ok(generation.responses['201'].headers.Location);
  assert.deepEqual(generation.responses['405'].headers.Allow.schema.enum, ['POST']);
  assert.equal(generation.responses['429'].headers['Retry-After'].schema.example, '1');
  assert.deepEqual(generation.responses['201'].content['application/json'].schema,
    { $ref: '#/components/schemas/GeneratedQuest' });
  const { Quest, GeneratedQuest, QuestResponse, QuestGenerationInput } = specification.components.schemas;
  assert.equal(QuestGenerationInput.additionalProperties, false);
  assert.deepEqual(QuestGenerationInput.required, ['adventurerId', 'theme', 'difficulty']);
  for (const field of ['adventurerId', 'theme']) {
    assert.equal(QuestGenerationInput.properties[field].maxLength, 200);
  }
  assert.deepEqual(QuestResponse.oneOf, [
    { $ref: '#/components/schemas/Quest' }, { $ref: '#/components/schemas/GeneratedQuest' },
  ]);
  for (const field of ['objectives', 'aiGenerated']) {
    assert.equal(Object.hasOwn(Quest.properties, field), false);
    assert.ok(GeneratedQuest.required.includes(field));
    assert.equal(GeneratedQuest.properties[field].readOnly, true);
  }
  assert.equal(GeneratedQuest.properties.objectives.minItems, 3);
  assert.equal(GeneratedQuest.properties.objectives.maxItems, 5);
  assert.equal(GeneratedQuest.properties.objectives.items.maxLength, 500);
  assert.deepEqual(GeneratedQuest.properties.aiGenerated.enum, [true]);
  assert.deepEqual(specification.components.requestBodies.Quest.content['application/json'].schema,
    { $ref: '#/components/schemas/Quest' });
  assert.deepEqual(Quest.required.filter(field => !Quest.properties[field].readOnly).sort(),
    Object.keys(quest).sort());
  for (const [path, method] of [['/quests', 'get'], ['/quests/{id}', 'get'], ['/quests/{id}', 'put']]) {
    const schema = specification.paths[path][method].responses['200'].content['application/json'].schema;
    assert.deepEqual(path === '/quests' ? schema.items : schema,
      { $ref: '#/components/schemas/QuestResponse' });
  }
  const manual = await (await request('/quests/quest-1')).json();
  const generated = await (await request('/quests/generate', 'POST', generationInput)).json();
  for (const [record, schema] of [[manual, Quest], [generated, GeneratedQuest]]) {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(record).sort(), Object.keys(schema.properties).sort());
    for (const field of schema.required) assert.ok(Object.hasOwn(record, field));
  }
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
