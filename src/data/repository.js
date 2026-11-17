const { randomUUID } = require('node:crypto');

class InMemoryRepository {
  constructor(items = []) {
    this.items = new Map(items.map(item => [item.id, { ...item }]));
  }

  list(filters = {}) {
    return [...this.items.values()]
      .filter(item => Object.entries(filters).every(([key, value]) => item[key] === value))
      .map(item => ({ ...item }));
  }

  get(id) {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  create(data) {
    const item = { ...data, id: randomUUID() };
    this.items.set(item.id, item);
    return { ...item };
  }

  update(id, data) {
    if (!this.items.has(id)) return undefined;
    const item = { ...data, id };
    this.items.set(id, item);
    return { ...item };
  }

  delete(id) {
    return this.items.delete(id);
  }
}

module.exports = { InMemoryRepository };
