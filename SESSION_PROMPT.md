# Session 564 Prompt: Factory admin form is live; pick the next item

## Session 563 Summary — 2026-10-01/02 PT (Factory admin form lane, Claude, home Mac)

This lane ran alongside the Codex refactor lane that closed as "Session 562"; the Factory plan documents written during it say "S562". It is numbered 563 here only to keep this file's sequence.

The admin Test Request form is built, enabled in Production, and has produced one complete test Request with a status change. [VERIFIED via owner-run `--run-inspect` against `managed-ledger/ledger_prod`, GitHub PRs, and Vercel deployment status]

### What Was Completed

1. **Slices 2, 2b, 3 built and merged** (PRs #398 `baa4eeb46`, #399 `9a7f12c49`, #401 `b5eb97138`): eight superuser routes, the status setter with exactly one PATCH per change, the admin UI. Sonnet builds, Opus reviews, Codex adversarial rounds, an Impeccable critique of the UI.
2. **Preview rehearsal** (owner click-through, branch `factory-form-rehearsal`, since deleted): sign-in, superuser gate, production source read, Confirm and `fence_source` worked; the sandbox refused the create, as anticipated. Rehearsal run `3de97783-6988-5c0c-b933-e7bccbc9da64`'s row is in `managed-ledger/ledger` with no Request behind it. All rehearsal configuration was removed.
3. **Server-side logging of stops and refusals** (PR #403 `cd0d6ebe6`).
4. **Production provisioning (owner)**: `TEST_REQUEST_FACTORY_FORM=on`, `TEST_REQUEST_LEDGER_URL`, `FACTORY_BLOB_RW_TOKEN` (store `wmkf-factory-private`). The form is **on in Production**.
5. **First production run stopped**: run `20407283-c279-5e0c-b396-210ad6842482` (`managed-ledger/ledger_prod`), source 1002860, test Request **1003308**, `needs_attention` / `file_journal_unverified`. SharePoint rewrote `docProps/custom.xml` in the uploaded XLSX and only DOCX had a package comparison. Not resumable.
6. **XLSX fix** (PR #406 `06797abd0`): XLSX verified by the existing package attestation at the destination, the Basic journal carries what `verify` needs, and a settle check before a package-mode copy is journaled. Opus approve-with-fixes; Codex three rounds, final approve.
7. **Complete production run**: run `a5161f47-7b02-5ad3-8f20-3f645ec3c254` (`managed-ledger/ledger_prod`), source 1002988, test Request **1003310**, `ready`, seven documents verified including the XLSX. One status change through the form: Phase II status to "Phase II Pending Committee Review" (seen on the form and in the route log; `--run-inspect` does not list status changes).
8. **Two display fixes** from that run (PRs #408 `c1b57d6e2`, #409 `e236a7e14`).
9. **Slice 5 docs** (`dbac432f3`): `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md`, Atlas, credentials runbook, older plans annotated, memory.
10. **Two read-only probes**: `scripts/probe-test-request-source-document-sizes.mjs`, `scripts/probe-sharepoint-download-stability.mjs`.

### Commits

- PRs #398, #399, #401, #403, #406, #408, #409 (merge and squash commits above).
- `e3f370163`, `4c7689e1b`, `fd12baee3` probes and run records; `a931c66ba`, `9557cf275` rehearsal record; `dbac432f3` slice 5 docs.

## Next Items

### Verified Open

1. **Form stop copy disagrees with the code.** Several stops point to a command-line resolution that no mode provides; the `timeout`/`network` copy holds only before a write; `bundle_stale` and `meeting_date_patch_failed` have no copy.
   Evidence: `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` (*Known gaps*); `shared/components/admin/test-request-factory-copy.js` `ATTENTION_COPY`; delegated source trace 2026-10-02.
   A small reviewed PR. `BLIP_COPY` is owner-set wording and stays verbatim.
2. **First lookup of a source is refused once**, then passes ("changed while its bytes were being verified", an XLSX).
   Evidence: Vercel log 2026-10-02 (`admin test-request run refusal: 409 test_request_preview_source_changed …`); `lib/services/test-requests/admin-preview-service.js` `hydrateSelectedDocument`. Cause not established; the refusal does not say which of its four comparisons failed.
3. **Flaky `tests/unit/awardee-tab.test.js`** ("T2 send: non-2xx with an unparseable body"): failed once and passed on re-run on PRs #398 and #409. Not investigated.
4. **Artifact sweep not yet observed in Production.** It becomes active now that both variables are set; it will delete run `a5161f47`'s bundle and manifest and keep run `20407283`'s.
   Evidence: `lib/services/test-requests/factory-artifact-store.js` `sweepFactoryArtifacts`; `pages/api/cron/maintenance.js`.
5. **Verify the test-request email fix in the browser on 1003303** (carried from the S561 handoff; PR #392 is MERGED [VERIFIED via GitHub]). Not done this session.
6. **Office Mac**: run `docs/plans/briefs/OFFICE_MAC_SYNC_BRIEF_2026-10-01.md`. Its `.env.local` now also needs `FACTORY_BLOB_RW_TOKEN` if the artifact download script is to run there. Not done this session.

### Owner Decision Needed

1. **Form v2 scope**: a way to abandon or resume a stuck run (none exists), status-setter `rerun`, bind-reviewer, slot PATCH, retire. Evidence: admin form plan, decision 7; runbook, *What "cannot continue" leaves behind*.
2. **Request 1003308**: leave as a partly built marked test record, or clean up by hand. Its run cannot be resumed.
3. **PR #390** (refactor survey) is OPEN and on hold by the owner [VERIFIED via GitHub]. No next refactor is selected.

### Parked

1. **Layout checks never done in a browser**: long-label wrapping, selected-row tint, narrow window. Re-open the next time the form is used.
2. **Stray Production/Preview variables** `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` from connecting `wmkf-factory-private`; neither is read. Disconnecting the store should remove them (unverified).

### Verify Before Acting

1. **D2: retire the home Mac's local ledger copies** and scratch databases (carried from S560/S561). Destructive: list and confirm first; not revalidated this session.
2. **Worktree and branch hygiene**: `/Users/gallivan/Code/WMKF_Apps-factory-form` is on merged branch `claude/factory-xlsx-package-verify`; remote branches `claude/factory-admin-form-slice1..3`, `-slice2b`, `claude/factory-form-stop-logging`, `claude/factory-xlsx-package-verify`, `claude/factory-status-already-set-copy`, `claude/factory-status-history-arrow` are merged. List and confirm before removing anything.
3. Requests 1003301–1003303, 1003308 and 1003310 are tracked Factory runs in `managed-ledger/ledger_prod`, not cleanup residue.
4. The materials lane section below was written by another session and was not revalidated here. `main` history shows PRs #404 and #407 merged since [VERIFIED via `git log`]; PR #405 is open.

### Do Not Reopen Without New Decision

1. The form never offers the GoVerify bypass; a Preview rehearsal therefore ends at `create_request`.
2. A sent create is never re-sent, and an uploaded file is never re-uploaded, on retry.
3. No message text in the ledger; stops are diagnosed from the function log.
4. PR #397's scope is complete; PR #390 stays on hold (refactor lane).
5. Delegated cadence for this lane: Fable orchestrates, Sonnet builds and reconnoiters, Opus reviews, Fable final review, Codex adversarial to satisfaction; no tail-chasing. Runtime merges need explicit owner authorization.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` | Operating the form: needs, stops, retries, CLI limits, turning it off |
| `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md` | Plan, slice build records, rehearsal and slice 4 results |
| `docs/atlas/postgres-test-request-runs.md` | Ledger ownership; the form as second writer; the artifact store |
| `lib/services/test-requests/admin-run-service.js` | The form's service: lookup, Confirm, advance, status |
| `lib/services/test-requests/bundle-file-copy.js` | Document copy, integrity modes, settle check |
| `shared/components/admin/TestRequestFactorySection.js` | The form's UI entry point |
| `scripts/probe-sharepoint-download-stability.mjs` | Owner-run: download stability and package diff of SharePoint files |

## Testing

```bash
npx jest --testPathPatterns "test-request|ledger|maintenance|rehearse|admin"
npx jest --testPathPatterns "bundle-file-copy|run-runner|docx-package"
# Owner-run, read-only, production ledger:
node scripts/rehearse-test-request-sandbox.mjs --target=production --run-inspect=<runId>
```

No claim-evidence observation row was added: the pilot report recorded no eligible plan/design documentation edit for this session.

## Materials feature branch handoff — 2026-10-02 (separate lane)

[VERIFIED via owner read-only probes] The base applicant Site Visit / Research Presentation background upload feature is merged in PR #402 and deployed in Ready Production deployment `dpl_HejNdRssKwXEZmjMpGuRXXZ3WBZb` (commit `1ec1d93265fa19357372c5c75fa2dff9501e8406`). Migration 060 was applied at `2026-10-02T17:08:20.197Z`; schema readiness is `on`, admission is `off`, virus scanning is `true`, and the 17:20 UTC worker run found an empty queue. No job was admitted. Keep the synchronous applicant finalize behavior until the owner separately approves activation.

[VERIFIED via source/tests] Activation follow-ups are on branch `codex/materials-activation-readiness`, PR #404 tracks final checks. The guarded Production recovery CLI is source-built in `3fdd04686`/`e5837db5e`; 26 focused operator unit tests and 16 local PostgreSQL tests passed, and Sol approved. Production mode requires the fixed local-shell `MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL`, explicit target/host/database and exact job/action confirmations, verified TLS, read-only inspect, sanitized output, and connected database/public-schema checks inside the resolver transaction. No Production CLI command was run; only the owner runs any Production inspection or recovery.

The exact-root recursive-reader filter and five callers are source-built in `2bfa5f590`. Eight focused suites passed 104 tests and one snapshot; Sol and parent approved. It removes only exact same-request portal-produced Superseded drive/item identities beneath canonical Site Visit materials roots, preserves current/manual identities, and omits affected candidates with a sanitized error when registry/drive evidence is incomplete. Fable approved the runtime through `2bfa5f590` with no required fixes. The dependency-only matcher extraction in `45fc84144` passed 26 focused suites (483 tests, one snapshot), including the prior CI import-failure suites and plain Node CLI; Sol approved the extraction; Fable approved the bounded dependency fix in `45fc84144` with no required fixes; a later cleanup nit was deferred. PR #404 tracks final checks; verify required checks on its current head before merge. Neither follow-up is deployed. Do not enable background admissions or run a Production recovery mutation as part of this handoff.

[VERIFIED via prior GitHub Actions] PR #402 final CI passed 1,204 suites, 19,529 tests, five snapshots, and seven PostgreSQL suites with 114 tests. Verify required CI for PR #404 on its current head before merge; do not treat PR #402 results as evidence for these follow-ups. Full provider/browser 500 MB rehearsal remains a separate release task. No production milestone was added on this source branch; deployment, admission, and recovery mutations remain out of scope. Preserve unrelated Factory and reviewer-refactor context above; this handoff replaces only the previous materials-lane section.
