import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewVerdict, reviewNeedsFix } from '../src/verdict.js';

test('requests another round for an explicit NEEDS_FIX verdict', () => {
  assert.equal(reviewNeedsFix('VERDICT: NEEDS_FIX\nTests are failing.'), true);
  assert.equal(reviewNeedsFix('Verdict: needs fix'), true);
});

test('does not mistake successful test output for a failed review', () => {
  assert.equal(reviewNeedsFix('VERDICT: PASS\n# pass 1\n# fail 0'), false);
  assert.equal(reviewNeedsFix('VERDICT: PASS\nNo critical findings.'), false);
});

test('requires an explicit, unambiguous verdict', () => {
  for (const text of ['', 'Everything looks fine.', 'VERDICT: UNKNOWN', 'Expected VERDICT: PASS', 'VERDICT: PASS\nVERDICT: NEEDS_FIX']) {
    assert.equal(parseReviewVerdict(text), 'UNKNOWN', text);
  }
  assert.equal(parseReviewVerdict('VERDICT\nPASS\nFINDINGS: None.'), 'PASS');
  assert.equal(parseReviewVerdict('**VERDICT:** PASS'), 'PASS');
  assert.equal(parseReviewVerdict('## VERDICT: NEEDS_FIX'), 'NEEDS_FIX');
});
