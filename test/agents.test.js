import test from 'node:test';
import assert from 'node:assert/strict';
import { agentArgs, agentEnvironment } from '../src/agents.js';
import { eventUsage, sumUsage } from '../src/usage.js';

const config = { codex: { sandbox: 'workspace-write' }, claude: { permissionMode: 'plan' } };

test('uses existing CLI configuration unless a profile or model is requested', () => {
  const args = agentArgs('codex', 'task', config);
  assert.deepEqual(args, ['exec', '--sandbox', 'workspace-write', '--json', 'task']);
  assert.deepEqual(agentArgs('codex', 'task', { ...config, codex: { ...config.codex, profile: 'my-profile', model: 'my-model' } }, false),
    ['exec', '--profile', 'my-profile', '--sandbox', 'workspace-write', '--model', 'my-model', '--json', '--skip-git-repo-check', 'task']);
});

test('preserves login configuration and passes known credential variables only to their agent', () => {
  const env = { HOME: '/test', CODEX_HOME: '/codex', CLAUDE_CONFIG_DIR: '/claude', OPENAI_API_KEY: 'openai', LLMPROXY_API_KEY: 'proxy', CODEX_API_KEY: 'codex', ANTHROPIC_API_KEY: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'token', CLAUDE_CODE_OAUTH_TOKEN: 'oauth' };
  assert.deepEqual(agentEnvironment('codex', env), { HOME: '/test', CODEX_HOME: '/codex', CLAUDE_CONFIG_DIR: '/claude', OPENAI_API_KEY: 'openai', LLMPROXY_API_KEY: 'proxy', CODEX_API_KEY: 'codex' });
  assert.deepEqual(agentEnvironment('claude', env), { HOME: '/test', CODEX_HOME: '/codex', CLAUDE_CONFIG_DIR: '/claude', ANTHROPIC_API_KEY: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'token', CLAUDE_CODE_OAUTH_TOKEN: 'oauth' });
  assert.equal(env.OPENAI_API_KEY, 'openai');
  assert.deepEqual(agentEnvironment('codex', { HOME: '/test' }), { HOME: '/test' });
});

test('counts Claude terminal usage once and includes cache tokens', () => {
  assert.equal(eventUsage('claude', { type: 'assistant', usage: { input_tokens: 100 } }), null);
  const usage = eventUsage('claude', { type: 'result', usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 5 }, total_cost_usd: 0.02 });
  assert.deepEqual(usage, { inputTokens: 60, cachedInputTokens: 20, cacheWriteTokens: 30, outputTokens: 5, reportedCostUsd: 0.02 });
});

test('does not invent a dollar cost when Codex reports only tokens', () => {
  const codex = eventUsage('codex', { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } });
  assert.equal(codex.inputTokens, 100);
  assert.equal(codex.reportedCostUsd, null);
  assert.equal(sumUsage([null]), null);
  assert.equal(sumUsage([codex, null]), null);
  assert.equal(sumUsage([codex, { inputTokens: 10, outputTokens: 2, reportedCostUsd: 0.01 }]).reportedCostUsd, null);
  assert.equal(sumUsage([codex, codex]).inputTokens, 200);
});
