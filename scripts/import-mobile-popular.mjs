import { readFileSync, writeFileSync } from 'node:fs';
import { createCatalogGame, validateCatalog } from './catalog-tools.mjs';

const sourceUrl = new URL('../data/games.json', import.meta.url);
const original = JSON.parse(readFileSync(sourceUrl, 'utf8'));
const base = original.filter(game => !game.tags?.includes('모바일 인기 확장'));
const canonical = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^a-z0-9가-힣]+/g, '');
const existing = new Set(base.flatMap(game => [game.title, ...(game.memory || []).slice(0, 3), ...(game.newsAliases || [])].map(canonical)).filter(Boolean));
const feedUrls = [
  ['무료 차트', 'https://itunes.apple.com/kr/rss/topfreeapplications/limit=100/genre=6014/json'],
  ['유료 차트', 'https://itunes.apple.com/kr/rss/toppaidapplications/limit=100/genre=6014/json']
];

async function json(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'PLAYLOG catalog builder (+https://woo12345678.github.io/playlog/)' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
const ranked = [];
const chartById = new Map();
for (const [chart, url] of feedUrls) {
  const feed = await json(url);
  for (const item of feed.feed.entry || []) {
    const id = item.id?.attributes?.['im:id'];
    if (id && !chartById.has(id)) { chartById.set(id, chart); ranked.push(id); }
  }
}
const details = [];
for (let start = 0; start < ranked.length; start += 100) {
  const ids = ranked.slice(start, start + 100).join(',');
  const lookup = await json(`https://itunes.apple.com/lookup?id=${ids}&country=kr&entity=software`);
  details.push(...lookup.results);
}
const byId = new Map(details.map(item => [String(item.trackId), item]));
const genreMap = new Map([
  ['Games','게임'],['Action','액션'],['Adventure','어드벤처'],['Arcade','아케이드'],['Board','보드'],['Card','카드'],['Casino','카지노'],
  ['Casual','캐주얼'],['Family','가족'],['Music','리듬'],['Puzzle','퍼즐'],['Racing','레이싱'],['Role Playing','RPG'],['Simulation','시뮬레이션'],
  ['Sports','스포츠'],['Strategy','전략'],['Trivia','퀴즈'],['Word','단어']
]);
const strip = value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const additions = [];
for (const trackId of ranked) {
  if (additions.length >= 50) break;
  const app = byId.get(trackId);
  if (!app || app.wrapperType !== 'software' || !app.trackName || existing.has(canonical(app.trackName))) continue;
  const rawGenres = [...new Set([app.primaryGenreName, ...(app.genres || [])])].filter(value => value && value !== 'Games' && value !== '게임');
  const genres = rawGenres.map(value => genreMap.get(value) || value).slice(0, 4);
  const description = strip(app.description);
  const modeList = /멀티|친구|온라인|multiplayer|pvp|co-op/i.test(description) ? ['싱글', '멀티'] : ['싱글'];
  const year = Number(String(app.releaseDate || '').slice(0, 4)) || null;
  const game = createCatalogGame({
    id: `mobile-ios-${trackId}`, title: app.trackName, year, genres: (genres.length ? genres : ['모바일 게임']).join(','),
    tags: [...genres, '모바일 인기 확장', `App Store ${chartById.get(trackId)}`, app.bundleId, app.sellerName].filter(Boolean).join(','),
    modes: modeList.join(','), platforms: 'Mobile,iOS', price: Number(app.price) || 0,
    length: '중간', difficulty: '보통', mood: '다채로움', pace: genres.includes('액션') || genres.includes('아케이드') ? '빠름' : '보통',
    perspective: genres.includes('퍼즐') || genres.includes('카드') ? '2D' : '3D',
    memory: [app.trackName, app.bundleId, app.sellerName, ...(app.artistName ? [app.artistName] : [])].filter(Boolean).join(','),
    url: app.trackViewUrl || `https://apps.apple.com/kr/app/id${trackId}`,
    summary: description.slice(0, 220) || `${app.trackName} — 한국 App Store 게임 차트 수록작.`
  });
  additions.push({ ...game, coverUrl: app.artworkUrl512 || app.artworkUrl100, source: { provider: 'Apple App Store', trackId: Number(trackId), chart: chartById.get(trackId), capturedAt: new Date().toISOString() } });
  existing.add(canonical(app.trackName));
}
if (additions.length !== 50) throw new Error(`Mobile additions ${additions.length}/50`);
const output = [...base, ...additions];
validateCatalog(output);
writeFileSync(sourceUrl, `${JSON.stringify(output, null, 2)}\n`);
console.log(`MOBILE IMPORT OK · ${additions.length} new · ${output.length} total`);
