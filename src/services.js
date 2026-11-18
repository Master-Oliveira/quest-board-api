const { InMemoryRepository } = require('./data/repository');
const { createSeeds } = require('./data/seeds');
const { GuildService } = require('./domain/guild-service');
const { createFoundryModelService } = require('./foundry/model-service');
const { createQuestGenerator } = require('./domain/quest-generation');

function createServices({ env = process.env, modelService = createFoundryModelService({ env }), logGeneration } = {}) {
  const seeds = createSeeds();
  const guild = Object.fromEntries(Object.entries(seeds)
    .map(([resource, items]) => [
      resource, new GuildService(resource, new InMemoryRepository(items)),
    ]));
  const generateQuest = createQuestGenerator({
    adventurers: guild.adventurers, quests: guild.quests.repository, model: modelService, log: logGeneration,
  });
  return { guild, model: modelService, generateQuest };
}

module.exports = { createServices };
