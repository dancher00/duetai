import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'duetai-install-'));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
try {
  const pack = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temp], { cwd: root }).stdout)[0];
  assert.ok(pack.files.some(file => file.path === 'src/agents.js'));
  assert.ok(!pack.files.some(file => /^(assets|test|\.duet|\.env)(\/|$)/.test(file.path)));
  const publishedArchive = path.join(root, 'docs', pack.filename);
  if (fs.existsSync(publishedArchive)) {
    const unpacked = path.join(temp, 'published');
    fs.mkdirSync(unpacked);
    run('tar', ['-xzf', publishedArchive, '-C', unpacked]);
    for (const file of pack.files) {
      assert.deepEqual(fs.readFileSync(path.join(unpacked, 'package', file.path)), fs.readFileSync(path.join(root, file.path)),
        `Published archive is stale: ${file.path}. Rebuild with npm pack --pack-destination docs.`);
    }
  }
  const prefix = path.join(temp, 'prefix');
  run('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', fs.existsSync(publishedArchive) ? publishedArchive : path.join(temp, pack.filename)]);
  const project = path.join(temp, 'project');
  fs.mkdirSync(project);
  const emptyHome = path.join(temp, 'empty-home');
  fs.mkdirSync(emptyHome);
  const env = { ...process.env, HOME: emptyHome, CODEX_HOME: path.join(emptyHome, '.codex'), CLAUDE_CONFIG_DIR: path.join(emptyHome, '.claude') };
  for (const key of ['LLMPROXY_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[key];
  const cli = path.join(prefix, 'bin', 'duet');
  const prompt = run(cli, [], { cwd: project, env, input: '/\n/exit\n' });
  assert.match(prompt.stdout, /Claude leads/);
  assert.doesNotMatch(prompt.stdout, /API key:/);
  const demo = run(cli, ['--demo'], { cwd: project, env: { ...env, DUET_DEMO_FAST: '1' } });
  assert.match(demo.stdout, /scripted agents, real tests/);
  assert.match(demo.stdout, /rounds: 2\/2/);
  assert.equal(fs.existsSync(path.join(project, '.duet')), false);
  // Exercise the installed package, not imports from the source checkout.
  const agent = path.join(temp, 'agent.cjs');
  fs.writeFileSync(agent, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--profile')) process.exit(12);
let text;
if (args[0] === 'exec') text = 'DECISION: done';
else if (args.join(' ').includes('meticulous senior reviewer')) text = 'VERDICT: PASS';
else text = 'MODE: DUET\\nPLAN: implement';
console.log(JSON.stringify({text}));
`);
  fs.chmodSync(agent, 0o755);
  fs.writeFileSync(path.join(project, '.duet.json'), JSON.stringify({ claude: { command: agent }, codex: { command: agent } }));
  const workflow = run(cli, [], { cwd: project, env, input: 'Implement a feature\n/exit\n' });
  assert.match(workflow.stdout, /Workflow complete/);
  console.log(`Clean package install passed (${pack.size} bytes): empty home, no keys, offline demo and mock workflow.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
