const normalize = value => String(value || '').toLocaleLowerCase('ko-KR').replace(/[^0-9a-z가-힣]+/g, ' ').trim();
const words = value => normalize(value).split(/\s+/).filter(word => word.length >= 1);

function clueMatches(text, clue) {
  const input = normalize(text).replace(/\s/g, '');
  const target = normalize(clue).replace(/\s/g, '');
  if (!target) return false;
  if (input.includes(target) || target.includes(input)) return true;
  const inputWords = new Set(words(text));
  const clueWords = words(clue);
  return clueWords.some(word => word.length >= 2 && [...inputWords].some(inputWord => inputWord.includes(word) || word.includes(inputWord)));
}

export function findRememberedGames(catalog, query = {}) {
  const text = normalize(query.text);
  const hasFilters = [query.era, query.perspective, query.mode, query.platform].some(Boolean);
  if (!text && !hasFilters) return [];
  return catalog.map(game => {
    const matchedClues = [];
    let score = 0;
    const searchable = [game.title, ...game.genres, ...game.tags, ...(game.memory || [])];
    for (const clue of searchable) {
      if (text && clueMatches(text, clue)) {
        const label = String(clue);
        if (!matchedClues.includes(label)) matchedClues.push(label);
        score += game.memory?.includes(clue) ? 5 : 3;
      }
    }
    if (query.era && game.era === query.era) { score += 7; matchedClues.push(query.era); }
    if (query.perspective && game.perspective === query.perspective) { score += 6; matchedClues.push(`${query.perspective} 화면`); }
    if (query.mode && game.modes.includes(query.mode)) { score += 6; matchedClues.push(`${query.mode} 플레이`); }
    if (query.platform && game.platforms.includes(query.platform)) { score += 5; matchedClues.push(query.platform); }
    if (text && normalize(game.title).split(' ').some(part => part.length > 2 && text.includes(part))) score += 12;
    return { game, rawScore: score, matchedClues: [...new Set(matchedClues)].slice(0, 8) };
  }).filter(item => item.rawScore > 0)
    .sort((a, b) => b.rawScore - a.rawScore || a.game.year - b.game.year)
    .slice(0, 8)
    .map((item, index, all) => ({
      game: item.game,
      confidence: Math.min(98, Math.round(25 + (item.rawScore / Math.max(1, all[0].rawScore)) * 70)),
      matchedClues: item.matchedClues
    }));
}

export const memoryPrompts = [
  '캐릭터는 사람이었나요, 동물이나 기계였나요?',
  '화면은 옆에서 보는 2D였나요, 뒤에서 보는 3D였나요?',
  '혼자 했나요, 한 화면에서 친구와 함께 했나요?',
  '기억나는 맵의 장소·날씨·대표 색이 있나요?',
  '적을 공격하거나 이동할 때 어떤 방식이었나요?',
  '오락실·PC방·휴대폰·콘솔 중 어디서 했나요?'
];
