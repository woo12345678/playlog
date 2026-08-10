const normalize = value => String(value || '').toLocaleLowerCase('ko-KR').replace(/[^0-9a-z가-힣]+/g, ' ').trim();
const words = value => normalize(value).split(/\s+/).filter(word => word.length >= 1);
const gameIndex = new WeakMap();
const ignoredTextClues = new Set(['게임', '추억게임', '웹게임', '플래시게임', '브라우저게임', '추억게임확장', '웹게임추억']);

function indexGame(game) {
  if (gameIndex.has(game)) return gameIndex.get(game);
  const searchable = [game.title, ...game.genres, ...game.tags, ...(game.memory || [])].filter(clue => !ignoredTextClues.has(normalize(clue).replace(/\s/g, ''))).map(clue => ({
    label: String(clue),
    compact: normalize(clue).replace(/\s/g, ''),
    words: words(clue),
    weight: game.memory?.includes(clue) ? 5 : 3
  }));
  const indexed = { searchable, titleParts: normalize(game.title).split(' ') };
  gameIndex.set(game, indexed);
  return indexed;
}

function clueMatches(input, clue) {
  if (!clue.compact) return false;
  if (input.compact.length >= 2 && clue.compact.length >= 2 && (input.compact.includes(clue.compact) || clue.compact.includes(input.compact))) return true;
  return clue.words.some(word => word.length >= 2 && input.words.some(inputWord => inputWord.length >= 2 && (inputWord.includes(word) || word.includes(inputWord))));
}

export function findRememberedGames(catalog, query = {}) {
  const text = normalize(query.text);
  const hasFilters = [query.era, query.perspective, query.mode, query.platform].some(Boolean);
  const compactText = text.replace(/\s/g, '');
  const input = compactText.length >= 2 && !ignoredTextClues.has(compactText) ? { compact: compactText, words: words(text) } : null;
  if (!input && !hasFilters) return [];
  return catalog.map(game => {
    const matchedClues = [];
    let score = 0;
    const indexed = indexGame(game);
    for (const clue of indexed.searchable) {
      if (input && clueMatches(input, clue)) {
        if (!matchedClues.includes(clue.label)) matchedClues.push(clue.label);
        score += clue.weight;
      }
    }
    if (query.era && game.era === query.era) { score += 7; matchedClues.push(query.era); }
    if (query.perspective && game.perspective === query.perspective) { score += 6; matchedClues.push(`${query.perspective} 화면`); }
    if (query.mode && game.modes.includes(query.mode)) { score += 6; matchedClues.push(`${query.mode} 플레이`); }
    if (query.platform && game.platforms.includes(query.platform)) { score += 5; matchedClues.push(query.platform); }
    if (input && indexed.titleParts.some(part => part.length > 2 && text.includes(part))) score += 12;
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
