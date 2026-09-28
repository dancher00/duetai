const stages = [
  { agent: 'CLAUDE', className: 'claude-text', title: 'A plan before the patch.', description: 'Check both boundaries. Keep values inside the range. Verify the result with independent assertions.', label: 'starting point', code: 'const clamp = (value, min, max) => value;', output: 'Acceptance: clamp(-2, 0, 10) → 0\nAcceptance: clamp(12, 0, 10) → 10' },
  { agent: 'CODEX', className: 'codex-text', title: 'A patch to review.', description: 'This scripted first attempt fixes the lower bound. The upper bound is still missing — the reviewer will check it.', label: 'first attempt', code: 'const clamp = (value, min, max) =>\n  Math.max(min, value);', output: 'Changed: clamp.js\nNext: independent review' },
  { agent: 'CLAUDE', className: 'claude-text', title: 'Caught at the boundary.', description: 'The implementation misses values above max. The failing assertion goes back to Codex as a specific correction.', label: 'review finding', code: 'clamp(12, 0, 10)\n// expected: 10\n// received: 12', output: 'VERDICT: NEEDS_FIX\n1 failing assertion · upper bound not applied', status: 'fail' },
  { agent: 'CODEX', className: 'codex-text', title: 'A focused second pass.', description: 'Use the review finding to fix both boundaries. No need to copy the error into another terminal.', label: 'correction', code: 'const clamp = (value, min, max) =>\n  Math.min(max, Math.max(min, value));', output: 'Changed: clamp.js\nNext: review + final tests' },
  { agent: 'CLAUDE + TESTS', className: 'test-text', title: 'Verified. Then complete.', description: 'The review passes and the configured test command succeeds. DuetAI can now mark the workflow complete.', label: 'verified result', code: 'clamp(-2, 0, 10)  // 0\nclamp(12, 0, 10)  // 10\nclamp(4, 0, 10)   // 4', output: '', status: 'pass' }
];
let current = 0;
let timer;
const play = document.querySelector('#play');
const buttons = [...document.querySelectorAll('[data-step]')];
function stop() { clearInterval(timer); timer = null; play.innerHTML = '<span aria-hidden="true">▶</span> Play workflow'; }
function show(index) {
  current = index;
  const stage = stages[index];
  const agent = document.querySelector('#agent-name');
  agent.textContent = stage.agent; agent.className = stage.className;
  document.querySelector('#stage-count').textContent = `0${index + 1} / 05`;
  document.querySelector('#stage-title').textContent = stage.title;
  document.querySelector('#stage-description').textContent = stage.description;
  document.querySelector('#stage-code').textContent = stage.code;
  document.querySelector('#code-label').textContent = stage.label;
  const output = document.querySelector('#test-output');
  output.className = `test-output ${stage.status || ''}`;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const passed = [[-2,0],[12,10],[4,4]].every(([value,expected]) => clamp(value,0,10) === expected);
  output.textContent = index === 4 ? `VERDICT: ${passed ? 'PASS' : 'NEEDS_FIX'}\n${passed ? '3 browser assertions passed · run duet --demo for Node tests' : 'Assertion failed'}` : stage.output;
  output.style.whiteSpace = 'pre-line';
  buttons.forEach((button, i) => { button.classList.toggle('active', i === index); button.setAttribute('aria-pressed', String(i === index)); });
}
buttons.forEach(button => button.addEventListener('click', () => { stop(); show(Number(button.dataset.step)); }));
document.querySelector('#next').addEventListener('click', () => { stop(); show((current + 1) % stages.length); });
play.addEventListener('click', () => {
  if (timer) { stop(); return; }
  show(0); play.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause';
  timer = setInterval(() => { if (current === stages.length - 1) { stop(); return; } show(current + 1); }, 2500);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'Copied!'; }
  catch { button.textContent = 'Select text'; }
  setTimeout(() => { button.textContent = 'Copy'; }, 1800);
}));
