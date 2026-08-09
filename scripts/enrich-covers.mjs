import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { validateCatalog } from './catalog-tools.mjs';

const sourceUrl = new URL('../data/games.json', import.meta.url);
const coverDir = new URL('../assets/covers/', import.meta.url);
mkdirSync(coverDir, { recursive: true });
const games = JSON.parse(readFileSync(sourceUrl, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const canonical = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^a-z0-9가-힣]+/g, '');
const xml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[char]));
const lines = title => {
  const chars = [...String(title || '')];
  const output = [];
  while (chars.length && output.length < 4) output.push(chars.splice(0, 16).join(''));
  return output.length ? output : ['UNKNOWN GAME'];
};

function ensureFallback(game) {
  const path = new URL(`${game.id}.svg`, coverDir);
  if (!existsSync(path)) {
    const titleLines = lines(game.title);
    const text = titleLines.map((line, index) => `<text x="48" y="${470 + index * 66}" font-size="50" font-weight="800" fill="#fff">${xml(line)}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${game.color}"/><stop offset="1" stop-color="#111218"/></linearGradient><filter id="n"><feTurbulence baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .12 0"/></filter></defs><rect width="600" height="900" fill="url(#g)"/><rect width="600" height="900" filter="url(#n)" opacity=".45"/><text x="48" y="78" font-family="monospace" font-size="20" letter-spacing="5" fill="#fff" opacity=".8">PLAYLOG / COVER</text><path d="M48 126h108" stroke="#fff" stroke-width="8"/><g font-family="Arial,Apple SD Gothic Neo,Malgun Gothic,sans-serif">${text}</g><text x="48" y="830" font-family="monospace" font-size="22" fill="#fff" opacity=".82">${xml(game.year ?? 'YEAR UNKNOWN')} · ${xml((game.platforms || []).slice(0,2).join(' / '))}</text></svg>`;
    writeFileSync(path, svg);
  }
  return `assets/covers/${game.id}.svg`;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal:AbortSignal.timeout(15000), headers:{ 'user-agent':'Mozilla/5.0 PLAYLOG cover enricher' } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
async function fetchText(url) {
  const response = await fetch(url, { signal:AbortSignal.timeout(15000), headers:{ 'user-agent':'Mozilla/5.0 PLAYLOG cover enricher' } });
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}
function metaImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i
  ];
  return patterns.map(pattern => html.match(pattern)?.[1]).find(Boolean)?.replace(/&amp;/g, '&') || '';
}
async function officialCover(game) {
  const steamId = game.source?.appId || game.storeUrl?.match(/store\.steampowered\.com\/app\/(\d+)/)?.[1];
  if (steamId) return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_600x900_2x.jpg`;
  const appleId = game.source?.trackId || game.storeUrl?.match(/\/id(\d+)/)?.[1];
  if (appleId) {
    const result = await fetchJson(`https://itunes.apple.com/lookup?id=${appleId}&country=kr`);
    const app = result.results?.[0];
    if (app?.artworkUrl512 || app?.artworkUrl100) return app.artworkUrl512 || app.artworkUrl100;
  }
  if (game.platforms?.includes('Steam')) {
    const search = await fetchJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(game.title)}&l=english&cc=KR`);
    const match = search.items?.find(item => canonical(item.name) === canonical(game.title));
    if (match?.id) return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${match.id}/library_600x900_2x.jpg`;
  }
  if (game.platforms?.includes('Mobile')) {
    const search = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(game.title)}&entity=software&country=kr&limit=8`);
    const match = search.results?.find(item => canonical(item.trackName) === canonical(game.title) || canonical(item.trackName).includes(canonical(game.title)));
    if (match?.artworkUrl512 || match?.artworkUrl100) return match.artworkUrl512 || match.artworkUrl100;
  }
  if (/^https:\/\//.test(game.storeUrl || '') && !/google\.com\/search|bing\.com\/search/i.test(game.storeUrl)) {
    const image = metaImage(await fetchText(game.storeUrl));
    if (/^https:\/\//.test(image)) return image;
  }
  return '';
}

let official = 0, fallback = 0;
for (let start = 0; start < games.length; start += 6) {
  const chunk = games.slice(start, start + 6);
  await Promise.all(chunk.map(async game => {
    game.fallbackCoverUrl = ensureFallback(game);
    if (/^https:\/\//.test(game.coverUrl || '')) { official += 1; return; }
    try { game.coverUrl = await officialCover(game); } catch { /* deterministic fallback below */ }
    if (game.coverUrl) official += 1;
    else { game.coverUrl = game.fallbackCoverUrl; fallback += 1; }
  }));
  process.stdout.write(`\rCovers ${Math.min(start + 6, games.length)}/${games.length} · official ${official} · fallback ${fallback}`);
  await sleep(80);
}
console.log();
validateCatalog(games);
writeFileSync(sourceUrl, `${JSON.stringify(games, null, 2)}\n`);
console.log(`COVER ENRICH OK · ${official} official · ${fallback} local fallback · ${games.length} total`);
