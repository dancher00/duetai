import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// The agents are scripted. The normal orchestrator and the test executions are real.
export async function runDemo(cli) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'duetai-demo-'));
  const agent = path.join(directory, 'demo-agent.cjs');
  console.log('\nDuetAI offline demo · scripted agents, real tests');
  console.log('No model calls or account required. All changes stay in a temporary directory.\n');
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(directory, 'clamp.js'), 'export const clamp = (value, min, max) => value;\n');
  fs.writeFileSync(path.join(directory, 'clamp.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from './clamp.js';
test('clamps to both bounds', () => {
  assert.equal(clamp(-2, 0, 10), 0);
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(4, 0, 10), 4);
});
`);
  fs.writeFileSync(agent, `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const prompt = args.join(' ');
let text;
if (args[0] === 'exec') {
  const fixing = prompt.includes('PREVIOUS REVIEW:');
  fs.writeFileSync('clamp.js', fixing
    ? 'export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));\\n'
    : 'export const clamp = (value, min, max) => Math.max(min, value);\\n');
  text = fixing
    ? 'DECISION: Apply both bounds.\\nCHANGED: clamp.js now handles values above max.\\nVALIDATION: Ready for independent review.'
    : 'DECISION: Apply the lower bound.\\nCHANGED: clamp.js.\\nVALIDATION: Upper-bound behavior still needs review.';
} else if (prompt.includes('meticulous senior reviewer')) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const tests = spawnSync(process.execPath, ['--test', 'clamp.test.js'], { encoding: 'utf8', env });
  text = tests.status === 0
    ? 'VERDICT: PASS\\nFINDINGS: Both bounds and in-range values work.\\nWHY: Independent assertions passed.\\nTESTS: 1 passed, 0 failed.'
    : 'VERDICT: NEEDS_FIX\\nFINDINGS: clamp(12, 0, 10) returns 12; expected 10.\\nWHY: The upper bound is never applied.\\nTESTS: 0 passed, 1 failed.';
} else {
  text = 'MODE: DUET\\nPLAN: Fix clamp and check both boundaries.\\nFILES: clamp.js\\nACCEPTANCE: Values stay between min and max.\\nRISKS: Fixing one bound can miss the other.\\nTESTS: node --test clamp.test.js';
}
setTimeout(() => console.log(JSON.stringify({ text })), process.env.DUET_DEMO_FAST === '1' ? 0 : 750);
`);
  fs.chmodSync(agent, 0o755);
  fs.writeFileSync(path.join(directory, '.duet.json'), JSON.stringify({
    claude: { command: agent }, codex: { command: agent },
    workflow: { maxRounds: 2, runTests: true, testCommand: 'npm test' }
  }));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli], { cwd: directory, env, stdio: ['pipe', 'inherit', 'inherit'], detached: process.platform !== 'win32' });
      let killTimer;
      const stop = () => {
        const kill = signal => { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch {} };
        kill('SIGTERM');
        killTimer = setTimeout(() => kill('SIGKILL'), 2000);
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      const cleanup = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); clearTimeout(killTimer); };
      child.stdin.on('error', () => {});
      child.stdin.end('Fix clamp so it respects both bounds.\n/exit\n');
      child.once('error', error => { cleanup(); reject(error); });
      child.once('close', (code, signal) => { cleanup(); resolve(signal ? 130 : code ?? 1); });
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
