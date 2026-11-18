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
    if (this.resource === 'quests') data.createdAt = new Date().toISOString();
    return this.repository.create(data);
  }

  update(id, input) {
    const existing = this.get(id);
    const data = validateInput(this.resource, input);
    if (this.resource === 'quests') {
      data.createdAt = existing.createdAt;
      if (existing.aiGenerated === true) {
        data.aiGenerated = true;
        data.objectives = existing.objectives;
      }
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
