const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const STEAM_GAMES = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const STATE_COOKIE = 'playlog_steam_state';
const encoder = new TextEncoder();

const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));
const allowedReturnUrls = env => String(env.APP_RETURN_URLS || '').split(';').map(value => value.trim()).filter(Boolean).flatMap(value => { try { return [new URL(value)]; } catch { return []; } });
const isAllowedReturnUrl = (candidate, env) => allowedReturnUrls(env).some(allowed => candidate.origin === allowed.origin && candidate.pathname === allowed.pathname);
const strongSecret = secret => encoder.encode(String(secret || '')).length >= 32;
const configured = env => Boolean(env.STEAM_API_KEY && strongSecret(env.SESSION_SECRET) && allowedReturnUrls(env).length);
const noStore = (body, status = 200, headers = {}) => new Response(body, { status, headers:{ 'cache-control':'no-store', ...headers } });
const clearStateCookie = `${STATE_COOKIE}=; Path=/auth/steam/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

async function signature(value, secret) {
  if (!strongSecret(secret)) throw new Error('weak-session-secret');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

function cookie(request, name) {
  for (const part of String(request.headers.get('cookie') || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

export async function createState(returnUrl, secret, now = Date.now()) {
  const payload = base64url(encoder.encode(JSON.stringify({ origin:returnUrl.origin, path:returnUrl.pathname, exp:now + 10 * 60_000, nonce:crypto.randomUUID() })));
  return `${payload}.${base64url(await signature(payload, secret))}`;
}

export async function verifyState(state, secret, env, now = Date.now()) {
  if (String(state || '').length > 2048) throw new Error('invalid-state');
  const [payload, supplied, extra] = String(state || '').split('.');
  if (!payload || !supplied || extra) throw new Error('invalid-state');
  const expected = await signature(payload, secret);
  if (!constantTimeEqual(expected, fromBase64url(supplied))) throw new Error('invalid-state');
  const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
  let returnUrl;
  try { returnUrl = new URL(parsed.path, parsed.origin); } catch { throw new Error('invalid-return-state'); }
  if (parsed.exp < now || parsed.exp > now + 10 * 60_000 || !isAllowedReturnUrl(returnUrl, env)) throw new Error('expired-state');
  return parsed;
}

async function readBounded(response, maxBytes) {
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > maxBytes) throw new Error('upstream-too-large');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('upstream-too-large'); }
    chunks.push(value);
  }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function fetchBounded(url, options, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal:controller.signal });
    const bytes = await readBounded(response, maxBytes);
    return { response, text:new TextDecoder().decode(bytes) };
  } finally { clearTimeout(timer); }
}

function popupHtml(origin, payload) {
  const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const safeOrigin = JSON.stringify(origin);
  const nonce = crypto.randomUUID().replace(/-/g, '');
  return noStore(`<!doctype html><meta charset="utf-8"><title>PLAYLOG Steam 연결</title><p>Steam 라이브러리를 PLAYLOG로 전달하고 있습니다…</p><script nonce="${nonce}">window.opener?.postMessage(${safePayload},${safeOrigin});window.close();</script>`, 200, {
    'content-type':'text/html;charset=UTF-8',
    'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'none'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    'referrer-policy':'no-referrer',
    'x-content-type-options':'nosniff',
    'set-cookie':clearStateCookie
  });
}

function expectedCallback(url) {
  const output = new URL('/auth/steam/callback', url.origin);
  output.searchParams.set('state', url.searchParams.get('state') || '');
  return output.href;
}

async function validateSteamCallback(url) {
  const entries = [...url.searchParams];
  if (entries.length > 30 || entries.some(([key, value]) => key.length > 80 || value.length > 4096)) throw new Error('invalid-openid-payload');
  const claimed = url.searchParams.get('openid.claimed_id') || '';
  const identity = url.searchParams.get('openid.identity') || '';
  const required = {
    'openid.ns':OPENID_NS,
    'openid.mode':'id_res',
    'openid.op_endpoint':STEAM_OPENID,
    'openid.return_to':expectedCallback(url)
  };
  for (const [key, expected] of Object.entries(required)) if (url.searchParams.get(key) !== expected) throw new Error('invalid-openid-assertion');
  if (identity !== claimed) throw new Error('invalid-openid-identity');
  const match = claimed.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
  if (!match) throw new Error('invalid-steam-id');
  const nonce = url.searchParams.get('openid.response_nonce') || '';
  if (!nonce || nonce.length > 255) throw new Error('invalid-openid-nonce');
  const signed = new Set(String(url.searchParams.get('openid.signed') || '').split(','));
  for (const field of ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce']) if (!signed.has(field)) throw new Error('unsigned-openid-field');

  const body = new URLSearchParams();
  for (const [key, value] of entries) if (key.startsWith('openid.')) body.set(key, value);
  body.set('openid.mode', 'check_authentication');
  const { response, text } = await fetchBounded(STEAM_OPENID, { method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded' }, body }, 16_384);
  if (!response.ok || !/^is_valid:true$/m.test(text)) throw new Error('steam-validation-failed');
  return match[1];
}

async function ownedGames(steamId, apiKey) {
  const url = new URL(STEAM_GAMES);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamid', steamId);
  url.searchParams.set('include_appinfo', '1');
  url.searchParams.set('include_played_free_games', '1');
  url.searchParams.set('format', 'json');
  const { response, text } = await fetchBounded(url, { headers:{ accept:'application/json' } }, 2_000_000);
  if (!response.ok) throw new Error('steam-api-failed');
  const data = JSON.parse(text);
  const rawGames = Array.isArray(data?.response?.games) ? data.response.games : [];
  const games = rawGames.slice(0, 1000).map(game => ({
    appId:Number(game.appid),
    name:String(game.name || '').slice(0, 120),
    playtimeForever:Math.max(0, Number(game.playtime_forever) || 0),
    playtimeTwoWeeks:Math.max(0, Number(game.playtime_2weeks) || 0)
  })).filter(game => Number.isInteger(game.appId) && game.appId > 0 && game.name);
  const reportedCount = Math.max(0, Number(data?.response?.game_count) || rawGames.length);
  return { games, truncated:reportedCount > games.length || rawGames.length > 1000 };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.url.length > 16_384) return noStore('Request too large', 413);
    if (url.pathname === '/health') {
      if (request.method !== 'GET') return noStore('Method not allowed', 405, { allow:'GET' });
      return noStore(JSON.stringify({ ok:configured(env) }), 200, { 'content-type':'application/json;charset=UTF-8' });
    }
    if (url.pathname === '/auth/steam') {
      if (request.method !== 'GET') return noStore('Method not allowed', 405, { allow:'GET' });
      if (!configured(env)) return noStore('Steam integration is not configured', 503);
      let returnUrl;
      try { returnUrl = new URL(url.searchParams.get('return_to') || ''); }
      catch { return noStore('invalid return origin', 400); }
      if (!isAllowedReturnUrl(returnUrl, env)) return noStore('invalid return URL', 400);
      const state = await createState(returnUrl, env.SESSION_SECRET);
      const callback = new URL('/auth/steam/callback', url.origin);
      callback.searchParams.set('state', state);
      const target = new URL(STEAM_OPENID);
      target.search = new URLSearchParams({
        'openid.ns':OPENID_NS,
        'openid.mode':'checkid_setup',
        'openid.return_to':callback.href,
        'openid.realm':url.origin,
        'openid.identity':`${OPENID_NS}/identifier_select`,
        'openid.claimed_id':`${OPENID_NS}/identifier_select`
      });
      return noStore(null, 302, {
        location:target.href,
        'set-cookie':`${STATE_COOKIE}=${state}; Path=/auth/steam/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
        'referrer-policy':'no-referrer'
      });
    }
    if (url.pathname === '/auth/steam/callback') {
      if (request.method !== 'GET') return noStore('Method not allowed', 405, { allow:'GET', 'set-cookie':clearStateCookie });
      if (!configured(env)) return noStore('Steam integration is not configured', 503, { 'set-cookie':clearStateCookie });
      const suppliedState = url.searchParams.get('state') || '';
      if (!suppliedState || cookie(request, STATE_COOKIE) !== suppliedState) return noStore('Steam connection failed: state-cookie-mismatch', 400, { 'set-cookie':clearStateCookie });
      let state;
      try { state = await verifyState(suppliedState, env.SESSION_SECRET, env); }
      catch (error) { return noStore(`Steam connection failed: ${error.message}`, 400, { 'set-cookie':clearStateCookie }); }
      try {
        const steamId = await validateSteamCallback(url);
        const result = await ownedGames(steamId, env.STEAM_API_KEY);
        return popupHtml(state.origin, { type:'playlog:steam-library', games:result.games, truncated:result.truncated });
      } catch { return popupHtml(state.origin, { type:'playlog:steam-error' }); }
    }
    return noStore('Not found', 404);
  }
};
