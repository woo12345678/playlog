import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { buildNewsQuery, normalizeNewsItem, isNewsRelevant } from '../src/news.js';
import { parseGoogleNewsXml, parseYouTubeInitialData } from './news-sources.mjs';
import { chooseSourceItems, cacheRunMetadata } from './news-cache-policy.mjs';

const root = new URL('../', import.meta.url);
const sourceUrl = new URL('data/games.json', root);
const outputUrl = new URL('data/news.json', root);
mkdirSync(new URL('data/', root), { recursive: true });
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };
const limit = Math.max(0, Number(option('--limit')) || 0);
const onlyIds = new Set(String(option('--ids') || '').split(',').map(value => value.trim()).filter(Boolean));
const concurrency = Math.max(1, Math.min(10, Number(option('--concurrency')) || 4));
const games = JSON.parse(readFileSync(sourceUrl, 'utf8'));
const previous = existsSync(outputUrl) ? JSON.parse(readFileSync(outputUrl, 'utf8')) : { version:1, games:{} };
let targets = onlyIds.size ? games.filter(game => onlyIds.has(game.id)) : games;
if (limit) targets = targets.slice(0, limit);
const runAt = new Date().toISOString();
const fullRefresh = !onlyIds.size && !limit;
const pruneCache = fullRefresh || args.includes('--prune');
const catalogIds = new Set(games.map(game => game.id));
const retainedGames = pruneCache ? Object.fromEntries(Object.entries(previous.games || {}).filter(([id]) => catalogIds.has(id))) : { ...(previous.games || {}) };
const output = { version:1, ...cacheRunMetadata(previous, runAt, fullRefresh), catalogCount:games.length, refreshHours:12, games:retainedGames };
const failures = [];

async function fetchText(url, attempts = 3) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal:AbortSignal.timeout(25000), headers:{ 'user-agent':'Mozilla/5.0 (compatible; PLAYLOG-News/1.0; +https://woo12345678.github.io/playlog/)', 'accept-language':'ko-KR,ko;q=0.9,en;q=0.8' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    } catch (caught) { error = caught; await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1))); }
  }
  throw error;
}
function newsUrl(game) {
  const params = new URLSearchParams({ q:buildNewsQuery(game), hl:'ko', gl:'KR', ceid:'KR:ko' });
  return `https://news.google.com/rss/search?${params}`;
}
function youtubeUrl(game) {
  const params = new URLSearchParams({ search_query:`${game.title} game`, sp:'CAI%3D', hl:'ko' });
  return `https://www.youtube.com/results?${params}`;
}
const day = 86_400_000;
function relevant(items, game) {
  const threshold = Date.now() - 120 * day;
  return items.map(normalizeNewsItem).filter(Boolean)
    .filter(item => Date.parse(item.publishedAt) >= threshold)
    .filter(item => isNewsRelevant(item, game))
    .sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
async function updateGame(game) {
  const oldItems = relevant(previous.games?.[game.id]?.items || [], game);
  let news = oldItems.filter(item => item.type !== 'video');
  let videos = oldItems.filter(item => item.type === 'video');
  let newsOk = false, youtubeOk = false;
  try {
    const choice = chooseSourceItems(news, relevant(parseGoogleNewsXml(await fetchText(newsUrl(game))), game).slice(0, 8));
    news = choice.items; newsOk = choice.ok;
    if (!choice.ok) failures.push({ gameId:game.id, source:'news', error:choice.reason });
  } catch (error) { failures.push({ gameId:game.id, source:'news', error:error.message }); }
  try {
    const choice = chooseSourceItems(videos, relevant(parseYouTubeInitialData(await fetchText(youtubeUrl(game))), game).slice(0, 5));
    videos = choice.items; youtubeOk = choice.ok;
    if (!choice.ok) failures.push({ gameId:game.id, source:'youtube', error:choice.reason });
  } catch (error) { failures.push({ gameId:game.id, source:'youtube', error:error.message }); }
  const items = [...videos, ...news].sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 12);
  const previousFetchedAt = previous.games?.[game.id]?.fetchedAt || null;
  output.games[game.id] = {
    query: buildNewsQuery(game),
    fetchedAt: newsOk || youtubeOk ? runAt : previousFetchedAt,
    status: newsOk && youtubeOk ? 'fresh' : items.length ? 'partial-cache' : 'unavailable',
    sources: { news:newsOk, youtube:youtubeOk },
    items
  };
}

let cursor = 0, completed = 0;
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= targets.length) return;
    await updateGame(targets[index]);
    completed += 1;
    if (completed % 5 === 0 || completed === targets.length) process.stdout.write(`\rNews ${completed}/${targets.length} · failures ${failures.length}`);
  }
}
await Promise.all(Array.from({ length:Math.min(concurrency, targets.length || 1) }, worker));
console.log();
output.failures = failures.slice(0, 100);
writeFileSync(outputUrl, `${JSON.stringify(output, null, 2)}\n`);
console.log(`NEWS CACHE OK · ${targets.length} games · ${Object.values(output.games).reduce((sum,row)=>sum+(row.items?.length||0),0)} items · ${failures.length} source failures`);
