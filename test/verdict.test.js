import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewNeedsFix } from '../src/verdict.js';

test('requests another round for an explicit NEEDS_FIX verdict', () => {
  assert.equal(reviewNeedsFix('VERDICT: NEEDS_FIX\nTests are failing.'), true);
  assert.equal(reviewNeedsFix('Verdict: needs fix'), true);
});

test('does not mistake successful test output for a failed review', () => {
  assert.equal(reviewNeedsFix('VERDICT: PASS\n# pass 1\n# fail 0'), false);
  assert.equal(reviewNeedsFix('VERDICT: PASS\nNo critical findings.'), false);
});
