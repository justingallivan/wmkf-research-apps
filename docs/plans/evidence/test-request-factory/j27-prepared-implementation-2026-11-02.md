# Prepared J27 Factory — implementation evidence

Status: branch source and local checks verified; independent Fable plan/code
reviews and bounded correction closures passed. Managed application/live proof pending.
No managed schema application, Production fixture writes, AI runs, email sends,
merge or Production deployment performed for this implementation.

## Contract and invariants

| Invariant | Enforcing surface | Evidence |
|---|---|---|
| Old manifests recompile identically, including old J27 reservations | `compileBody` selects only the explicit discriminator | production-target regression exercises old/new values for the same J27 cycle |
| New Production J27+ manifests start unready and omit direct Request Status | manifest builder, metadata compiler, closed create fence | compiler/fence tests; runtime gates |
| Minimum package is canonical reviewer proposal plus applicant abstract | prepared contract + existing Basic copying | minimum-package negatives contain other documents; positives do not need saved AI outputs |
| Clone completion and staff readiness are distinct | unchanged Basic terminal verifier; owner-only CLI finalizer | no new recipe step/run state/HTTP route; UI and runbook explain both meanings |
| Finalizer touches only its marked destination after guarded phase advancement | manifest/body/bundle/run binding, live marker/cycle/pair, status journal | wrong marker/run/cycle/phase/metadata/legacy/unselected-readiness tests refuse before intent/PATCH |
| Source, Foundation and synthetic contacts remain isolated | saved-source/body provenance, Foundation transition check, immutable-body cast bindings | existing isolation regressions; changed-contact negative |
| Copied files must remain verified and present | ledger receipts, folder census, byte/package re-verification | missing/stale package negatives block the stamp |
| One sender, no blind repeat | unique open, attempt-bound typed journal and planned→dispatched CAS | local PostgreSQL competing-dispatch proof; landed/unlanded ambiguity, repeat, ETag and 412 unit cases |
| Readiness is a true-only concrete-ETag PATCH | dedicated fence and target interlock | negative tests contain false, extra status field, wildcard and source path |
| Completion needs true readback and quiet observed effects | applied→complete conditional write after job/census checks | unexpected effect leaves needs_attention; 23 PostgreSQL/fingerprint tests pass |

Trace: existing authenticated admin reserve / owner CLI → explicit immutable
manifest and operational run → unchanged Basic clone/files → existing guarded
Phase I then Phase II status setter → owner CLI read-only finalization preview →
confirmed typed-journal intent/CAS → exact ETag readiness PATCH → package/status
readback and effect observation → existing readiness-filtered app consumers.

Partial success: clone-ready may coexist with staff-unready; a dispatched stamp
can be visible while effect verification remains incomplete. The journal records
that distinction. No automatic rollback or re-dispatch exists. A failure is not a
reviewer-ready success. External automation does not yet exclude test markers;
its reactions require the separately authorized bounded live exercise.

Async: no new browser state/request flow; existing UI generation guards remain.
The owner CLI has no process lease; unique open-attempt identity and attempt-bound compare-and-set
select the sender, and every ambiguous dispatch resumes through readback only.
Confirmed owner recovery requires all possible senders stopped and live readiness
false/null; it retains the abandoned attempt and its original error. The next
finalization verifies the package before capturing its fresh ETag/new intent. Recovery
cannot clear unexpected already-true effects. The existing status setter's integer/options/effects/replay contract is unchanged.
Only its ready-run gate, interlock preflight and quiet-job observer are exported.

Durable: migration 094 and its registered manifest/fingerprint define typed immutable
journal attempts with one open per run; retained audit trail, no cleanup writer. The existing fresh
bootstrap executes numbered migrations. Atlas, runbook and service catalog name
the writer/readers and pending managed application. Route/security count changes:
N/A, no route added. UI run status vocabulary is unchanged.

Complement: pre-J27 and historical manifests retain old creation; unsupported
or tampered prepared values refuse; unready/missing/ordinary/other-run records
cannot finalize; already-true without dispatched journal refuses; unknown journal
states never dispatch; incomplete files/metadata/statuses fail closed. There is
no client-supplied readiness bypass or bulk operation.

## Verification and limits

- Canonical production build passed; type check and scoped lint passed.
- 2,225 Factory/readiness/Reviewer Finder unit tests passed after the recovery
  ordering correction, followed by all 32 focused finalizer tests for the final
  read-only diagnostic change.
- Disposable local PostgreSQL: 23 journal/fingerprint/migration tests passed.
- Sixteen runtime gate/self-test commands passed sequentially (migration manifest,
  Atlas, types, DAL, OData, context and route/service boundaries, status parity,
  secrets). Nine documentation gates/self-tests passed, including the correctly
  named `check:build-claim-freshness` pair. Diff checks passed.
- Production reads only: all six Research J27 requests unready; six sampled
  invited D26 sources have seven recognized files and non-null applicant abstract.
  Non-null is a candidate check, not full abstract/content validation. Readiness
  Boolean metadata is explicitly createable/updateable. Receipts are adjacent.
- No live positive prepared fixture is claimed. Phase I producing effects,
  readiness reactions, actual copied bytes and reviewer end-to-end actions still
  need the bounded owner-authorized live test. No email delivery claim follows.

Bounded sweep mode A: prepared fixture ownership/package/sequence and new journal.
Modified source headers, service catalog, runbook, Atlas and owning J27 plans
reflect the separate real-intake/fixture writer contracts. Existing readiness
filtering is unchanged; only its writer-ownership comment is clarified. Historical
Factory evidence remains historical. Broader J27 workflow, existing unrelated
Atlas history and other worktrees are outside this implementation audit.


Final independent verdict: [READY FOR OWNER REVIEW](j27-prepared-fable-final-review-2026-11-02.md).
All original P1/P2 findings and the final preview-note mismatch are closed. The
remaining operational limits are explicit: no automatic acceptance/clearing of
unexpected stamped effects, unknown status-abandon history blocks finalization,
and migration/live testing need separate owner authorization. Preview diagnostics
remain read-only for needs_attention and abandoned attempts, while confirmation
still refuses unresolved attention. CI explicitly includes the new PostgreSQL
attempt-journal suite.
