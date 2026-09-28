import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../scripts/benchmark.js', import.meta.url));
function benchmark(t, error = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duetai-benchmark-test-'));
  const out = path.join(dir, 'results');
  t.after(() => {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
      for (const result of report.results) fs.rmSync(result.workspace, { recursive: true, force: true });
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const command = path.join(dir, 'agent.cjs');
  fs.writeFileSync(command, `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('fake-agent'); process.exit(0); }
console.error(${JSON.stringify(error)});
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'All done, tests pass.'}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:20,output_tokens:10}}));
`);
  fs.chmodSync(command, 0o755);
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ codex: { command }, claude: { command } }));
  const result = spawnSync(process.execPath, [runner, `--out=${out}`, `--config=${config}`, '--task=money', '--mode=codex'], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  return { result, report: JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')) };
}

test('benchmark grades unchanged code independently of a success claim', t => {
  const { result, report } = benchmark(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.results[0].exitCode, 0);
  assert.equal(report.results[0].acceptancePassed, false);
  assert.equal(report.results[0].usage.inputTokens, 100);
  assert.equal(report.results[0].usage.reportedCostUsd, null);
});

test('benchmark marks sandbox infrastructure failures and stops', t => {
  const { result, report } = benchmark(t, 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted');
  assert.equal(result.status, 1);
  assert.match(report.results[0].infrastructureError, /not a quality comparison/);
});
