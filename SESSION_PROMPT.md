# Session 470 Prompt: Final Writeup Infrastructure

## Session 469 Summary

Session 469 (2026-08-30) shipped durable Executor budget publication and
Initial Assessment restore/Board-snapshot controls, closed their review and
release work, and deliberately stopped before either owner-gated Production
write. The session also hardened the Site Visit recipient-directory unsaved
state, remediated Gitleaks test-token findings, and added a durable prohibition
against launching metered review tools without explicit owner authorization.

### What Was Completed

1. **Site Visit recipient-directory unsaved state hardened.**
   - Newly added unsaved people use warning semantics, the page exposes
     unsaved changes clearly, and browser navigation/history is guarded.
   - Commits `07f350c2` and `df44b3e9`.

2. **Executor budgets moved from tracked literals to durable publication.**
   - Append-only `wmkf_appsystemsettings` revisions
     (`executor.budgets.vNNNNNN`) now own the complete atomic budget document.
   - The superuser Admin editor uses expected-version concurrency and UUID
     request idempotency, validates code-owned ranges and resolved model
     ceilings, and rereads the published revision.
   - Pre-Site and review synthesis consume the latest valid revision; strict
     bounds and the reviewed outage fallback remain in code.
   - Production read proof passed in the safe **No published revision · using
     reviewed code fallback** state. The first publication remains an explicit
     owner action, not required for current behavior.
   - Commits `00b1ed83`, `c465b0fd`, and `f083220d`.

3. **Gitleaks findings investigated and remediated.**
   - Reported values were synthetic unit-test fixtures, not live credentials.
   - Fixtures and narrowly scoped allowlisting now prevent false positives
     without weakening scanning of runtime secrets.
   - Commit `b7863922`; Gitleaks passed on the release PR.

4. **Initial Assessment restore and Board snapshots shipped.**
   - Superusers can restore one exact historical native SharePoint version as a
     new current version. Server-owned pointer/item identity and stale-view
     fences are rechecked; governed bytes and Dataverse metadata are reread.
   - Board freeze creates/reuses a distinct Ready/Board Ready Request Document
     and SharePoint item from the exact selected current buffer. Normalized
     governed Word verification accepts SharePoint repackaging while rejecting
     changed/invalid content. Snapshot rows never move the editable pointer or
     participate in editable activation/supersession/cycle discovery.
   - Claude's adversarial findings around stable-ID verification, `cTag`,
     cleanup ownership, lost-response recovery, and package validation were
     fixed before promotion.
   - Feature/hardening commits `8bd8331c`, `70c1f988`, and `65be41a9`; PR #138
     merged as `c519daf6`. Production deployment
     `dpl_9RVF7gdGtXrFAyLxcG16M1Fa86gK` reached Ready.

5. **Production read smoke and durable sweep closed.**
   - Signed-in Request `1003109` loaded the canonical Initial Assessment,
     Board-snapshot control, and native versions `2.0` / `1.0` with no browser
     warnings or errors.
   - No restore, snapshot, refresh, or external-document action was invoked.
   - Fourteen queue, Atlas, route, strategy, pilot, catalog, memory, and wiki
     surfaces were reconciled to **Production-deployed + signed-in
     read-smoked; writes not Production-exercised**.
   - The owner chose to stop here. Production restore/snapshot proof is deferred
     to an explicitly authorized pre-J27-scale checkpoint rather than being
     manufactured now.
   - Sweep commit on `main`: `b5024ad4`.

6. **Metered-tool authorization made durable.**
   - The complimentary UltraReview run exposed that a metered external review
     could be launched without the owner's request. Repository instructions now
     require explicit authorization before any metered tool/session is started.
   - Commit `cbbb45a9`. Do not reinterpret access or a complimentary credit as
     permission.

### Commits

- `07f350c2` — Warn before leaving unsaved recipient changes
- `df44b3e9` — Cover history navigation in recipient warning
- `00b1ed83` — Add durable Executor budget settings
- `c465b0fd` — Harden Executor budget publication
- `f083220d` — Initialize delayed Executor budgets
- `b7863922` — Allowlist public Executor revision keys in Gitleaks
- `8bd8331c` — Add Initial Assessment recovery controls
- `cbbb45a9` — Require authorization for metered tools
- `70c1f988` — Verify Board snapshots by governed content
- `65be41a9` — Harden Board snapshot recovery
- `c519daf6` — Merge PR #138 to `main`
- `b5024ad4` — Reconcile Initial Assessment Production status

## Next Items

### Current Owner-Selected Delivery

1. **Final Writeup infrastructure by 2026-09-04.**
   Slice 0 reconciliation is complete. Slice 1 is source-built on
   `codex/final-writeup-slice1`, and the owner-authorized Production Wave 22
   apply/readback is 4 exact / 0 absent / 0 divergent. Runtime promotion,
   literal-on readiness, and a controlled superuser transition proof remain
   separately gated; acknowledgement storage and matrix-ready dashboard data
   remain later slices. Editing stays in Word in a separate
   browser window/tab (or desktop Word when Microsoft permits); do not embed an
   editor in the Workbench.
