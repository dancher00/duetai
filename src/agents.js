// Let the installed CLIs resolve login sessions, helpers, and provider settings.
export function agentEnvironment(kind, source = process.env) {
  const env = { ...source };
  if (kind === 'codex') {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
  } else {
    delete env.LLMPROXY_API_KEY;
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
  }
  return env;
}

export function agentArgs(kind, prompt, config, inGitRepository = true) {
  if (kind === 'codex') {
    const { profile, sandbox, model } = config.codex;
    return ['exec', ...(profile ? ['--profile', profile] : []), '--sandbox', sandbox,
      ...(model ? ['--model', model] : []), '--json',
      ...(inGitRepository ? [] : ['--skip-git-repo-check']), prompt];
  }
  const { permissionMode, model } = config.claude;
  return ['-p', prompt, '--verbose', '--output-format', 'stream-json',
    '--permission-mode', permissionMode, ...(model ? ['--model', model] : [])];
}
