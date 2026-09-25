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
    expect(script).toContain('destinationDataverseHost: new URL(SANDBOX_URL).hostname');
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

  test('ledger-driven modes refuse an unset or shared-production TEST_REQUEST_LEDGER_URL', () => {
    expect(script).toContain("if (!url) {");
    expect(script).toContain('TEST_REQUEST_LEDGER_URL is required for ledger-driven modes');
    expect(script).toMatch(/neon\\?\.tech/);
    expect(script).toContain('must not be the shared Production/Preview database');
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
    // Not entered anywhere else in the file (module load, runReserve, etc.).
    expect(script.indexOf('enterDynamicsBypassForScript(', enterBypass + 1)).toBe(-1);
    expect(script.indexOf('enterDynamicsBypassForScript(')).toBe(enterBypass);
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
