const cleanText = (value, limit = 240) => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/[<>\u0000-\u001f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);

const canonical = value => cleanText(value, 300).normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^0-9a-z가-힣]+/g, '');
const safeHttps = value => {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
};
const hash = value => {
  let output = 2166136261;
  for (const char of value) { output ^= char.codePointAt(0); output = Math.imul(output, 16777619); }
  return (output >>> 0).toString(36);
};

export function normalizeNewsSelection(ids, catalog) {
  if (!Array.isArray(ids) || !Array.isArray(catalog)) return [];
  const valid = new Set(catalog.map(game => game.id));
  return [...new Set(ids.map(id => String(id || '')).filter(id => valid.has(id)))].slice(0, 5);
}

export function classifyNewsItem(item) {
  if (['news', 'event', 'video'].includes(item?.type)) return item.type;
  const text = `${item?.title || ''} ${item?.source || ''} ${item?.url || ''}`;
  if (/youtube|youtu\.be|영상|트레일러|trailer|gameplay/i.test(text)) return 'video';
  if (/이벤트|업데이트|패치|출시|시즌|콜라보|대회|update|event|patch|release|season|festival|showcase/i.test(text)) return 'event';
  return 'news';
}

export function normalizeNewsItem(item) {
  if (!item || typeof item !== 'object') return null;
  const source = cleanText(item.source, 80) || '출처 확인';
  const rawTitle = cleanText(item.title, 220);
  const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const title = rawTitle.replace(new RegExp(`\\s+-\\s+${escapedSource}$`, 'i'), '').trim();
  const url = safeHttps(item.url);
  if (!title || !url) return null;
  const parsedDate = new Date(item.publishedAt || 0);
  const publishedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : new Date(0).toISOString();
  const thumbnail = safeHttps(item.thumbnail);
  return {
    id: cleanText(item.id, 100) || hash(`${title}|${url}`),
    type: classifyNewsItem(item),
    title,
    url,
    source,
    publishedAt,
    ...(thumbnail ? { thumbnail } : {}),
    ...(item.relativeTime ? { relativeTime: cleanText(item.relativeTime, 40) } : {})
  };
}

export function collectSelectedNews(cache, selectedIds, catalog, perGame = 8) {
  const selected = normalizeNewsSelection(selectedIds, catalog);
  const gameMap = new Map(catalog.map(game => [game.id, game]));
  const output = [];
  for (const gameId of selected) {
    const game = gameMap.get(gameId);
    const items = (cache?.games?.[gameId]?.items || []).map(normalizeNewsItem).filter(Boolean)
      .filter(item => isNewsRelevant(item, game))
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, Math.max(1, Math.min(12, Number(perGame) || 8)));
    for (const item of items) output.push({ game, item });
  }
  return output.sort((a, b) => Date.parse(b.item.publishedAt) - Date.parse(a.item.publishedAt));
}

export function newsTerms(game) {
  return [game?.title, ...(Array.isArray(game?.newsAliases) ? game.newsAliases : [])]
    .map(value => cleanText(value, 80)).filter(value => value.length >= 2).slice(0, 5);
}

export function isNewsRelevant(item, game) {
  const title = canonical(item?.title);
  const terms = newsTerms(game);
  const normalizedTerms = terms.map(canonical).filter(Boolean);
  if (!title || !normalizedTerms.some(term => title.includes(term))) return false;
  const explicitContexts = (Array.isArray(game?.newsContext) ? game.newsContext : []).map(canonical).filter(Boolean);
  const gameContext = canonical([game?.title, ...(game?.genres || []), ...(game?.tags || [])].join(' '));
  const gamblingSpam = ['슬롯', '카지노', '도박', 'betting', 'casino', 'slot'].map(canonical).some(term => title.includes(term));
  const gamblingGame = ['슬롯', '카지노', '도박', 'betting', 'casino', 'slot'].map(canonical).some(term => gameContext.includes(term));
  if (gamblingSpam && !gamblingGame) return false;
  const derivative = normalizedTerms.some(term => title.includes(`${term}풍`) || title.includes(`${term}like`) || title.includes(`${term}스타일`));
  if (derivative && !explicitContexts.some(term => title.includes(term))) return false;
  const ambiguous = terms.every(term => !/[\s:/'’+\-]/.test(term) && canonical(term).length <= 8);
  if (!ambiguous) return true;
  const contexts = [
    ...(Array.isArray(game?.newsContext) ? game.newsContext : []),
    'game', 'gaming', 'gameplay', 'steam', 'switch', 'xbox', 'playstation', 'ps5',
    '게임', '스팀', '업데이트', '패치', 'DLC', '모드'
  ].map(canonical).filter(Boolean);
  return contexts.some(term => title.includes(term));
}

export function buildNewsQuery(game) {
  const terms = newsTerms(game).map(value => `"${value.replace(/["()]/g, '')}"`);
  if (!terms.length) return '"video game" when:30d';
  return `${terms.length > 1 ? `(${terms.join(' OR ')})` : terms[0]} when:30d`;
}

export function newsFreshness(generatedAt, now = new Date()) {
  const generated = new Date(generatedAt || 0);
  const ageHours = (now.getTime() - generated.getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours > 72) return { status:'old', label:'오래된 캐시', ageHours };
  if (ageHours > 12) return { status:'stale', label:'업데이트 대기', ageHours };
  return { status:'fresh', label:'최신 수집', ageHours:Math.max(0, ageHours) };
}

export function selectedNewsFreshness(cache, selectedIds, now = new Date()) {
  const rows = (Array.isArray(selectedIds) ? selectedIds : []).map(id => cache?.games?.[id] || { fetchedAt:null, status:'unavailable', items:[], missing:true });
  const datedRows = rows.filter(row => row?.fetchedAt && Number.isFinite(new Date(row.fetchedAt).getTime()));
  const oldest = datedRows.sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt))[0];
  const referenceAt = oldest?.fetchedAt || null;
  const unavailable = rows.filter(row => row.status === 'unavailable' || !row.fetchedAt).length;
  const partial = rows.filter(row => row.status === 'partial-cache').length;
  const base = referenceAt ? newsFreshness(referenceAt, now) : { status:'old', label:'수집된 소식 없음', ageHours:Infinity };
  return {
    ...base,
    status:unavailable && base.status === 'fresh' ? 'stale' : base.status,
    label:unavailable ? `${base.label} · 일부 수집 불가` : base.label,
    referenceAt,
    unavailable,
    partial
  };
}

export function youtubeSearchUrl(game) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${game?.title || ''} game latest`)}`;
}

export function googleNewsSearchUrl(game) {
  return `https://news.google.com/search?q=${encodeURIComponent(buildNewsQuery(game))}&hl=ko&gl=KR&ceid=KR%3Ako`;
}
