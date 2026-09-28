// Acceptance tests stay outside the agent workspace until after the run.
export const tasks = [
  {
    id: 'money',
    task: 'Implement parseCents(value) in index.js. Accept strings containing a nonnegative decimal amount with at most two fractional digits, optional surrounding whitespace, and optional leading zeros. Return integer cents. Reject signs, exponents, empty values, non-string inputs, missing integer digits, trailing decimal points, and amounts exceeding Number.MAX_SAFE_INTEGER cents with TypeError or RangeError. Avoid floating-point rounding. Keep the public export. Add tests and run npm test.',
    source: 'export function parseCents(value) { return Math.round(Number(value) * 100); }\n',
    visible: "assert.equal(parseCents('12.34'), 1234);",
    exportName: 'parseCents',
    acceptance: `
test('exact amounts and whitespace', () => {
  for (const [value, expected] of [['0',0],['0.01',1],['1.2',120],[' 0002.50 ',250],['1.005',null],['90071992547409.91',Number.MAX_SAFE_INTEGER]]) {
    if (expected === null) assert.throws(() => parseCents(value));
    else assert.equal(parseCents(value), expected);
  }
});
test('invalid and unsafe amounts', () => {
  for (const value of ['', ' ', '-1', '+1', '1e2', 'Infinity', '.5', '1.', '1.234', '90071992547409.92', 1, null, {}, '0x10']) assert.throws(() => parseCents(value), value + ' should fail');
});`
  },
  {
    id: 'ttl-cache',
    task: 'Implement createCache(now = Date.now) in index.js, returning set(key, value, ttlMs), get(key), and has(key). TTL is a finite nonnegative number; invalid TTL throws RangeError. Entries expire when now() >= insertionTime + ttlMs; zero TTL expires immediately. Updating resets TTL. Support arbitrary Map keys and undefined values; has must distinguish a stored undefined from a missing key. Use the injected clock, no timers. Keep the public export. Add tests and run npm test.',
    source: 'export function createCache(now = Date.now) { const items = new Map(); return { set(k,v,ttl) { items.set(k,v); }, get(k) { return items.get(k); }, has(k) { return items.has(k); } }; }\n',
    visible: "const c = createCache(() => 0); c.set('x', 1, 10); assert.equal(c.get('x'), 1);",
    exportName: 'createCache',
    acceptance: `
test('expires at the exact boundary', () => {
  let time = 100; const c = createCache(() => time);
  c.set('x',1,10); time = 109; assert.equal(c.get('x'),1); time = 110; assert.equal(c.get('x'),undefined); assert.equal(c.has('x'),false);
});
test('undefined values, object keys, reset, zero TTL', () => {
  let time = 0; const c = createCache(() => time); const key = {};
  c.set(key,undefined,10); assert.equal(c.has(key),true); time = 5; c.set(key,2,20); time = 11; assert.equal(c.get(key),2); time = 25; assert.equal(c.has(key),false);
  c.set('zero',1,0); assert.equal(c.has('zero'),false);
});
test('rejects invalid TTL', () => {
  const c = createCache(() => 0);
  for (const ttl of [-1, NaN, Infinity, '1', undefined]) assert.throws(() => c.set('x',1,ttl), RangeError);
});`
  },
  {
    id: 'retry',
    task: 'Implement async retry(fn, { attempts = 3, shouldRetry = () => true } = {}) in index.js. Attempts is a positive integer, otherwise reject with RangeError before calling fn. Call fn with the 1-based attempt number. Return the first success, handling both synchronous throws and rejected promises. After each failure except the last, await shouldRetry(error, attempt); if false, rethrow the original error immediately. Exhaustion must throw the exact last error object; a failing shouldRetry must propagate its own error. No delays. Keep the public export. Add tests and run npm test.',
    source: 'export async function retry(fn, options = {}) { return fn(1); }\n',
    visible: "assert.equal(await retry(() => 42), 42);",
    exportName: 'retry',
    acceptance: `
test('retries sync and async failures with numbered attempts', async () => {
  const seen = []; const result = await retry(n => { seen.push(n); if (n === 1) throw new Error('sync'); if (n === 2) return Promise.reject(new Error('async')); return 42; });
  assert.equal(result,42); assert.deepEqual(seen,[1,2,3]);
});
test('exhaustion preserves identity and skips the last predicate', async () => {
  const errors = [new Error('a'),new Error('b')]; const predicates = [];
  await assert.rejects(retry(n => { throw errors[n-1]; }, { attempts:2, shouldRetry: (e,n) => { predicates.push(n); return true; } }), e => e === errors[1]);
  assert.deepEqual(predicates,[1]);
});
test('async predicate can stop and can fail', async () => {
  const original = new Error('original'); let count = 0;
  await assert.rejects(retry(() => { count++; throw original; }, { shouldRetry: async () => false }), e => e === original); assert.equal(count,1);
  const predicate = new Error('predicate');
  await assert.rejects(retry(() => { throw original; }, { shouldRetry: async () => { throw predicate; } }), e => e === predicate);
});
test('validates attempts before invoking fn', async () => {
  for (const attempts of [0,-1,1.5,NaN,Infinity,'2']) await assert.rejects(retry(() => assert.fail('must not run'), {attempts}), RangeError);
});`
  }
];
