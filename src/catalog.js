import generatedGames from './catalog.generated.js';

export const games = generatedGames;
export const gameById = new Map(games.map(game => [game.id, game]));
export const platforms = [...new Set(games.flatMap(game => game.platforms))].sort();
