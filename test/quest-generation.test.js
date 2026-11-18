const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateInput, validateGeneratedQuest, generationRewards } = require('../src/domain/validation');
const { createServices } = require('../src/services');
const { ModelServiceError } = require('../src/foundry/model-service');

const request = { adventurerId: 'adventurer-1', theme: 'forest exploration', difficulty: 'easy' };
const proposal = {
  title: 'Find the crystal', description: 'Search the ancient forest.',
  difficulty: 'easy', minimumLevel: 3, goldReward: 25, experienceReward: 60,
  objectives: ['Find the trail', 'Reach the grove', 'Recover the crystal'],
};

test('generation input requires exactly three bounded fields and preserves seed IDs', () => {
  assert.deepEqual(validateInput('questGeneration', {
    ...request, adventurerId: ' adventurer-1 ', theme: ' forest exploration ',
  }), request);
  assert.equal(validateInput('questGeneration', { ...request, theme: '\u{1F409}'.repeat(200) }).theme.length, 400);
  const invalid = [null, [], '', {}, { ...request, difficulty: 'impossible' },
    { ...request, status: 'open' }, { ...request, maxOutputTokens: 1 }];
  for (const field of Object.keys(request)) {
    const missing = { ...request };
    delete missing[field];
    invalid.push(missing);
    for (const value of [null, 1, true, '', ' ', 'x'.repeat(201)]) {
      invalid.push({ ...request, [field]: value });
    }
  }
  invalid.push({ ...request, theme: ` ${'x'.repeat(200)}` });
  for (const input of invalid) {
    assert.throws(() => validateInput('questGeneration', input), { status: 400, code: 'VALIDATION_ERROR' });
  }
});

test('proposal validation enforces every difficulty band, objective edge and Unicode limit', () => {
  for (const [difficulty, rewards] of Object.entries(generationRewards)) {
    for (const edge of [0, 1]) {
      const input = {
        ...proposal, difficulty, minimumLevel: edge === 0 ? 1 : 5,
        goldReward: rewards.gold[edge], experienceReward: rewards.experience[edge],
        title: ` ${'t'.repeat(198)} `, description: '\u{1F409}'.repeat(5000),
        objectives: Array.from({ length: edge === 0 ? 3 : 5 }, () => '\u{1F409}'.repeat(500)),
      };
      const output = validateGeneratedQuest(input, { difficulty, level: 5 });
      assert.equal(output.title, 't'.repeat(198));
      assert.equal(output.objectives.length, input.objectives.length);
      for (const [field, values] of [
        ['goldReward', [rewards.gold[0] - 1, rewards.gold[1] + 1]],
        ['experienceReward', [rewards.experience[0] - 1, rewards.experience[1] + 1]],
      ]) {
        for (const value of values) {
          assert.throws(() => validateGeneratedQuest({ ...input, [field]: value }, { difficulty, level: 5 }),
            { status: 502, code: 'INVALID_MODEL_RESPONSE' });
        }
      }
    }
  }
  assert.deepEqual(validateGeneratedQuest({
    ...proposal, objectives: [' One ', ' Two ', ' Three '],
  }, { difficulty: 'easy', level: 5 }).objectives, ['One', 'Two', 'Three']);
});

test('invalid model proposals have sanitized 502 errors without exposing raw fields or persisting', async () => {
  let response;
  const services = createServices({
    modelService: { complete: async () => response }, logGeneration: () => {},
  });
  const invalid = [null, [], 'private model text', 123, {}, { ...proposal, difficulty: 'hard' },
    { ...proposal, minimumLevel: 6 }, { ...proposal, objectives: ['One', 'Two'] },
    { ...proposal, objectives: Array(6).fill('One') }, { ...proposal, objectives: ['One', 'Two', ' '] },
    { ...proposal, objectives: ['One', null, 'Three'] },
    { ...proposal, objectives: ['x'.repeat(501), 'Two', 'Three'] },
    { ...proposal, objectives: [` ${'x'.repeat(500)}`, 'Two', 'Three'] },
    { ...proposal, title: 'x'.repeat(201) }, { ...proposal, description: '\u{1F409}'.repeat(5001) }];
  for (const field of Object.keys(proposal)) {
    const missing = { ...proposal };
    delete missing[field];
    invalid.push(missing, { ...proposal, [field]: null }, { ...proposal, [field]: true });
  }
  for (const field of ['minimumLevel', 'goldReward', 'experienceReward']) {
    for (const value of [-1, 0.1, '1', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      invalid.push({ ...proposal, [field]: value });
    }
  }
  invalid.push({ ...proposal, minimumLevel: 0 });
  for (const field of ['id', 'createdAt', 'status', 'aiGenerated', 'extra']) {
    invalid.push({ ...proposal, [field]: 'private value' });
  }
  for (const input of invalid) {
    assert.throws(() => validateGeneratedQuest(input, { difficulty: 'easy', level: 5 }), error => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'INVALID_MODEL_RESPONSE');
      assert.equal(error.details, undefined);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    response = JSON.stringify(input);
    await assert.rejects(services.generateQuest(request), { status: 502, code: 'INVALID_MODEL_RESPONSE' });
    assert.equal(services.guild.quests.list().length, 10);
  }
});

test('generation personalizes a strict bounded proposal, saves once and emits only safe telemetry', async () => {
  const events = [];
  let calls = 0;
  const controller = new AbortController();
  const services = createServices({
    logGeneration: event => events.push(event),
    modelService: { complete: async (input, options) => {
      calls++;
      const context = JSON.parse(input.split('\n').at(-1));
      assert.deepEqual(context.adventurer, services.guild.adventurers.get('adventurer-1'));
      assert.equal(context.theme, request.theme);
      assert.equal(context.difficulty, request.difficulty);
      assert.deepEqual(context.rewardBounds, generationRewards.easy);
      assert.equal(options.signal, controller.signal);
      assert.equal(options.maxOutputTokens, 4096);
      assert.equal(options.outputFormat.type, 'json_schema');
      assert.equal(options.outputFormat.strict, true);
      assert.equal(options.outputFormat.schema.additionalProperties, false);
      assert.deepEqual(options.outputFormat.schema.required, Object.keys(proposal));
      assert.deepEqual(options.outputFormat.schema.properties.objectives, { type: 'array', items: { type: 'string' } });
      return JSON.stringify(proposal);
    } },
  });
  const generated = await services.generateQuest(request, { signal: controller.signal, requestId: 'request-1' });
  assert.equal(calls, 1);
  assert.deepEqual(generated, {
    ...proposal, status: 'open', aiGenerated: true, id: generated.id, createdAt: generated.createdAt,
  });
  assert.match(generated.id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(generated.createdAt)));
  assert.deepEqual(services.guild.quests.get(generated.id), generated);
  assert.equal(services.guild.quests.list().length, 11);
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ['modelDurationMs', 'outcome', 'requestId']);
  assert.equal(events[0].requestId, 'request-1');
  assert.equal(events[0].outcome, 'succeeded');
  assert.ok(Number.isFinite(events[0].modelDurationMs) && events[0].modelDurationMs >= 0);
});

