#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { reviewNeedsFix } from '../src/verdict.js';

const VERSION = '0.1.0';
const activeChildren = new Set();
let cancellationRequested = false;
const cwd = process.cwd();
const stateDir = path.join(cwd, '.duet');
const stateFile = path.join(stateDir, 'session.json');
const eventFile = path.join(stateDir, 'events.jsonl');
const sessionSecrets = {
  codex: process.env.LLMPROXY_API_KEY || '',
  claude: process.env.ANTHROPIC_API_KEY || ''
};
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
function isGitRepository() { return spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' }).status === 0; }

async function promptSecret(label) {
  process.stdout.write(label);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
    };
    const onKey = (text, key) => {
      if ((key?.ctrl && key.name === 'c') || key?.name === 'escape') { finish(); reject(new Error('Credential entry cancelled.')); return; }
      if (key?.name === 'return' || key?.name === 'enter') { finish(); resolve(value.trim()); return; }
      if (key?.name === 'backspace') { value = value.slice(0, -1); return; }
      if (text && !key?.ctrl && !key?.meta) value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}

async function ensureInteractiveCredentials() {
  if (!process.stdin.isTTY) return;
  if (!sessionSecrets.codex) sessionSecrets.codex = await promptSecret('Codex API key: ');
  if (!sessionSecrets.claude) sessionSecrets.claude = await promptSecret('Claude API key: ');
  if (!sessionSecrets.codex || !sessionSecrets.claude) throw new Error('Both Codex and Claude API keys are required.');
}

function runAgent(kind, prompt, config, onEvent) {
  return new Promise((resolve, reject) => {
    const isCodex = kind === 'codex';
    const args = isCodex
      ? ['exec', '--profile', config.codex.profile, '--sandbox', config.codex.sandbox, ...(config.codex.model ? ['--model', config.codex.model] : []), '--json', ...(isGitRepository() ? [] : ['--skip-git-repo-check']), prompt]
      : ['-p', prompt, '--verbose', '--output-format', 'stream-json', '--permission-mode', config.claude.permissionMode, ...(config.claude.model ? ['--model', config.claude.model] : [])];
    const { LLMPROXY_API_KEY: _codexKey, ANTHROPIC_API_KEY: _claudeKey, ...baseEnv } = process.env;
    const agentEnv = isCodex
      ? { ...baseEnv, ...(sessionSecrets.codex ? { LLMPROXY_API_KEY: sessionSecrets.codex } : {}) }
      : { ...baseEnv, ...(sessionSecrets.claude ? { ANTHROPIC_API_KEY: sessionSecrets.claude } : {}) };
    const child = spawn(isCodex ? config.codex.command : config.claude.command, args, { cwd, env: agentEnv, stdio: [process.stdin.isTTY ? 'inherit' : 'ignore', 'pipe', 'pipe'] });
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
      if (cancellationRequested) { cancellationRequested = false; reject(new Error('Cancelled.')); return; }
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
    state.phase = 'lead'; event({ type: 'phase', phase: state.phase, agent: 'claude' });
    const plan = await runAgent('claude', `You are the lead agent and router in DuetAI. Decide whether to answer by yourself or bring in Codex.\n\nFor conversation, greetings, general questions, explanations, and advice: do not inspect files and do not call tools. Return exactly:\nMODE: CHAT\nRESPONSE: <a direct, natural answer>\n\nOnly when the request requires implementation, file changes, tests, debugging, or a second coding agent: inspect the workspace but do not edit it. Return MODE: DUET, then a concrete plan no longer than 12 lines using the headings PLAN, FILES, ACCEPTANCE, RISKS, TESTS. Prefer specific paths and commands; do not narrate tool calls. Codex will implement your plan and you will review its work.\n\nUSER MESSAGE:\n${task}`, config, event);
    if (!/^MODE:\s*DUET\b/im.test(plan.output)) {
      const response = plan.output.replace(/^MODE:\s*CHAT\s*/im, '').replace(/^RESPONSE:\s*/im, '').trim();
      state.phase = 'complete'; state.outputs.response = response; state.updatedAt = now(); saveState(state);
      appendEvent({ type: 'session.completed', mode: 'chat' }); render({ type: 'chat', text: response }, state); return state;
    }
    plan.output = plan.output.replace(/^MODE:\s*DUET\s*/im, '').trim();
    state.phase = 'planning';
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
  const labels = { lead: 'Claude is thinking', planning: 'Claude is preparing the plan', implementation: 'Codex is implementing', review: 'Claude is reviewing', tests: 'Running final tests' };
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
    } else if (e.type === 'chat') { stopSpinner(); console.log(e.text);
    } else if (e.type === 'error') { stopSpinner(); console.error(`\n${color('red', '✗ ' + e.text)}`); }
  };
}

async function interactive(config) {
  await ensureInteractiveCredentials();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  let pending = null;
  console.log(`${color('cyan', 'DuetAI')} ${color('dim', `v${VERSION} · ${cwd}`)}`);
  console.log(color('dim', 'Claude leads · Codex implements · /resume · /permissions · /model · /exit\n'));
  rl.setPrompt(`${color('cyan', '›')} `);
  rl.prompt();
  rl.on('SIGINT', () => shutdown(130));
  const onKeypress = (_text, key) => {
    if (key?.name !== 'escape') return;
    if (activeChildren.size) {
      cancellationRequested = true;
      for (const child of activeChildren) { try { child.kill('SIGTERM'); } catch {} }
    } else shutdown(0);
  };
  process.stdin.on('keypress', onKeypress);
  for await (const input of rl) {
    const task = input.trim();
    if (pending?.type === 'permissions') {
      const modes = {
        '1': ['safe', 'plan', 'read-only'], safe: ['safe', 'plan', 'read-only'],
        '2': ['workspace', 'acceptEdits', 'workspace-write'], workspace: ['workspace', 'acceptEdits', 'workspace-write'],
        '3': ['full', 'bypassPermissions', 'danger-full-access'], full: ['full', 'bypassPermissions', 'danger-full-access']
      };
      const selected = modes[task.toLowerCase()];
      if (selected) {
        config.claude.permissionMode = selected[1]; config.codex.sandbox = selected[2];
        console.log(color('green', `Permissions: ${selected[0]}`));
      } else console.log(color('yellow', 'Permissions unchanged.'));
      pending = null; rl.setPrompt(`${color('cyan', '›')} `); rl.prompt(); continue;
    }
    if (pending?.type === 'claude-model') {
      if (task) config.claude.model = task.toLowerCase() === 'default' ? undefined : task;
      pending = { type: 'codex-model' };
      rl.setPrompt(`${color('green', 'Codex model')} ${color('dim', `[${config.codex.model || 'profile default'}]`)} › `); rl.prompt(); continue;
    }
    if (pending?.type === 'codex-model') {
      if (task) config.codex.model = task.toLowerCase() === 'default' ? undefined : task;
      console.log(`${color('magenta', 'Claude')}: ${config.claude.model || 'default'} · ${color('green', 'Codex')}: ${config.codex.model || 'profile default'}`);
      pending = null; rl.setPrompt(`${color('cyan', '›')} `); rl.prompt(); continue;
    }
    if (!task) { rl.prompt(); continue; }
    if (['/exit', '/quit'].includes(task)) break;
    if (task === '/permissions') {
      console.log(`  1  safe       ${color('dim', 'read-only')}\n  2  workspace  ${color('dim', 'edit current project')}\n  3  full       ${color('dim', 'unrestricted')}`);
      pending = { type: 'permissions' }; rl.setPrompt(`${color('yellow', 'Permissions')} › `); rl.prompt(); continue;
    }
    if (task === '/model') {
      pending = { type: 'claude-model' };
      rl.setPrompt(`${color('magenta', 'Claude model')} ${color('dim', `[${config.claude.model || 'default'}]`)} › `); rl.prompt(); continue;
    }
    if (task === '/resume') {
      const previous = loadState();
      if (!previous?.task) { console.log(color('yellow', 'Nothing to resume.')); rl.prompt(); continue; }
      const continuation = `Continue the previous task.\n\nORIGINAL TASK:\n${previous.task}\n\nPREVIOUS RESULT OR REVIEW:\n${previous.outputs?.review || previous.outputs?.response || previous.error || 'No result recorded.'}`;
      try { await workflow(continuation, config, createConsoleRenderer()); } catch {}
      console.log(); rl.prompt(); continue;
    }
    try { await workflow(task, config, createConsoleRenderer()); }
    catch {}
    console.log();
    rl.prompt();
  }
  process.stdin.off('keypress', onKeypress);
  rl.close();
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
  if (process.argv.length > 2) throw new Error('Run DuetAI without arguments: duet');
  await interactive(loadConfig());
}

main().catch((e) => { console.error(color('red', `DuetAI: ${e.message}`)); process.exitCode = 1; });
