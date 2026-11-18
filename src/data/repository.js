const { randomUUID } = require('node:crypto');

class InMemoryRepository {
  constructor(items = []) {
    this.items = new Map(items.map(item => [item.id, structuredClone(item)]));
  }

  list(filters = {}) {
    return [...this.items.values()]
      .filter(item => Object.entries(filters).every(([key, value]) => item[key] === value))
      .map(item => structuredClone(item));
  }

  get(id) {
    const item = this.items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  create(data) {
    const item = { ...structuredClone(data), id: randomUUID() };
    this.items.set(item.id, item);
    return structuredClone(item);
  }

  update(id, data) {
    if (!this.items.has(id)) return undefined;
    const item = { ...structuredClone(data), id };
    this.items.set(id, item);
    return structuredClone(item);
  }

  delete(id) {
    return this.items.delete(id);
  }
}

module.exports = { InMemoryRepository };
