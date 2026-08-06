const cleanText = (value, limit = 100) => String(value ?? '')
  .replace(/<[^>]*>/g, '')
  .replace(/[<>\u0000-\u001f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);

const canonical = value => cleanText(value, 300).toLocaleLowerCase('ko-KR').replace(/[^0-9a-z가-힣]+/g, '');

const list = (value, fallback = []) => {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[,/|]/);
  const result = [...new Set(source.map(item => cleanText(item, 30)).filter(Boolean))].slice(0, 8);
  return result.length ? result : fallback;
};

const hash = value => {
  let output = 2166136261;
  for (const char of value) {
    output ^= char.codePointAt(0);
    output = Math.imul(output, 16777619);
  }
  return (output >>> 0).toString(36);
};

const slug = value => canonical(value).slice(0, 24) || 'game';

export function searchGames(catalog, query, limit = 12) {
  const needle = canonical(query);
  if (!needle || !Array.isArray(catalog)) return [];
  return catalog.map(game => {
    const title = canonical(game.title);
    const aliases = [...(game.memory || []), ...(game.tags || []), ...(game.genres || [])].map(canonical).filter(Boolean);
    let score = title === needle ? 120 : title.startsWith(needle) ? 105 : title.includes(needle) ? 95 : 0;
    for (const alias of aliases) {
      if (alias === needle) score = Math.max(score, 115);
      else if (alias.includes(needle) || needle.includes(alias)) score = Math.max(score, 85);
    }
    return { game, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.game.title.localeCompare(b.game.title, 'ko'))
    .slice(0, Math.max(1, Math.min(30, Number(limit) || 12)))
    .map(item => item.game);
}

export function createCustomGame(input, catalog = []) {
  const title = cleanText(input?.title, 80);
  if (!title) throw new Error('title-required');
  if (catalog.some(game => canonical(game.title) === canonical(title))) throw new Error('duplicate-title');
  const genres = list(input?.genres ?? input?.genre, ['기타']);
  const platforms = list(input?.platforms ?? input?.platform, ['기타']);
  const memory = list(input?.memory, []);
  return {
    id: `custom-${slug(title)}-${hash(title)}`,
    title,
    year: null,
    genres,
    tags: ['사용자 추가'],
    modes: list(input?.modes ?? input?.mode, ['싱글']),
    platforms,
    priceKRW: 0,
    length: '미상',
    difficulty: '미상',
    mood: '미상',
    pace: '미상',
    perspective: cleanText(input?.perspective, 10) || '미상',
    era: '연도 미상',
    memory: [title, ...memory].slice(0, 12),
    storeUrl: '',
    color: '#6d6558',
    summary: cleanText(input?.summary, 180) || '사용자가 직접 추가한 게임입니다.',
    custom: true
  };
}

export function normalizeCustomGames(items, baseCatalog = []) {
  if (!Array.isArray(items)) return [];
  const output = [];
  for (const item of items.slice(0, 100)) {
    try {
      const game = createCustomGame(item, [...baseCatalog, ...output]);
      output.push(game);
    } catch { /* invalid or duplicate custom game */ }
  }
  return output;
}

export function mergeCatalog(baseCatalog, customGames) {
  return [...baseCatalog, ...normalizeCustomGames(customGames, baseCatalog)];
}
