const validStatuses = new Set(['플레이 중', '완료', '보류', '중단', '찜']);

const sanitizeText = (value, limit) => String(value || '').replace(/[<>]/g, '').trim().slice(0, limit);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function normalizeLibrary(items, catalog) {
  const validIds = new Set(catalog.map(game => game.id));
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.flatMap(item => {
    if (!item || !validIds.has(item.gameId) || seen.has(item.gameId)) return [];
    seen.add(item.gameId);
    return [{
      gameId: item.gameId,
      hours: Math.round(clamp(item.hours, 0, 100000) * 10) / 10,
      platform: sanitizeText(item.platform || '기타', 30),
      status: validStatuses.has(item.status) ? item.status : '플레이 중',
      rating: Math.round(clamp(item.rating, 0, 5))
    }];
  });
}

export function calculateStats(library, catalog) {
  const clean = normalizeLibrary(library, catalog);
  const platformHours = {};
  const genreHours = {};
  let totalHours = 0;
  for (const entry of clean) {
    const game = catalog.find(item => item.id === entry.gameId);
    totalHours += entry.hours;
    platformHours[entry.platform] = (platformHours[entry.platform] || 0) + entry.hours;
    for (const genre of game.genres) genreHours[genre] = (genreHours[genre] || 0) + entry.hours / game.genres.length;
  }
  const rounded = value => Math.round(value * 10) / 10;
  Object.keys(platformHours).forEach(key => platformHours[key] = rounded(platformHours[key]));
  Object.keys(genreHours).forEach(key => genreHours[key] = rounded(genreHours[key]));
  const topGame = [...clean].sort((a, b) => b.hours - a.hours)[0] || null;
  const topGenre = Object.entries(genreHours).sort((a, b) => b[1] - a[1])[0] || null;
  return { totalHours: rounded(totalHours), gameCount: clean.length, platformHours, genreHours, topGame, topGenre };
}

function toBase64Url(text) {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64url');
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64url').toString('utf8');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

export function encodeShare(profile) {
  const payload = {
    v: 1,
    name: sanitizeText(profile?.name || '플레이어', 30),
    bio: sanitizeText(profile?.bio || '', 100),
    library: (Array.isArray(profile?.library) ? profile.library : []).slice(0, 100).map(entry => ({
      gameId: sanitizeText(entry.gameId, 80),
      hours: Math.round(clamp(entry.hours, 0, 100000) * 10) / 10,
      platform: sanitizeText(entry.platform || '기타', 30),
      status: validStatuses.has(entry.status) ? entry.status : '플레이 중',
      rating: Math.round(clamp(entry.rating, 0, 5))
    }))
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeShare(encoded) {
  try {
    if (!encoded || encoded.length > 24000) return null;
    const parsed = JSON.parse(fromBase64Url(encoded));
    if (parsed.v !== 1 || !Array.isArray(parsed.library)) return null;
    return {
      name: sanitizeText(parsed.name || '플레이어', 30),
      bio: sanitizeText(parsed.bio || '', 100),
      library: parsed.library.slice(0, 100).map(entry => ({
        gameId: sanitizeText(entry.gameId, 80),
        hours: Math.round(clamp(entry.hours, 0, 100000) * 10) / 10,
        platform: sanitizeText(entry.platform || '기타', 30),
        status: validStatuses.has(entry.status) ? entry.status : '플레이 중',
        rating: Math.round(clamp(entry.rating, 0, 5))
      }))
    };
  } catch {
    return null;
  }
}
