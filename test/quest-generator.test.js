const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServices } = require('../src/services');
const { ModelServiceError } = require('../src/foundry/model-service');
const { questSchema } = require('../src/domain/quest-generator');

// adventurer-1 is level 5, so the allowed minimum level window is 1..5.
const request = { adventurerId: 'adventurer-1', theme: 'haunted lighthouse', difficulty: 'medium' };
const validQuest = {
  title: ' The Lantern Wraith ',
  description: 'A restless spirit has darkened the coastal lighthouse.',
  difficulty: 'medium',
  minimumLevel: 4,
  goldReward: 150,
  experienceReward: 300,
  objectives: [' Reach the lighthouse ', 'Relight the lantern', 'Banish the wraith'],
};

function setup(output) {
  const calls = [];
  const logs = [];
  const services = createServices({
    modelService: {
      complete: async (...args) => {
        calls.push(args);
        if (output instanceof Error) throw output;
        return typeof output === 'string' ? output : JSON.stringify(output);
      },
    },
    logger: {
      info: entry => logs.push(['info', entry]),
      error: entry => logs.push(['error', entry]),
    },
  });
  const questCount = () => services.guild.quests.list().length;
  return { services, calls, logs, questCount, generator: services.questGenerator };
}

test('generates, validates, and persists an AI quest for the adventurer', async () => {
  const { services, calls, logs, generator } = setup(validQuest);
  const signal = new AbortController().signal;
  const quest = await generator.generate({ ...request, theme: '  haunted lighthouse  ' },
    { requestId: 'req-1', signal });

  assert.deepEqual(quest, {
    id: quest.id,
    title: 'The Lantern Wraith',
    description: validQuest.description,
    difficulty: 'medium',
    minimumLevel: 4,
    goldReward: 150,
    experienceReward: 300,
    status: 'open',
    createdAt: quest.createdAt,
    objectives: ['Reach the lighthouse', 'Relight the lantern', 'Banish the wraith'],
    aiGenerated: true,
  });
  assert.match(quest.id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(quest.createdAt)));
  assert.deepEqual(services.guild.quests.get(quest.id), quest);

  const [[prompt, options]] = calls;
  assert.deepEqual(JSON.parse(prompt), {
    adventurer: { name: 'Aria Moonbow', level: 5, experience: 450 },
    theme: 'haunted lighthouse',
    difficulty: 'medium',
    limits: {
      minimumLevel: { min: 1, max: 5 },
      goldReward: { min: 75, max: 300 },
      experienceReward: { min: 150, max: 600 },
      objectives: { min: 3, max: 5 },
    },
  });
  assert.match(options.instructions, /data only/);
  assert.deepEqual(options.jsonSchema, { name: 'generated_quest', schema: questSchema });
  assert.equal(options.maxOutputTokens, 2048);
  assert.equal(options.signal, signal);
  const schemaText = JSON.stringify(questSchema);
  for (const keyword of ['minimum', 'maximum', 'minItems', 'maxItems', 'maxLength']) {
    assert.doesNotMatch(schemaText, new RegExp(`"${keyword}"`));
  }

  assert.equal(logs.length, 1);
  const [level, entry] = logs[0];
  assert.equal(level, 'info');
  assert.equal(typeof entry.modelDurationMs, 'number');
  assert.deepEqual(entry, {
    event: 'quest.generate', requestId: 'req-1', adventurerId: 'adventurer-1', difficulty: 'medium',
    modelDurationMs: entry.modelDurationMs, outcome: 'succeeded', questId: quest.id,
  });
});

test('accepts values on the rule boundaries', async () => {
  for (const [adventurerId, difficulty, fields] of [
    ['adventurer-1', 'easy', { minimumLevel: 1, goldReward: 10, experienceReward: 150 }],
    ['adventurer-1', 'easy', { minimumLevel: 5, goldReward: 60, experienceReward: 25 }],
    ['adventurer-3', 'legendary', { minimumLevel: 10, goldReward: 8000, experienceReward: 4000 }],
    ['adventurer-4', 'hard', { minimumLevel: 1, goldReward: 400, experienceReward: 2000 }],
  ]) {
    const objectives = ['One', 'Two', 'Three', 'Four', 'Five'];
    const { generator } = setup({ ...validQuest, difficulty, objectives, ...fields });
    const quest = await generator.generate({ ...request, adventurerId, difficulty });
    assert.equal(quest.aiGenerated, true);
    assert.deepEqual(quest.objectives, objectives);
  }
});

