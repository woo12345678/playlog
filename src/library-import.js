import { createCustomGame, normalizeCustomGames, mergeCatalog } from './game-entry.js';
import { normalizeLibrary } from './library.js';

export const MAX_QUICK_GAMES = 100;
export const MAX_IMPORT_FILE_BYTES = 1_000_000;
export const MAX_JSON_LIBRARY_ROWS = 1000;
export const MAX_CUSTOM_GAMES = 1000;

const normalizeIdentity = value => String(value || '')
  .toLocaleLowerCase('ko-KR')
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .trim();

const headerNames = {
  title:new Set(['title', 'game', 'name', '게임', '게임명', '제목']),
  hours:new Set(['hour', 'hours', 'time', 'playtime', '시간', '플레이시간']),
  platform:new Set(['platform', 'store', '플랫폼', '기기']),
  status:new Set(['status', 'state', '상태']),
  rating:new Set(['rating', 'score', '평점'])
};

const isHeader = (value, kind) => headerNames[kind].has(normalizeIdentity(value));
const cleanPlatform = value => String(value || '기타').replace(/[<>]/g, '').trim().slice(0, 30) || '기타';

function buildIdentityIndex(catalog) {
  const index = new Map();
  for (const game of catalog) {
    for (const identity of [game.title, ...(game.newsAliases || []), ...(game.memory || [])]) {
      const key = normalizeIdentity(identity);
      if (key && !index.has(key)) index.set(key, game);
    }
  }
  return index;
}

function buildImport(records, baseCatalog, defaultPlatform) {
  const customGames = [];
  const byGame = new Map();
  const rejected = [];
  const workingCatalog = [...baseCatalog];
  const identityIndex = buildIdentityIndex(workingCatalog);
  const idIndex = new Set(workingCatalog.map(game => game.id));
  let truncated = false;

  for (const record of records) {
    const title = String(record?.title || '').replace(/[<>]/g, '').trim().slice(0, 80);
    const identity = normalizeIdentity(title);
    if (!title || !identity) { rejected.push({ line:record?.line || 0, title }); continue; }
    let game = identityIndex.get(identity);
    const newEntry = !game || !byGame.has(game.id);
    if (newEntry && byGame.size >= MAX_QUICK_GAMES) { truncated = true; continue; }
    const platform = cleanPlatform(record.platform || defaultPlatform);
    if (!game) {
      try {
        game = createCustomGame({ title, genre:'사용자 가져오기', platform, memory:title }, []);
        if (idIndex.has(game.id)) throw new Error('duplicate-id');
        customGames.push(game);
        workingCatalog.push(game);
        identityIndex.set(identity, game);
        idIndex.add(game.id);
      } catch {
        rejected.push({ line:record?.line || 0, title });
        continue;
      }
    }
    byGame.set(game.id, {
      gameId:game.id,
      hours:record.hours,
      platform,
      status:record.status || '플레이 중',
      rating:record.rating || 0
    });
  }

  return {
    library:normalizeLibrary([...byGame.values()], workingCatalog),
    customGames,
    rejected,
    truncated
  };
}

function quickRecord(line, lineNumber) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const headerParts = trimmed.split(/[\t|,]/).map(value => value.trim());
  if (isHeader(headerParts[0], 'title') && (!headerParts[1] || isHeader(headerParts[1], 'hours'))) return null;
  const parts = headerParts.filter(Boolean);
  const maybeHours = parts.length > 1 ? Number(parts.at(-1)) : NaN;
  const hasHours = Number.isFinite(maybeHours);
  return {
    line:lineNumber,
    title:hasHours ? parts.slice(0, -1).join(', ') : trimmed,
    hours:hasHours ? maybeHours : 0
  };
}

