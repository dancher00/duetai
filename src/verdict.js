export function parseReviewVerdict(text) {
  const normalized = String(text || '').replace(/[*`]/g, '');
  const matches = [...normalized.matchAll(/^\s*(?:#{1,6}\s+)?VERDICT\s*:?\s*(PASS|NEEDS(?:_|\s+)FIX)\b/gim)];
  const verdicts = new Set(matches.map(match => match[1].toUpperCase().replace(/\s+/g, '_')));
  return verdicts.size === 1 ? [...verdicts][0] : 'UNKNOWN';
}

export function reviewNeedsFix(text) {
  return parseReviewVerdict(text) === 'NEEDS_FIX';
}
