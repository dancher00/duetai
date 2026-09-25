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

test('opens and exits the interactive prompt', () => {
  const result = spawnSync(process.execPath, [cli], { cwd: root, input: 'hi\n/exit\n', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Claude plans and reviews/);
  assert.match(result.stdout, /Привет! Что будем делать/);
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
  ? 'VERDICT: PASS\\nFINDINGS: None.\\nWHY: The change matches the task.\\nTESTS: npm test passed.'
  : 'PLAN\\n1. Inspect the target.\\n2. Implement the feature.\\nFILES: src/feature.js\\nACCEPTANCE: tests pass.\\nRISKS: none.\\nTESTS: npm test';
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Inspecting the repository.'}]}}));
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text}]}}));
`);
  fs.writeFileSync(codex, `#!/usr/bin/env node
console.error('internal provider diagnostic');
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Working on the implementation.'}}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'DECISION: Kept the change local.\\nCHANGED: src/feature.js\\nVALIDATION: npm test passed.'}}));
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
  assert.match(state.outputs.plan, /PLAN/);
  assert.doesNotMatch(state.outputs.plan, /Inspecting the repository/);
  assert.match(state.outputs.implementation, /DECISION/);
  assert.doesNotMatch(state.outputs.implementation, /Working on the implementation/);
  assert.match(state.outputs.review, /VERDICT: PASS/);
  assert.match(result.stdout, /Plan ready/);
  assert.match(result.stdout, /Claude.*Plan/s);
  assert.match(result.stdout, /Codex.*Implementation/s);
  assert.match(result.stdout, /Claude.*Review/s);
  assert.match(result.stdout, /Inspect the target/);
  assert.match(result.stdout, /Kept the change local/);
  assert.match(result.stdout, /The change matches the task/);
  assert.match(result.stdout, /Review complete/);
  assert.match(result.stdout, /Workflow complete/);
  assert.doesNotMatch(result.stdout, /\[claude\]|\[codex\]/);
  assert.doesNotMatch(result.stderr, /internal provider diagnostic/);
  const verbose = spawnSync(process.execPath, [cli, 'run', '--verbose', 'Create a tiny feature'], { cwd: sandbox, encoding: 'utf8' });
  assert.equal(verbose.status, 0, verbose.stderr);
  assert.match(verbose.stdout, /\[claude\]|\[codex\]/);
  assert.match(verbose.stderr, /internal provider diagnostic/);
  const compact = spawnSync(process.execPath, [cli, 'run', '--compact', 'Create a tiny feature'], { cwd: sandbox, encoding: 'utf8' });
  assert.equal(compact.status, 0, compact.stderr);
  assert.doesNotMatch(compact.stdout, /Inspect the target|Kept the change local|The change matches the task/);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('includes verbose when using Claude stream-json output', () => {
  const source = fs.readFileSync(cli, 'utf8');
  assert.match(source, /--verbose.*--output-format.*stream-json/);
  assert.match(source, /--skip-git-repo-check/);
});

test('allows Codex to run outside a Git repository', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'duetai-no-git-'));
  const claude = path.join(sandbox, 'mock-claude.js');
  const codex = path.join(sandbox, 'mock-codex.js');
  fs.writeFileSync(claude, `#!/usr/bin/env node
const review = process.argv.join(' ').includes('meticulous senior reviewer');
const text = review ? 'VERDICT: PASS\\nFINDINGS: none' : 'PLAN\\n1. Answer the request.';
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text}]}}));
`);
  fs.writeFileSync(codex, `#!/usr/bin/env node
require('node:fs').writeFileSync('codex-args.json', JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'DECISION: answered\\nCHANGED: none\\nVALIDATION: complete'}}));
`);
  fs.chmodSync(claude, 0o755);
  fs.chmodSync(codex, 0o755);
  fs.writeFileSync(path.join(sandbox, '.duet.json'), JSON.stringify({
    claude: { command: claude }, codex: { command: codex }, workflow: { maxRounds: 1 }
  }));
  const result = spawnSync(process.execPath, [cli, 'run', 'Answer a question'], { cwd: sandbox, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(fs.readFileSync(path.join(sandbox, 'codex-args.json'), 'utf8'));
  assert.ok(args.includes('--skip-git-repo-check'));
  fs.rmSync(sandbox, { recursive: true, force: true });
});
