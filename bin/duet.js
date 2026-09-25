#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { reviewNeedsFix } from '../src/verdict.js';

const VERSION = '0.1.0';
const activeChildren = new Set();
const cwd = process.cwd();
const stateDir = path.join(cwd, '.duet');
const stateFile = path.join(stateDir, 'session.json');
const eventFile = path.join(stateDir, 'events.jsonl');
const defaultConfig = {
  codex: { command: 'codex', profile: 'llm-proxy-cu', sandbox: 'workspace-write' },
  claude: { command: 'claude', permissionMode: 'acceptEdits' },
  workflow: { lead: 'claude', maxRounds: 2, runTests: false, testCommand: 'npm test' },
  ui: { maxEvents: 160 }
};

const ansi = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m', blue: '\x1b[34m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m', white: '\x1b[37m',
  bg: '\x1b[48;5;235m', clear: '\x1b[2J\x1b[H', hide: '\x1b[?25l', show: '\x1b[?25h'
};
const color = (c, s) => `${ansi[c] || ''}${s}${ansi.reset}`;
const now = () => new Date().toISOString();

function loadConfig() {
  const file = path.join(cwd, '.duet.json');
  if (!fs.existsSync(file)) return structuredClone(defaultConfig);
  try {
    const user = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...structuredClone(defaultConfig), ...user,
      codex: { ...defaultConfig.codex, ...(user.codex || {}) },
      claude: { ...defaultConfig.claude, ...(user.claude || {}) },
      workflow: { ...defaultConfig.workflow, ...(user.workflow || {}) },
      ui: { ...defaultConfig.ui, ...(user.ui || {}) } };
  } catch (e) { throw new Error(`Invalid .duet.json: ${e.message}`); }
}

function ensureState() { fs.mkdirSync(stateDir, { recursive: true }); }
function saveState(state) { ensureState(); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n'); }
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; } }
function appendEvent(event) { ensureState(); fs.appendFileSync(eventFile, JSON.stringify({ at: now(), ...event }) + '\n'); }
function git(args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); return (r.stdout || '').trim(); }
function gitSnapshot() { return { branch: git(['branch', '--show-current']), status: git(['status', '--short']), diff: git(['diff', '--stat']) }; }

function usage() {
  console.log(`${color('cyan', 'DuetAI')} ${color('dim', `v${VERSION}`)}\n\n` +
`  duet                         open the interactive workspace\n` +
`  duet run "task"              run the Claude → Codex → review workflow\n` +
`  duet run --compact "task"    show phases and verdict only\n` +
`  duet run --verbose "task"    include raw agent and tool output\n` +
`  duet resume                  continue the last saved task\n` +
`  duet status                  show the last session\n` +
`  duet doctor                  check local prerequisites\n` +
`  duet init                    create a commented .duet.json\n` +
`  duet --version               print version\n`);
}

function doctor() {
  console.log(`${color('cyan', 'DuetAI doctor')}\n`);
  const checks = [
    ['node', process.version],
    ['git', commandVersion('git', ['--version'])],
    ['claude', commandVersion('claude', ['--version'])],
    ['codex', commandVersion('codex', ['--version'])],
    ['LLMPROXY_API_KEY', process.env.LLMPROXY_API_KEY ? 'set' : 'not set (Codex may use saved login)']
  ];
  for (const [name, result] of checks) console.log(`  ${result ? color('green', '✓') : color('red', '✗')} ${name.padEnd(18)} ${result || 'missing'}`);
  console.log(`\n  ${color('dim', `workspace: ${cwd}`)}`);
}
function commandVersion(cmd, args) { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return r.status === 0 ? (r.stdout || r.stderr || '').trim().split('\n')[0] : ''; }

