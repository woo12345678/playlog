# PLAYLOG 게임 카탈로그 개발 가이드

## 원본과 생성 파일

- 수정할 파일: `data/games.json`
- 자동 생성 파일: `src/catalog.generated.js`
- 생성 명령: `npm run catalog:build`
- 전체 검증: `npm test`

`catalog.generated.js`를 직접 수정하면 다음 빌드에서 덮어써집니다.

## 권장: CLI로 한 게임 추가

```bash
npm run catalog:add -- \
  --title "Example Game" \
  --year 2026 \
  --genres "퍼즐,어드벤처" \
  --platforms "Steam,Switch" \
  --memory "보라색 문,별 조각,달빛 정원" \
  --url "https://store.steampowered.com/app/000000/"
```

필수 인자는 `--title` 하나입니다. 나머지를 생략하면 안전한 기본값을 사용합니다. 다만 추천 품질을 위해 `year`, `genres`, `platforms`, `memory`, `url`, `summary`를 함께 넣는 것을 권장합니다.

### 선택 인자

| 인자 | 예시 | 설명 |
|---|---|---|
| `--id` | `example-game` | 생략 시 영문 제목에서 생성 |
| `--tags` | `시간 조작,협동` | 추천 유사도에 사용 |
| `--modes` | `싱글,협동` | 싱글·협동·경쟁 필터 |
| `--price` | `32000` | 원 단위 가격대 기준값 |
| `--length` | `김` | 짧음·중간·김·매우 김·무한 |
| `--difficulty` | `어려움` | 쉬움·보통·어려움·매우 어려움 |
| `--mood` | `따뜻함` | 추천 설명용 분위기 |
| `--pace` | `느긋함` | 느긋함·보통·빠름·매우 빠름 |
| `--perspective` | `2D` | 2D·3D·1인칭 등 |
| `--color` | `#5865a8` | 카드 강조색 |
| `--summary` | `한 문장 소개` | 결과 카드 설명 |

쉼표가 들어간 값은 따옴표로 감쌉니다.

## JSON 직접 편집

```json
{
  "id": "example-game",
  "title": "Example Game",
  "year": 2026,
  "genres": ["퍼즐", "어드벤처"],
  "tags": ["시간 조작", "탐험"],
  "modes": ["싱글"],
  "platforms": ["Steam", "Switch"],
  "priceKRW": 32000,
  "length": "중간",
  "difficulty": "보통",
  "mood": "신비로움",
  "pace": "느긋함",
  "perspective": "3D",
  "era": "2020년대",
  "memory": ["Example Game", "보라색 문", "별 조각", "달빛 정원"],
  "storeUrl": "https://example.com/official-game-page",
  "color": "#5865a8",
  "summary": "시간과 공간의 단서를 연결하는 퍼즐 어드벤처."
}
```

편집 후 반드시 실행합니다.

```bash
npm run catalog:build
npm test
```

## 자동 차단되는 오류

- 중복 `id` 또는 대소문자만 다른 중복 제목
- 영문 소문자·숫자·하이픈 형식이 아닌 ID
- 빈 `genres`, `tags`, `modes`, `platforms`, `memory`
- 1970~2100 범위 밖 연도(연도 미상은 `null`)
- 음수 또는 숫자가 아닌 가격
- HTTP/HTTPS가 아닌 확인 링크
- `#RRGGBB`가 아닌 색상
- 빈 요약

## 추가 품질 기준

1. `memory`에는 제목 반복만 넣지 말고 캐릭터, 색, 맵, 조작, 장소, 대표 사물을 4개 이상 넣습니다.
2. 최신 가격처럼 단정하지 않고 `priceKRW`는 추천 필터용 가격대 기준값으로 관리합니다.
3. 확인 링크는 공식 퍼블리셔 사이트 또는 공식 스토어 페이지를 사용합니다.
4. 플랫폼 독점작을 Steam에 있는 것처럼 표시하지 않습니다.
5. 추가 후 추천 검색, 추억 찾기, 라이브러리 검색에서 제목을 각각 한 번 확인합니다.

## PR 체크리스트

- [ ] `data/games.json` 수정
- [ ] `npm run catalog:build` 성공
- [ ] `npm test` 성공
- [ ] `src/catalog.generated.js` 함께 커밋
- [ ] 새 게임 제목 검색 확인
- [ ] 모바일 검색 결과가 입력창 바로 아래 표시
