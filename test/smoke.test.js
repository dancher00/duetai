import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'duet.js');

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

test('prints version', () => {
  const result = run('--version');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^0\.1\.0/m);
});

test('unknown command prints usage', () => {
  const result = run('not-a-command');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /DuetAI/);
  assert.match(result.stdout, /duet doctor/);
});

test('doctor detects installed runtime', () => {
  const result = run('doctor');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /node/);
  assert.match(result.stdout, /git/);
});

test('completes a mocked Claude and Codex workflow', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'duetai-test-'));
  const claude = path.join(sandbox, 'mock-claude.js');
  const codex = path.join(sandbox, 'mock-codex.js');
  fs.writeFileSync(claude, `#!/usr/bin/env node
const prompt = process.argv.join(' ');
const text = prompt.includes('meticulous senior reviewer')
  ? 'VERDICT PASS\\nNo critical findings.'
  : 'Plan: implement the requested change and verify it.';
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text}]}}));
`);
  fs.writeFileSync(codex, `#!/usr/bin/env node
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Implementation complete. Tests passed.'}}));
`);
  fs.chmodSync(claude, 0o755);
  fs.chmodSync(codex, 0o755);
  fs.writeFileSync(path.join(sandbox, '.duet.json'), JSON.stringify({
    claude: { command: claude }, codex: { command: codex }, workflow: { maxRounds: 1 }
  }));
  spawnSync('git', ['init', '-q'], { cwd: sandbox });
  const result = spawnSync(process.execPath, [cli, 'run', 'Create a tiny feature'], { cwd: sandbox, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(sandbox, '.duet', 'session.json'), 'utf8'));
  assert.equal(state.phase, 'complete');
  assert.match(state.outputs.plan, /Plan:/);
  assert.match(state.outputs.implementation, /Implementation complete/);
  assert.match(state.outputs.review, /VERDICT PASS/);
  fs.rmSync(sandbox, { recursive: true, force: true });
});
