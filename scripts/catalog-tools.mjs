import { writeFileSync } from 'node:fs';

export const splitList = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const secureUrl = value => {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
};

export function slugify(value) {
  const slug = String(value || '').normalize('NFKD').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug) return slug;
  let hash = 2166136261;
  for (const char of String(value || 'game')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return `game-${(hash >>> 0).toString(36)}`;
}

export function colorFromId(id) {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const saturation = 42 + (hash % 18);
  const lightness = 38 + (hash % 12);
  const hslToRgb = (h, s, l) => {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
    return [r,g,b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  };
  return `#${hslToRgb(hue, saturation, lightness)}`;
}

export function createCatalogGame(input) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title-required');
  const id = String(input.id || slugify(title));
  const yearValue = Number(input.year);
  const year = Number.isInteger(yearValue) && yearValue >= 1970 && yearValue <= 2100 ? yearValue : null;
  const genres = splitList(input.genres);
  const platforms = splitList(input.platforms);
  const memory = [...new Set([title, ...splitList(input.memory)])];
  const storeUrl = secureUrl(input.url ?? input.storeUrl);
  const defaultCover = `assets/covers/${id}.svg`;
  const rawCover = String(input.coverUrl || defaultCover).trim();
  const coverUrl = rawCover.startsWith('assets/covers/') ? rawCover : secureUrl(rawCover) || defaultCover;
  const rawFallback = String(input.fallbackCoverUrl || defaultCover).trim();
  const fallbackCoverUrl = rawFallback.startsWith('assets/covers/') ? rawFallback : defaultCover;
  return {
    id, title, year,
    genres: genres.length ? genres : ['기타'],
    tags: splitList(input.tags).length ? splitList(input.tags) : (genres.length ? genres : ['기타']),
    modes: splitList(input.modes).length ? splitList(input.modes) : ['싱글'],
    platforms: platforms.length ? platforms : ['PC'],
    priceKRW: Math.max(0, Number(input.price) || 0),
    length: String(input.length || '중간'),
    difficulty: String(input.difficulty || '보통'),
    mood: String(input.mood || '다채로움'),
    pace: String(input.pace || '보통'),
    perspective: String(input.perspective || '3D'),
    era: year ? `${Math.floor(year / 10) * 10}년대` : '연도 미상',
    memory,
    storeUrl: storeUrl || `https://store.steampowered.com/search/?term=${encodeURIComponent(title)}`,
    coverUrl,
    fallbackCoverUrl,
    color: /^#[0-9a-f]{6}$/i.test(String(input.color || '')) ? input.color : colorFromId(id),
    summary: String(input.summary || `${title}의 플레이 기록과 추천을 위한 카탈로그 항목.`).trim()
  };
}

export function validateCatalog(games) {
  if (!Array.isArray(games)) throw new Error('catalog must be an array');
  const ids = new Set();
  const titles = new Set();
  const arrayFields = ['genres', 'tags', 'modes', 'platforms', 'memory'];
  games.forEach((game, index) => {
    const label = `game[${index}]`;
    if (!game || typeof game !== 'object') throw new Error(`${label} must be an object`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(game.id || '')) throw new Error(`${label} invalid id`);
    if (ids.has(game.id)) throw new Error(`duplicate id: ${game.id}`);
    ids.add(game.id);
    const title = String(game.title || '').trim();
    if (!title) throw new Error(`${label} title required`);
    const titleKey = title.toLocaleLowerCase();
    if (titles.has(titleKey)) throw new Error(`duplicate title: ${title}`);
    titles.add(titleKey);
    for (const field of arrayFields) if (!Array.isArray(game[field]) || game[field].length === 0) throw new Error(`${game.id} ${field} required`);
    if (!(game.year === null || (Number.isInteger(game.year) && game.year >= 1970 && game.year <= 2100))) throw new Error(`${game.id} invalid year`);
    if (!Number.isFinite(game.priceKRW) || game.priceKRW < 0) throw new Error(`${game.id} invalid priceKRW`);
    if (!/^#[0-9a-f]{6}$/i.test(game.color || '')) throw new Error(`${game.id} invalid color`);
    let url;
    try { url = new URL(game.storeUrl); } catch { throw new Error(`${game.id} invalid storeUrl`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${game.id} invalid storeUrl protocol`);
    if (!/^(https:\/\/|assets\/covers\/)/.test(game.coverUrl || '')) throw new Error(`${game.id} invalid coverUrl`);
    if (!/^assets\/covers\/[a-z0-9-]+\.svg$/.test(game.fallbackCoverUrl || '')) throw new Error(`${game.id} invalid fallbackCoverUrl`);
    if (!String(game.summary || '').trim()) throw new Error(`${game.id} summary required`);
  });
  return games;
}

export function writeGeneratedCatalog(games, outputPath) {
  validateCatalog(games);
  const body = '// GENERATED from data/games.json — run npm run catalog:build. Do not edit by hand.\nexport default ' + JSON.stringify(games, null, 2) + ';\n';
  writeFileSync(outputPath, body);
}