function status() {
  const s = loadState();
  if (!s) return console.log(`${color('yellow', 'No DuetAI session yet.')} Run ${color('cyan', 'duet run "..."')}.`);
  console.log(`${color('cyan', 'DuetAI session')} ${s.id}\n`);
  console.log(`  task:    ${s.task}\n  phase:   ${s.phase}\n  round:   ${s.round}/${s.maxRounds}\n  started: ${s.startedAt}\n  updated: ${s.updatedAt}\n`);
  console.log(`  ${color('dim', s.snapshot?.diff || 'No working-tree diff recorded.')}`);
}

function init() {
  const file = path.join(cwd, '.duet.json');
  if (fs.existsSync(file)) return console.log(`${color('yellow', 'Already exists:')} ${file}`);
  fs.writeFileSync(file, JSON.stringify(defaultConfig, null, 2) + '\n');
  console.log(`${color('green', 'Created')} ${file}`);
}

function runAgent(kind, prompt, config, onEvent) {
  return new Promise((resolve, reject) => {
    const isCodex = kind === 'codex';
    const args = isCodex
      ? ['exec', '--profile', config.codex.profile, '--sandbox', config.codex.sandbox, '--json', prompt]
      : ['-p', prompt, '--verbose', '--output-format', 'stream-json', '--permission-mode', config.claude.permissionMode];
    const child = spawn(isCodex ? config.codex.command : config.claude.command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.add(child);
    let output = ''; let stderr = ''; let buffer = ''; const messages = [];
    const emit = (event) => { onEvent?.({ agent: kind, ...event }); };
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line); const text = extractText(obj);
          if (text.trim()) { messages.push(text.trim()); output += `${output ? '\n' : ''}${text.trim()}`; }
          emit({ type: 'stream', text, raw: obj });
        }
        catch { output += line + '\n'; emit({ type: 'stream', text: line }); }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); const text = chunk.toString().trim(); if (text) emit({ type: 'log', text }); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
      if (buffer.trim()) { output += `${output ? '\n' : ''}${buffer.trim()}`; messages.push(buffer.trim()); emit({ type: 'stream', text: buffer }); }
      const finalOutput = messages.at(-1) || output.trim();
      if (code === 0) resolve({ output: finalOutput, stderr: stderr.trim() });
      else reject(new Error(`${kind} exited with ${signal || `code ${code}`}${stderr ? `: ${stderr.trim().slice(-800)}` : ''}`));
    });
  });
}

function extractText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.message === 'string') return obj.message;
  if (obj.item && typeof obj.item.text === 'string') return obj.item.text;
  if (obj.item && typeof obj.item.content === 'string') return obj.item.content;
  if (obj.type === 'item.completed' && obj.item?.type === 'agent_message') return obj.item.text || obj.item.content || '';
  if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) return obj.message.content.map(x => x.text || '').join('');
  return '';
}

function compact(text, max = 1100) { return text.length > max ? text.slice(0, max) + '\n…' : text; }
function id() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }

