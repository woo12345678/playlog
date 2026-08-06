# PLAYLOG

좋아한 게임 2~10개를 기반으로 설명 가능한 추천을 받고, 기억나는 단서로 추억의 게임을 찾고, 플레이 시간과 플랫폼 기록을 로컬에서 관리·공유하는 게임 라이프로그입니다.

## 실제 동작하는 기능

- 171개 게임 지식 카탈로그와 제목·한글/영문 별칭 검색형 다중 취향 추천
- 플랫폼·싱글/협동/경쟁·가격 필터
- 맵·캐릭터·색·조작·시대 단서 기반 추억 게임 찾기 (`Lady Bug / 레이디버그` 포함)
- 검색형 로컬 라이브러리와 목록에 없는 사용자 게임 직접 추가
- 사용자 게임까지 보존하는 JSON/CSV import/export
- 플랫폼별 플레이 시간과 최다 플레이 통계
- 토큰·계정 ID를 제외한 공유 URL
- 플랫폼별 공식 연동 가능성 안내

## 계정 연동 원칙

연결되지 않은 계정을 연결된 것처럼 표시하지 않습니다. Steam 라이브러리 자동 연동은 OpenID + Web API 서버와 `STEAM_API_KEY`가 필요한 후속 기능입니다. Nintendo/Epic 등 공개 범용 라이브러리 API가 없는 플랫폼은 수동 가져오기를 제공합니다.

## 게임 카탈로그 추가

게임 데이터의 **유일한 원본은 `data/games.json`**입니다. `src/catalog.generated.js`는 자동 생성 파일이므로 직접 수정하지 않습니다.

가장 빠른 추가 방법:

```bash
npm run catalog:add -- --title "새 게임" --year 2026 --genres "퍼즐,어드벤처" --platforms "Steam,Switch" --memory "보라색 문,별 조각"
```

필요하면 `--id`, `--tags`, `--modes`, `--price`, `--length`, `--difficulty`, `--mood`, `--pace`, `--perspective`, `--url`, `--color`, `--summary`를 추가합니다. 명령은 JSON을 저장하고 브라우저용 모듈까지 자동 생성합니다.

JSON을 직접 편집했다면 다음을 실행합니다.

```bash
npm run catalog:build
npm test
```

중복 ID·제목, 빈 필수 배열, 잘못된 연도·가격·URL·색상은 빌드에서 차단됩니다. 전체 필드와 예시는 [`docs/CATALOG.md`](docs/CATALOG.md)를 참고하세요.

## 실행 및 테스트

```bash
npm test
npm start
```

`http://127.0.0.1:4176/`에서 확인합니다.
