import fs from 'node:fs';
import path from 'node:path';
import {
  assertCopiedSourceValues,
  assertSourceUnchanged,
  expectedRequestFolder,
  projectCloneSource,
  requireUniqueSourceRequest,
  resolveCloneCycle,
  verifyCloneRequestReadback,
} from '../../lib/services/test-requests/sandbox-clone.js';

const source = (overrides = {}) => ({
  akoya_requestid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  akoya_requestnum: '1000339',
  akoya_requesttype: 100000000,
  akoya_purpose: 'Synthetic source purpose',
  akoya_request: 125000,
  akoya_fiscalyear: 'December 2026',
  wmkf_meetingdate: '2026-12-04T00:00:00Z',
  '@odata.etag': 'W/"source-7"',
  akoya_requeststatus: 'Approved',
  _akoya_primarycontactid_value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  akoya_paid: 999,
  ...overrides,
});

describe('sandbox clone source fence', () => {
  test('projects only copyable fields and copies the source fiscal year and meeting date by default', () => {
    const projected = projectCloneSource(source());
    expect(projected).toEqual({
      akoya_requestid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      akoya_requestnum: '1000339',
      akoya_requesttype: 100000000,
      akoya_purpose: 'Synthetic source purpose',
      akoya_request: 125000,
      akoya_fiscalyear: 'December 2026',
      wmkf_meetingdate: '2026-12-04',
      revision: 'W/"source-7"',
    });
    expect(projected).not.toHaveProperty('akoya_requeststatus');
    expect(projected).not.toHaveProperty('_akoya_primarycontactid_value');
    expect(projected).not.toHaveProperty('akoya_paid');
    expect(projectCloneSource(source({ akoya_purpose: '' })).akoya_purpose).toBeNull();
    expect(expectedRequestFolder('1000001', projected.akoya_requestid))
      .toBe('1000001_AAAAAAAAAAAA4AAA8AAAAAAAAAAAAAAA');
    expect(resolveCloneCycle(projected)).toEqual({ fiscalYear: 'December 2026', meetingDate: '2026-12-04' });
  });

  test('requires an explicit override for each missing source cycle value', () => {
    const projected = projectCloneSource(source({ akoya_fiscalyear: null, wmkf_meetingdate: null }));
    expect(() => resolveCloneCycle(projected)).toThrow('--fiscal-year');
    expect(() => resolveCloneCycle(projected, { fiscalYear: 'June 2027' })).toThrow('--meeting-date');
    expect(resolveCloneCycle(projected, { fiscalYear: 'June 2027', meetingDate: '2027-06-11' }))
      .toEqual({ fiscalYear: 'June 2027', meetingDate: '2027-06-11' });
  });

  test('explicit cycle overrides win after calendar validation', () => {
    expect(resolveCloneCycle(projectCloneSource(source()), {
      fiscalYear: 'June 2027', meetingDate: '2027-06-11',
    })).toEqual({ fiscalYear: 'June 2027', meetingDate: '2027-06-11' });
    expect(() => resolveCloneCycle(projectCloneSource(source()), { meetingDate: '2027-02-30' }))
      .toThrow('--meeting-date');
  });

  test('source lookup fails closed for missing, ambiguous, or truncated result sets', () => {
    expect(() => requireUniqueSourceRequest([])).toThrow('found 0');
    expect(() => requireUniqueSourceRequest([source(), source({ akoya_requestid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })]))
      .toThrow('found 2');
    expect(() => requireUniqueSourceRequest([source()], true)).toThrow('found 1+');
  });

  test('pre-write fence rejects changed revision, changed copied values, wrong type, and missing source', () => {
    const prepared = projectCloneSource(source());
    const provenance = {
      requestId: prepared.akoya_requestid,
      requestType: prepared.akoya_requesttype,
      revision: prepared.revision,
    };
    expect(assertSourceUnchanged(provenance, source(), 100000000)).toEqual(prepared);
    expect(() => assertSourceUnchanged(provenance, source({ versionnumber: '8', '@odata.etag': 'W/"source-8"' }), 100000000))
      .toThrow('changed since prepare');
    expect(() => assertSourceUnchanged(provenance, source({ akoya_requesttype: 100000001 }), 100000000))
      .toThrow('no longer the same Grant');
    expect(() => assertSourceUnchanged(provenance, null, 100000000)).toThrow('missing or invalid');
    expect(() => assertCopiedSourceValues(projectCloneSource(source({ akoya_request: 1 })), {
      akoya_purpose: 'Synthetic source purpose', akoya_request: 125000,
    })).toThrow('copied values changed');
  });

  test('readback rejects drift in marker, run, date, creator, or owner while accepting the complete planned row', () => {
    const manifest = {
      values: {
        requestId: '11111111-1111-4111-8111-111111111111',
        runId: '22222222-2222-4222-8222-222222222222',
        meetingDate: '2026-12-04',
      },
      expectedOrganization: { accountid: '33333333-3333-4333-8333-333333333333' },
      expectedAppUserId: '44444444-4444-4444-8444-444444444444',
      createBody: {
        akoya_title: 'TEST: safe fixture',
        akoya_fiscalyear: 'December 2026',
        akoya_purpose: 'Synthetic purpose',
        akoya_request: 125000,
        akoya_requesttype: 100000000,
        wmkf_respondreminderenabled: false,
        wmkf_reviewduereminderenabled: false,
      },
    };
    const row = {
      akoya_requestid: manifest.values.requestId,
      akoya_title: manifest.createBody.akoya_title,
      akoya_fiscalyear: manifest.createBody.akoya_fiscalyear,
      akoya_purpose: manifest.createBody.akoya_purpose,
      akoya_request: manifest.createBody.akoya_request,
      akoya_requesttype: manifest.createBody.akoya_requesttype,
      wmkf_meetingdate: manifest.values.meetingDate,
      _akoya_applicantid_value: manifest.expectedOrganization.accountid,
      _createdby_value: manifest.expectedAppUserId,
      _ownerid_value: manifest.expectedAppUserId,
      wmkf_istestrequest: true,
      wmkf_testcreationrunid: manifest.values.runId,
      wmkf_respondreminderenabled: false,
      wmkf_reviewduereminderenabled: false,
    };
    expect(verifyCloneRequestReadback(manifest, row)).toEqual([]);
    const drifted = verifyCloneRequestReadback(manifest, {
      ...row,
      wmkf_istestrequest: false,
      wmkf_testcreationrunid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      wmkf_meetingdate: '2024-12-13',
      _createdby_value: '55555555-5555-4555-8555-555555555555',
      _ownerid_value: '66666666-6666-4666-8666-666666666666',
    });
    expect(drifted).toEqual(expect.arrayContaining([
      'test marker not true', 'run ID mismatch', 'meeting date mismatch', 'creator mismatch', 'owner mismatch',
    ]));
  });
});

