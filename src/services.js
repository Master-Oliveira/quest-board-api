const { InMemoryRepository } = require('./data/repository');
const { createSeeds } = require('./data/seeds');
const { GuildService } = require('./domain/guild-service');
const { createFoundryModelService } = require('./foundry/model-service');

function createServices({ env = process.env, modelService = createFoundryModelService({ env }) } = {}) {
  const seeds = createSeeds();
  const guild = Object.fromEntries(Object.entries(seeds)
    .map(([resource, items]) => [
      resource, new GuildService(resource, new InMemoryRepository(items)),
    ]));
  return { guild, model: modelService };
}

module.exports = { createServices };
