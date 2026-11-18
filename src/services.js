const { InMemoryRepository } = require('./data/repository');
const { createSeeds } = require('./data/seeds');
const { GuildService } = require('./domain/guild-service');
const { createQuestGenerator, generationMaxOutputTokens } = require('./domain/quest-generator');
const { createFoundryModelService } = require('./foundry/model-service');

const jsonLogger = {
  info: entry => console.log(JSON.stringify(entry)),
  error: entry => console.error(JSON.stringify(entry)),
};

function createServices({
  env = process.env, modelService = createFoundryModelService({ env }), logger = jsonLogger,
} = {}) {
  const seeds = createSeeds();
  const guild = Object.fromEntries(Object.entries(seeds)
    .map(([resource, items]) => [
      resource, new GuildService(resource, new InMemoryRepository(items)),
    ]));
  const questGenerator = createQuestGenerator({
    adventurers: guild.adventurers, quests: guild.quests, model: modelService, logger,
    maxOutputTokens: generationMaxOutputTokens(env),
  });
  return { guild, model: modelService, questGenerator };
}

module.exports = { createServices };
