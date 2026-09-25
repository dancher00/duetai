import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
