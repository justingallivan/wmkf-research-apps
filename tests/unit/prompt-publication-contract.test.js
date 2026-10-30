/** @jest-environment node */
const { execFileSync } = require('node:child_process');
const { LIMITS, parseJson, inspectJson, canonicalPreimage } = require('../../lib/prompt-publication/json-contract');
const { validateDefinition } = require('../../lib/prompt-publication/definition-schema');
const { validateRequest, validateSnapshot, validateReceipt, incrementRevision } = require('../../lib/prompt-publication/publication-contract');
const { hashSnapshot, publicationFingerprint, verifyReceiptBinding, validateFreshPublication } = require('../../lib/prompt-publication/fingerprint');
const { POLICY_ARTIFACT } = require('../../lib/prompt-publication/template-policy');
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = { organizationId: id(1), initiatingUserId: id(2), effectiveUserId: id(3) };
const emptyCatalog = { title: null, description: null, groupKey: null, sectionKey: null, usedBy: null, usageCategory: null };
const definition = () => ({ name: 'pa.summary', systemPrompt: '', body: '{{x}}', variables: JSON.stringify({ variables: [{ name: 'x', source: { kind: 'override' } }] }), outputSchema: JSON.stringify({ parseMode: 'raw', outputs: [{ name: 'answer', target: { kind: 'none' } }] }), model: 'sonnet', maxTokens: 1000, temperature: 0.7 });
const snapshot = () => ({ definitionFormatVersion: 1, definition: definition(), catalog: { ...emptyCatalog, title: 'Summary', description: 'Summarizes text', groupKey: 'reviews', usedBy: 'Future PA flow', usageCategory: 'declared' } });
const request = () => ({ contractVersion: 1, definitionFormatVersion: 1, policyRevision: POLICY_ARTIFACT.policy.policyVersion, policyArtifactHash: POLICY_ARTIFACT.hash, requestId: id(4), operation: 'publish', promptKey: 'pa.summary', draftId: id(5), draftEtag: 'W/"12"', expectedHeadRevision: '0', expectedCurrent: null, metadataBaseline: { schemaVersion: 1, current: null, catalog: { ...emptyCatalog }, headRevision: '0' }, snapshotHash: hashSnapshot(snapshot()).hash });
const receipt = (r = request()) => ({ receiptVersion: 1, fingerprintVersion: 1, request: r, actor: { ...actor }, requestFingerprint: publicationFingerprint(r, actor).hash, published: { id: r.draftId, version: 1, etag: 'W/"15"' }, headRevision: '1', publishedAt: '2026-10-30T00:00:00.000Z' });
const codes = result => result.errors.map(e => e.code);
const setMemo = (d, field, fn) => { const v = JSON.parse(d[field]); fn(v); d[field] = JSON.stringify(v); return d; };

