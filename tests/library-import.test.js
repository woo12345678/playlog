import test from 'node:test';
import assert from 'node:assert/strict';
import { games } from '../src/catalog.js';
import { parseQuickLibraryText, parseLibraryCsv, prepareImportedLibraryState } from '../src/library-import.js';
import { createCustomGame } from '../src/game-entry.js';

test('게임명만 한 줄씩 붙여넣으면 별칭을 찾아 기본 0시간 기록으로 만든다', () => {
  const result = parseQuickLibraryText('하데스\n스타듀 밸리\n레이디 버그', games, 'Steam');
  assert.equal(result.library.length, 3);
  assert.deepEqual(result.library.map(row => row.gameId), ['hades', 'stardew-valley', 'lady-bug-donxu']);
  assert(result.library.every(row => row.hours === 0 && row.platform === 'Steam'));
  assert.equal(result.customGames.length, 0);
});

test('쉼표·탭·세로줄로 시간을 선택 입력하고 모르는 게임은 안전한 내 게임으로 만든다', () => {
  const result = parseQuickLibraryText('\ufefftitle,hours\nHades,40\n없는 <게임>|12.5\nPortal 2\t18', games, 'PlayStation');
  assert.equal(result.library.length, 3);
  assert.deepEqual(result.library.map(row => row.hours), [40, 12.5, 18]);
  assert.equal(result.customGames.length, 1);
  assert.equal(result.customGames[0].title, '없는 게임');
  assert.equal(result.customGames[0].platforms[0], 'PlayStation');
  assert.equal(result.rejected.length, 0);
});

test('빈 줄·중복·과도한 시간은 안전하게 정리하고 최대 100줄만 처리한다', () => {
  const many = Array.from({ length: 120 }, (_, index) => `새 게임 ${index},9999999`).join('\n');
  const result = parseQuickLibraryText(`Hades,10\nHades,20\n\n${many}`, games, 'PC');
  assert.equal(result.library[0].hours, 20, '같은 게임은 마지막 줄의 시간으로 갱신');
  assert.equal(result.library.length, 100);
  assert(result.library.every(row => row.hours <= 100000));
  assert(result.truncated);
});

test('일본어와 키릴 제목을 서로 다른 사용자 게임으로 보존한다', () => {
  const result = parseQuickLibraryText('ゼルダ,1\nМарио,2', games, 'Switch');
  assert.equal(result.library.length, 2);
  assert.equal(result.customGames.length, 2);
  assert.notEqual(result.library[0].gameId, result.library[1].gameId);
});

test('101번째 항목은 양쪽에서 만들지 않고 이후 중복 갱신은 반영한다', () => {
  const rows = Array.from({ length: 101 }, (_, index) => `경계 게임 ${index},${index}`).join('\n');
  const result = parseQuickLibraryText(`${rows}\n경계 게임 0,77`, games, 'PC');
  assert.equal(result.library.length, 100);
  assert.equal(result.customGames.length, 100);
  assert.equal(result.library[0].hours, 77);
  assert(result.truncated);
});

test('CSV는 따옴표 속 쉼표·name 헤더·헤더 없는 첫 행과 플랫폼 열을 보존한다', () => {
  const named = parseLibraryCsv('name,hours,platform\n"Sid, Meier 추억",5,PC\nHades,3,Steam', games, '기타');
  assert.equal(named.library.length, 2);
  assert.equal(named.customGames[0].title, 'Sid, Meier 추억');
  assert.deepEqual(named.library.map(row => row.platform), ['PC', 'Steam']);
  const headerless = parseLibraryCsv('Hades,3,Steam\nPortal 2,4,PC', games, '기타');
  assert.equal(headerless.library.length, 2);
  assert.deepEqual(headerless.library.map(row => row.hours), [3, 4]);
});

test('가져오기 준비는 custom 100개 초과와 JSON 1000행 초과를 원본 변경 없이 거부한다', () => {
  const existingCustom = parseQuickLibraryText(Array.from({ length: 100 }, (_, i) => `기존 ${i}`).join('\n'), games, 'PC').customGames;
  const current = { library:[], customGames:existingCustom, seeds:[], newsGames:[], profile:{ name:'테스트', bio:'' } };
  const snapshot = JSON.stringify(current);
  const incoming = parseQuickLibraryText('새로운 101번째', [...games, ...existingCustom], 'PC');
  assert.throws(() => prepareImportedLibraryState(current, incoming.library, incoming.customGames, games), /custom-limit/);
  assert.throws(() => prepareImportedLibraryState(current, Array.from({ length:1001 }, () => ({ gameId:'hades' })), [], games), /library-limit/);
  assert.equal(JSON.stringify(current), snapshot);
});

test('사용자 게임 ID가 기존 카탈로그 ID와 충돌하면 거부한다', () => {
  const candidate = createCustomGame({ title:'충돌 후보' }, []);
  assert.throws(() => createCustomGame({ title:'충돌 후보' }, [{ id:candidate.id, title:'다른 제목' }]), /duplicate-id/);
});
