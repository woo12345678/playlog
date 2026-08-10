import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { games } from '../src/catalog.js';
import { recommendGames } from '../src/recommender.js';
import { calculateStats, encodeShare, decodeShare, normalizeLibrary, shareOmissionCounts } from '../src/library.js';
import { findRememberedGames } from '../src/memory-finder.js';
import { searchGames, createCustomGame, mergeCatalog } from '../src/game-entry.js';

test('카탈로그는 실제 추천에 충분하고 식별자가 고유하다', () => {
  assert(games.length >= 171, `기존 71개에 100개 이상을 추가해야 합니다: ${games.length}`);
  assert.equal(new Set(games.map(game => game.id)).size, games.length);
  assert(new Set(games.flatMap(game => game.genres)).size >= 25, '장르가 한쪽에 몰리지 않아야 합니다.');
  assert(new Set(games.flatMap(game => game.platforms)).size >= 8, '플랫폼이 다양해야 합니다.');
  assert.equal(new Set(games.map(game => game.title)).size, games.length);
  for (const game of games) {
    for (const field of ['id', 'title', 'year', 'priceKRW', 'length', 'difficulty', 'color']) assert.notEqual(game[field], undefined, `${game.title}: ${field}`);
    assert(game.genres.length && game.tags.length && game.modes.length && game.platforms.length);
    assert(/^(https:\/\/|assets\/covers\/)/.test(game.coverUrl || ''), `${game.title}: coverUrl`);
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

test('사용자 게임 100개 공유 링크도 24000자 이내에서 자체 디코드된다', () => {
  const customGames = Array.from({ length:100 }, (_, index) => createCustomGame({
    title:`공유 사용자 게임 ${index}`,
    genre:'Steam 가져오기',
    platform:'Steam',
    memory:Array.from({ length:8 }, (__, clue) => `사용자 기억 단서 ${index}-${clue}`),
    summary:`Steam에서 자동으로 가져온 사용자 게임 ${index}의 공유 설명입니다.`
  }, []));
  const library = customGames.map((game, index) => ({ gameId:game.id, hours:index, platform:'Steam', status:'플레이 중', rating:0 }));
  const encoded = encodeShare({ name:'대형 프로필', customGames, library });
  const decoded = decodeShare(encoded);
  assert(encoded.length <= 24000);
  assert(decoded);
  assert(decoded.library.length > 0);
  assert.equal(decoded.customGames.length, decoded.library.length);
});

test('1,000개 라이브러리 공유는 정책 제외 900개와 URL 추가 제외를 구분한다', () => {
  assert.deepEqual(shareOmissionCounts(1000, 100), { policyOmitted:900, lengthOmitted:0 });
  assert.deepEqual(shareOmissionCounts(100, 29), { policyOmitted:0, lengthOmitted:71 });
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

test('기존 카탈로그와 Steam 사용자 게임을 병합해도 최종 라이브러리는 1000개다', () => {
  const customGames = Array.from({ length:1000 }, (_, index) => createCustomGame({ title:`Steam 상한 게임 ${index}`, platform:'Steam' }, games));
  const catalog = mergeCatalog(games, customGames);
  const entries = catalog.map((game, index) => ({ gameId:game.id, hours:index, platform:'Steam', status:'플레이 중', rating:0 }));
  const clean = normalizeLibrary(entries, catalog);
  assert.equal(clean.length, 1000);
  assert.equal(new Set(clean.map(entry => entry.gameId)).size, 1000);
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

test('186개 추억 검색은 반복 입력에도 150ms 안에 응답한다', () => {
  const started = performance.now();
  for (let i = 0; i < 20; i += 1) findRememberedGames(games, { text: '작은 흰색 로봇 듀얼센스' });
  assert(performance.now() - started < 150);
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
  assert.equal(searchGames(games, 'ladybug')[0].id, 'lady-bug-donxu');
  assert.equal(searchGames(games, '레이디 버그')[0].id, 'lady-bug-donxu');
});

test('신규 영문 게임도 한국어 통용 제목으로 검색한다', () => {
  assert.equal(searchGames(games, '하데스 2')[0]?.id, 'hades-ii');
  assert.equal(searchGames(games, '아스트로 봇')[0]?.id, 'astro-bot');
  assert.equal(searchGames(games, '왕국의 눈물')[0]?.id, 'zelda-tears-of-the-kingdom');
});

test('요청한 모바일 게임 5개와 추가 10개를 더해 186개 이상 검색한다', () => {
  assert(games.length >= 186, `지정 5개와 추가 모바일 10개가 필요합니다: ${games.length}`);
  const expected = new Map([
    ['클래시 오브 클랜', 'Clash of Clans'],
    ['브롤스타즈', 'Brawl Stars'],
    ['헤이데이', 'Hay Day'],
    ['붐비치', 'Boom Beach']
  ]);
  for (const [query, title] of expected) assert.equal(searchGames(games, query)[0]?.title, title, `${query} 검색 실패`);
  assert(searchGames(games, '매직브릭 인피니티')[0], '매직브릭 인피니티 검색 실패');
});

test('요청한 플랫폼 확장 배치와 대규모 추억 게임 카탈로그를 함께 보존한다', () => {
  const steam = games.filter(game => game.tags.includes('Steam 인기 2026'));
  const mobile = games.filter(game => game.tags.includes('모바일 인기 확장'));
  const nintendo = games.filter(game => game.tags.includes('Nintendo Switch 확장'));
  assert.equal(games.length, 618, `검증된 전체 카탈로그 수가 달라졌습니다: ${games.length}`);
  assert.equal(steam.length, 100);
  assert.equal(mobile.length, 50);
  assert.equal(nintendo.length, 50);
  assert(games.filter(game => game.platforms.includes('Steam')).length >= 221);
  assert(games.filter(game => game.platforms.includes('Mobile')).length >= 104);
  assert(games.filter(game => game.platforms.includes('Switch')).length >= 146);
});

test('추억 확장 수량과 Web·Flash 분류를 정확히 보존한다', () => {
  const imported = games.filter(game => game.source === 'PLAYLOG curated nostalgia expansion');
  const nostalgia = games.filter(game => game.year >= 2006 && game.year <= 2016);
  const web = imported.filter(game => game.platforms.some(platform => ['Web', 'Flash'].includes(platform)));
  const mainstream = imported.filter(game => !game.platforms.some(platform => ['Web', 'Flash'].includes(platform)));
  assert.equal(imported.length, 232);
  assert.equal(nostalgia.length, 272);
  assert.equal(web.length, 108);
  assert.equal(mainstream.length, 124);
  for (const game of imported.filter(game => game.platforms.includes('Nintendo'))) {
    assert.match(game.storeUrl, /^https:\/\/(www\.)?nintendo\.com\//, `${game.title}는 Nintendo 공식 링크여야 합니다.`);
  }
  for (const [id, perspective] of Object.entries({
    'the-witness': '3D',
    'xcom-2': '3D',
    'hyper-light-drifter': '2D',
    'this-war-of-mine': '2D',
    'the-world-ends-with-you': '2D'
  })) assert.equal(games.find(game => game.id === id)?.perspective, perspective, `${id} 화면 분류`);
  for (const id of ['boxhead-2play-rooms', 'fireboy-and-watergirl-forest-temple', 'fancy-pants-adventures', 'age-of-war', 'bloons-tower-defense-4', 'line-rider']) {
    assert(games.some(game => game.id === id), `${id} 필요`);
  }
});

test('웹게임의 특징적인 기억으로 Boxhead와 불물 게임을 찾는다', () => {
  const boxhead = findRememberedGames(games, { text: '네모난 사람 둘이 웹에서 좀비를 총으로 막던 게임' });
  assert.equal(boxhead[0]?.game.id, 'boxhead-2play-rooms');
  const fireboy = findRememberedGames(games, { text: '불과 물 캐릭터 둘이 사원에서 보석을 먹는 2인용 웹게임' });
  assert.equal(fireboy[0]?.game.id, 'fireboy-and-watergirl-forest-temple');
  const lineRider = findRememberedGames(games, { text: '선 그려서 썰매 타는 소년 웹게임' });
  assert.equal(lineRider[0]?.game.id, 'line-rider');
});

test('한 글자와 taxonomy 일반어만으로 추억 후보를 만들지 않는다', () => {
  for (const text of ['a', 'n', '가', '웹게임', '플래시게임']) {
    assert.deepEqual(findRememberedGames(games, { text }), [], `${text} 입력은 후보를 만들면 안 됩니다.`);
  }
});

test('618개 추억 검색도 반복 입력에 180ms 안에 응답한다', () => {
  const started = performance.now();
  for (let i = 0; i < 20; i += 1) findRememberedGames(games, { text: '옛날 웹게임 좀비 둘이 총 쏘는 네모난 캐릭터' });
  assert(performance.now() - started < 180);
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