async function workflow(task, config, render = createConsoleRenderer()) {
  ensureState();
  const state = { id: id(), task, phase: 'starting', round: 0, maxRounds: config.workflow.maxRounds, startedAt: now(), updatedAt: now(), snapshot: gitSnapshot(), outputs: {} };
  saveState(state); appendEvent({ type: 'session.started', task });
  const event = (e) => { state.updatedAt = now(); appendEvent(e); render(e, state); saveState(state); };
  try {
    state.phase = 'planning'; event({ type: 'phase', phase: state.phase, agent: 'claude' });
    const plan = await runAgent('claude', `You are the lead architect in DuetAI. Do not edit files. Inspect the repository and return a concrete plan for the task. Your final response must be useful in a terminal and no longer than 12 lines. Use exactly these headings: PLAN, FILES, ACCEPTANCE, RISKS, TESTS. Prefer specific file paths and commands; do not narrate tool calls.\n\nTASK:\n${task}`, config, event);
    state.outputs.plan = plan.output; event({ type: 'phase.completed', phase: 'planning', text: compact(plan.output) });
    for (let round = 1; round <= config.workflow.maxRounds; round++) {
      state.round = round; state.phase = 'implementation'; event({ type: 'phase', phase: state.phase, agent: 'codex', round });
      const implementation = await runAgent('codex', `You are the implementation engineer. Work directly in the current repository. Implement the user's task using the lead plan below. Make the smallest complete change and run relevant tests. Your final response must be useful in a terminal and no longer than 10 lines. Use exactly these headings: DECISION, CHANGED, VALIDATION. Do not narrate tool calls.\n\nUSER TASK:\n${task}\n\nLEAD PLAN:\n${state.outputs.plan}\n\n${round > 1 ? `PREVIOUS REVIEW:\n${state.outputs.review}` : ''}`, config, event);
      state.outputs.implementation = implementation.output; state.snapshot = gitSnapshot(); event({ type: 'phase.completed', phase: 'implementation', text: compact(implementation.output), snapshot: state.snapshot });
      state.phase = 'review'; event({ type: 'phase', phase: state.phase, agent: 'claude', round });
      const review = await runAgent('claude', `You are a meticulous senior reviewer. Do not edit files. Inspect the current git diff and verify the task. Your final response must be useful in a terminal and no longer than 10 lines. Use exactly these headings: VERDICT (PASS or NEEDS_FIX), FINDINGS, WHY, TESTS. Do not narrate tool calls.\n\nTASK:\n${task}\n\nLEAD PLAN:\n${state.outputs.plan}`, { ...config, claude: { ...config.claude, permissionMode: 'plan' } }, event);
      state.outputs.review = review.output; state.snapshot = gitSnapshot(); event({ type: 'phase.completed', phase: 'review', text: compact(review.output), snapshot: state.snapshot });
      if (!reviewNeedsFix(review.output)) break;
      if (round === config.workflow.maxRounds) break;
    }
    if (config.workflow.runTests) { state.phase = 'tests'; event({ type: 'phase', phase: state.phase }); const result = spawnSync(config.workflow.testCommand, { cwd, shell: true, encoding: 'utf8' }); state.outputs.tests = (result.stdout || '') + (result.stderr || ''); event({ type: 'phase.completed', phase: state.phase, code: result.status, text: compact(state.outputs.tests) }); }
    state.phase = 'complete'; state.snapshot = gitSnapshot(); state.updatedAt = now(); saveState(state); appendEvent({ type: 'session.completed', snapshot: state.snapshot }); render({ type: 'complete', text: 'Workflow complete.' }, state); return state;
  } catch (error) { state.phase = 'failed'; state.error = error.message; state.updatedAt = now(); saveState(state); appendEvent({ type: 'session.failed', error: error.message }); render({ type: 'error', text: error.message }, state); throw error; }
}

function phaseLabel(phase, agent) {
  const labels = { planning: 'Claude is preparing the plan', implementation: 'Codex is implementing', review: 'Claude is reviewing', tests: 'Running final tests' };
  return labels[phase] || (agent ? `${agent} · ${phase}` : phase);
}

function snapshotSummary(snapshot) {
  const files = (snapshot?.status || '').split('\n').filter(Boolean).length;
  const stat = (snapshot?.diff || '').split('\n').filter(Boolean).at(-1) || '';
  if (!files && !stat) return 'no working-tree changes';
  if (/\bfile(?:s)? changed\b/.test(stat)) return stat;
  return [files ? `${files} file${files === 1 ? '' : 's'} changed` : '', stat].filter(Boolean).join(' · ');
}

function reviewVerdict(text) {
  const match = String(text || '').match(/\bVERDICT\s*:?\s*(PASS|NEEDS(?:_|\s+)FIX)\b/i);
  return match ? match[1].toUpperCase().replace(/\s+/g, '_') : 'REVIEWED';
}

