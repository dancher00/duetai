import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tasks } from '../benchmarks/tasks.js';
import { agentArgs, agentEnvironment } from '../src/agents.js';
import { eventUsage, sumUsage } from '../src/usage.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const index = arg.indexOf('=');
  if (index < 0 || !arg.startsWith('--')) throw new Error('Use --out=DIR --task=ID --mode=duet|codex|claude --timeout=600 --config=FILE');
  return [arg.slice(2,index), arg.slice(index+1)];
}));
for (const key of Object.keys(options)) {
  if (!['out', 'task', 'mode', 'timeout', 'config'].includes(key)) throw new Error(`Unknown option: --${key}`);
}
const selectedTasks = options.task ? tasks.filter(task => task.id === options.task) : tasks;
const modes = options.mode ? [options.mode] : ['codex', 'claude', 'duet'];
if (!selectedTasks.length || modes.some(mode => !['codex','claude','duet'].includes(mode))) throw new Error('Unknown task or mode.');
const timeoutMs = Number(options.timeout || 600) * 1000;
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout.');
const custom = options.config ? JSON.parse(fs.readFileSync(options.config, 'utf8')) : {};
const config = {
  codex: { command: 'codex', sandbox: 'workspace-write', ...custom.codex },
  claude: { command: 'claude', permissionMode: 'acceptEdits', ...custom.claude },
  workflow: { maxRounds: 2, runTests: true, testCommand: 'npm test' }
};
const out = path.resolve(options.out || path.join(root, 'benchmark-results', new Date().toISOString().replace(/[:.]/g,'-')));
fs.mkdirSync(out, { recursive: true });
const reportFile = path.join(out, 'results.json');
if (fs.existsSync(reportFile)) throw new Error(`Refusing to overwrite ${reportFile}`);
const versions = Object.fromEntries(['codex','claude'].map(kind => [kind, spawnSync(config[kind].command, ['--version'], { encoding:'utf8', timeout:10000 }).stdout?.trim() || 'unavailable']));
const report = { date: new Date().toISOString(), versions, timeoutSeconds: timeoutMs/1000, trialsPerCase: 1,
  models: { codex: config.codex.model || 'inherited CLI default', claude: config.claude.model || 'inherited CLI default' }, results: [] };

function run(command, args, cwd, env, input, prefix) {
  return new Promise(resolve => {
    const start = Date.now(); let stdout = ''; let stderr = ''; let timedOut = false;
    const cast = [[0, 'o', `$ ${path.basename(command)}${command === process.execPath ? ' bin/duet.js' : ' (benchmark task)'}\r\n`]];
    const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio:['pipe','pipe','pipe'] });
    const kill = signal => { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch {} };
    let hardKill;
    const stop = code => {
      process.exitCode = code;
      kill('SIGTERM');
      hardKill ||= setTimeout(() => kill('SIGKILL'), 2000);
    };
    const onInterrupt = () => stop(130);
    const onTerminate = () => stop(143);
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); hardKill = setTimeout(() => kill('SIGKILL'), 2000); }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    fs.writeFileSync(`${prefix}.stdout`, ''); fs.writeFileSync(`${prefix}.stderr`, '');
    child.stdout.on('data', chunk => { stdout += chunk; fs.appendFileSync(`${prefix}.stdout`,chunk); cast.push([(Date.now()-start)/1000,'o',chunk.replace(/\r?\n/g,'\r\n')]); });
    child.stderr.on('data', chunk => { stderr += chunk; fs.appendFileSync(`${prefix}.stderr`,chunk); });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
    child.on('error', error => { stderr += error.message; });
    child.on('close', (code, signal) => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      clearTimeout(timer);
      if (hardKill) { clearTimeout(hardKill); kill('SIGKILL'); }
      fs.writeFileSync(`${prefix}.stdout`, stdout); fs.writeFileSync(`${prefix}.stderr`, stderr);
      fs.writeFileSync(`${prefix}.cast`, [JSON.stringify({version:2,width:120,height:36,timestamp:Math.floor(start/1000),title:'DuetAI live benchmark',env:{TERM:'xterm-256color'}}), ...cast.map(event => JSON.stringify(event))].join('\n')+'\n');
      resolve({ code, signal, timedOut, seconds: (Date.now()-start)/1000, stdout, stderr });
    });
  });
}

function updateReport() {
  fs.writeFileSync(reportFile, JSON.stringify(report,null,2)+'\n');
  const rows = report.results.map(r => `| ${r.task} | ${r.mode} | ${r.acceptancePassed ? 'PASS' : 'FAIL'} | ${r.workflowPhase || r.exitCode} | ${r.seconds.toFixed(1)} | ${r.usage?.inputTokens ?? 'unknown'} | ${r.usage?.cachedInputTokens ?? 'unknown'} | ${r.usage?.outputTokens ?? 'unknown'} | ${r.usage?.reportedCostUsd == null ? 'unknown' : '$'+r.usage.reportedCostUsd.toFixed(4)} | ${r.rounds ?? '—'} |`);
  fs.writeFileSync(path.join(out,'REPORT.md'), `# DuetAI exploratory benchmark\n\nDate: ${report.date}\n\nCLI versions: ${JSON.stringify(versions)}\n\nModels requested: ${JSON.stringify(report.models)}. Observed model IDs, when emitted, are in results.json.\n\nOne trial per task and mode. Fresh identical repositories; same task text; no manual intervention during runs. Acceptance tests are supplied after each run and evaluate the original contract. Duet uses up to two implementation/review rounds, so this is a workflow comparison, not an equal-token-budget experiment. Timeout: ${timeoutMs/1000}s per run.\n\n| Task | Mode | Acceptance | Workflow/exit | Seconds | Input tokens | Cached input | Output tokens | CLI-reported USD | Rounds |\n|---|---|---|---|---:|---:|---:|---:|---|---:|\n${rows.join('\n')}\n\nInput includes cached and cache-write tokens; cached input is a subset, not an extra charge. Token counts across providers are not directly equivalent. Unknown cost means the CLI did not report a complete dollar total; it does not mean free. Reported dollar totals are provider estimates, not a verified invoice. Fresh repositories do not eliminate provider-side caching or user-level agent memory. No claim of general superiority follows from this small sample.\n`);
}

