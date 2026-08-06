const overlap = (a = [], b = []) => {
  const right = new Set(b);
  return a.length ? a.filter(value => right.has(value)).length / new Set([...a, ...b]).size : 0;
};

const clamp = value => Math.max(0, Math.min(100, Math.round(value)));

function similarity(candidate, seed) {
  const genre = overlap(candidate.genres, seed.genres);
  const tags = overlap(candidate.tags, seed.tags);
  const modes = overlap(candidate.modes, seed.modes);
  const platforms = overlap(candidate.platforms, seed.platforms);
  const mood = candidate.mood === seed.mood ? 1 : 0;
  const pace = candidate.pace === seed.pace ? 1 : 0;
  const difficulty = candidate.difficulty === seed.difficulty ? 1 : 0;
  const length = candidate.length === seed.length ? 1 : 0;
  return clamp(genre * 35 + tags * 28 + modes * 10 + platforms * 8 + mood * 6 + pace * 6 + difficulty * 4 + length * 3);
}

function buildReasons(game, seeds, affinities) {
  const reasons = [];
  const genreCounts = new Map();
  const tagCounts = new Map();
  for (const seed of seeds) {
    for (const genre of game.genres.filter(value => seed.genres.includes(value))) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    for (const tag of game.tags.filter(value => seed.tags.includes(value))) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const topGenre = [...genreCounts].sort((a, b) => b[1] - a[1])[0];
  const topTag = [...tagCounts].sort((a, b) => b[1] - a[1])[0];
  if (topGenre) reasons.push(`입력한 ${topGenre[1]}개 게임과 ${topGenre[0]} 취향이 이어집니다.`);
  if (topTag) reasons.push(`${topTag[0]} 요소를 좋아했다면 익숙하게 빠져들 수 있습니다.`);
  const best = [...affinities].sort((a, b) => b.score - a.score)[0];
  if (best) reasons.push(`${best.title}와의 취향 유사도가 가장 높습니다 (${best.score}%).`);
  if (game.modes.includes('협동')) reasons.push('친구와 함께 플레이할 수 있는 협동 선택지입니다.');
  else if (game.modes.includes('싱글')) reasons.push('혼자서 흐름을 끊지 않고 즐길 수 있습니다.');
  if (game.priceKRW === 0) reasons.push('무료로 시작할 수 있어 취향 확인 부담이 적습니다.');
  else if (game.priceKRW <= 20000) reasons.push('2만원 이하 가격대라 비교적 가볍게 시도할 수 있습니다.');
  if (reasons.length < 2) reasons.push(`${game.mood} 분위기와 ${game.pace} 진행을 가진 작품입니다.`);
  return [...new Set(reasons)].slice(0, 4);
}

export function recommendGames(catalog, seedIds, filters = {}) {
  const uniqueSeedIds = [...new Set((seedIds || []).filter(Boolean))].slice(0, 10);
  const seeds = uniqueSeedIds.map(id => catalog.find(game => game.id === id)).filter(Boolean);
  if (seeds.length < 2) return [];
  const excluded = new Set(seeds.map(game => game.id));
  const candidates = catalog.filter(game => {
    if (excluded.has(game.id)) return false;
    if (filters.platform && filters.platform !== '전체' && !game.platforms.includes(filters.platform)) return false;
    if (filters.mode && filters.mode !== '전체' && !game.modes.includes(filters.mode)) return false;
    if (Number(filters.maxPrice) >= 0 && filters.maxPrice !== '' && filters.maxPrice !== undefined && game.priceKRW > Number(filters.maxPrice)) return false;
    return true;
  });
  return candidates.map(game => {
    const seedAffinity = seeds.map(seed => ({ gameId: seed.id, title: seed.title, score: similarity(game, seed) }));
    const scores = seedAffinity.map(item => item.score);
    const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const strongest = Math.max(...scores);
    const breadth = scores.filter(score => score >= 20).length / scores.length;
    const score = clamp(average * .55 + strongest * .3 + breadth * 15);
    return { game, score, seedAffinity, reasons: buildReasons(game, seeds, seedAffinity) };
  }).sort((a, b) => b.score - a.score || a.game.title.localeCompare(b.game.title)).slice(0, 8);
}
