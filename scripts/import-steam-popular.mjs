import { readFileSync, writeFileSync } from 'node:fs';
import { createCatalogGame, validateCatalog } from './catalog-tools.mjs';

const sourceUrl = new URL('../data/games.json', import.meta.url);
const original = JSON.parse(readFileSync(sourceUrl, 'utf8'));
const base = original.filter(game => !game.tags?.includes('Steam 인기 2026'));
const canonical = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/[^a-z0-9가-힣]+/g, '');
const existing = new Set(base.map(game => canonical(game.title)));
const decode = value => String(value || '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,'').trim();

async function json(url) {
  const response = await fetch(url, { headers: { 'user-agent':'PLAYLOG catalog builder (+https://woo12345678.github.io/playlog/)' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
const rows = [];
for (const start of [0, 100, 200, 300, 400, 500]) {
  const params = new URLSearchParams({ query:'', start:String(start), count:'100', dynamic_data:'', sort_by:'_ASC', filter:'topsellers', infinite:'1', cc:'KR', l:'english' });
  const page = await json(`https://store.steampowered.com/search/results/?${params}`);
  const anchors = [...page.results_html.matchAll(/<a\s[\s\S]*?<\/a>/gi)].map(match => match[0]);
  for (const anchor of anchors) {
    const appId = anchor.match(/data-ds-appid="(\d+)"/)?.[1];
    const title = decode(anchor.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1]);
    if (!appId || !title) continue;
    rows.push({
      appId:Number(appId), title,
      href:decode(anchor.match(/href="([^"]+)"/)?.[1]).split('?')[0],
      released:decode(anchor.match(/class="search_released[^>]*>([\s\S]*?)<\/div>/i)?.[1]),
      tagIds:JSON.parse(anchor.match(/data-ds-tagids="([^"]+)"/)?.[1] || '[]'),
      priceFinal:Number(anchor.match(/data-price-final="(\d+)"/)?.[1] || 0),
      rank:start + rows.length % 100 + 1
    });
  }
}
const genreTags = new Map([[19,'액션'],[21,'어드벤처'],[122,'RPG'],[9,'전략'],[599,'시뮬레이션'],[701,'스포츠'],[699,'레이싱'],[492,'인디'],[113,'무료 플레이'],[493,'앞서 해보기'],[4085,'애니메이션'],[12095,'배틀로얄'],[1663,'FPS'],[1773,'아케이드'],[3871,'2D'],[4191,'3D']]);
const additions = [];
for (const row of rows) {
  if (additions.length >= 100) break;
  if (existing.has(canonical(row.title))) continue;
  const genres = [...new Set(row.tagIds.map(id => genreTags.get(id)).filter(Boolean))].slice(0,4);
  const modes = [];
  if (row.tagIds.some(id => [4182,1719].includes(id))) modes.push('싱글');
  if (row.tagIds.some(id => [128,1685,3843].includes(id))) modes.push('협동');
  if (row.tagIds.some(id => [3859,1775,3814].includes(id))) modes.push('멀티');
  if (row.tagIds.some(id => [1775,12095].includes(id))) modes.push('경쟁');
  const year = Number(row.released.match(/(?:19|20)\d{2}/)?.[0]) || null;
  const game = createCatalogGame({
    id:`steam-${row.appId}`, title:row.title, year, genres:(genres.length ? genres : ['PC 게임']).join(','),
    tags:[...genres,'Steam 인기 2026','Steam 공식 인기 판매',`인기 판매 ${row.rank}위`,`Steam App ${row.appId}`].join(','),
    modes:(modes.length ? [...new Set(modes)] : ['싱글']).join(','), platforms:'Steam,PC', price:Math.round(row.priceFinal / 100),
    length:'중간', difficulty:'보통', mood:'다채로움', pace:genres.includes('액션') || genres.includes('레이싱') ? '빠름' : '보통',
    perspective:row.tagIds.includes(3871) ? '2D' : '3D',
    memory:[row.title,`Steam App ID ${row.appId}`,`Steam 인기 판매 ${row.rank}위`].join(','),
    url:row.href || `https://store.steampowered.com/app/${row.appId}/`,
    summary:`Steam 공식 인기 판매 목록 ${row.rank}위에서 확인한 ${genres.join('·') || 'PC'} 게임. App ID ${row.appId}.`
  });
  additions.push({ ...game, coverUrl:`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${row.appId}/library_600x900_2x.jpg`, source:{ provider:'Steam', appId:row.appId, popularity:'top-seller', rank:row.rank, capturedAt:new Date().toISOString() } });
  existing.add(canonical(row.title));
}
if (additions.length !== 100) throw new Error(`Steam additions ${additions.length}/100 from ${rows.length} official results`);
const output = [...base, ...additions];
validateCatalog(output);
writeFileSync(sourceUrl, `${JSON.stringify(output, null, 2)}\n`);
console.log(`STEAM IMPORT OK · ${additions.length} new · ${output.length} total · ${rows.length} ranked candidates`);