test('generation fails before calling for invalid input, missing adventurer or cancelled signal', async () => {
  let calls = 0;
  const services = createServices({
    modelService: { complete: async () => { calls++; return JSON.stringify(proposal); } },
    logGeneration: () => assert.fail('No model invocation means no invocation event'),
  });
  await assert.rejects(services.generateQuest({ ...request, difficulty: 'impossible' }), { status: 400 });
  await assert.rejects(services.generateQuest({ ...request, adventurerId: 'missing' }), { status: 404 });
  await assert.rejects(services.generateQuest(request, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(calls, 0);
  assert.equal(services.guild.quests.list().length, 10);
});

test('generation never salvages invalid JSON or saves on model failure and sanitizes log codes', async () => {
  let result;
  const events = [];
  const services = createServices({
    modelService: { complete: async () => { if (result instanceof Error) throw result; return result; } },
    logGeneration: event => events.push(event),
  });
  for (const output of ['', '{', `\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``,
    `${JSON.stringify(proposal)} ${JSON.stringify(proposal)}`]) {
    result = output;
    await assert.rejects(services.generateQuest(request), { code: 'INVALID_MODEL_RESPONSE' });
    assert.equal(events.at(-1).code, 'INVALID_MODEL_RESPONSE');
  }
  for (const error of [
    new ModelServiceError('MODEL_UNAVAILABLE', 'Safe diagnostic.'),
    Object.assign(new Error('private upstream text'), { code: 'private code' }),
  ]) {
    result = error;
    await assert.rejects(services.generateQuest(request), caught => caught === error);
  }
  assert.equal(services.guild.quests.list().length, 10);
  assert.equal(events.at(-1).code, 'INTERNAL_ERROR');
  for (const event of events) {
    assert.equal(event.outcome, 'failed');
    assert.match(event.requestId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(Object.keys(event).sort(), ['code', 'modelDurationMs', 'outcome', 'requestId']);
    assert.doesNotMatch(JSON.stringify(event), /private|crystal|adventurer/);
  }
});

test('generation rechecks adventurers and cancellation before saving and tolerates a failing logger', async () => {
  for (const change of ['delete', 'level-down', 'unrelated', 'cancel']) {
    let resolve;
    const controller = new AbortController();
    const events = [];
    const services = createServices({
      modelService: { complete: () => new Promise(done => { resolve = done; }) },
      logGeneration: event => events.push(event),
    });
    const pending = services.generateQuest(request, { signal: controller.signal });
    const original = services.guild.adventurers.get('adventurer-1');
    const { id, ...fields } = original;
    if (change === 'delete') services.guild.adventurers.delete(id);
    if (change === 'level-down') services.guild.adventurers.update(id, { ...fields, level: 1 });
    if (change === 'unrelated') services.guild.adventurers.update(id, { ...fields, gold: 999 });
    if (change === 'cancel') controller.abort();
    resolve(JSON.stringify(proposal));
    if (change === 'unrelated') {
      assert.equal((await pending).aiGenerated, true);
      assert.equal(services.guild.quests.list().length, 11);
    } else {
      await assert.rejects(pending, change === 'cancel' ? { name: 'AbortError' }
        : { status: change === 'delete' ? 404 : 409 });
      assert.equal(services.guild.quests.list().length, 10);
      assert.equal(events[0].code, {
        delete: 'NOT_FOUND', 'level-down': 'GENERATION_CONFLICT', cancel: 'MODEL_CANCELLED',
      }[change]);
    }
  }
  const services = createServices({
    modelService: { complete: async () => JSON.stringify(proposal) },
    logGeneration: () => { throw new Error('private logger failure'); },
  });
  assert.equal((await services.generateQuest(request)).aiGenerated, true);
  assert.equal(services.guild.quests.list().length, 11);
});
