import test from 'node:test';
import assert from 'node:assert/strict';
import { games } from '../src/catalog.js';
import { normalizeNewsSelection, normalizeNewsItem, collectSelectedNews, newsFreshness, selectedNewsFreshness, buildNewsQuery, isNewsRelevant } from '../src/news.js';
import { parseGoogleNewsXml, parseYouTubeInitialData } from '../scripts/news-sources.mjs';

test('소식 게임 선택은 카탈로그 항목만 중복 없이 최대 5개 보존한다', () => {
  const ids = ['elden-ring', 'hades', 'elden-ring', 'missing', 'portal-2', 'celeste', 'stardew-valley', 'dead-cells'];
  assert.deepEqual(normalizeNewsSelection(ids, games), ['elden-ring', 'hades', 'portal-2', 'celeste', 'stardew-valley']);
});

test('뉴스 항목은 안전한 HTTPS 링크와 세 종류만 허용한다', () => {
  const clean = normalizeNewsItem({ id:'x', type:'video', title:'<b>새 영상</b>', url:'https://www.youtube.com/watch?v=abc', source:'공식 채널', publishedAt:'2026-08-09T10:00:00Z', thumbnail:'https://i.ytimg.com/vi/abc/hqdefault.jpg' });
  assert.equal(clean.title, '새 영상');
  assert.equal(clean.type, 'video');
  assert.equal(normalizeNewsItem({ title:'위험', url:'javascript:alert(1)' }), null);
  assert.equal(normalizeNewsItem({ title:'빈 링크', url:'' }), null);
});

test('선택한 게임 소식은 게임별 최대치와 전체 최신순을 지킨다', () => {
  const cache = { games: {
    'elden-ring': { items: [
      { id:'a', type:'news', title:'ELDEN RING 소식 A', url:'https://example.com/a', source:'A', publishedAt:'2026-08-08T00:00:00Z' },
      { id:'b', type:'event', title:'ELDEN RING 업데이트 B', url:'https://example.com/b', source:'B', publishedAt:'2026-08-09T00:00:00Z' }
    ]},
    'hades': { items: [{ id:'c', type:'video', title:'Hades game 영상 C', url:'https://youtube.com/watch?v=c', source:'C', publishedAt:'2026-08-10T00:00:00Z' }] }
  }};
  const result = collectSelectedNews(cache, ['elden-ring','hades'], games, 1);
  assert.equal(result.length, 2);
  assert.equal(result[0].item.id, 'c');
  assert.equal(result[1].item.id, 'b');
  assert(result.every(row => row.game?.coverUrl));
});

test('소식 검색어는 영문 제목과 쓸 만한 한글 별칭을 함께 사용한다', () => {
  const game = games.find(item => item.id === 'elden-ring');
  const query = buildNewsQuery(game);
  assert.match(query, /ELDEN RING/i);
  assert.match(query, /엘든/);
  assert.match(query, /when:30d/);
});

test('짧은 단일어 게임명은 게임 문맥이 없는 동명이인 뉴스를 거른다', () => {
  const game = { title:'Hades', newsAliases:['하데스'], newsContext:['Hades II','Supergiant'] };
  assert.equal(isNewsRelevant({ title:'BTS, ATEEZ, HADES reach No. 1 on the chart' }, game), false);
  assert.equal(isNewsRelevant({ title:'슬롯 하데스 위험 요소와 예방 전략' }, game), false);
  assert.equal(isNewsRelevant({ title:'신데리아, 초반부터 도파민 터지는 하데스풍 로그라이트 게임' }, game), false);
  assert.equal(isNewsRelevant({ title:'Hades II 대규모 업데이트 공개' }, game), true);
  assert.equal(isNewsRelevant({ title:'Supergiant의 Hades 게임 패치' }, game), true);
});

test('게임명만 끼워 넣은 도박 SEO 스팸은 비카지노 게임 소식에서 제외한다', () => {
  const stardew = { title:'Stardew Valley', newsAliases:['스타듀밸리','스타듀 밸리'], genres:['시뮬레이션','RPG'], tags:['농장'] };
  assert.equal(isNewsRelevant({ title:'스타듀밸리 슬롯 학습을 위한 최고의 자료와 도구' }, stardew), false);
  const casino = { title:'Casino Game', genres:['카지노'], tags:['슬롯'] };
  assert.equal(isNewsRelevant({ title:'Casino Game 슬롯 업데이트 공개' }, casino), true);
});

test('피드 생성 시각은 최신·주의·오래됨 상태를 정직하게 표시한다', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  assert.equal(newsFreshness('2026-08-10T08:00:00Z', now).status, 'fresh');
  assert.equal(newsFreshness('2026-08-09T12:00:00Z', now).status, 'stale');
  assert.equal(newsFreshness('2026-08-01T12:00:00Z', now).status, 'old');
});

test('선택 게임 신선도는 부분 갱신의 최상위 시각이 아니라 가장 오래된 행을 따른다', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const cache = {
    generatedAt:'2026-08-10T11:50:00Z',
    games:{
      'elden-ring':{ fetchedAt:'2026-08-10T10:00:00Z', status:'fresh', items:[] },
      'hades':{ fetchedAt:'2026-08-05T10:00:00Z', status:'partial-cache', items:[] },
      'portal-2':{ fetchedAt:null, status:'unavailable', items:[] }
    }
  };
  const result = selectedNewsFreshness(cache, ['elden-ring','hades','portal-2'], now);
  assert.equal(result.status, 'old');
  assert.equal(result.referenceAt, '2026-08-05T10:00:00Z');
  assert.equal(result.unavailable, 1);
  assert.equal(result.partial, 1);
});

test('선택 게임 cache 행이 누락되면 숨기지 않고 수집 불가로 상태를 낮춘다', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const cache = { games:{ a:{ fetchedAt:'2026-08-10T11:00:00Z', status:'fresh', items:[] } } };
  const result = selectedNewsFreshness(cache, ['a','missing'], now);
  assert.equal(result.unavailable, 1);
  assert.equal(result.status, 'stale');
  assert.match(result.label, /일부 수집 불가/);
  assert.equal(result.referenceAt, '2026-08-10T11:00:00Z');
});

test('Google News RSS를 뉴스·이벤트 항목으로 파싱한다', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title>ELDEN RING 여름 이벤트 &amp; 업데이트 - 게임뉴스</title><link>https://news.google.com/rss/articles/abc</link><guid>abc</guid><pubDate>Sun, 09 Aug 2026 10:00:00 GMT</pubDate><source url="https://game.example">게임뉴스</source></item></channel></rss>`;
  const items = parseGoogleNewsXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'event');
  assert.equal(items[0].source, '게임뉴스');
  assert.equal(items[0].title, 'ELDEN RING 여름 이벤트 & 업데이트');
});

test('YouTube 초기 데이터를 최신 영상 카드로 파싱한다', () => {
  const payload = { contents: [{ videoRenderer: { videoId:'abc123', title:{ runs:[{text:'ELDEN RING 새 이벤트'}] }, ownerText:{ runs:[{text:'Bandai Namco'}] }, publishedTimeText:{ simpleText:'2시간 전' }, thumbnail:{ thumbnails:[{url:'https://i.ytimg.com/vi/abc123/hqdefault.jpg'}] } } }] };
  const html = `<script>var ytInitialData = ${JSON.stringify(payload)};</script>`;
  const items = parseYouTubeInitialData(html, new Date('2026-08-09T12:00:00Z'));
  assert.equal(items[0].type, 'video');
  assert.equal(items[0].url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(items[0].source, 'Bandai Namco');
});
