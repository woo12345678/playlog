import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSourceItems, cacheRunMetadata } from '../scripts/news-cache-policy.mjs';

test('HTTP 200이어도 유효 파싱 항목이 비면 마지막 정상 소스를 보존한다', () => {
  const oldItems = [{ id:'old', title:'ELDEN RING 기존 영상' }];
  assert.deepEqual(chooseSourceItems(oldItems, []), { items:oldItems, ok:false, reason:'empty-parse' });
  const nextItems = [{ id:'new', title:'ELDEN RING 새 영상' }];
  assert.deepEqual(chooseSourceItems(oldItems, nextItems), { items:nextItems, ok:true, reason:'' });
});

test('부분 갱신은 전체 생성 시각을 바꾸지 않고 실행 시각만 기록한다', () => {
  const previous = { generatedAt:'2026-08-09T00:00:00.000Z', updatedAt:'2026-08-09T01:00:00.000Z' };
  assert.deepEqual(cacheRunMetadata(previous, '2026-08-10T00:00:00.000Z', false), {
    generatedAt:'2026-08-09T00:00:00.000Z', updatedAt:'2026-08-10T00:00:00.000Z'
  });
  assert.deepEqual(cacheRunMetadata(previous, '2026-08-10T00:00:00.000Z', true), {
    generatedAt:'2026-08-10T00:00:00.000Z', updatedAt:'2026-08-10T00:00:00.000Z'
  });
});
