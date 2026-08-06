import test from 'node:test';
import assert from 'node:assert/strict';
import { games } from '../src/catalog.js';
import { recommendGames } from '../src/recommender.js';
import { calculateStats, encodeShare, decodeShare, normalizeLibrary } from '../src/library.js';
import { findRememberedGames } from '../src/memory-finder.js';
import { searchGames, createCustomGame, mergeCatalog } from '../src/game-entry.js';

test('카탈로그는 실제 추천에 충분하고 식별자가 고유하다', () => {
  assert(games.length >= 40);
  assert.equal(new Set(games.map(game => game.id)).size, games.length);
  assert.equal(new Set(games.map(game => game.title)).size, games.length);
  for (const game of games) {
    for (const field of ['id', 'title', 'year', 'priceKRW', 'length', 'difficulty', 'color']) assert.notEqual(game[field], undefined, `${game.title}: ${field}`);
    assert(game.genres.length && game.tags.length && game.modes.length && game.platforms.length);
    assert(/^https:\/\//.test(game.storeUrl));
  }
});

test('추천은 두 입력 게임을 제외하고 점수와 사람에게 읽히는 이유를 준다', () => {
  const result = recommendGames(games, ['elden-ring', 'stardew-valley'], {});
  assert.equal(result.length, 8);
  assert(!result.some(item => ['elden-ring', 'stardew-valley'].includes(item.game.id)));
  assert(result.every(item => item.score >= 0 && item.score <= 100));
  assert(result.every(item => item.reasons.length >= 2));
  assert(result.every(item => item.seedAffinity.length === 2));
});

test('좋아한 게임을 다섯 개 이상 입력해도 모든 입력작을 제외하고 취향 축을 계산한다', () => {
  const seeds = ['elden-ring', 'stardew-valley', 'hades', 'portal-2', 'monster-hunter-world'];
  const result = recommendGames(games, seeds, {});
  assert.equal(result.length, 8);
  assert(!result.some(item => seeds.includes(item.game.id)));
  assert(result.every(item => item.seedAffinity.length === seeds.length));
  assert(result.every(item => item.reasons.length >= 2));
});

test('플랫폼·모드·가격 필터를 동시에 지킨다', () => {
  const result = recommendGames(games, ['hades', 'dead-cells'], { platform: 'Switch', mode: '싱글', maxPrice: 30000 });
  assert(result.length > 0);
  assert(result.every(item => item.game.platforms.includes('Switch')));
  assert(result.every(item => item.game.modes.includes('싱글')));
  assert(result.every(item => item.game.priceKRW <= 30000));
});

test('라이브러리 통계는 총 시간·게임 수·플랫폼 시간을 계산한다', () => {
  const library = [
    { gameId: 'hades', hours: 40, platform: 'Steam', status: '완료', rating: 5 },
    { gameId: 'stardew-valley', hours: 100.5, platform: 'Switch', status: '플레이 중', rating: 5 },
    { gameId: 'celeste', hours: 12.5, platform: 'Steam', status: '보류', rating: 4 }
  ];
  const stats = calculateStats(library, games);
  assert.equal(stats.totalHours, 153);
  assert.equal(stats.gameCount, 3);
  assert.equal(stats.platformHours.Steam, 52.5);
  assert.equal(stats.platformHours.Switch, 100.5);
  assert.equal(stats.topGame.gameId, 'stardew-valley');
});

test('공유 데이터는 최소 정보만 왕복하고 토큰·계정 ID는 제거한다', () => {
  const source = { name: '현우', bio: '게임을 만들고 플레이합니다.', library: [{ gameId: 'hades', hours: 40, platform: 'Steam', status: '완료', rating: 5, accessToken: 'secret', accountId: '1234' }] };
  const encoded = encodeShare(source);
  assert(!encoded.includes('secret'));
  const decoded = decodeShare(encoded);
  assert.equal(decoded.name, '현우');
  assert.deepEqual(decoded.library[0], { gameId: 'hades', hours: 40, platform: 'Steam', status: '완료', rating: 5 });
  assert.equal(decodeShare('망가진값'), null);
});

test('가져온 라이브러리는 잘못된 행을 버리고 수치를 제한한다', () => {
  const clean = normalizeLibrary([
    { gameId: 'hades', hours: 9999999, platform: 'Steam', status: '완료', rating: 12 },
    { gameId: 'not-real', hours: 3, platform: 'Steam' },
    null
  ], games);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].hours, 100000);
  assert.equal(clean[0].rating, 5);
});

