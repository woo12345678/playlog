import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const NS = 'http://specs.openid.net/auth/2.0';
const env = {
  SESSION_SECRET:'test-session-secret-with-at-least-32-bytes!',
  STEAM_API_KEY:'server-secret-key',
  APP_RETURN_URLS:'https://woo12345678.github.io/playlog/;http://127.0.0.1:4173/'
};

async function beginLogin() {
  const response = await worker.fetch(new Request('https://api.example/auth/steam?return_to=https://woo12345678.github.io/playlog/'), env);
  const target = new URL(response.headers.get('location'));
  const returnTo = target.searchParams.get('openid.return_to');
  const state = new URL(returnTo).searchParams.get('state');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { response, target, returnTo, state, cookie };
}

function callbackRequest(flow, overrides = {}) {
  const callback = new URL('https://api.example/auth/steam/callback');
  const claimed = 'https://steamcommunity.com/openid/id/76561197960435530';
  const values = {
    state:flow.state,
    'openid.ns':NS,
    'openid.mode':'id_res',
    'openid.op_endpoint':STEAM_OPENID,
    'openid.claimed_id':claimed,
    'openid.identity':claimed,
    'openid.return_to':flow.returnTo,
    'openid.response_nonce':'2026-08-10T06:00:00Znonce',
    'openid.signed':'op_endpoint,claimed_id,identity,return_to,response_nonce',
    'openid.sig':'signed-by-steam',
    ...overrides
  };
  for (const [key, value] of Object.entries(values)) callback.searchParams.set(key, value);
  return new Request(callback, { headers:{ cookie:flow.cookie } });
}

test('health는 전체 설정 준비 여부만 반환하고 key 내용을 숨긴다', async () => {
  const response = await worker.fetch(new Request('https://api.example/health'), env);
  assert.deepEqual(await response.json(), { ok:true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const weak = await worker.fetch(new Request('https://api.example/health'), { ...env, SESSION_SECRET:'short' });
  assert.deepEqual(await weak.json(), { ok:false });
});

test('인증 경로는 GET과 정상 return URL만 허용하고 모든 응답을 저장 금지한다', async () => {
  for (const value of ['%', '::::', 'https://evil.example/steal', 'https://woo12345678.github.io/other-project/']) {
    const response = await worker.fetch(new Request(`https://api.example/auth/steam?return_to=${encodeURIComponent(value)}`), env);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const post = await worker.fetch(new Request('https://api.example/auth/steam', { method:'POST' }), env);
  assert.equal(post.status, 405);
});

test('Steam 로그인은 서명 state·HttpOnly cookie와 공식 OpenID callback을 만든다', async () => {
  const flow = await beginLogin();
  assert.equal(flow.response.status, 302);
  assert.equal(flow.response.headers.get('cache-control'), 'no-store');
  assert(flow.response.headers.get('set-cookie').includes('HttpOnly'));
  assert(flow.response.headers.get('set-cookie').includes('SameSite=Lax'));
  assert.equal(flow.target.origin, 'https://steamcommunity.com');
  assert.equal(flow.target.searchParams.get('openid.mode'), 'checkid_setup');
  assert.equal(new URL(flow.returnTo).origin, 'https://api.example');
  assert(flow.state.includes('.'));
});

test('Steam callback은 모든 RP 필드를 검증한 후 API key 없이 게임만 전달한다', async t => {
  const flow = await beginLogin();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.origin === 'https://steamcommunity.com') {
      assert.equal(options.method, 'POST');
      assert(String(options.body).includes('openid.mode=check_authentication'));
      return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
    }
    assert.equal(url.origin, 'https://api.steampowered.com');
    assert.equal(url.searchParams.get('key'), env.STEAM_API_KEY);
    return Response.json({ response:{ game_count:1001, games:[{ appid:10, name:'Counter-Strike <One>', playtime_forever:125, playtime_2weeks:5 }] } });
  };
  const response = await worker.fetch(callbackRequest(flow), env);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert(html.includes('playlog:steam-library'));
  assert(html.includes('playtimeForever'));
  assert(html.includes('"truncated":true'));
  assert(!html.includes(env.STEAM_API_KEY));
  assert(!html.includes('76561197960435530'));
  assert(!html.includes('<One>'));
  assert(response.headers.get('set-cookie').includes('Max-Age=0'));
  assert(response.headers.get('content-security-policy').includes("default-src 'none'"));
});

test('callback은 state cookie가 없거나 불일치하면 Steam 호출 전에 거부한다', async () => {
  const flow = await beginLogin();
  const missing = new Request(callbackRequest(flow).url);
  const response = await worker.fetch(missing, env);
  assert.equal(response.status, 400);
  assert((await response.text()).includes('state-cookie-mismatch'));
});

test('callback은 다른 return_to assertion을 수락하지 않는다', async t => {
  const flow = await beginLogin(); let calls = 0;
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { calls += 1; return new Response('is_valid:true'); };
  const response = await worker.fetch(callbackRequest(flow, { 'openid.return_to':'https://evil.example/callback' }), env);
  assert((await response.text()).includes('playlog:steam-error'));
  assert.equal(calls, 0);
});

test('callback은 비공식 endpoint·identity 불일치·필수 서명 누락을 거부한다', async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('must not fetch'); };
  const cases = [
    { 'openid.op_endpoint':'https://evil.example/openid' },
    { 'openid.identity':'https://steamcommunity.com/openid/id/76561197960435531' },
    { 'openid.signed':'claimed_id,identity' }
  ];
  for (const overrides of cases) {
    const flow = await beginLogin();
    const response = await worker.fetch(callbackRequest(flow, overrides), env);
    assert((await response.text()).includes('playlog:steam-error'));
  }
});

test('Steam upstream 실패는 raw 오류 대신 안전한 popup 메시지로 전달한다', async t => {
  const flow = await beginLogin();
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('upstream unavailable', { status:503 });
  const response = await worker.fetch(callbackRequest(flow), env);
  assert.equal(response.status, 200);
  assert((await response.text()).includes('playlog:steam-error'));
});

test('변조 state와 약한 secret은 제어된 오류로 거부한다', async () => {
  const flow = await beginLogin();
  const badUrl = new URL(callbackRequest(flow).url); badUrl.searchParams.set('state', 'broken.payload');
  const bad = await worker.fetch(new Request(badUrl, { headers:{ cookie:'playlog_steam_state=broken.payload' } }), env);
  assert.equal(bad.status, 400);
  const weak = await worker.fetch(new Request('https://api.example/auth/steam?return_to=https://woo12345678.github.io/playlog/'), { ...env, SESSION_SECRET:'tiny' });
  assert.equal(weak.status, 503);
});
