const { randomUUID } = require('node:crypto');

// Copies records one level deep so array fields such as quest objectives are never shared.
const copy = item => Object.fromEntries(Object.entries(item)
  .map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));

class InMemoryRepository {
  constructor(items = []) {
    this.items = new Map(items.map(item => [item.id, copy(item)]));
  }

  list(filters = {}) {
    return [...this.items.values()]
      .filter(item => Object.entries(filters).every(([key, value]) => item[key] === value))
      .map(copy);
  }

  get(id) {
    const item = this.items.get(id);
    return item ? copy(item) : undefined;
  }

  create(data) {
    const item = copy({ ...data, id: randomUUID() });
    this.items.set(item.id, item);
    return copy(item);
  }

  update(id, data) {
    if (!this.items.has(id)) return undefined;
    const item = copy({ ...data, id });
    this.items.set(id, item);
    return copy(item);
  }

  delete(id) {
    return this.items.delete(id);
  }
}

module.exports = { InMemoryRepository };
