import test from 'node:test';
import assert from 'node:assert/strict';
import { games } from '../src/catalog.js';
import { convertSteamLibrary, steamLoginUrl } from '../src/steam-integration.js';

test('Steam 게임을 플레이 분에서 시간으로 바꾸고 정확한 카탈로그 제목에 연결한다', () => {
  const result = convertSteamLibrary([
    { appId:1145360, name:'<b>Hades</b>', playtimeForever:125 },
    { appId:413150, name:'스타듀 밸리', playtimeForever:7200 }
  ], games);
  assert.deepEqual(result.library.map(row => row.gameId), ['hades', 'stardew-valley']);
  assert.deepEqual(result.library.map(row => row.hours), [2.1, 120]);
  assert.equal(result.customGames.length, 0);
});

test('Steam AppID는 문장부호 제목 충돌보다 steam 전용 catalog 항목을 우선한다', () => {
  const result = convertSteamLibrary([
    { appId:553850, name:'HELLDIVERS™ 2', playtimeForever:10 },
    { appId:1172470, name:'Apex Legends™', playtimeForever:20 },
    { appId:1222670, name:'The Sims™ 4', playtimeForever:30 }
  ], games);
  assert.deepEqual(result.library.map(entry => entry.gameId), ['steam-553850', 'steam-1172470', 'steam-1222670']);
  assert.equal(result.customGames.length, 0);
});

test('카탈로그에 없는 Steam 게임은 안전한 사용자 게임으로 만들고 임의 계정 필드는 버린다', () => {
  const result = convertSteamLibrary([{ appId:999, name:'<b>나만의 Steam 게임</b>', playtimeForever:90, token:'secret', steamId:'private' }], games);
  assert.equal(result.library.length, 1);
  assert.equal(result.library[0].hours, 1.5);
  assert.equal(result.customGames[0].title, '나만의 Steam 게임');
  assert(!JSON.stringify(result).includes('secret'));
  assert(!JSON.stringify(result).includes('private'));
});

test('Steam 라이브러리는 중복·잘못된 행을 거르고 최대 1000개까지 처리한다', () => {
  const rows = Array.from({ length:1001 }, (_, index) => ({ appId:900000000 + index, name:`Steam 소장 게임 ${index}`, playtimeForever:index }));
  rows.splice(2, 0, { appId:900000000, name:'중복', playtimeForever:999 });
  const result = convertSteamLibrary(rows, games);
  assert.equal(result.library.length, 1000);
  assert.equal(result.customGames.length, 1000);
  assert(result.truncated);
});

test('Steam 로그인 URL은 HTTPS backend와 현재 PLAYLOG return URL을 보존한다', () => {
  const result = new URL(steamLoginUrl('https://playlog-steam.example.workers.dev', 'https://woo12345678.github.io/playlog/?from=test'));
  assert.equal(result.origin, 'https://playlog-steam.example.workers.dev');
  assert.equal(result.pathname, '/auth/steam');
  assert.equal(result.searchParams.get('return_to'), 'https://woo12345678.github.io/playlog/?from=test');
  assert.throws(() => steamLoginUrl('http://evil.example', 'https://woo12345678.github.io/playlog/'));
});
