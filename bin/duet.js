#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const VERSION = '0.1.0';
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
      : ['-p', prompt, '--output-format', 'stream-json', '--permission-mode', config.claude.permissionMode];
    const child = spawn(isCodex ? config.codex.command : config.claude.command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let stderr = ''; let buffer = '';
    const emit = (event) => { onEvent?.({ agent: kind, ...event }); };
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { const obj = JSON.parse(line); output += extractText(obj); emit({ type: 'stream', text: extractText(obj), raw: obj }); }
        catch { output += line + '\n'; emit({ type: 'stream', text: line }); }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); const text = chunk.toString().trim(); if (text) emit({ type: 'log', text }); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (buffer.trim()) { output += buffer; emit({ type: 'stream', text: buffer }); }
      if (code === 0) resolve({ output: output.trim(), stderr: stderr.trim() });
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

async function workflow(task, config, render = consoleRenderer) {
  ensureState();
  const state = { id: id(), task, phase: 'starting', round: 0, maxRounds: config.workflow.maxRounds, startedAt: now(), updatedAt: now(), snapshot: gitSnapshot(), outputs: {} };
  saveState(state); appendEvent({ type: 'session.started', task });
  const event = (e) => { state.updatedAt = now(); appendEvent(e); render(e, state); saveState(state); };
  try {
    state.phase = 'planning'; event({ type: 'phase', phase: state.phase, agent: 'claude' });
    const plan = await runAgent('claude', `You are the lead architect in DuetAI. Do not edit files. Analyze this task and produce a concise implementation plan with acceptance criteria, likely files, risks, and test commands.\n\nTASK:\n${task}`, config, event);
    state.outputs.plan = plan.output; event({ type: 'phase.completed', phase: 'planning', text: compact(plan.output) });
    for (let round = 1; round <= config.workflow.maxRounds; round++) {
      state.round = round; state.phase = 'implementation'; event({ type: 'phase', phase: state.phase, agent: 'codex', round });
      const implementation = await runAgent('codex', `You are the implementation engineer. Work directly in the current repository. Implement the user's task using the lead plan below. Make the smallest complete change, run relevant tests, and report files changed and test results.\n\nUSER TASK:\n${task}\n\nLEAD PLAN:\n${state.outputs.plan}\n\n${round > 1 ? `PREVIOUS REVIEW:\n${state.outputs.review}` : ''}`, config, event);
      state.outputs.implementation = implementation.output; state.snapshot = gitSnapshot(); event({ type: 'phase.completed', phase: 'implementation', text: compact(implementation.output), snapshot: state.snapshot });
      state.phase = 'review'; event({ type: 'phase', phase: state.phase, agent: 'claude', round });
      const review = await runAgent('claude', `You are a meticulous senior reviewer. Do not edit files. Inspect the current git diff and verify the task. Return exactly: VERDICT (PASS or NEEDS_FIX), critical findings, suggested fixes, and tests to run.\n\nTASK:\n${task}\n\nLEAD PLAN:\n${state.outputs.plan}`, { ...config, claude: { ...config.claude, permissionMode: 'plan' } }, event);
      state.outputs.review = review.output; state.snapshot = gitSnapshot(); event({ type: 'phase.completed', phase: 'review', text: compact(review.output), snapshot: state.snapshot });
      if (!/NEEDS_FIX|NEEDS FIX|FAIL/i.test(review.output)) break;
      if (round === config.workflow.maxRounds) break;
    }
    if (config.workflow.runTests) { state.phase = 'tests'; event({ type: 'phase', phase: state.phase }); const result = spawnSync(config.workflow.testCommand, { cwd, shell: true, encoding: 'utf8' }); state.outputs.tests = (result.stdout || '') + (result.stderr || ''); event({ type: 'phase.completed', phase: state.phase, code: result.status, text: compact(state.outputs.tests) }); }
    state.phase = 'complete'; state.snapshot = gitSnapshot(); state.updatedAt = now(); saveState(state); appendEvent({ type: 'session.completed', snapshot: state.snapshot }); render({ type: 'complete', text: 'Workflow complete.' }, state); return state;
  } catch (error) { state.phase = 'failed'; state.error = error.message; state.updatedAt = now(); saveState(state); appendEvent({ type: 'session.failed', error: error.message }); render({ type: 'error', text: error.message }, state); throw error; }
}