test('추억 단서로 후보·확신도·일치 근거를 돌려준다', () => {
  const results = findRememberedGames(games, {
    text: '눈 오는 맵에서 형제가 적을 눈덩이로 만들어 굴렸어요',
    era: '1990년대',
    perspective: '2D',
    mode: '협동'
  });
  assert(results.length >= 3);
  assert.equal(results[0].game.id, 'snow-bros');
  assert(results[0].confidence > results[1].confidence);
  assert(results[0].matchedClues.length >= 3);
});

test('추억 검색은 빈 입력을 안전하게 안내한다', () => {
  assert.deepEqual(findRememberedGames(games, { text: '' }), []);
});

test('레이디버그와 기울기 기억으로 Donxu 원작 Lady Bug를 찾는다', () => {
  const ladybug = games.find(game => game.id === 'lady-bug-donxu');
  assert(ladybug, 'Donxu Lady Bug가 카탈로그에 있어야 합니다.');
  assert(ladybug.memory.some(clue => /com\.donxu\.lady_bug/.test(clue)));
  const results = findRememberedGames(games, {
    text: '레이디버그 무당벌레를 스마트폰 기울기로 움직여 정원에서 싸웠어요'
  });
  assert.equal(results[0]?.game.id, 'lady-bug-donxu');
  assert(results[0].matchedClues.some(clue => /레이디|무당벌레|기울/.test(clue)));
});

test('게임 검색은 영문 붙여쓰기와 한글 별칭으로 Lady Bug를 찾는다', () => {
  assert.equal(searchGames(games, 'ladybug')[0]?.id, 'lady-bug-donxu');
  assert.equal(searchGames(games, '레이디 버그')[0]?.id, 'lady-bug-donxu');
});

test('목록에 없는 게임을 안전한 사용자 게임으로 만들어 통계에 포함한다', () => {
  const custom = createCustomGame({
    title: '<b>나만의 우주 게임</b>',
    genre: '슈팅, 탐험',
    platform: '내 콘솔',
    memory: '보라색 우주선으로 별을 모았어요'
  }, games);
  assert.equal(custom.title, '나만의 우주 게임');
  assert.deepEqual(custom.genres, ['슈팅', '탐험']);
  assert(custom.id.startsWith('custom-'));
  const catalog = mergeCatalog(games, [custom]);
  const stats = calculateStats([{ gameId: custom.id, hours: 42, platform: '내 콘솔', status: '완료', rating: 5 }], catalog);
  assert.equal(stats.totalHours, 42);
  assert.equal(stats.topGame.gameId, custom.id);
});

test('공유 데이터는 사용자 게임을 보존하지만 비밀 필드는 제거한다', () => {
  const custom = createCustomGame({ title: '작은 게임', genre: '퍼즐', platform: 'PC' }, games);
  const encoded = encodeShare({ name: '춘식', customGames: [{ ...custom, token: 'secret' }], library: [{ gameId: custom.id, hours: 3, platform: 'PC', status: '완료', rating: 4 }] });
  const decoded = decodeShare(encoded);
  assert.equal(decoded.customGames[0].title, '작은 게임');
  assert.equal(decoded.customGames[0].token, undefined);
  assert.equal(decoded.library[0].gameId, custom.id);
});