describe('bounded JSON and canonical v1', () => {
  test.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[1,]', '{"a":}', '01', 'true false'])('reject ambiguous/invalid JSON %s', text => { expect(() => parseJson(text)).toThrow(); });
  test.each(['-0', '1e999', '9007199254740993', '"\\ud800"', '"\\udc00"'])('reject lossy JSON %s', text => { expect(() => parseJson(text)).toThrow(); });
  test('null prototype JSON objects preserve special keys without pollution', () => {
    const parsed = parseJson('{"__proto__":{"polluted":true},"x":"😀"}');
    expect(Object.getPrototypeOf(parsed)).toBe(null); expect({}.polluted).toBeUndefined();
    expect(parsed.x).toBe('😀');
  });
  test.each([undefined, NaN, Infinity, -0, 9007199254740992, { a: undefined }, new Date(), /x/, [undefined], new Array(2), '\ud800'])('reject non-JSON value %p', value => { expect(() => inspectJson(value)).toThrow(); });
  test('accessors are never invoked; cycles, hidden/symbol/extended properties reject', () => {
    const getter = jest.fn(); const value = {}; Object.defineProperty(value, 'x', { enumerable: true, get: getter });
    expect(() => inspectJson(value)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const cycle = {}; cycle.x = cycle; expect(() => inspectJson(cycle)).toThrow();
    const sym = { [Symbol('x')]: 1 }; expect(() => inspectJson(sym)).toThrow();
    const a = []; a.foo = 1; expect(() => inspectJson(a)).toThrow();
  });
  test('UTF8 cap, escaped JSON overhead and depth are bounded', () => {
    expect(() => inspectJson('a'.repeat(LIMITS.bytes))).toThrow('payload_too_large');
    expect(() => inspectJson('😀'.repeat(300000))).toThrow('payload_too_large');
    expect(() => parseJson('['.repeat(40) + '0' + ']'.repeat(40))).toThrow('json_complexity_limit');
    expect(() => inspectJson('\n'.repeat(600000))).toThrow('payload_too_large');
  });
  test('canonical bytes pin numeric representation, ordering and Unicode', () => {
    expect(canonicalPreimage({ b: 0.5, a: 'é\r\n😀' })).toBe('["o",[["a",["s","\\u00e9\\u000d\\u000a\\ud83d\\ude00"]],["b",["n","3fe0000000000000"]]]]');
    expect(canonicalPreimage({ b: 2, a: 1 })).toBe(canonicalPreimage({ a: 1, b: 2 }));
    expect(canonicalPreimage({ '10': 1, '2': 2 })).toMatch(/^\["o",\[\["10"/);
    expect(canonicalPreimage([1, 2])).not.toBe(canonicalPreimage([2, 1]));
  });
});
describe('complete structural definition schema', () => {
  test('new generic definition passes without rewriting memo strings or CRLF', () => {
    const d = definition(); d.body += '\r\n😀'; const before = JSON.stringify(d);
    expect(validateDefinition(d)).toEqual({ valid: true, errors: [] }); expect(JSON.stringify(d)).toBe(before);
  });
  test.each(Object.keys(definition()))('missing %s rejects', k => { const d = definition(); delete d[k]; expect(validateDefinition(d).valid).toBe(false); });
  test.each(['actor', 'status', 'isCurrent', 'version', 'force', 'newExtension'])('unknown top-level %s rejects', k => { expect(codes(validateDefinition({ ...definition(), [k]: true }))).toContain('unknown_field'); });
  test.each(['PA.summary', 'pa', 'pa.summary ', 'pa.😀', 'pa..summary'])('invalid canonical key %s', name => { expect(codes(validateDefinition({ ...definition(), name }))).toContain('invalid_canonical_key'); });
  test('known consumer keys cannot downgrade to generic/new rules', () => {
    for (const name of POLICY_ARTIFACT.policy.pendingConsumerNames) expect(codes(validateDefinition({ ...definition(), name }))).toContain('consumer_contract_pending');
  });
  test.each([null, '', '{}', '{"variables":[{"name":"x"}]}', '{"variables":[{"name":"x","source":{"kind":"flow"}}]}'])('invalid variables spec %p', variables => { expect(validateDefinition({ ...definition(), variables }).valid).toBe(false); });
  test('all supported source kinds and A7 pairs', () => {
    for (const source of [{ kind: 'override', default: 'text' }, { kind: 'dynamics', table: 'akoya_request', field: 'name' }, { kind: 'sharepoint', pattern: '*.pdf', preprocess: 'pdf_to_text', maxChars: 100000 }]) {
      const d = setMemo(definition(), 'variables', s => Object.assign(s.variables[0], { source, required: true, cacheable: false, placement: 'system', untrusted: true, dataClass: 'custom-transcript-tag', maxChars: 100000 }));
      expect(validateDefinition(d).valid).toBe(true);
    }
  });
  test.each([{ source: { kind: 'override', injected: true } }, { source: { kind: 'dynamics', table: 'contact', field: 'name' } }, { source: { kind: 'dynamics', field: "x'" } }, { source: { kind: 'sharepoint' } }, { source: { kind: 'sharepoint', pattern: '*', preprocess: 'execute' } }, { untrusted: true }, { dataClass: 'transcript' }, { maxChars: 3 }, { maxChars: '3', dataClass: 'text' }, { placement: 'assistant' }, { required: 'yes' }, { name: '__proto__' }])('invalid variable %p', patch => {
    expect(validateDefinition(setMemo(definition(), 'variables', s => Object.assign(s.variables[0], patch))).valid).toBe(false);
  });
  test.each([null, '', '[]', '{"outputs":[]}', '{"outputs":[],"outputs":[{}]}'])('invalid output schema %p', outputSchema => { expect(validateDefinition({ ...definition(), outputSchema }).valid).toBe(false); });
  test.each([['parseMode', 'xml'], ['generationMode', 'code'], ['rawOutputRetention', 'private']])('unsupported %s', (k, value) => {
    expect(validateDefinition(setMemo(definition(), 'outputSchema', s => { s[k] = value; })).valid).toBe(false);
  });
  test.each([{ guard: 'sometimes' }, { target: { kind: 'flow' } }, { target: { kind: 'none', field: 'name' } }, { target: { kind: 'akoya_request', field: 'name', jsonPath: '$.a.b' } }, { type: 'script' }, { name: '__proto__' }])('invalid output %p', patch => {
    expect(validateDefinition(setMemo(definition(), 'outputSchema', s => Object.assign(s.outputs[0], patch))).valid).toBe(false);
  });
  test('native JSON and independent bounded declarative output', () => {
    const d = setMemo(definition(), 'outputSchema', s => Object.assign(s, { parseMode: 'json', generationMode: 'native-json-schema', jsonSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } }, additionalProperties: false }, validationSchema: { type: 'object', fields: { answer: { type: 'string', maxLength: 1000 } } } }));
    d.model = 'claude-sonnet-5'; expect(validateDefinition(d).valid).toBe(true);
    expect(validateDefinition({ ...d, model: 'sonnet' }).valid).toBe(false);
    expect(validateDefinition(setMemo(d, 'outputSchema', s => { s.jsonSchema.properties.answer.maxLength = 100; })).valid).toBe(false);
  });
  test.each([{ type: 'code' }, { type: 'string', forbidPattern: '(a+)+' }, { type: 'record', of: { type: 'string' }, keys: { pattern: '.*' } }, { type: 'array' }, { type: 'object', fields: {}, default: {} }, { type: 'string', maxLength: 1, default: 'long' }, { type: 'string', enum: 3, coerceEnum: true, default: 'a' }, { type: 'number', min: 3, max: 1 }])('invalid validation node %p', node => {
    expect(validateDefinition(setMemo(definition(), 'outputSchema', s => { s.parseMode = 'json'; s.validationSchema = node; })).valid).toBe(false);
  });
  test.each([NaN, -1, 2, '0.5', null])('invalid new temperature %p', temperature => { expect(validateDefinition({ ...definition(), temperature }).valid).toBe(false); });
});
describe('publication contracts and request binding', () => {
  test('first and later request with exact baseline', () => {
    expect(validateRequest(request()).valid).toBe(true);
    const r = request(); r.expectedCurrent = { id: id(6), version: 7, etag: 'W/"10"' }; r.metadataBaseline.current = { id: id(6), etag: 'W/"10"' };
    expect(validateRequest(r).valid).toBe(true);
    r.metadataBaseline.current.etag = 'W/"11"'; expect(codes(validateRequest(r))).toContain('baseline_current_mismatch');
  });
  test.each(Object.keys(request()))('missing request %s', k => { const r = request(); delete r[k]; expect(validateRequest(r).valid).toBe(false); });
  test.each(['actor', 'targetUrl', 'force', 'definition', 'budgetOverride'])('caller cannot submit %s', k => { expect(validateRequest({ ...request(), [k]: {} }).valid).toBe(false); });
  test.each([1, '-1', '00', '9223372036854775807', '9223372036854775808', '0\n'])('invalid expected revision %p', expectedHeadRevision => { expect(validateRequest({ ...request(), expectedHeadRevision }).valid).toBe(false); });
  test('old policy may parse/replay without current policy acceptance', () => {
    const r = request(); r.policyRevision = 1; r.policyArtifactHash = 'a'.repeat(64);
    const rec = receipt(r); expect(validateReceipt(rec).valid).toBe(true); expect(verifyReceiptBinding(rec, r, actor)).toBe(true);
  });
  test('every request and trusted actor field changes the fingerprint', () => {
    const r = request(), original = publicationFingerprint(r, actor).hash;
    const variants = [ { ...r, requestId: id(99) }, { ...r, draftId: id(99) }, { ...r, draftEtag: 'W/"13"' }, { ...r, policyRevision: 99 }, { ...r, policyArtifactHash: 'b'.repeat(64) }, { ...r, snapshotHash: 'c'.repeat(64) }, { ...r, promptKey: 'pa.other' } ];
    for (const changed of variants) expect(publicationFingerprint(changed, actor).hash).not.toBe(original);
    for (const k of Object.keys(actor)) expect(publicationFingerprint(r, { ...actor, [k]: id(99) }).hash).not.toBe(original);
  });
  test('snapshot binds full raw content and catalog; line endings/memo formatting significant', () => {
    const s = snapshot(), original = hashSnapshot(s).hash;
    for (const body of ['{{x}}\n', '{{x}}\r\n']) expect(hashSnapshot({ ...s, definition: { ...s.definition, body } }).hash).not.toBe(original);
    expect(hashSnapshot({ ...s, definition: { ...s.definition, variables: JSON.stringify(JSON.parse(s.definition.variables), null, 2) } }).hash).not.toBe(original);
    for (const k of Object.keys(s.catalog)) expect(hashSnapshot({ ...s, catalog: { ...s.catalog, [k]: k === 'groupKey' || k === 'sectionKey' ? 'changed' : 'Changed' } }).hash).not.toBe(original);
    expect(validateSnapshot({ ...s, ignored: true }).valid).toBe(false);
  });
  test('receipt remains bound to historical request, never fresh active state', () => {
    const r = request(), rec = receipt(r);
    expect(validateReceipt(rec).valid).toBe(true); expect(verifyReceiptBinding(rec, r, actor)).toBe(true);
    expect(verifyReceiptBinding(rec, { ...r, draftEtag: 'W/"99"' }, actor)).toBe(false);
    expect(verifyReceiptBinding(rec, r, { ...actor, initiatingUserId: id(99) })).toBe(false);
    expect(verifyReceiptBinding({ ...rec, requestFingerprint: 'a'.repeat(64) }, r, actor)).toBe(false);
    expect(validateReceipt({ ...rec, published: null }).valid).toBe(false);
    expect(validateReceipt({ ...rec, headRevision: '2' }).valid).toBe(false);
    expect(validateReceipt({ ...rec, publishedAt: '2026-02-30T00:00:00.000Z' }).valid).toBe(false);
  });
  test('64-bit revision without JS precision loss', () => {
    expect(incrementRevision('999999999999999999')).toBe('1000000000000000000');
    expect(incrementRevision('9223372036854775806')).toBe('9223372036854775807');
    expect(incrementRevision('9223372036854775807')).toBe(null);
  });
});

describe('portable fingerprint goldens and fresh validation separation', () => {
  const vectors = require('../fixtures/prompt-publication/fingerprints-v1.json');
  test.each(vectors.canonical)('canonical $preimage', ({ input, preimage }) => expect(canonicalPreimage(input)).toBe(preimage));
  test('snapshot/request/receipt goldens match exact bytes', () => {
    expect(hashSnapshot(vectors.snapshot.input)).toEqual({ hash: vectors.snapshot.hash, preimage: vectors.snapshot.preimage });
    for (const v of vectors.requests) expect(publicationFingerprint(v.input, v.actor)).toEqual({ hash: v.hash, preimage: v.preimage });
    expect(verifyReceiptBinding(vectors.receipt, vectors.requests[0].input, vectors.requests[0].actor)).toBe(true);
  });
  test('fresh validation binds content/name/hash/policy, while historical replay ignores installed policy', () => {
    const r = request(), s = snapshot();
    expect(validateFreshPublication(r, s).valid).toBe(true);
    expect(codes(validateFreshPublication(r, { ...s, definition: { ...s.definition, body: '{{x}} changed' } }))).toContain('snapshot_hash_mismatch');
    expect(codes(validateFreshPublication({ ...r, promptKey: 'pa.other' }, s))).toContain('snapshot_identity_mismatch');
    const old = { ...r, policyRevision: 1, policyArtifactHash: 'b'.repeat(64) };
    expect(codes(validateFreshPublication(old, s))).toContain('policy_changed');
    expect(verifyReceiptBinding(receipt(old), old, actor)).toBe(true);
  });
});

describe('malformed nested JSON complements never throw', () => {
  test('non-string source/type selectors reject without coercion', () => {
    for (const kind of [['override'], { toString: 'override' }, null, true, 1]) {
      const d = setMemo(definition(), 'variables', s => { s.variables[0].source.kind = kind; });
      expect(() => validateDefinition(d)).not.toThrow();
      expect(validateDefinition(d).valid).toBe(false);
    }
    for (const type of [['string'], { toString: 'string' }, null, true, 1]) {
      const d = setMemo(definition(), 'outputSchema', s => { s.parseMode = 'json'; s.validationSchema = { type }; });
      expect(() => validateDefinition(d)).not.toThrow();
      expect(validateDefinition(d).valid).toBe(false);
    }
  });
  test('all wire fields reject JSON type substitutions without throwing', () => {
    for (const field of Object.keys(request())) for (const value of [null, true, [], {}, { toString: 'x' }]) {
      const r = { ...request(), [field]: value };
      expect(() => validateRequest(r)).not.toThrow();
    }
  });
});

describe('Fable schema and checker regressions', () => {
  test.each([null, 3, true, {}, ['text']])('override default %p must be text', value => {
    const d = setMemo(definition(), 'variables', s => { s.variables[0].source.default = value; });
    expect(codes(validateDefinition(d))).toContain('invalid_default');
  });
  test.each([[null, null], ['$.a', '$.a'], [null, '$.a'], ['$.a', null]])('duplicate/mixed target pair %p %p rejects', (a, b) => {
    const d = setMemo(definition(), 'outputSchema', s => {
      s.parseMode = 'json'; s.outputs = [a, b].map((path, i) => ({ name: 'answer' + i, target: { kind: 'akoya_request', field: 'f', ...(path === null ? {} : { jsonPath: path }) } }));
    });
    expect(codes(validateDefinition(d))).toContain('duplicate_output_target');
  });
  test('distinct paths in same field preserve supported write behavior', () => {
    const d = setMemo(definition(), 'outputSchema', s => {
      s.parseMode = 'json'; s.outputs = ['$.a', '$.b'].map((jsonPath, i) => ({ name: 'answer' + i, target: { kind: 'akoya_request', field: 'f', jsonPath } }));
    });
    expect(validateDefinition(d).valid).toBe(true);
  });
  test('golden builder is checked, not silently regenerated by tests', () => {
    expect(execFileSync(process.execPath, ['scripts/build-prompt-publication-vectors.cjs', '--check'], { cwd: process.cwd(), encoding: 'utf8' })).toContain('golden vectors match');
  });
});

describe('final malformed name and bound no-coercion regression', () => {
  test.each([{}, { toString: 'x' }, [], null, true, 1])('definition name %p rejects without throwing', name => {
    expect(() => validateDefinition({ ...definition(), name })).not.toThrow();
    expect(validateDefinition({ ...definition(), name }).valid).toBe(false);
  });
  test.each([
    { type: 'number', min: {}, max: {}, default: 1 },
    { type: 'integer', min: { toString: '1' }, max: 3, default: 2 },
    { type: 'string', maxLength: {}, default: 'text' },
  ])('declarative malformed bound %p rejects without throwing', node => {
    const d = setMemo(definition(), 'outputSchema', s => { s.parseMode = 'json'; s.validationSchema = { type: 'object', fields: { answer: node } }; });
    expect(() => validateDefinition(d)).not.toThrow();
    expect(validateDefinition(d).valid).toBe(false);
  });
  test('JSON Schema malformed bound objects reject without coercion', () => {
    const d = setMemo(definition(), 'outputSchema', s => { s.parseMode = 'json'; s.jsonSchema = { type: 'object', properties: { answer: { type: 'number', minimum: {}, maximum: {} } } }; });
    expect(() => validateDefinition(d)).not.toThrow(); expect(validateDefinition(d).valid).toBe(false);
  });
});

test('strict-parsed receipt version objects return errors and fail binding without throwing', () => {
  for (const field of ['prior', 'published', 'both']) {
    const r = request(); r.expectedCurrent = { id: id(6), version: 7, etag: 'W/"10"' }; r.metadataBaseline.current = { id: id(6), etag: 'W/"10"' };
    const rec = receipt(r); rec.published.version = 8;
    if (field !== 'published') rec.request.expectedCurrent.version = {};
    if (field !== 'prior') rec.published.version = {};
    const parsed = parseJson(JSON.stringify(rec));
    expect(() => validateReceipt(parsed)).not.toThrow();
    expect(validateReceipt(parsed).valid).toBe(false);
    expect(() => verifyReceiptBinding(parsed, r, actor)).not.toThrow();
    expect(verifyReceiptBinding(parsed, r, actor)).toBe(false);
  }
});
