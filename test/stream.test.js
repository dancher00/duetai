import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/duet.js', import.meta.url));
function withAgent(t, source) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'duetai-stream-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const command = path.join(cwd, 'agent.cjs');
  fs.writeFileSync(command, '#!/usr/bin/env node\n' + source);
  fs.chmodSync(command, 0o755);
  fs.writeFileSync(path.join(cwd, '.duet.json'), JSON.stringify({ claude: { command }, codex: { command } }));
  const result = spawnSync(process.execPath, [cli], { cwd, input: 'Hello\n/exit\n', encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  return { result, state: JSON.parse(fs.readFileSync(path.join(cwd, '.duet/session.json'), 'utf8')) };
}

test('uses the terminal Claude result and counts its usage once', t => {
  const { result, state } = withAgent(t, `
console.log(JSON.stringify({type:'assistant',message:{content:[{text:'intermediate'}]},usage:{input_tokens:100}}));
process.stdout.write(JSON.stringify({type:'result',result:'MODE: CHAT\\nRESPONSE: Finished.',usage:{input_tokens:10,output_tokens:5},total_cost_usd:0.01}));
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state.outputs.response, 'Finished.');
  assert.equal(state.usage[0].inputTokens, 10);
  assert.equal(state.usage[0].reportedCostUsd, 0.01);
});

test('reports a structured agent error even when the CLI exits zero', t => {
  const { result, state } = withAgent(t, `
console.log(JSON.stringify({type:'result',is_error:true,result:'Authentication failed'}));
`);
  assert.equal(result.status, 1);
  assert.equal(state.phase, 'failed');
  assert.match(state.error, /Authentication failed/);
});

test('preserves UTF-8 split between stream chunks without a trailing newline', t => {
  const { result, state } = withAgent(t, `
const data = Buffer.from(JSON.stringify({text:'MODE: CHAT\\nRESPONSE: Привет'}));
const offset = data.indexOf(Buffer.from('П')) + 1;
process.stdout.write(data.subarray(0,offset));
setTimeout(() => process.stdout.write(data.subarray(offset)),20);
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state.outputs.response, 'Привет');
});