describe('sandbox operator write boundary', () => {
  // Slice 5b (build order item 5) extracted executeManifest's step bodies
  // into lib/services/test-requests/basic-clone-steps.js so a bounded
  // resumable runner (run-runner.js) can reuse them. Every pin that used to
  // check literal text inside a NOW-MOVED function was replaced by an
  // equivalent behavioral test in tests/unit/test-request-basic-clone-steps.test.js
  // (see that file's header comment for the full list); only the pins for
  // logic that stays in this script -- main()'s read-only boundary, the
  // still-unmoved copyBundleDocuments/inspectManifest/prepare helpers -- stay
  // here as literal-text pins.
  const scriptPath = path.resolve(process.cwd(), 'scripts/rehearse-test-request-sandbox.mjs');
  const script = fs.readFileSync(scriptPath, 'utf8');

  test('keeps the receipt-open call and generic write-boundary markers intact in the orchestrating script', () => {
    expect(script).toContain('reserveRehearsalReceipt(receiptPath, receipt)');
    expect(script).toContain('expectedFolder');
    expect(script).toContain('checkPreallocatedRequestAbsent');
    expect(script).toContain('READ_ONLY_PREFLIGHT');
    expect(script).toContain('writeNewJson(args.prepare, manifest)');
    expect(script).toContain('receipt.observationStartedAt = new Date().toISOString()');
    expect(script).toContain('expectedSharePointFolder: expectedFolder');
    expect(script).toContain('postCreateStepsSkippedReason =');
    const mainBody = script.slice(script.indexOf('async function main()'), script.indexOf('main().catch'));
    expect(mainBody).not.toMatch(/client\.(post|patch|delete)\s*\(/);
    // --reserve writes the private manifest before reserving, so no reserved
    // run can exist without its manifest; the actor is a digest, never free text.
    expect(script.indexOf('writeNewJson(args.manifestOut, manifest)')).toBeGreaterThan(-1);
    expect(script.indexOf('writeNewJson(args.manifestOut, manifest)')).toBeLessThan(script.indexOf('ledger.reserveRun('));
    expect(script).toContain('cliActorId(');
    expect(script).not.toMatch(/cli:\$\{/);
    // Production plan P1: the reserved destination host comes from the manifest's pinned target.
    expect(script).toContain('destinationDataverseHost: targetHostOf(manifest)');
    // --advance reports a finished run plainly instead of claiming a lease on it.
    expect(script).toContain("mode: 'NOT_ADVANCED'");
    // --run-inspect must not construct the Dataverse client at all.
    expect(script.indexOf("if (args.runInspect)")).toBeLessThan(script.indexOf('createClient({'));
  });

  test('copies bundle files only after the location exists, through the journaled copy module (unmoved copyBundleDocuments)', () => {
    // File copy runs after the Request and its location are proven, never before.
    const locationProvision = script.indexOf('const location = await provisionSharePointLocation(');
    const copyCall = script.indexOf('await copyBundleDocuments(manifest, datedRequest, location.folder, preflightBefore, receipt, receiptPath)');
    expect(locationProvision).toBeGreaterThan(-1);
    expect(copyCall).toBeGreaterThan(locationProvision);
    // The receipt journal is persisted synchronously on every copy-module callback.
    const journalAssign = script.indexOf('receipt.fileCopies = journal;');
    expect(journalAssign).toBeGreaterThan(-1);
    expect(script.indexOf('updateRehearsalReceipt(receiptPath, receipt);', journalAssign) - journalAssign).toBeLessThan(80);
    // The script itself never uploads; the copy module owns the single create-only PUT.
    expect(script).not.toMatch(/GraphService\.uploadFile\([^)]*\)\s*;/);
    expect(script).toContain("destinationRequestNumber: request.akoya_requestnum");
    // Source attestation for both file-receipt prepare and the ledger-driven reserve.
    expect(script).toContain('source.akoya_requestnum !== args.sourceRequestNumber');
    // Receipt-bound inspection reconciles journaled stable IDs read-only.
    expect(script).toContain('reconcileJournaledCopies(receipt.fileCopies');
    expect(script).toContain("Receipt does not belong to this manifest.");
    // The reverify wrapper still runs after observation and before the final receipt persist.
    const observation = script.indexOf('const observation = await observe(client, manifest.values.requestId);');
    const reverify = script.indexOf('reverifyClone(graph, receipt.fileCopies || [])');
    const persisted = script.indexOf('updateRehearsalReceipt(receiptPath, receipt);', reverify);
    expect(reverify).toBeGreaterThan(observation);
    expect(persisted).toBeGreaterThan(reverify);
    expect(script).toContain("verification.failures.push(...reverifyFailures.map((failure) => `final file check: ${failure}`))");
  });

  test('ledger-driven modes are dispatched through the ledger guard (Codex round-1 Fix 1/4/7; Opus round-2 item 6)', () => {
    // Opus round-2 item 6 (Codex round-2 #7): requireLedgerUrl and
    // ledgerSchemaCheck moved to lib/db/ledger-guard.js so their SAFETY
    // BEHAVIOR is executable and unit-tested (tests/unit/ledger-guard.test.js),
    // not just their presence in this dispatch source — a literal-source
    // check alone cannot catch a deleted throw inside those functions. The
    // pins below stay here only for what still lives in THIS file: the
    // import and the dispatch call placement.
    expect(script).toContain("import { requireLedgerUrl, ledgerSchemaCheck } from '../lib/db/ledger-guard.js';");
    expect(script).not.toContain('--strict-ledger-check');
    // Zero no-argument calls left at HEAD (a future merge that reintroduces
    // one, e.g. from B4, is a real regression, not a decorative one) —
    // ledger-guard.js's own requireLedgerUrl fails closed on a missing
    // target (tests/unit/ledger-guard.test.js), but this still pins that no
    // call site in THIS script forgets to pass args.target.
    expect((script.match(/requireLedgerUrl\(\)/g) || []).length).toBe(0);
    // Block-bound: for each write/read-only ledger-driven dispatch, BOTH
    // requireLedgerUrl(args.target) and ledgerSchemaCheck(..., { mode: '...'
    // must occur strictly between this block's `if (args.X) {` and the next
    // `if (args.` dispatch, not merely somewhere later in the file.
    // Codex round-3 #7 (generic, name-independent): EVERY dispatch block in
    // main() that creates a Dataverse client must first take a target-bound
    // ledger and pass the schema check, in that order, before createClient(.
    // A future block (e.g. B4's bindReviewerSlot) is caught whatever it is called.
    const mainStart = script.indexOf('async function main(');
    expect(mainStart).toBeGreaterThan(-1);
    const blockRe = /\n  if \(args\.[^\n]*\) \{/g;
    blockRe.lastIndex = mainStart;
    const starts = [];
    let m;
    while ((m = blockRe.exec(script)) !== null) starts.push(m.index);
    expect(starts.length).toBeGreaterThan(5);
    let clientBlocks = 0;
    for (let i = 0; i < starts.length; i++) {
      const at = starts[i];
      // A dispatch block ends at its own closing brace at two-space indent.
      const end = script.indexOf('\n  }', at + 1);
      expect(end).toBeGreaterThan(at);
      const block = script.slice(at, end);
      const create = block.indexOf('createClient(');
      if (create === -1) continue;
      clientBlocks += 1;
      const guard = block.indexOf('requireLedgerUrl(args.target)');
      const check = block.indexOf('ledgerSchemaCheck(ledgerUrl, {');
      expect({ block: block.slice(0, 60), guardBeforeCheck: guard > -1 && guard < check, checkBeforeClient: check > -1 && check < create })
        .toEqual({ block: block.slice(0, 60), guardBeforeCheck: true, checkBeforeClient: true });
    }
    expect(clientBlocks).toBe(3);
    for (const mode of ['ledgerCheck', 'runInspect', 'setStatus || args.statusRecheck', 'createCast || args.bindReviewer', 'runRecheck', 'reserve', 'advance']) {
      const at = script.indexOf(`if (args.${mode}) {`);
      expect(at).toBeGreaterThan(-1);
      const nextDispatch = script.indexOf('\n  if (args.', at + 1);
      const boundary = nextDispatch === -1 ? script.length : nextDispatch;
      const requireAt = script.indexOf('requireLedgerUrl(args.target)', at);
      const checkAt = script.indexOf('ledgerSchemaCheck(ledgerUrl, { mode:', at);
      expect(requireAt).toBeGreaterThan(at);
      expect(requireAt).toBeLessThan(boundary);
      expect(checkAt).toBeGreaterThan(at);
      expect(checkAt).toBeLessThan(boundary);
    }
    // Drift-always-throws and the approved-ahead extra rule (Codex round-1
    // Fix 4) now live in lib/db/ledger-guard.js's ledgerSchemaCheck, covered
    // executably by tests/unit/ledger-guard.test.js.
  });

  /**
   * Opus round-3 L7: the block matcher above (`/\n  if \(args\.[^\n]*\) \{/g`)
   * only recognizes a bare `if (args.` at two-space indent — a dispatch
   * reachable only through `} else if (args.` or a trailing `} else {`
   * would be invisible to it, and neither test above checks a block that
   * reuses main()'s own SHARED, unconditional `const client =
   * createClient(...)` (line ~1315) rather than creating its own. This test
   * covers both gaps directly: an extended, name-independent block matcher
   * that also recognizes else-if/else branches, and an assertion — for
   * every such block found AFTER the shared client line that references
   * `ledgerUrl` and uses the shared `client` — that requireLedgerUrl(args.target)
   * and ledgerSchemaCheck( both precede the block's first use of `client`
   * (today: reserve and advance).
   *
   * Proven by mutation on a scratch copy (not left as a repeatable CI step,
   * since restoring a source mutation mid-suite is not deterministic): with
   * `requireLedgerUrl(args.target)` deleted from the `reserve` block, this
   * test failed with `guardBeforeClient: false` where `true` was expected;
   * restoring the line byte-for-byte (diffed against a backup) made it pass
   * again.
   */
  test('Opus round-3 L7: a dispatch block reusing the SHARED client (incl. else-if/else) still guards + schema-checks before using it', () => {
    const mainStart = script.indexOf('async function main(');
    expect(mainStart).toBeGreaterThan(-1);
    const sharedClientIdx = script.indexOf('const client = createClient(', mainStart);
    expect(sharedClientIdx).toBeGreaterThan(mainStart);

    // Extended, name-independent matcher: a bare `if (args.`, an
    // `} else if (args.`, or a trailing `} else {`, all at two-space indent
    // (so nested blocks deeper in the file, e.g. --prepare's --bundle
    // branch, are never mistaken for a top-level dispatch).
    const blockRe = /\n  (?:\} else )?if \(args\.[^\n]*\) \{|\n  \} else \{/g;
    blockRe.lastIndex = sharedClientIdx;
    const starts = [];
    let m;
    while ((m = blockRe.exec(script)) !== null) starts.push(m.index);
    expect(starts.length).toBeGreaterThan(0);

    let ledgerUrlBlocksChecked = 0;
    for (const at of starts) {
      const end = script.indexOf('\n  }', at + 1);
      const block = script.slice(at, end === -1 ? script.length : end);
      if (!block.includes('ledgerUrl')) continue; // not a ledger-driven block
      const firstClientUse = block.search(/\bclient\b/);
      if (firstClientUse === -1) continue; // never actually uses the shared client
      ledgerUrlBlocksChecked += 1;
      const guardAt = block.indexOf('requireLedgerUrl(args.target)');
      const checkAt = block.indexOf('ledgerSchemaCheck(ledgerUrl, {');
      expect({
        block: block.slice(0, 40),
        guardBeforeClient: guardAt > -1 && guardAt < firstClientUse,
        checkBeforeClient: checkAt > -1 && checkAt < firstClientUse,
      }).toEqual({ block: block.slice(0, 40), guardBeforeClient: true, checkBeforeClient: true });
    }
    // reserve and advance are the two known-good cases today; a future
    // else-if/else dispatch that reuses the shared client and references
    // ledgerUrl is picked up by the loop above automatically.
    expect(ledgerUrlBlocksChecked).toBe(2);
  });

  test('--advance enters the script-only trusted DAL context before advancing any step (Stage C round 2, P1-B)', () => {
    // Every Initial Assessment step's sandbox dependency
    // (lib/services/test-requests/ia-sandbox-deps.js) calls
    // assertTrustedDalContext; without a trusted context the first such call
    // throws. This CLI never wraps its calls in bypassDynamicsRestrictions
    // (a route/library-shaped, callback-scoped mechanism) -- it uses the
    // documented script-only precedent instead
    // (scripts/rebaseline-email-defaults.mjs), entered once inside
    // runAdvance, narrower than module load so --reserve/--inspect
    // invocations (which never reach a sandbox-bound dependency) never carry it.
    const runAdvanceStart = script.indexOf('async function runAdvance(');
    expect(runAdvanceStart).toBeGreaterThan(-1);
    const enterBypass = script.indexOf("enterDynamicsBypassForScript('rehearse-test-request-sandbox:advance')", runAdvanceStart);
    expect(enterBypass).toBeGreaterThan(runAdvanceStart);
    const loopStart = script.indexOf('for (let i = 0; i < args.steps; i += 1) {', runAdvanceStart);
    expect(loopStart).toBeGreaterThan(enterBypass);
    // Not entered anywhere else in the file except runReserve's own
    // reviews-recipe-only entry (slice 6c-ii Stage B:
    // resolveReviewerAssignments' sandbox-bound reads/ledger reads also need
    // a trusted context, entered narrowly inside runReserve, only when
    // args.recipe === 'reviews', never for basic/initial_assessment).
    const runReserveStart = script.indexOf('async function runReserve(');
    expect(runReserveStart).toBeGreaterThan(-1);
    const enterBypassReserve = script.indexOf("enterDynamicsBypassForScript('rehearse-test-request-sandbox:reserve-reviews')", runReserveStart);
    expect(enterBypassReserve).toBeGreaterThan(runReserveStart);
    expect(enterBypassReserve).toBeLessThan(runAdvanceStart);
    const thirdCall = script.indexOf('enterDynamicsBypassForScript(', enterBypass + 1);
    expect(thirdCall).toBe(-1);
  });

  it('--advance derives its lease duration from recipeLeaseSeconds (owner decision 2026-09-24, no renewal; P1-b: any IA-cumulative recipe must get the 900 s maximum, not just initial_assessment by name)', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/rehearse-test-request-sandbox.mjs'), 'utf8');
    const runAdvanceStart = script.indexOf('async function runAdvance(');
    const lease = script.indexOf("leaseSeconds: recipeLeaseSeconds(manifest.recipe ?? 'basic')", runAdvanceStart);
    expect(lease).toBeGreaterThan(runAdvanceStart);
    expect(script.indexOf('renewLease')).toBe(-1);
    // recipeLeaseSeconds itself (run-runner.js) is unit-tested for all three
    // recipes; this only pins that the CLI actually calls it rather than
    // naming a single recipe by string.
  });
});
