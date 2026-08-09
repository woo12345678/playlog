import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeCssColor, safeHttpsAttribute } from '../src/html.js';

test('외부 카탈로그 문자열은 HTML·CSS·URL 문맥에서 실행되지 않는다', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(safeCssColor('red; background:url(javascript:alert(1))'), '#35312b');
  assert.equal(safeCssColor('#A1b2C3'), '#A1b2C3');
  assert.equal(safeHttpsAttribute('javascript:alert(1)'), '');
  assert.equal(safeHttpsAttribute('https://example.com/?a=1&b=2'), 'https://example.com/?a=1&amp;b=2');
});
