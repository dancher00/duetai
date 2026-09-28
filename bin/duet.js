#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseReviewVerdict } from '../src/verdict.js';
import { agentArgs, agentEnvironment } from '../src/agents.js';
import { eventUsage, sumUsage } from '../src/usage.js';

const VERSION = '0.2.0';
const activeChildren = new Set();
let cancellationRequested = false;
const cwd = process.cwd();
const stateDir = path.join(cwd, '.duet');
const stateFile = path.join(stateDir, 'session.json');
const resumeFile = path.join(stateDir, 'last-duet.json');
const eventFile = path.join(stateDir, 'events.jsonl');
const defaultConfig = {
  codex: { command: 'codex', sandbox: 'workspace-write' },
  claude: { command: 'claude', permissionMode: 'acceptEdits' },
  workflow: { lead: 'claude', maxRounds: 2, runTests: false, testCommand: 'npm test' },
  ui: { maxEvents: 160 }
};
const slashCommands = [
  ['/resume', 'continue the previous task'],
  ['/permissions', 'choose agent access level'],
  ['/model', 'choose Claude and Codex models'],
  ['/exit', 'quit DuetAI']
];
const modelSuggestions = {
  claude: [
    ['default', 'use Claude Code default'],
    ['sonnet', 'balanced Claude model'],
    ['opus', 'strongest Claude model'],
    ['haiku', 'fast Claude model']
  ],
  codex: [
    ['default', 'use Codex CLI settings']
  ]
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
function saveResumeState(state) { ensureState(); fs.writeFileSync(resumeFile, JSON.stringify(state, null, 2) + '\n'); }
function loadResumeState() { try { return JSON.parse(fs.readFileSync(resumeFile, 'utf8')); } catch { return null; } }
function appendEvent(event) { ensureState(); fs.appendFileSync(eventFile, JSON.stringify({ at: now(), ...event }) + '\n'); }
function git(args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); return (r.stdout || '').trim(); }
function gitSnapshot() { return { branch: git(['branch', '--show-current']), status: git(['status', '--short']), diff: git(['diff', '--stat']) }; }
function isGitRepository() { return spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' }).status === 0; }

function completeSlashCommand(line) {
  if (!line.startsWith('/')) return [[], line];
  const hits = slashCommands
    .filter(([command]) => command.startsWith(line))
    .map(([command]) => command);
  return [hits.length ? hits : slashCommands.map(([command]) => command), line];
}

function resolveSlashCommand(input) {
  const exact = slashCommands.find(([command]) => command === input)?.[0];
  if (exact) return exact;
  const matches = slashCommands.filter(([command]) => command.startsWith(input));
  return matches.length === 1 ? matches[0][0] : null;
}

function printSlashHints() {
  console.log(color('dim', '  Commands (Tab completes):'));
  for (const [command, description] of slashCommands) {
    console.log(`  ${color('cyan', command.padEnd(14))} ${color('dim', description)}`);
  }
}

function printModelHints(kind, current) {
  const title = kind === 'claude' ? 'Claude model' : 'Codex model';
  console.log(color('dim', `${title} · choose a number, alias, or type a custom model:`));
  modelSuggestions[kind].forEach(([value, description], index) => {
    const selected = (current || 'default').toLowerCase() === value;
    console.log(`  ${color('cyan', String(index + 1).padEnd(3))}${value.padEnd(14)} ${color('dim', description)}${selected ? color('green', '  ✓') : ''}`);
  });
}

function runAgent(kind, prompt, config, onEvent) {
  return new Promise((resolve, reject) => {
    const isCodex = kind === 'codex';
    const args = agentArgs(kind, prompt, config, isGitRepository());
    const child = spawn(isCodex ? config.codex.command : config.claude.command, args, {
      cwd, env: agentEnvironment(kind), stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    activeChildren.add(child);
    let output = ''; let stderr = ''; let buffer = ''; let usage = null; let agentError = ''; const messages = [];
    const emit = (event) => { onEvent?.({ agent: kind, ...event }); };
    const consumeLine = (line) => {
      if (!line.trim()) return;
      let obj;
      try { obj = JSON.parse(line); }
      catch { output += line + '\n'; emit({ type: 'stream', text: line }); return; }
      const text = extractText(obj);
      if (text.trim()) { messages.push(text.trim()); output += `${output ? '\n' : ''}${text.trim()}`; }
      const reportedUsage = eventUsage(kind, obj);
      if (reportedUsage) usage = kind === 'codex' && usage ? sumUsage([usage, reportedUsage]) : reportedUsage;
      if (obj.type === 'turn.failed' || (obj.type === 'result' && obj.is_error)) {
        agentError = obj.error?.message || obj.result || obj.errors?.join('\n') || 'Agent reported a failed run.';
      }
      emit({ type: 'stream', text, raw: obj });
    };
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) consumeLine(line);
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); const text = chunk.toString().trim(); if (text) emit({ type: 'log', text }); });
    child.on('error', error => {
      activeChildren.delete(child);
      reject(new Error(error.code === 'ENOENT' ? `${kind} CLI not found: ${config[kind].command}. Install it and sign in before running DuetAI.` : error.message));
    });
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
      consumeLine(buffer);
      const finalOutput = messages.at(-1) || output.trim();
      if (cancellationRequested) { cancellationRequested = false; reject(new Error('Cancelled.')); return; }
      if (agentError) reject(new Error(`${kind}: ${agentError}`));
      else if (code === 0) resolve({ output: finalOutput, stderr: stderr.trim(), usage });
      else reject(new Error(`${kind} exited with ${signal || `code ${code}`}${stderr ? `: ${stderr.trim().slice(-800)}` : ''}`));
    });
  });
}