test('rejects malformed model output as an invalid model response without persisting', async () => {
  const { objectives, ...withoutObjectives } = validQuest;
  for (const output of [
    'not json', '[]', 'null', '"quest"', withoutObjectives,
    { ...validQuest, status: 'completed' },
    { ...validQuest, goldReward: '150' },
    { ...validQuest, minimumLevel: 4.5 },
    { ...validQuest, title: null },
    { ...validQuest, objectives: 'Reach the lighthouse' },
    { ...validQuest, objectives: [...objectives.slice(0, 2), 3] },
  ]) {
    const { generator, questCount, logs } = setup(output);
    const before = questCount();
    await assert.rejects(generator.generate(request, { requestId: 'req-2' }), error => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'INVALID_MODEL_RESPONSE');
      return true;
    });
    assert.equal(questCount(), before);
    assert.equal(logs[0][0], 'error');
    assert.equal(logs[0][1].errorCode, 'INVALID_MODEL_RESPONSE');
  }
});

test('enforces game rules in the application before saving', async () => {
  for (const [changes, field] of [
    [{ objectives: ['One', 'Two'] }, 'objectives'],
    [{ objectives: ['1', '2', '3', '4', '5', '6'] }, 'objectives'],
    [{ objectives: ['One', '  ', 'Three'] }, 'objectives'],
    [{ objectives: ['One', 'Two', 'x'.repeat(201)] }, 'objectives'],
    [{ goldReward: -1 }, 'goldReward'],
    [{ experienceReward: -5 }, 'experienceReward'],
    [{ goldReward: 74 }, 'goldReward'],
    [{ goldReward: 301 }, 'goldReward'],
    [{ experienceReward: 601 }, 'experienceReward'],
    [{ goldReward: Number.MAX_SAFE_INTEGER + 1 }, 'goldReward'],
    [{ minimumLevel: 6 }, 'minimumLevel'],
    [{ minimumLevel: 0 }, 'minimumLevel'],
    [{ difficulty: 'hard' }, 'difficulty'],
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(201) }, 'title'],
  ]) {
    const { generator, questCount } = setup({ ...validQuest, ...changes });
    const before = questCount();
    await assert.rejects(generator.generate(request), error => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'INVALID_GENERATED_QUEST');
      assert.ok(error.details.some(detail => detail.field === field), `${field} detail expected`);
      return true;
    });
    assert.equal(questCount(), before);
  }
  const { generator } = setup({ ...validQuest, minimumLevel: 2 });
  await assert.rejects(generator.generate({ ...request, adventurerId: 'adventurer-3' }),
    error => error.details.some(detail => detail.field === 'minimumLevel' && /10 and 15/.test(detail.message)));
});

test('rejects unknown adventurers and invalid requests before calling the model', async () => {
  for (const [input, status, code] of [
    [{ ...request, adventurerId: 'adventurer-404' }, 404, 'NOT_FOUND'],
    [{ ...request, difficulty: 'impossible' }, 400, 'VALIDATION_ERROR'],
    [{ ...request, theme: '  ' }, 400, 'VALIDATION_ERROR'],
    [{ ...request, theme: 'x'.repeat(201) }, 400, 'VALIDATION_ERROR'],
    [{ ...request, status: 'open' }, 400, 'VALIDATION_ERROR'],
    [{ adventurerId: 'adventurer-1' }, 400, 'VALIDATION_ERROR'],
  ]) {
    const { generator, calls, logs } = setup(validQuest);
    await assert.rejects(generator.generate(input, { requestId: 'req-3' }), { status, code });
    assert.equal(calls.length, 0);
    assert.equal(logs[0][1].outcome, 'failed');
    assert.equal(logs[0][1].errorCode, code);
    assert.equal(logs[0][1].modelDurationMs, undefined);
  }
});

