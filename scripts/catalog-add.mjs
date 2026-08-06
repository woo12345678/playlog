import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalogGame, validateCatalog, writeGeneratedCatalog } from './catalog-tools.mjs';

const args = process.argv.slice(2);
const values = {};
for (let i = 0; i < args.length; i += 1) {
  if (!args[i].startsWith('--')) continue;
  values[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
}

try {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const sourcePath = resolve(values.file || `${root}/data/games.json`);
  const games = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const game = createCatalogGame(values);
  if (games.some(item => item.id === game.id)) throw new Error(`duplicate-id:${game.id}`);
  if (games.some(item => item.title.toLocaleLowerCase() === game.title.toLocaleLowerCase())) throw new Error(`duplicate-title:${game.title}`);
  games.push(game);
  validateCatalog(games);
  writeFileSync(sourcePath, JSON.stringify(games, null, 2) + '\n');
  if (!values.file) writeGeneratedCatalog(games, resolve(root, 'src/catalog.generated.js'));
  console.log(`ADDED ${game.id} · ${game.title} · total ${games.length}`);
} catch (error) {
  console.error(`CATALOG ADD FAILED: ${error.message}`);
  process.exitCode = 1;
}
