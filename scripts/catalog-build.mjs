import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, writeGeneratedCatalog } from './catalog-tools.mjs';

const args = process.argv.slice(2);
const values = {};
for (let i = 0; i < args.length; i += 1) {
  if (!args[i].startsWith('--')) continue;
  values[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
}

try {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const source = resolve(values.source || `${root}/data/games.json`);
  const output = resolve(values.output || `${root}/src/catalog.generated.js`);
  const games = validateCatalog(JSON.parse(readFileSync(source, 'utf8')));
  writeGeneratedCatalog(games, output);
  console.log(`CATALOG OK · ${games.length} games · ${output}`);
} catch (error) {
  console.error(`CATALOG BUILD FAILED: ${error.message}`);
  process.exitCode = 1;
}
