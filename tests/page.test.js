import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('다섯 제품 탭과 핵심 조작이 문서에 존재한다', () => {
  for (const tab of ['recommend', 'memory', 'library', 'profile', 'accounts']) {
    assert(html.includes(`data-tab="${tab}"`), `${tab} 탭 필요`);
    assert(html.includes(`data-view="${tab}"`), `${tab} 화면 필요`);
  }
  for (const id of ['seedList', 'addSeed', 'memoryQuery', 'libraryForm', 'exportLibrary', 'importLibrary', 'shareProfile']) assert(html.includes(`id="${id}"`), `${id} 필요`);
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
