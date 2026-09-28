const count = value => Number.isFinite(value) && value >= 0 ? value : 0;

// Only terminal usage events: assistant message usage would double-count Claude.
export function eventUsage(kind, event) {
  if (kind === 'codex' && event.type === 'turn.completed' && event.usage) {
    return {
      inputTokens: count(event.usage.input_tokens),
      cachedInputTokens: count(event.usage.cached_input_tokens),
      cacheWriteTokens: 0,
      outputTokens: count(event.usage.output_tokens),
      reportedCostUsd: null
    };
  }
  if (kind === 'claude' && event.type === 'result' && event.usage) {
    const cached = count(event.usage.cache_read_input_tokens);
    const written = count(event.usage.cache_creation_input_tokens);
    return {
      inputTokens: count(event.usage.input_tokens) + cached + written,
      cachedInputTokens: cached,
      cacheWriteTokens: written,
      outputTokens: count(event.usage.output_tokens),
      reportedCostUsd: Number.isFinite(event.total_cost_usd) ? event.total_cost_usd : null
    };
  }
  return null;
}

export function sumUsage(entries) {
  const reported = entries.filter(entry => entry && Number.isFinite(entry.inputTokens));
  if (!reported.length || reported.length !== entries.length) return null;
  return {
    inputTokens: reported.reduce((sum, entry) => sum + entry.inputTokens, 0),
    cachedInputTokens: reported.reduce((sum, entry) => sum + count(entry.cachedInputTokens), 0),
    cacheWriteTokens: reported.reduce((sum, entry) => sum + count(entry.cacheWriteTokens), 0),
    outputTokens: reported.reduce((sum, entry) => sum + count(entry.outputTokens), 0),
    reportedCostUsd: reported.every(entry => Number.isFinite(entry.reportedCostUsd))
      ? reported.reduce((sum, entry) => sum + entry.reportedCostUsd, 0) : null
  };
}
