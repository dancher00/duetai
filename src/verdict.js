export function reviewNeedsFix(text) {
  return /\bVERDICT\s*:?\s*NEEDS(?:_|\s+)FIX\b/i.test(text || '');
}