export function parseQuickLibraryText(text, baseCatalog, platform = '기타') {
  const lines = String(text || '').split(/\r?\n/).slice(0, 2000);
  const records = lines.map((line, index) => quickRecord(line, index + 1)).filter(Boolean);
  const result = buildImport(records, baseCatalog, cleanPlatform(platform));
  if (String(text || '').split(/\r?\n/).length > 2000) result.truncated = true;
  return result;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const source = String(text || '').replace(/^\ufeff/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      if (rows.length > MAX_JSON_LIBRARY_ROWS + 1) throw new Error('csv-row-limit');
    } else field += char;
    if (field.length > 12000) throw new Error('csv-cell-limit');
  }
  if (quoted) throw new Error('csv-unclosed-quote');
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function csvHeader(row) {
  const indexOf = kind => row.findIndex(value => isHeader(value, kind));
  const title = indexOf('title');
  if (title < 0) return null;
  return { title, hours:indexOf('hours'), platform:indexOf('platform'), status:indexOf('status'), rating:indexOf('rating') };
}

export function parseLibraryCsv(text, baseCatalog, defaultPlatform = '기타') {
  const rows = parseCsvRows(text);
  if (!rows.length) return { library:[], customGames:[], rejected:[], truncated:false };
  const header = csvHeader(rows[0]);
  const columns = header || { title:0, hours:1, platform:2, status:3, rating:4 };
  const dataRows = header ? rows.slice(1) : rows;
  const records = dataRows.map((row, index) => ({
    line:index + (header ? 2 : 1),
    title:row[columns.title],
    hours:columns.hours >= 0 ? Number(row[columns.hours]) : 0,
    platform:columns.platform >= 0 ? row[columns.platform] : defaultPlatform,
    status:columns.status >= 0 ? row[columns.status] : '플레이 중',
    rating:columns.rating >= 0 ? Number(row[columns.rating]) : 0
  }));
  return buildImport(records, baseCatalog, defaultPlatform);
}

export function prepareImportedLibraryState(currentState, imported, incomingCustom, baseCatalog) {
  if (!Array.isArray(imported) || imported.length > MAX_JSON_LIBRARY_ROWS) throw new Error('library-limit');
  if (!Array.isArray(incomingCustom) || incomingCustom.length > MAX_CUSTOM_GAMES) throw new Error('custom-limit');
  const normalizedIncoming = normalizeCustomGames(incomingCustom, baseCatalog);
  if (normalizedIncoming.length !== incomingCustom.length) throw new Error('invalid-custom');
  const currentCustom = normalizeCustomGames(currentState.customGames || [], baseCatalog);
  const nextCustom = normalizeCustomGames([...currentCustom, ...normalizedIncoming], baseCatalog);
  const acceptedIds = new Set(nextCustom.map(game => game.id));
  if (normalizedIncoming.some(game => !acceptedIds.has(game.id))) throw new Error('custom-limit');
  const catalog = mergeCatalog(baseCatalog, nextCustom);
  const clean = normalizeLibrary(imported, catalog);
  if (!clean.length) throw new Error('empty-library');
  const merged = new Map(normalizeLibrary(currentState.library || [], catalog).map(entry => [entry.gameId, entry]));
  clean.forEach(entry => merged.set(entry.gameId, entry));
  const finalLibrary = normalizeLibrary([...merged.values()], catalog);
  const retainedIds = new Set(finalLibrary.map(entry => entry.gameId));
  const retainedIncoming = clean.filter(entry => retainedIds.has(entry.gameId));
  if (!retainedIncoming.length) throw new Error('library-limit');
  const retainedCustom = normalizedIncoming.filter(game => retainedIds.has(game.id));
  const finalCustom = normalizeCustomGames([...currentCustom, ...retainedCustom], baseCatalog);
  const nextState = { ...currentState, customGames:finalCustom, library:finalLibrary };
  return { nextState, clean:retainedIncoming, droppedCount:clean.length - retainedIncoming.length, catalog:mergeCatalog(baseCatalog, finalCustom) };
}
