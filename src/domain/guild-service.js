const { ApiError, validateInput } = require('./validation');

class GuildService {
  constructor(resource, repository) {
    this.resource = resource;
    this.repository = repository;
  }

  list(filters) {
    return this.repository.list(filters);
  }

  get(id) {
    const item = this.repository.get(id);
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
    return item;
  }

  create(input) {
    const data = validateInput(this.resource, input);
    if (this.resource === 'quests') {
      Object.assign(data, { createdAt: new Date().toISOString(), objectives: [], aiGenerated: false });
    }
    return this.repository.create(data);
  }

  // Persists an AI-generated quest whose game rules the quest generator already enforced.
  createGenerated({ objectives, ...fields }) {
    if (this.resource !== 'quests') {
      throw new Error('createGenerated is only supported for quests.');
    }
    const data = validateInput('quests', fields);
    return this.repository.create({
      ...data, createdAt: new Date().toISOString(), objectives, aiGenerated: true,
    });
  }

  update(id, input) {
    const existing = this.get(id);
    const data = validateInput(this.resource, input);
    if (this.resource === 'quests') {
      const { createdAt, objectives, aiGenerated } = existing;
      Object.assign(data, { createdAt, objectives, aiGenerated });
    }
    return this.repository.update(id, data);
  }

  delete(id) {
    if (!this.repository.delete(id)) {
      throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
    }
  }
}

module.exports = { GuildService };