2. **Audience and matrix.**
   The audience is all PDs, PCs, CSO, and President. Include the full
   coordinator matrix, but keep it neutral: no denominator, required count,
   due date, compliance language, or CSO/President sequence. Acknowledgements
   are version-aware; later edits show Updated since review. The responsible PD
   does not self-acknowledge.
3. **Milestone boundary.**
   September 4 means underlying infrastructure and a superuser test path, not
   broad rollout. Ordinary PD review may precede the global persona contract;
   PC backup, broad matrix visibility, and leadership queues stay off until
   role identity and SharePoint access are positively verified. The expected
   `wmkf_requestdocument` staff-role privilege grant remains external around
   2026-09-10.

### Verified Open

1. **Execute the Final Writeup plan in bounded slices.**
   `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md` is owner-approved for
   staged implementation with named identity/persona prerequisites. Slice 1 is
   source-built and its additive Production schema is exact; next is deliberate
   runtime promotion/readiness and a separately authorized controlled proof.

2. **Positive-path funding-history observation.**
   The zero-program-grant branch is Production-proved; the positive sentence is
   probe/test-proven only. Observe the first real generated institution with
   program grants rather than manufacturing another Production smoke.

3. **PD onboarding/posture seeding before the next solicitation cycle.**
   Evidence and checklist: `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md`.

4. **Async PD approval for staff-triggered “sent as me” mail.**
   Evidence: `docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md`.

### Owner Decision Needed

1. **First durable Executor-budget publication.**
   Production safely uses the reviewed code fallback. Publishing revision v1
   is optional and requires an explicit owner action.

2. **Share → Wrap Up no-send fallback and zero-program-grant wording.**
   Decide whether off-app distribution gets a manual transition, and whether
   the zero-program sentence should mention discretionary history.

### External Dependency

1. **WAITING on Connor (~2026-09-10): `wmkf_requestdocument` staff-role
   privilege grant.** After the grant, rerun
   `scripts/probe-write-attribution-census.js`; do not infer success from
   `modifiedby` alone.

### Parked

1. **Initial Assessment Production write proof.**
   Owner-deferred 2026-08-30. Reopen before J27 scale or under a new explicit
   authorization. Prefer Board snapshot first if only one proof is needed;
   use an agreed dummy request and capture exact cross-store readback/cleanup.
   Native Graph restore retains the documented final-call concurrency race.
2. **Reviewer cron-reminders ledger slice.** Merge only after the current
   reviewer cycle ends; migration 038 remains unapplied everywhere.
3. **Preference-matrix slice and PD tutorial refresh.** Reopen only after the
   reminders-ledger promotion.
4. **Invitation-link strictness.** Deliberate post-cycle decision; current
   duplicate-identical-token and trailing-punctuation tolerance remains pinned.
5. **Public git history rewrite and reviewer cleanup.** Both remain owner-gated.

### Verify Before Acting

1. **Phantom co-PI residual cleanup.** Production writes require owner
   confirmation and a fresh read-only preflight; importer prevention remains
   Connor-owned.
2. **Logistics PATCH retirement.** There is no in-app write caller, but the
   service/validation remain intentionally live. Re-grep before retirement.
3. **Request `1002379` as a future smoke vehicle.** Re-run the exact inventory
   before and after any authorized mutation; do not request Activity delete
   privileges.

### Do Not Reopen Without New Decision

1. Do not run Initial Assessment restore or first Board snapshot merely to
   close a proof checkbox; the owner explicitly selected the current stopping
   point.
2. Do not launch UltraReview or any other metered tool/session without explicit
   owner authorization, regardless of available access or credits.
3. Recipient-directory members remain menu choices only; they are never
   automatically added to email drafts.
4. Do not merge the parked reminder slice mid-cycle or tighten invitation-link
   behavior during the current reviewer cycle.
5. Do not rerun the Request `1002852` hard-failure smoke or resurrect removed
   Site Visit logistics/calendar UI without a new owner decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/CURRENT_WORK_QUEUE.md` | Canonical delivery priority and owner-deferred write proof |
| `shared/config/executorBudgets.js` | Budget bounds, descriptions, and reviewed outage fallback |
| `lib/services/executor-budget-service.js` | Append-only read/publication contract |
| `pages/api/admin/executor-budgets.js` | Superuser budget read/publication route |
| `lib/services/initial-assessment/controls-service.js` | Restore and exact byte-copy Board snapshot orchestration |
| `pages/api/workbench/initial-assessment/restore-version.js` | Superuser native-version restore route |
| `pages/api/workbench/initial-assessment/board-snapshot.js` | Superuser retained Board snapshot route |
| `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` | Pilot evidence and remaining write-proof boundary |
| `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md` | Reviewed, owner-gated Final design |

## Testing

Release verification completed before and after PR #138 merge:

```bash
npm test -- --runInBand
# 716 suites / 9,205 tests passed
npm run build
# webpack production build passed
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:route-service-boundary && npm run check:route-service-boundary:self-test
npm run check:atlas && npm run check:atlas:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npm run check:canonical-pointers && npm run check:canonical-pointers:self-test
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test
npm run check:docs-catalog
```

All PR/post-merge checks passed, including Claude review, Gitleaks, Jest,
Semgrep, Trivy, Vercel, and Playwright. The stop-time claim-evidence report was
unavailable from local metadata, so no pilot observation row was added.
