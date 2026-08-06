import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { games } from '../src/catalog.js';

const sourcePath = new URL('../data/games.json', import.meta.url);
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('게임 카탈로그는 개발자가 편집할 단일 JSON 원본과 앱 데이터가 일치한다', () => {
  assert(existsSync(sourcePath), 'data/games.json 단일 원본이 필요합니다.');
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  assert.equal(games.length, source.length);
  assert.deepEqual(games.map(game => game.id), source.map(game => game.id));
});

test('개발자는 최소 인자로 새 게임을 JSON에 추가할 수 있다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'playlog-catalog-'));
  const file = join(directory, 'games.json');
  writeFileSync(file, '[]\n');
  const result = spawnSync(process.execPath, [
    'scripts/catalog-add.mjs', '--file', file,
    '--title', 'Developer Test Game', '--year', '2025',
    '--genres', '퍼즐,어드벤처', '--platforms', 'PC',
    '--memory', '보라색 문,별 조각'
  ], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const added = JSON.parse(readFileSync(file, 'utf8'))[0];
  assert.equal(added.id, 'developer-test-game');
  assert.equal(added.title, 'Developer Test Game');
  assert.deepEqual(added.genres, ['퍼즐', '어드벤처']);
  assert.deepEqual(added.platforms, ['PC']);
  assert(added.memory.includes('보라색 문'));
  assert.match(added.color, /^#[0-9a-f]{6}$/i);
});

test('카탈로그 빌드는 중복 ID를 발견하면 생성하지 않는다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'playlog-build-'));
  const source = join(directory, 'games.json');
  const output = join(directory, 'catalog.generated.js');
  writeFileSync(source, JSON.stringify([games[0], games[0]]));
  const result = spawnSync(process.execPath, [
    'scripts/catalog-build.mjs', '--source', source, '--output', output
  ], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate id/i);
  assert.equal(existsSync(output), false);
});

test('개발 문서는 게임 추가와 검증 명령을 그대로 실행할 수 있게 안내한다', () => {
  assert.equal(packageJson.scripts['catalog:add'], 'node scripts/catalog-add.mjs');
  assert.equal(packageJson.scripts['catalog:build'], 'node scripts/catalog-build.mjs');
  assert(readme.includes('data/games.json'));
  assert(readme.includes('npm run catalog:add --'));
  assert(readme.includes('npm run catalog:build'));
});
