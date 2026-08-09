import { readFileSync, writeFileSync } from 'node:fs';
import { createCatalogGame, validateCatalog } from './catalog-tools.mjs';

const sourceUrl = new URL('../data/games.json', import.meta.url);
const original = JSON.parse(readFileSync(sourceUrl, 'utf8'));
const base = original.filter(game => !game.tags?.includes('Nintendo Switch 확장'));
const canonical = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/[^a-z0-9가-힣]+/g, '');
const existing = new Set(base.map(game => canonical(game.title)));
const response = await fetch('https://www.nintendo.com/us/store/games/best-sellers/', { headers: { 'user-agent': 'PLAYLOG catalog builder (+https://woo12345678.github.io/playlog/)' } });
if (!response.ok) throw new Error(`Nintendo ${response.status}`);
const html = await response.text();
const payload = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
if (!payload) throw new Error('Nintendo __NEXT_DATA__ missing');
const data = JSON.parse(payload);
const products = data.props?.pageProps?.page?.content?.merchandisedGrid || [];
const genreMap = new Map([
  ['Action','액션'],['Adventure','어드벤처'],['Arcade','아케이드'],['Board game','보드'],['Card game','카드'],
  ['Fighting','격투'],['First-person','1인칭'],['Music','리듬'],['Party','파티'],['Platformer','플랫포머'],
  ['Puzzle','퍼즐'],['Racing','레이싱'],['Role-playing','RPG'],['Simulation','시뮬레이션'],['Sports','스포츠'],
  ['Strategy','전략'],['Shooting','슈팅']
]);
const additions = [];
for (const [rank, product] of products.entries()) {
  if (additions.length >= 50) break;
  const cleanTitle = String(product?.name || '').replace(/[™®]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleanTitle || !product.urlKey || existing.has(canonical(cleanTitle))) continue;
  const genres = [...new Set((product.gameGenreLabels || []).map(value => genreMap.get(value) || value))].slice(0, 4);
  const features = product.gameFeatureLabels || [];
  const player = String(product.playerCount || product.numberOfPlayers?.system?.label || 'Single player');
  const modes = [];
  if (/single/i.test(player) || !player) modes.push('싱글');
  if (/2|3|4|multi|online/i.test(`${player} ${features.join(' ')}`)) modes.push('멀티');
  if (/co-op|cooperative/i.test(features.join(' '))) modes.push('협동');
  const platform = String(product.platform || 'Nintendo Switch');
  const platforms = ['Switch', ...(platform.includes('Switch 2') ? ['Switch 2'] : [])];
  const year = Number(String(product.releaseDate || '').slice(0, 4)) || null;
  const regularUsd = Number(product.prices?.regularPrice ?? product.prices?.finalPrice ?? 0);
  const cover = product.productImageSquare?.url || (product.productImage?.publicId ? `https://assets.nintendo.com/image/upload/q_auto/f_auto/${product.productImage.publicId}` : '');
  const publisher = product.softwarePublisher || product.manufacturer || 'Nintendo eShop';
  const game = createCatalogGame({
    id: `nintendo-${product.nsuid || canonical(cleanTitle)}`, title: cleanTitle, year,
    genres: (genres.length ? genres : ['Nintendo 게임']).join(','),
    tags: [...genres, 'Nintendo Switch 확장', 'Nintendo 공식 베스트셀러', `베스트셀러 ${rank + 1}위`, publisher, ...features.slice(0, 2)].join(','),
    modes: (modes.length ? [...new Set(modes)] : ['싱글']).join(','), platforms: platforms.join(','),
    price: regularUsd ? Math.round(regularUsd * 1400 / 1000) * 1000 : 0,
    length: '중간', difficulty: /difficulty/i.test(features.join(' ')) ? '선택 가능' : '보통', mood: '다채로움',
    pace: genres.includes('액션') || genres.includes('레이싱') || genres.includes('슈팅') ? '빠름' : '보통',
    perspective: features.some(value => /third-person|first-person/i.test(value)) ? '3D' : '2D/3D',
    memory: [product.name, product.franchise, product.softwareDeveloper, publisher, product.nsuid && `Nintendo NSUID ${product.nsuid}`].filter(Boolean).join(','),
    url: `https://www.nintendo.com/us/store/products/${product.urlKey}/`,
    summary: `${publisher}의 ${genres.join('·') || 'Nintendo'} 게임. Nintendo 공식 베스트셀러 목록 ${rank + 1}위에서 확인한 ${platform} 타이틀.`
  });
  additions.push({ ...game, coverUrl: cover, source: { provider: 'Nintendo', nsuid: product.nsuid, bestsellerRank: rank + 1, capturedAt: new Date().toISOString() } });
  existing.add(canonical(cleanTitle));
}
if (additions.length !== 50) throw new Error(`Nintendo additions ${additions.length}/50 from ${products.length} products`);
const output = [...base, ...additions];
validateCatalog(output);
writeFileSync(sourceUrl, `${JSON.stringify(output, null, 2)}\n`);
console.log(`NINTENDO IMPORT OK · ${additions.length} new · ${output.length} total`);