function elapsed(state) {
  const ms = Math.max(0, new Date(state.updatedAt || now()) - new Date(state.startedAt));
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function reportText(text, maxLines = 12, maxChars = 1400) {
  const lines = String(text || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')
    .map(line => line.trimEnd()).filter((line, index, all) => line.trim() || (index > 0 && all[index - 1]?.trim()));
  let result = lines.slice(0, maxLines).join('\n').trim();
  if (result.length > maxChars) result = result.slice(0, maxChars).trimEnd() + '…';
  if (lines.length > maxLines) result += '\n…';
  return result;
}

function printReport(agent, title, text, shade, maxLines) {
  const report = reportText(text, maxLines);
  if (!report) return;
  console.log(`\n  ${color(shade, agent)} ${color('dim', '·')} ${color('bold', title)}`);
  for (const line of report.split('\n')) console.log(`  ${color('dim', '│')} ${line}`);
}

function createConsoleRenderer({ verbose = false, compactMode = false } = {}) {
  let spinner = null;
  let spinnerLabel = '';
  let spinnerStarted = 0;
  const frames = ['◐', '◓', '◑', '◒'];
  let frame = 0;
  const stopSpinner = () => {
    if (!spinner) return;
    clearInterval(spinner); spinner = null;
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
  };
  const startSpinner = (label) => {
    stopSpinner(); spinnerLabel = label; spinnerStarted = Date.now();
    if (!process.stdout.isTTY || verbose) { console.log(`\n${color('cyan', '◆')} ${color('bold', label)}`); return; }
    const draw = () => process.stdout.write(`\r${color('cyan', frames[frame++ % frames.length])} ${label} ${color('dim', `${Math.round((Date.now() - spinnerStarted) / 1000)}s`)}`);
    draw(); spinner = setInterval(draw, 250);
  };
  return (e, state) => {
    if (verbose && e.type === 'stream' && e.text?.trim()) process.stdout.write(color(e.agent === 'codex' ? 'green' : 'magenta', `\n[${e.agent}] `) + e.text);
    else if (verbose && e.type === 'log' && e.text?.trim()) process.stderr.write(color('dim', `\n${e.text}`));
    else if (e.type === 'phase') startSpinner(phaseLabel(e.phase, e.agent) + (e.round ? ` · round ${e.round}/${state.maxRounds}` : ''));
    else if (e.type === 'phase.completed') {
      stopSpinner();
      if (e.phase === 'planning') {
        console.log(`${color('green', '✓')} Plan ready`);
        if (!compactMode && !verbose) printReport('Claude', 'Plan', e.text, 'magenta', 12);
      } else if (e.phase === 'implementation') {
        console.log(`${color('green', '✓')} Implementation complete ${color('dim', `· ${snapshotSummary(e.snapshot)}`)}`);
        if (!compactMode && !verbose) printReport('Codex', 'Implementation', e.text, 'green', 10);
      } else if (e.phase === 'review') {
        console.log(`${color('green', '✓')} Review complete ${color(reviewNeedsFix(e.text) ? 'yellow' : 'green', `· ${reviewVerdict(e.text)}`)}`);
        if (!compactMode && !verbose) printReport('Claude', 'Review', e.text, 'magenta', 10);
      }
      else if (e.phase === 'tests') console.log(`${e.code === 0 ? color('green', '✓') : color('red', '✗')} Tests ${e.code === 0 ? 'passed' : `failed (exit ${e.code})`}`);
    } else if (e.type === 'complete') {
      stopSpinner();
      console.log(`\n${color('green', '✓ Workflow complete')}`);
      console.log(`  ${snapshotSummary(state.snapshot)}`);
      console.log(`  review: ${reviewVerdict(state.outputs?.review)} · rounds: ${state.round}/${state.maxRounds} · duration: ${elapsed(state)}`);
      console.log(`  ${color('dim', 'details: .duet/session.json · raw events: .duet/events.jsonl')}`);
    } else if (e.type === 'error') { stopSpinner(); console.error(`\n${color('red', '✗ ' + e.text)}`); }
  };
}

function renderTui(model) {
  const width = process.stdout.columns || 100; const height = process.stdout.rows || 30; const inner = Math.max(40, width - 2);
  const visible = model.verbose ? model.events.filter(e => e.type !== 'stream' || e.text?.trim()) : model.events.filter(e => ['phase', 'phase.completed', 'complete', 'error'].includes(e.type));
  const events = visible.slice(-Math.max(5, height - 11));
  const title = ` ${color('bold', 'DuetAI')} ${color('dim', '·')} ${model.state?.phase || 'ready'} ${color('dim', '·')} ${model.state?.round ? `round ${model.state.round}` : 'two agents, one flow'} ${color('dim', `· v ${model.verbose ? 'compact' : 'details'}`)}`;
  const line = color('dim', '─'.repeat(inner));
  const body = events.map(e => {
    const who = e.agent ? color(e.agent === 'codex' ? 'green' : 'magenta', e.agent.padEnd(7)) : color('cyan', 'system '.padEnd(7));
    let text = e.text || e.phase || e.type || '';
    if (e.type === 'phase.completed') text = e.phase === 'review' ? `review · ${reviewVerdict(e.text)}` : `${e.phase} complete`;
    return `${who} ${compact(text.replaceAll('\n', ' '), inner - 10)}`;
  });
  const task = model.state?.task ? compact(model.state.task, inner - 10) : 'Type a task below';
  process.stdout.write(ansi.clear + ansi.hide + title + '\n' + line + '\n' + ` ${color('dim', 'task:')} ${task}\n` + line + '\n' + body.join('\n') + '\n' + line + '\n' + ` ${color('dim', '›')} ${model.input}` + ansi.show);
}

async function interactive(config) {
  const model = { input: '', events: [], state: loadState(), verbose: false };
  const add = (e, s) => { model.events.push(e); model.state = s; renderTui(model); };
  readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume(); renderTui(model);
  let running = false;
  process.stdin.on('keypress', async (_, key) => {
    if (key?.ctrl && key.name === 'c') shutdown(130);
    if (key?.name === 'v' && !running && !model.input) model.verbose = !model.verbose;
    else if (key?.name === 'return') {
      const task = model.input.trim(); model.input = ''; if (!task || running) return; running = true; renderTui(model);
      try { await workflow(task, config, add); } catch {} finally { running = false; renderTui(model); }
    } else if (key?.name === 'backspace') model.input = model.input.slice(0, -1);
    else if (key?.sequence && !key.ctrl && !key.meta) model.input += key.sequence;
    renderTui(model);
  });
}

function shutdown(code = 0) {
  for (const child of activeChildren) {
    try { child.kill('SIGTERM'); } catch {}
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write(ansi.show + '\n');
  process.exit(code);
}

process.on('SIGTERM', () => shutdown(143));

async function main() {
  const config = loadConfig(); const [command, ...rest] = process.argv.slice(2);
  if (command === '--version' || command === '-v') return console.log(VERSION);
  if (command === 'doctor') return doctor();
  if (command === 'status') return status();
  if (command === 'init') return init();
  if (command === 'run') { const verbose = rest.includes('--verbose'); const compactMode = rest.includes('--compact'); const task = rest.filter(x => !['--verbose', '--compact'].includes(x)).join(' ').trim(); if (!task) return usage(); await workflow(task, config, createConsoleRenderer({ verbose, compactMode })); return; }
  if (command === 'resume') { const verbose = rest.includes('--verbose'); const compactMode = rest.includes('--compact'); const s = loadState(); if (!s?.task) return console.log('No resumable session.'); await workflow(`Continue the previous task. Original task:\n${s.task}\nPrevious review:\n${s.outputs?.review || ''}`, config, createConsoleRenderer({ verbose, compactMode })); return; }
  if (command && command !== 'tui') return usage();
  await interactive(config);
}

main().catch((e) => { console.error(color('red', `DuetAI: ${e.message}`)); process.exitCode = 1; });
