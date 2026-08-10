import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const accountCss = fs.readFileSync(new URL('../account-import.css', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('여섯 제품 탭과 핵심 조작이 문서에 존재한다', () => {
  for (const tab of ['recommend', 'memory', 'library', 'profile', 'news', 'accounts']) {
    assert(html.includes(`data-tab="${tab}"`), `${tab} 탭 필요`);
    assert(html.includes(`data-view="${tab}"`), `${tab} 화면 필요`);
  }
  for (const id of ['seedList', 'addSeed', 'memoryQuery', 'libraryForm', 'exportLibrary', 'importLibrary', 'shareProfile']) assert(html.includes(`id="${id}"`), `${id} 필요`);
});

test('추억 찾기에서 Web과 Flash 플레이 장소를 직접 고를 수 있다', () => {
  const platformSelect = html.match(/<select id="memoryPlatform">([\s\S]*?)<\/select>/)?.[1] || '';
  assert(platformSelect.includes('<option>Web</option>'));
  assert(platformSelect.includes('<option>Flash</option>'));
});

test('계정 연동 화면은 로그인 없이 1분 가져오기와 파일 대안을 제공한다', () => {
  for (const id of ['accountPlatform', 'accountPaste', 'accountQuickImport', 'accountFileImport', 'downloadCsvTemplate', 'accountImportSummary']) {
    assert(html.includes(`id="${id}"`), `${id} 필요`);
  }
  assert(html.includes('로그인 없이 1분 가져오기'));
  assert(html.includes('게임 이름만 한 줄에 하나'));
  assert(html.includes('시간은 몰라도 괜찮아요'));
  assert(html.includes('비밀번호를 입력하지 마세요'));
  assert(html.includes('이 브라우저의 로컬 저장소'));
  for (const account of ['steam', 'epic', 'xbox', 'playstation', 'nintendo', 'google']) {
    assert(html.includes(`data-account="${account}"`), `${account} 상세 경로 필요`);
  }
});

test('Steam 공식 로그인 자동 가져오기는 backend 설정과 메시지 출처를 검증한다', () => {
  for (const id of ['steamConnect', 'steamConnectStatus']) assert(html.includes(`id="${id}"`), `${id} 필요`);
  assert(html.includes('name="playlog-steam-api"'));
  assert(html.includes('Steam은 로그인 한 번이면 됩니다'));
  assert(html.includes('누적 플레이 시간을 자동으로 가져옵니다'));
  assert(appSource.includes('event.origin !== steamApiOrigin'));
  assert(appSource.includes('event.source !== steamPopup'));
  assert(appSource.includes('steamPopup = null'));
  assert(appSource.includes('result.truncated || event.data.truncated'));
  assert(appSource.includes('공유 정책상 최근 100개만 포함해 ${policyOmitted}개를 제외했습니다.'));
  assert(appSource.includes('주소 길이 때문에 ${lengthOmitted}개를 추가로 제외했습니다.'));
  assert(accountCss.includes('.steam-connect-button'));
});

test('추천 다중 입력·추억 DB·정직한 계정 연동 고지가 있다', () => {
  assert(html.includes('최대 10개'));
  assert(html.includes('추억의 게임을 찾아드립니다'));
  assert(html.includes('로컬 게임 지식 데이터베이스'));
  assert(html.includes('연결된 것처럼 꾸미지 않습니다'));
  assert(html.includes('파트너 승인'));
  assert(html.includes('수동 가져오기'));
});

test('접근성과 모바일 내비게이션을 제공한다', () => {
  assert(html.includes('본문 바로가기'));
  assert(html.includes('aria-live="polite"'));
  assert(html.includes('class="mobile-nav"'));
  assert(css.includes('prefers-reduced-motion'));
  assert(css.includes(':focus-visible'));
});

test('추천·선택·뉴스에서 게임 표지를 쓰고 최대 5게임 소식 UI를 제공한다', () => {
  for (const id of ['newsGameSearch', 'newsSearchResults', 'newsSelectedGames', 'newsFeed', 'newsFreshness', 'refreshNews']) assert(html.includes(`id="${id}"`), `${id} 필요`);
  assert(html.includes('최대 5개'));
  assert(css.includes('.game-cover'));
  assert(css.includes('.news-card'));
  assert(css.includes('.news-game-rail'));
});

test('추천과 라이브러리에 게임 검색 및 사용자 게임 추가 UI가 있다', () => {
  assert(html.includes('id="libraryGameSearch"'));
  assert(html.includes('id="librarySearchResults"'));
  assert(html.includes('id="showCustomGame"'));
  assert(html.includes('id="customGameFields"'));
  assert(html.includes('id="customGameTitle"'));
  assert(html.includes('id="customGameGenre"'));
  assert(html.includes('게임 이름을 검색'));
  assert(css.includes('.game-search-results'));
});
