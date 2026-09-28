import { spawnSync } from 'node:child_process';

export function doctor(config) {
  console.log('DuetAI setup check · no model requests\n');
  let passed = true;
  for (const [name, command] of [['Git', 'git'], ['Claude Code', config.claude.command], ['Codex', config.codex.command]]) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const ok = result.status === 0;
    passed &&= ok;
    console.log(`${ok ? '✓' : '✗'} ${name}: ${ok ? (result.stdout || result.stderr).trim().split('\n')[0] : `not available (${command})`}`);
  }
  console.log(`\nCodex profile: ${config.codex.profile || 'CLI default'}`);
  console.log('Authentication and sandbox permissions are not tested here.');
  console.log('Before a real task, make sure claude and codex each work on their own.');
  console.log('Try duet --demo for a local workflow example without accounts.');
  return passed ? 0 : 1;
}