function extractText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (obj.type === 'result' && typeof obj.result === 'string') return obj.result;
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
  const state = { id: id(), task, phase: 'starting', round: 0, maxRounds: config.workflow.maxRounds, startedAt: now(), updatedAt: now(), snapshot: gitSnapshot(), outputs: {}, usage: [] };
  saveState(state); appendEvent({ type: 'session.started', task });
  let resumable = false;
  const persist = () => { saveState(state); if (resumable) saveResumeState(state); };
  const event = (e) => { state.updatedAt = now(); appendEvent(e); render(e, state); persist(); };
  try {
    state.phase = 'lead'; event({ type: 'phase', phase: state.phase, agent: 'claude' });
    const plan = await runAgent('claude', `You are the lead agent and router in DuetAI. Decide whether to answer by yourself or bring in Codex.\n\nFor conversation, greetings, general questions, explanations, and advice: do not inspect files and do not call tools. Return exactly:\nMODE: CHAT\nRESPONSE: <a direct, natural answer>\n\nOnly when the request requires implementation, file changes, tests, debugging, or a second coding agent: inspect the workspace but do not edit it. Return MODE: DUET, then a concrete plan no longer than 12 lines using the headings PLAN, FILES, ACCEPTANCE, RISKS, TESTS. Prefer specific paths and commands; do not narrate tool calls. Codex will implement your plan and you will review its work.\n\nUSER MESSAGE:\n${task}`, config, event);
    state.usage.push({ agent: 'claude', phase: 'lead', ...plan.usage });
    if (!/^MODE:\s*DUET\b/im.test(plan.output)) {
      const response = plan.output.replace(/^MODE:\s*CHAT\s*/im, '').replace(/^RESPONSE:\s*/im, '').trim();
      state.phase = 'complete'; state.outputs.response = response; state.updatedAt = now(); saveState(state);
      appendEvent({ type: 'session.completed', mode: 'chat' }); render({ type: 'chat', text: response }, state); return state;
    }
    plan.output = plan.output.replace(/^MODE:\s*DUET\s*/im, '').trim();
    resumable = true;
    state.phase = 'planning';
    state.outputs.plan = plan.output; event({ type: 'phase.completed', phase: 'planning', text: compact(plan.output) });
    for (let round = 1; round <= config.workflow.maxRounds; round++) {
      state.round = round; state.phase = 'implementation'; event({ type: 'phase', phase: state.phase, agent: 'codex', round });
      const implementation = await runAgent('codex', `You are the implementation engineer. Work directly in the current repository. Implement the user's task using the lead plan below. Make the smallest complete change and run relevant tests. Your final response must be useful in a terminal and no longer than 10 lines. Use exactly these headings: DECISION, CHANGED, VALIDATION. Do not narrate tool calls.\n\nUSER TASK:\n${task}\n\nLEAD PLAN:\n${state.outputs.plan}\n\n${round > 1 ? `PREVIOUS REVIEW:\n${state.outputs.review}` : ''}`, config, event);
      state.usage.push({ agent: 'codex', phase: 'implementation', round, ...implementation.usage });
      state.outputs.implementation = implementation.output; state.snapshot = gitSnapshot(); event({ type: 'phase.completed', phase: 'implementation', text: compact(implementation.output), snapshot: state.snapshot });
      state.phase = 'review'; event({ type: 'phase', phase: state.phase, agent: 'claude', round });
      const review = await runAgent('claude', `You are a meticulous senior reviewer. Do not edit files. Inspect the current git diff and verify the task. Your final response must be useful in a terminal and no longer than 10 lines. Use exactly these headings: VERDICT (PASS or NEEDS_FIX), FINDINGS, WHY, TESTS. Do not narrate tool calls.\n\nTASK:\n${task}\n\nLEAD PLAN:\n${state.outputs.plan}`, { ...config, claude: { ...config.claude, permissionMode: 'plan' } }, event);
      state.usage.push({ agent: 'claude', phase: 'review', round, ...review.usage });
      state.outputs.review = review.output; state.snapshot = gitSnapshot(); event({ type: 'phase.completed', phase: 'review', text: compact(review.output), snapshot: state.snapshot });
      const verdict = parseReviewVerdict(review.output);
      if (verdict === 'PASS') break;
      if (verdict === 'UNKNOWN') throw new Error('Review did not return an unambiguous PASS or NEEDS_FIX verdict.');
    }
    if (parseReviewVerdict(state.outputs.review) !== 'PASS') {
      throw new Error(`Review did not pass after ${state.round} round(s). Use /resume to continue.`);
    }
    if (config.workflow.runTests) {
      state.phase = 'tests'; event({ type: 'phase', phase: state.phase });
      const result = spawnSync(config.workflow.testCommand, { cwd, shell: true, encoding: 'utf8' });
      state.outputs.tests = (result.stdout || '') + (result.stderr || '');
      state.testResult = { code: result.status, signal: result.signal, error: result.error?.message || null };
      event({ type: 'phase.completed', phase: state.phase, code: result.status, text: compact(state.outputs.tests) });
      if (result.error || result.signal || result.status !== 0) {
        throw new Error(`Final tests failed (${result.error?.message || result.signal || `exit ${result.status}`}). Use /resume to continue.`);
      }
    }
    state.phase = 'complete'; state.snapshot = gitSnapshot(); state.updatedAt = now(); persist(); appendEvent({ type: 'session.completed', snapshot: state.snapshot }); render({ type: 'complete', text: 'Workflow complete.' }, state); return state;
  } catch (error) { state.phase = 'failed'; state.error = error.message; state.updatedAt = now(); persist(); appendEvent({ type: 'session.failed', error: error.message }); render({ type: 'error', text: error.message }, state); throw error; }
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
  return parseReviewVerdict(text);
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
        const verdict = reviewVerdict(state.outputs?.review);
        console.log(`${color(verdict === 'PASS' ? 'green' : 'yellow', verdict === 'PASS' ? '✓' : '!')} Review complete ${color(verdict === 'PASS' ? 'green' : 'yellow', `· ${verdict}`)}`);
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
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY), completer: completeSlashCommand });
  const prompt = () => { if (!rl.closed) rl.prompt(); };
  let pending = null;
  console.log(`${color('cyan', 'DuetAI')} ${color('dim', `v${VERSION} · ${cwd}`)}`);
  console.log(color('dim', 'Claude leads · Codex implements'));
  console.log(color('dim', 'Type / for commands · Tab completes · Esc exits\n'));
  rl.setPrompt(`${color('cyan', '›')} `);
  prompt();
  rl.on('SIGINT', () => shutdown(130));
  let slashHintsShown = false;
  const onKeypress = (text, key) => {
    if (key?.name === 'escape') {
      if (activeChildren.size) {
        cancellationRequested = true;
        for (const child of activeChildren) { try { child.kill('SIGTERM'); } catch {} }
      } else shutdown(0);
      return;
    }
    if (!pending && text === '/' && !slashHintsShown) {
      setImmediate(() => {
        if (rl.line !== '/') return;
        slashHintsShown = true;
        process.stdout.write('\n');
        printSlashHints();
        rl._refreshLine?.();
      });
    } else if (key?.name === 'backspace' || (text && text !== '/')) {
      slashHintsShown = false;
    }
  };
  process.stdin.on('keypress', onKeypress);
  for await (const input of rl) {
    let task = input.trim();
    const showedSlashHints = slashHintsShown;
    slashHintsShown = false;
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
      pending = null; rl.setPrompt(`${color('cyan', '›')} `); prompt(); continue;
    }
    if (pending?.type === 'claude-model') {
      const choice = modelSuggestions.claude[Number(task) - 1]?.[0] || task;
      if (choice) config.claude.model = choice.toLowerCase() === 'default' ? undefined : choice;
      pending = { type: 'codex-model' };
      printModelHints('codex', config.codex.model || 'default');
      rl.setPrompt(`${color('green', 'Codex model')} ${color('dim', `[${config.codex.model || 'CLI default'}]`)} › `); prompt(); continue;
    }
    if (pending?.type === 'codex-model') {
      const choice = modelSuggestions.codex[Number(task) - 1]?.[0] || task;
      if (choice) config.codex.model = choice.toLowerCase() === 'default' ? undefined : choice;
      console.log(`${color('magenta', 'Claude')}: ${config.claude.model || 'default'} · ${color('green', 'Codex')}: ${config.codex.model || 'CLI default'}`);
      pending = null; rl.setPrompt(`${color('cyan', '›')} `); prompt(); continue;
    }
    if (!task) { prompt(); continue; }
    if (task.startsWith('/') && task !== '/') {
      const command = resolveSlashCommand(task);
      if (!command) {
        console.log(color('yellow', `Unknown command: ${task}`));
        printSlashHints();
        prompt();
        continue;
      }
      task = command;
    }
    if (task === '/exit') break;
    if (task === '/permissions') {
      console.log(`  1  safe       ${color('dim', 'read-only')}\n  2  workspace  ${color('dim', 'edit current project')}\n  3  full       ${color('dim', 'unrestricted')}`);
      pending = { type: 'permissions' }; rl.setPrompt(`${color('yellow', 'Permissions')} › `); prompt(); continue;
    }
    if (task === '/model') {
      pending = { type: 'claude-model' };
      printModelHints('claude', config.claude.model || 'default');
      rl.setPrompt(`${color('magenta', 'Claude model')} ${color('dim', `[${config.claude.model || 'default'}]`)} › `); prompt(); continue;
    }
    if (task === '/' && !showedSlashHints) {
      printSlashHints();
      prompt();
      continue;
    }
    if (task === '/resume') {
      const previous = loadResumeState();
      if (!previous?.task) { console.log(color('yellow', 'Nothing to resume.')); prompt(); continue; }
      const continuation = `Continue the previous task.\n\nORIGINAL TASK:\n${previous.task}\n\nPREVIOUS RESULT OR REVIEW:\n${previous.outputs?.review || previous.outputs?.response || 'No result recorded.'}\n\nPREVIOUS ERROR:\n${previous.error || 'None'}\n\nFINAL TEST OUTPUT:\n${previous.outputs?.tests || 'Not run'}`;
      try { await workflow(continuation, config, createConsoleRenderer()); }
      catch { if (!process.stdin.isTTY) process.exitCode = 1; }
      console.log(); prompt(); continue;
    }
    try { await workflow(task, config, createConsoleRenderer()); }
    catch { if (!process.stdin.isTTY) process.exitCode = 1; }
    console.log();
    prompt();
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
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(`DuetAI ${VERSION} — Claude plans and reviews; Codex implements and fixes.

Usage:
  duet           Open the workspace in the current directory
  duet --demo    Offline example: scripted agents, real tests, no account
  duet --doctor  Check installed tools without model requests
  duet --version Print the version

Inside the workspace: /resume, /permissions, /model, /exit
Docs: https://github.com/dancher00/duetai`);
    return;
  }
  if (args.length === 1 && args[0] === '--version') { console.log(VERSION); return; }
  if (args.length === 1 && args[0] === '--demo') {
    // Demo owns signal cleanup for its subprocess tree.
    process.removeAllListeners('SIGTERM');
    const { runDemo } = await import('../src/demo.js');
    process.exitCode = await runDemo(fileURLToPath(import.meta.url));
    return;
  }
  if (args.length === 1 && args[0] === '--doctor') {
    const { doctor } = await import('../src/doctor.js');
    process.exitCode = doctor(loadConfig());
    return;
  }
  if (args.length) throw new Error('Unknown arguments. Run duet --help for usage.');
  await interactive(loadConfig());
}

main().catch((e) => { console.error(color('red', `DuetAI: ${e.message}`)); process.exitCode = 1; });
