# PLAYLOG Steam Worker

Steam OpenID로 SteamID를 확인하고, 서버에만 저장된 Web API key로 `GetOwnedGames`를 호출합니다. 게임 목록은 KV/DB에 저장하지 않고 로그인 popup에서 PLAYLOG opener로 한 번 전달합니다.

## 필요한 비밀값

- `STEAM_API_KEY`: https://steamcommunity.com/dev/apikey 에서 발급
- `SESSION_SECRET`: OpenID state HMAC 서명용 무작위 문자열

비밀값을 파일이나 GitHub Pages에 넣지 마세요.

## 배포

```bash
npx wrangler login
cd worker
npx wrangler secret put STEAM_API_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

`SESSION_SECRET`에는 password manager가 만든 32바이트 이상의 무작위 값을 입력합니다. 배포 출력의 `https://...workers.dev` URL을 `index.html`의 다음 meta content에 설정합니다.

```html
<meta name="playlog-steam-api" content="https://playlog-steam-api.<subdomain>.workers.dev">
```

그 뒤 root에서 `npm test`를 실행하고 Pages를 배포합니다.

## 동작 확인

```bash
curl https://<worker-url>/health
```

`{"ok":true}`만 반환하며 key나 설정 내용은 절대 반환하지 않습니다. `ok`는 Steam key, 32바이트 이상 session secret, 허용 return URL이 모두 준비된 경우에만 true입니다.

운영 환경은 `https://woo12345678.github.io/playlog/` return 경로만 허용합니다. localhost QA는 운영 allowlist에 포함하지 않고 다음처럼 별도 dev 환경을 사용합니다.

```bash
npx wrangler dev --env dev --config worker/wrangler.jsonc
```

Steam 프로필에서 **게임 세부 정보**가 공개되어야 보유 게임과 플레이 시간을 받을 수 있습니다. 비공개이면 PLAYLOG는 공개 설정 안내를 표시합니다.
