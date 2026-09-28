import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/duet.js', import.meta.url));

function runWorkflow(t, reviews, { testExit, maxRounds = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duetai-result-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const claude = path.join(dir, 'claude.cjs');
  const codex = path.join(dir, 'codex.cjs');
  fs.writeFileSync(claude, `#!/usr/bin/env node
const fs = require('node:fs');
let text = 'MODE: DUET\\nPLAN: Implement the feature.';
if (process.argv.join(' ').includes('meticulous senior reviewer')) {
  const count = fs.existsSync('review-count') ? Number(fs.readFileSync('review-count', 'utf8')) : 0;
  const reviews = ${JSON.stringify(reviews)};
  text = reviews[Math.min(count, reviews.length - 1)];
  fs.writeFileSync('review-count', String(count + 1));
}
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
`);
  fs.writeFileSync(codex, `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Implemented.' } }));
`);
  fs.chmodSync(claude, 0o755);
  fs.chmodSync(codex, 0o755);
  fs.writeFileSync(path.join(dir, '.duet.json'), JSON.stringify({
    claude: { command: claude }, codex: { command: codex },
    workflow: { maxRounds, runTests: testExit !== undefined, testCommand: `exit ${testExit ?? 0}` }
  }));
  const result = spawnSync(process.execPath, [cli], {
    cwd: dir, input: 'Implement a feature\n/exit\n', encoding: 'utf8', timeout: 10000
  });
  assert.ifError(result.error);
  const readState = name => JSON.parse(fs.readFileSync(path.join(dir, '.duet', name), 'utf8'));
  const state = readState('session.json');
  const resume = readState('last-duet.json');
  const events = fs.readFileSync(path.join(dir, '.duet', 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  return { result, state, resume, events };
}

function assertFailed({ result, state, resume, events }, message) {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(state.phase, 'failed');
  assert.equal(resume.phase, 'failed');
  assert.match(state.error, message);
  assert.match(result.stderr, message);
  assert.doesNotMatch(result.stdout, /Workflow complete/);
  assert.ok(events.some(event => event.type === 'session.failed'));
  assert.ok(!events.some(event => event.type === 'session.completed'));
}

test('fails when review still needs fixes at the round limit', t => {
  const run = runWorkflow(t, ['VERDICT: NEEDS_FIX']);
  assertFailed(run, /Review did not pass after 2 round/);
  assert.equal(run.state.round, 2);
});

for (const review of ['', 'Looks good.', 'VERDICT: UNKNOWN', 'VERDICT: PASS\nVERDICT: NEEDS_FIX']) {
  test(`rejects missing or ambiguous verdict: ${JSON.stringify(review)}`, t => {
    const run = runWorkflow(t, [review]);
    assertFailed(run, /unambiguous PASS or NEEDS_FIX/);
    assert.equal(run.state.round, 1);
    assert.match(run.result.stdout, /UNKNOWN/);
  });
}

test('fails when final tests exit nonzero despite a passing review', t => {
  const run = runWorkflow(t, ['VERDICT: PASS'], { testExit: 7 });
  assertFailed(run, /Final tests failed \(exit 7\)/);
  assert.equal(run.state.testResult.code, 7);
  assert.equal(run.resume.testResult.code, 7);
});

test('completes after fixes receive PASS and final tests pass', t => {
  const { result, state, resume, events } = runWorkflow(t, ['VERDICT: NEEDS_FIX', 'VERDICT: PASS'], { testExit: 0 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state.phase, 'complete');
  assert.equal(resume.phase, 'complete');
  assert.equal(state.round, 2);
  assert.equal(state.testResult.code, 0);
  assert.match(result.stdout, /Workflow complete/);
  assert.ok(events.some(event => event.type === 'session.completed'));
});

test('cannot complete without review when no rounds are configured', t => {
  assertFailed(runWorkflow(t, ['VERDICT: PASS'], { maxRounds: 0 }), /Review did not pass after 0 round/);
});
