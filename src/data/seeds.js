function createSeeds() {
  const quests = [
    ['Rats in the Cellar', 'Clear the inn cellar of giant rats.', 'easy', 1, 20, 50],
    ['Herbs for the Healer', 'Gather moonleaf in the Whispering Woods.', 'easy', 1, 25, 60],
    ['The Lost Familiar', 'Find the apprentice wizard’s missing owl.', 'easy', 1, 30, 75],
    ['Escort the Caravan', 'Guard merchants on the road to Silverkeep.', 'medium', 3, 100, 200],
    ['Goblin Toll Bridge', 'Reclaim the bridge from goblin raiders.', 'medium', 4, 150, 300],
    ['The Sunken Shrine', 'Recover a relic from the flooded shrine.', 'medium', 5, 200, 400],
    ['Troll of Blackstone Pass', 'Drive the mountain troll from the pass.', 'hard', 8, 500, 900],
    ['The Lich’s Library', 'Retrieve the spellbook from an undead archive.', 'hard', 10, 800, 1400],
    ['Dragon of Ember Peak', 'Defeat the dragon terrorizing the valley.', 'legendary', 15, 3000, 5000],
    ['Seal the Shadow Gate', 'Close the portal before the shadow host arrives.', 'legendary', 20, 5000, 8000],
  ].map(([title, description, difficulty, minimumLevel, goldReward, experienceReward], i) => ({
    id: `quest-${i + 1}`,
    title,
    description,
    difficulty,
    minimumLevel,
    goldReward,
    experienceReward,
    status: ['open', 'in-progress', 'completed'][i % 3],
    createdAt: '2026-01-01T00:00:00.000Z',
  }));

  const adventurers = [
    ['Aria Moonbow', 5, 450, 120, 'active'],
    ['Borin Ironshield', 10, 1500, 800, 'active'],
    ['Lyra Starweaver', 15, 4000, 2000, 'active'],
    ['Finn Quickstep', 1, 0, 10, 'active'],
    ['Mira Dawnheart', 8, 950, 500, 'inactive'],
  ].map(([name, level, experience, gold, status], i) => ({
    id: `adventurer-${i + 1}`, name, level, experience, gold, status,
  }));

  return { quests, adventurers };
}

module.exports = { createSeeds };
