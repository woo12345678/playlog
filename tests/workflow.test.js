import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/refresh-news.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const jobsAt = workflow.indexOf('\njobs:');
const header = workflow.slice(0, jobsAt);

function jobBlock(name) {
  const marker = `\n  ${name}:`;
  const start = workflow.indexOf(marker, jobsAt);
  assert(start >= 0, `${name} job 필요`);
  const afterHeader = start + marker.length;
  const nextMatch = workflow.slice(afterHeader).match(/\n  [A-Za-z0-9-]+:\n/);
  const end = nextMatch ? afterHeader + nextMatch.index : workflow.length;
  return workflow.slice(start, end);
}

function assertOnlyPermissions(block, expected) {
  const match = block.match(/\n    permissions:\n((?:      [^\n]+\n)+)/);
  assert(match, 'job별 permissions 필요');
  const lines = match[1].trim().split('\n').map(line => line.trim()).sort();
  assert.deepEqual(lines, [...expected].sort());
}

test('검증 성공 뒤 사이트를 뉴스 수집과 독립적으로 배포한다', () => {
  assert.match(header, /push:\n    branches: \[main\]/);
  assert.doesNotMatch(header, /\npermissions:/, '전역 쓰기 권한 금지');
  const verify = jobBlock('verify');
  const initial = jobBlock('deploy-initial');
  assert.match(verify, /if: github\.event_name != 'workflow_dispatch' \|\| github\.ref == 'refs\/heads\/main'/);
  assert.match(verify, /outputs:\n      sha: \$\{\{ steps\.release\.outputs\.sha \}\}/);
  assert.match(verify, /ref: main/);
  assert.match(verify, /run: npm test/);
  assertOnlyPermissions(verify, ['contents: read']);
  assert.match(initial, /needs: verify/);
  assert.match(initial, /if: github\.event_name != 'schedule'/);
  assert.match(initial, /ref: \$\{\{ needs\.verify\.outputs\.sha \}\}/);
  assert.match(initial, /name: github-pages-initial/);
  assert.match(initial, /artifact_name: github-pages-initial/);
  assertOnlyPermissions(initial, ['contents: read', 'pages: write', 'id-token: write']);
});

test('뉴스 갱신은 최소 권한으로 실행하고 초기 배포보다 늦게 최신 main을 재배포한다', () => {
  assert.match(header, /cancel-in-progress:\s*true/);
  const refresh = jobBlock('refresh');
  const refreshed = jobBlock('deploy-refreshed');
  assert.match(refresh, /needs: verify/);
  assert.match(refresh, /outputs:\n      deploy-sha: \$\{\{ steps\.cache\.outputs\.sha \}\}/);
  assert.match(refresh, /ref: \$\{\{ needs\.verify\.outputs\.sha \}\}/);
  assert.match(refresh, /chore\(news\): refresh public game feeds \[skip ci\]/);
  const pushAt = refresh.indexOf('git push origin HEAD:main');
  const shaOutputs = [...refresh.matchAll(/echo "sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"/g)].map(match => match.index);
  assert.equal(shaOutputs.length, 2, '변경 없음/있음 양쪽에서 SHA 출력 필요');
  assert(pushAt >= 0 && shaOutputs[1] > pushAt, '변경 cache는 push 성공 뒤 SHA를 출력해야 함');
  assertOnlyPermissions(refresh, ['contents: write']);
  assert.doesNotMatch(refresh, /pages: write|id-token: write/);
  assert.match(refreshed, /needs:\n      - refresh\n      - deploy-initial/);
  assert.match(refreshed, /if: always\(\) && needs\.refresh\.result == 'success' && \(github\.event_name == 'schedule' \|\| needs\.deploy-initial\.result == 'success'\)/);
  assert.match(refreshed, /ref: \$\{\{ needs\.refresh\.outputs\.deploy-sha \}\}/);
  assert.doesNotMatch(refreshed, /ref: main/);
  assert.match(refreshed, /name: github-pages-refreshed/);
  assert.match(refreshed, /artifact_name: github-pages-refreshed/);
  assertOnlyPermissions(refreshed, ['contents: read', 'pages: write', 'id-token: write']);
});