for (const task of selectedTasks) {
  for (const mode of modes) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `duetai-bench-${task.id}-${mode}-`));
    const prefix = path.join(out, `${task.id}-${mode}`);
    fs.writeFileSync(path.join(workspace,'package.json'), JSON.stringify({name:'duetai-benchmark-fixture',private:true,type:'module',scripts:{test:'node --test'}},null,2));
    fs.writeFileSync(path.join(workspace,'index.js'),task.source);
    fs.writeFileSync(path.join(workspace,'visible.test.js'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${task.exportName} } from './index.js';\ntest('basic contract', async () => { ${task.visible} });\n`);
    fs.writeFileSync(path.join(workspace,'.gitignore'),'.duet/\n.duet.json\n');
    fs.writeFileSync(path.join(workspace,'.duet.json'),JSON.stringify(config,null,2));
    for (const args of [['init','-q'],['add','.'],['-c','user.name=DuetAI benchmark','-c','user.email=benchmark@example.invalid','commit','-qm','Initial fixture']]) {
      const git = spawnSync('git',args,{cwd:workspace,encoding:'utf8'});
      if (git.status !== 0) throw new Error(git.stderr);
    }
    const prompt = `${task.task} Work only in this directory. Do not delegate to other agents. Do not commit or push.`;
    console.log(`${task.id} / ${mode}: running (timeout ${timeoutMs/1000}s)…`);
    const runResult = mode === 'duet'
      ? await run(process.execPath,[path.join(root,'bin/duet.js')],workspace,process.env,prompt+'\n/exit\n',prefix)
      : await run(config[mode].command,agentArgs(mode,prompt,config),workspace,agentEnvironment(mode),'',prefix);
    let state = null;
    try { state = JSON.parse(fs.readFileSync(path.join(workspace,'.duet/session.json'),'utf8')); } catch {}
    const eventFile = path.join(workspace,'.duet/events.jsonl');
    const raw = mode === 'duet' && fs.existsSync(eventFile) ? fs.readFileSync(eventFile,'utf8') : runResult.stdout;
    const events = raw.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const usage = mode === 'duet' ? sumUsage(state?.usage || []) : sumUsage(events.map(event => eventUsage(mode,event)).filter(Boolean));
    const observedModels = [...new Set(events.map(event => (event.raw || event).model).filter(Boolean))];
    const gradePath = `${prefix}.acceptance.mjs`;
    fs.writeFileSync(gradePath, `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${task.exportName} } from ${JSON.stringify(pathToFileURL(path.join(workspace,'index.js')).href)};\n${task.acceptance}\n`);
    const gradeEnv = { ...process.env };
    delete gradeEnv.NODE_TEST_CONTEXT;
    const grade = spawnSync(process.execPath,['--test',gradePath],{encoding:'utf8',timeout:10000,env:gradeEnv});
    fs.writeFileSync(`${prefix}.tests.txt`,(grade.stdout || '')+(grade.stderr || ''));
    const diff = spawnSync('git',['diff'],{cwd:workspace,encoding:'utf8'});
    fs.writeFileSync(`${prefix}.diff`,diff.stdout || '');
    if (state) fs.writeFileSync(`${prefix}.session.json`,JSON.stringify(state,null,2));
    const infrastructureError = /bwrap:.*Operation not permitted/.test(runResult.stdout + runResult.stderr)
      ? 'Host cannot initialize the Codex sandbox; this run is not a quality comparison.' : null;
    report.results.push({task:task.id,mode,seconds:runResult.seconds,exitCode:runResult.code,timedOut:runResult.timedOut,infrastructureError,
      acceptancePassed:grade.status === 0,workflowPhase:state?.phase || null,rounds:state?.round || null,usage,observedModels,workspace,manualInterventions:0});
    updateReport();
    console.log(`${task.id} / ${mode}: ${grade.status === 0 ? 'PASS' : 'FAIL'}, ${runResult.seconds.toFixed(1)}s, exit ${runResult.code}${runResult.timedOut ? ' (timeout)' : ''}`);
    if (infrastructureError) {
      fs.appendFileSync(path.join(out,'REPORT.md'), `\n**Suite stopped:** ${infrastructureError}\n`);
      console.error(infrastructureError);
      process.exitCode = 1;
      break;
    }
  }
  if (process.exitCode) break;
}
console.log(`Report: ${path.join(out,'REPORT.md')}`);
