import { createCustomGame } from './game-entry.js';
import { normalizeLibrary } from './library.js';

export const MAX_STEAM_GAMES = 1000;
const identity = value => String(value || '').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]+/gu, '');
const cleanTitle = value => String(value || '').replace(/<[^>]*>/g, '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
const catalogSteamAppId = game => {
  const match = String(game?.storeUrl || '').match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match ? Number(match[1]) : null;
};

function catalogIndex(catalog) {
  const output = new Map();
  for (const game of catalog) {
    for (const value of [game.title, ...(game.newsAliases || [])]) {
      const key = identity(value);
      if (key && !output.has(key)) output.set(key, game);
    }
  }
  return output;
}

export function convertSteamLibrary(items, baseCatalog) {
  const source = Array.isArray(items) ? items.slice(0, MAX_STEAM_GAMES * 2) : [];
  const working = [...baseCatalog];
  const byAppId = new Map();
  for (const game of working) {
    const appId = catalogSteamAppId(game);
    if (!appId) continue;
    if (!byAppId.has(appId) || game.id === `steam-${appId}`) byAppId.set(appId, game);
  }
  const byIdentity = catalogIndex(working);
  const ids = new Set(working.map(game => game.id));
  const customGames = [];
  const library = [];
  const seenApps = new Set();
  let rejected = 0;

  for (const item of source) {
    const appId = Number(item?.appId);
    const name = cleanTitle(item?.name);
    if (!Number.isInteger(appId) || appId <= 0 || !name || seenApps.has(appId)) { rejected += 1; continue; }
    seenApps.add(appId);
    if (library.length >= MAX_STEAM_GAMES) continue;
    const key = identity(name);
    let game = byAppId.get(appId) || (key ? byIdentity.get(key) : null);
    if (!game) {
      try {
        game = createCustomGame({
          title:name,
          genre:'Steam 가져오기',
          platform:'Steam',
          memory:[`Steam AppID ${appId}`],
          summary:'Steam 로그인으로 가져온 사용자 게임입니다.'
        }, []);
        if (ids.has(game.id)) throw new Error('duplicate-id');
        ids.add(game.id); customGames.push(game); working.push(game); byIdentity.set(key, game);
      } catch { rejected += 1; continue; }
    }
    library.push({
      gameId:game.id,
      hours:Math.round(Math.max(0, Number(item.playtimeForever) || 0) / 6) / 10,
      platform:'Steam',
      status:'플레이 중',
      rating:0
    });
  }

  return {
    library:normalizeLibrary(library, working),
    customGames,
    rejected,
    truncated:Array.isArray(items) && items.length > MAX_STEAM_GAMES
  };
}

export function steamLoginUrl(apiBase, pageUrl) {
  const backend = new URL(apiBase);
  if (backend.protocol !== 'https:' && backend.hostname !== '127.0.0.1' && backend.hostname !== 'localhost') throw new Error('invalid-steam-backend');
  const target = new URL('/auth/steam', backend);
  target.searchParams.set('return_to', new URL(pageUrl).href);
  return target.href;
}