function consoleRenderer(e, state) {
  if (e.type === 'stream') process.stdout.write(color(e.agent === 'codex' ? 'green' : 'magenta', `\n[${e.agent}] `) + e.text);
  else if (e.type === 'log') process.stderr.write(color('dim', `\n${e.text}`));
  else if (e.type === 'phase') console.log(`\n${color('cyan', '◆')} ${color('bold', e.agent ? `${e.phase} · ${e.agent}` : e.phase)}${e.round ? color('dim', ` · round ${e.round}`) : ''}`);
  else if (e.type === 'phase.completed') console.log(`\n${color('green', '✓')} ${e.phase || 'step'} complete`);
  else if (e.type === 'complete') console.log(`\n\n${color('green', '✓ ' + e.text)}\n${color('dim', state.snapshot?.diff || '')}`);
  else if (e.type === 'error') console.error(`\n${color('red', '✗ ' + e.text)}`);
}

function renderTui(model) {
  const width = process.stdout.columns || 100; const height = process.stdout.rows || 30; const inner = Math.max(40, width - 2);
  const events = model.events.slice(-Math.max(5, height - 11));
  const title = ` ${color('bold', 'DuetAI')} ${color('dim', '·')} ${model.state?.phase || 'ready'} ${color('dim', '·')} ${model.state?.round ? `round ${model.state.round}` : 'two agents, one flow'}`;
  const line = color('dim', '─'.repeat(inner));
  const body = events.map(e => { const who = e.agent ? color(e.agent === 'codex' ? 'green' : 'magenta', e.agent.padEnd(7)) : color('cyan', 'system '.padEnd(7)); return `${who} ${compact((e.text || e.phase || e.type || '').replaceAll('\n', ' '), inner - 10)}`; });
  const task = model.state?.task ? compact(model.state.task, inner - 10) : 'Type a task below';
  process.stdout.write(ansi.clear + ansi.hide + title + '\n' + line + '\n' + ` ${color('dim', 'task:')} ${task}\n` + line + '\n' + body.join('\n') + '\n' + line + '\n' + ` ${color('dim', '›')} ${model.input}` + ansi.show);
}

async function interactive(config) {
  const model = { input: '', events: [], state: loadState() };
  const add = (e, s) => { model.events.push(e); model.state = s; renderTui(model); };
  readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume(); renderTui(model);
  let running = false;
  process.stdin.on('keypress', async (_, key) => {
    if (key?.ctrl && key.name === 'c') { process.stdout.write(ansi.show + '\n'); process.exit(130); }
    if (key?.name === 'return') {
      const task = model.input.trim(); model.input = ''; if (!task || running) return; running = true; renderTui(model);
      try { await workflow(task, config, add); } catch {} finally { running = false; renderTui(model); }
    } else if (key?.name === 'backspace') model.input = model.input.slice(0, -1);
    else if (key?.sequence && !key.ctrl && !key.meta) model.input += key.sequence;
    renderTui(model);
  });
}

async function main() {
  const config = loadConfig(); const [command, ...rest] = process.argv.slice(2);
  if (command === '--version' || command === '-v') return console.log(VERSION);
  if (command === 'doctor') return doctor();
  if (command === 'status') return status();
  if (command === 'init') return init();
  if (command === 'run') { const task = rest.join(' ').trim(); if (!task) return usage(); await workflow(task, config); return; }
  if (command === 'resume') { const s = loadState(); if (!s?.task) return console.log('No resumable session.'); await workflow(`Continue the previous task. Original task:\n${s.task}\nPrevious review:\n${s.outputs?.review || ''}`, config); return; }
  if (command && command !== 'tui') return usage();
  await interactive(config);
}

main().catch((e) => { console.error(color('red', `DuetAI: ${e.message}`)); process.exitCode = 1; });