test('allows inactive and low-level adventurers within their level window', async () => {
  const { generator } = setup({ ...validQuest, difficulty: 'legendary', minimumLevel: 1,
    goldReward: 2000, experienceReward: 4000 });
  const quest = await generator.generate({ ...request, adventurerId: 'adventurer-4', difficulty: 'legendary' });
  assert.equal(quest.minimumLevel, 1);
  const inactive = setup(validQuest);
  assert.equal((await inactive.generator.generate({ ...request, adventurerId: 'adventurer-5' })).status, 'open');
});

test('propagates model failures without persisting and logs sanitized failures', async () => {
  for (const code of ['MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'CONFIGURATION_ERROR']) {
    const failure = new ModelServiceError(code, 'Safe model diagnostic.');
    const { generator, questCount, logs } = setup(failure);
    const before = questCount();
    await assert.rejects(generator.generate(request, { requestId: 'req-4' }), caught => caught === failure);
    assert.equal(questCount(), before);
    const [level, entry] = logs[0];
    assert.equal(level, 'error');
    assert.equal(entry.errorCode, code);
    assert.equal(typeof entry.modelDurationMs, 'number');
  }
  const { generator, logs } = setup(new Error('private SDK details'));
  await assert.rejects(generator.generate(request), { message: 'private SDK details' });
  assert.equal(logs[0][1].errorCode, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(logs), /private SDK details/);
});

test('logs never include the theme, prompt, or model output', async () => {
  const secretTheme = 'secret-theme-marker';
  for (const output of [validQuest, { ...validQuest, goldReward: -1 }, 'model-output-marker']) {
    const { generator, logs } = setup(output);
    await generator.generate({ ...request, theme: secretTheme }).catch(() => {});
    const serialized = JSON.stringify(logs);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(serialized, /secret-theme-marker|model-output-marker|Lantern Wraith|lighthouse/);
  }
});

test('logger failures never change the generation outcome', async () => {
  const throwingLogger = { info: () => { throw new Error('log down'); }, error: () => { throw new Error('log down'); } };
  const services = createServices({
    modelService: { complete: async () => JSON.stringify(validQuest) }, logger: throwingLogger,
  });
  const quest = await services.questGenerator.generate(request);
  assert.equal(services.guild.quests.get(quest.id).aiGenerated, true);
  await assert.rejects(services.questGenerator.generate({ ...request, adventurerId: 'missing' }),
    { code: 'NOT_FOUND' });
});

test('generation output-token limit is configurable and validated', async () => {
  for (const [value, expected] of [[undefined, 2048], ['  ', 2048], ['256', 256], [' 16384 ', 16384]]) {
    const calls = [];
    const services = createServices({
      env: value === undefined ? {} : { QUEST_GENERATION_MAX_OUTPUT_TOKENS: value },
      modelService: { complete: async (...args) => { calls.push(args); return JSON.stringify(validQuest); } },
      logger: { info() {}, error() {} },
    });
    await services.questGenerator.generate(request);
    assert.equal(calls[0][1].maxOutputTokens, expected);
  }
  for (const value of ['255', '16385', '1.5', '1e3', '-512', 'many']) {
    assert.throws(() => createServices({
      env: { QUEST_GENERATION_MAX_OUTPUT_TOKENS: value }, modelService: { complete: async () => '' },
    }), /QUEST_GENERATION_MAX_OUTPUT_TOKENS must be an integer between 256 and 16384/);
  }
});

test('createGenerated is restricted to the quests resource', () => {
  const { services } = setup(validQuest);
  const before = services.guild.adventurers.list().length;
  assert.throws(() => services.guild.adventurers.createGenerated({ ...validQuest, status: 'open' }),
    /only supported for quests/);
  assert.equal(services.guild.adventurers.list().length, before);
});
