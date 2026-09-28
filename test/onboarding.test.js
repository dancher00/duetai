import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cli = fileURLToPath(new URL('../bin/duet.js', import.meta.url));

test('offline demo runs the correction loop without touching the current project', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'duetai-demo-test-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, 'keep.txt'), 'untouched');
  const result = spawnSync(process.execPath, [cli, '--demo'], { cwd, encoding: 'utf8', timeout: 15000, env: { ...process.env, DUET_DEMO_FAST: '1' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scripted agents, real tests/);
  assert.match(result.stdout, /NEEDS_FIX/);
  assert.match(result.stdout, /PASS/);
  assert.match(result.stdout, /Tests.*passed/);
  assert.match(result.stdout, /rounds: 2\/2/);
  assert.match(result.stdout, /outside Git/);
  assert.doesNotMatch(result.stdout, /no working-tree changes/);
  assert.deepEqual(fs.readdirSync(cwd), ['keep.txt']);
});

test('help and version work without calling agents', () => {
  for (const [arg, expected] of [['--help', /--demo/], ['--version', /^0\.2\.0\s*$/]]) {
    const result = spawnSync(process.execPath, [cli, arg], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, expected);
  }
});
