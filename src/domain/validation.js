class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

const difficulties = ['easy', 'medium', 'hard', 'legendary'];
const questStatuses = ['open', 'in-progress', 'completed'];
const adventurerStatuses = ['active', 'inactive'];
const text = max => value => typeof value === 'string'
  && value.trim().length > 0 && Array.from(value).length <= max;
const integer = min => value => Number.isSafeInteger(value) && value >= min;
const member = values => value => values.includes(value);
const generationRewards = {
  easy: { gold: [20, 30], experience: [50, 75] },
  medium: { gold: [100, 200], experience: [200, 400] },
  hard: { gold: [500, 800], experience: [900, 1400] },
  legendary: { gold: [3000, 5000], experience: [5000, 8000] },
};
const questFields = {
  title: text(200),
  description: text(5000),
  difficulty: member(difficulties),
  minimumLevel: integer(1),
  goldReward: integer(0),
  experienceReward: integer(0),
};

const schemas = {
  modelTest: {
    input: text(5000),
  },
  questGeneration: {
    adventurerId: text(200),
    theme: text(200),
    difficulty: member(difficulties),
  },
  questProposal: {
    ...questFields,
    objectives: value => Array.isArray(value) && value.length >= 3 && value.length <= 5
      && Array.from(value).every(text(500)),
  },
  quests: {
    ...questFields,
    status: member(questStatuses),
  },
  adventurers: {
    name: text(200),
    level: integer(1),
    experience: integer(0),
    gold: integer(0),
    status: member(adventurerStatuses),
  },
};

function validateInput(resource, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Body must be a JSON object.');
  }
  const schema = schemas[resource];
  const details = [];
  for (const [field, check] of Object.entries(schema)) {
    if (!Object.hasOwn(input, field) || !check(input[field])) {
      details.push({ field, message: 'Required field is missing or invalid.' });
    }
  }
  for (const field of Object.keys(input)) {
    if (!Object.hasOwn(schema, field)) {
      details.push({ field, message: 'Unknown or read-only field.' });
    }
  }
  if (details.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request body.', details);
  }
  return Object.fromEntries(Object.entries(input)
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
}

function validateGeneratedQuest(input, { difficulty, level }) {
  const invalid = () => new ApiError(502, 'INVALID_MODEL_RESPONSE',
    'The model returned an invalid quest. Try again.');
  let data;
  try {
    data = validateInput('questProposal', input);
  } catch (error) {
    if (error instanceof ApiError) throw invalid();
    throw error;
  }
  const rewards = generationRewards[difficulty];
  if (!rewards || data.difficulty !== difficulty || data.minimumLevel > level
    || data.goldReward < rewards.gold[0] || data.goldReward > rewards.gold[1]
    || data.experienceReward < rewards.experience[0] || data.experienceReward > rewards.experience[1]) {
    throw invalid();
  }
  return { ...data, objectives: data.objectives.map(value => value.trim()) };
}

function validateFilters(params) {
  const allowed = { status: questStatuses, difficulty: difficulties };
  const filters = {};
  for (const [key, value] of params) {
    if (!Object.hasOwn(allowed, key) || !allowed[key].includes(value)
      || Object.hasOwn(filters, key)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate quest filter.');
    }
    filters[key] = value;
  }
  return filters;
}

module.exports = { ApiError, validateInput, validateFilters, validateGeneratedQuest, generationRewards };
