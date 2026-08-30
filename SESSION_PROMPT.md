# Session 469 Prompt: Persist Executor Budgets as Admin-Editable Settings

## Session 468 Summary

Session 468 (2026-08-29) promoted three completed workstreams: the Staff
Deliberations distribution-history UX, a curated Site Visit materials-recipient
directory, and the error-message/operational-event reliability branch. The
recipient directory then received an owner-tested Production follow-up that
makes save semantics explicit and expands Contact name search from a silent ten-row
cutoff to a one-request, explicitly bounded 50-result flow.

### What Was Completed

1. **Staff Deliberations history UX merged and deployed.**
   - Distribution history groups by calendar day with Today/Yesterday/date
     headers and marks self-addressed sends as neutral `Test send` entries.
   - Commit `90d0f10e`; GitHub/Vercel status succeeded at deployment
     `dpl_87JFB8EWD2nzwTiibVX4akKXm1rR`.
   - The same branch added the reviewed Final Writeup Review plan. It remains
     plan-only and owner-gated; see Owner Decision Needed below.

2. **Curated Site Visit recipient directory shipped to Production.**
   - Superusers curate a maximum of 50 recipient-menu entries from active app
     staff plus existing Dataverse Contacts categorized as Consultant or Board.
     The Dataverse setting stores references/categories only; names and email
     addresses resolve live. Search never creates or edits a Contact.
   - Workbench senders choose from that menu per email; configured recipients
     are not added to drafts automatically. Free-form composer behavior remains
     unchanged and the directory is an affordance, not an authorization gate.
   - Initial implementation/hardening: `7d27ac47`, `0e1d7de5`, `11923c4a`,
     `88ebdaee`, `e6859356`.
   - Production follow-up `5792df71` + `07a7f50e` makes the local draft state
     explicit (`Added — unsaved`, `Unsaved changes`, `Save changes`, `Already
     saved`) and performs one bounded 51-row Dataverse name probe to return at most
     50 matches plus an explicit truncation signal. The owner verified a broad
     `smith` search displays the over-50 warning correctly.
   - Merge `c5efa770`; Production deployment
     `dpl_dKmm19nMyX3w6RRjkLNJowiFqFU1` reached Ready and GitHub recorded
     success.

3. **Error-message diagnosis branch merged and deployed.**
   - Dynamics Explorer Graph document search now honors `Retry-After`, retries
     transient failures, serializes same-round scopes into bounded waves, and
     carries cooldown/breaker state rather than misreporting throttled scopes as
     no documents.
   - Admin Operational Events gained grouped repeating incidents, resolve-group
     controls, ABA-safe freshness checks, current-filter refetch after slow
     mutations, and corrected action feedback.
   - Claude Opus findings on transient 408/5xx handling, partial batch success,
     and freshness tokens were fixed before release.
   - PR #137 merge `1c153a35`; GitHub/Vercel status succeeded at deployment
     `dpl_C3Y1w1ubjDjtuwtFWs58RBhkQu5H`.

### Commits

- `90d0f10e` — Merge staff deliberations history UX
- `7d27ac47` — Add curated Site Visit recipient directory
- `0e1d7de5` — Harden Site Visit recipient directory
- `11923c4a` — Address recipient directory review findings
- `88ebdaee` — Fix Site Visit recipient surname search
- `e6859356` — Clarify recipient directory selection UI
- `1c153a35` — Merge PR #137 error-message diagnosis
- `5792df71` — Fix Site Visit recipient directory UX
- `07a7f50e` — Harden recipient directory feedback
- `c5efa770` — Merge recipient-directory UX follow-up to `main`

## Next Items

### Verified Open

1. **Review, gate, and deliberately promote durable Executor budgets.**
   **[SOURCE-BUILT 2026-08-29 on `codex/executor-budget-settings`; production
   deployment/publication not claimed.]**
   The selected contract is append-only `wmkf_appsystemsettings` revisions
   (`executor.budgets.vNNNNNN`). `/api/admin/executor-budgets` is
   superuser-only; publication requires the complete closed schema,
   `expectedVersion`, and a UUID request id, validates code-owned ranges plus
   both current prompts' resolved model ceilings, creates one new revision, and
   rereads it. The Admin Prompt templates panel edits that atomic document.
   Pre-Site and review synthesis read the latest valid revision server-side;
   `shared/config/executorBudgets.js` now owns only strict bounds, descriptions,
   and the reviewed outage fallback. No runtime request accepts budget values.

   Remaining: fresh-agent adversarial review, relevant gates/self-tests, branch
   commit, and deliberate Tier 1 promotion. After deployment, verify the Admin
   read surface. The first production budget publication is an explicit owner
   action; absence safely preserves S466/S467 behavior through fallback.

2. **Initial Assessment library/history controls.**
   `docs/CURRENT_WORK_QUEUE.md` retains Workbench administrator restore and
   milestone snapshots as the next older approved product-control slice.
   Version limits, second-stage recovery, and substantive editing are proved;
   Purview retention and the Edit level's exact Delete flags remain
   owner-accepted-open absent a pressing need.

3. **Positive-path funding-history observation.**
   The zero-program-grant branch is Production-proved; the positive sentence is
   probe/test-proven only. Inspect the first real generated institution with
   program grants rather than manufacturing another Production smoke.

4. **PD onboarding/posture seeding before the next solicitation cycle.**
   Evidence and checklist: `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md`.

5. **Async PD approval for staff-triggered “sent as me” mail.**
   Evidence: `docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md` broader effort.

### Owner Decision Needed

1. **Final Writeup Review plan — implementation go and file-surface approval.**
   `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md` is reviewed plan-only.
   Before build: settle explicit transition actor/time storage, run the
   owner-authorized read-only `systemuser` coverage probe, define the
   PC/leadership persona contract, and sweep the obsolete “copy to a new Final
   file” direction.

2. **Share → Wrap Up no-send fallback.**
   Decide whether visits whose materials are distributed off-app get a manual
   “Move to wrap-up” control or remain on Share.

3. **Zero-program-grant wording.**
   Current sentence mentions no prior WMKF program grant and intentionally does
   not mention discretionary history.

### External Dependency

1. **WAITING on Connor (~2026-09-10): `wmkf_requestdocument` staff-role
   privilege grant.** After the grant, re-run
   `scripts/probe-write-attribution-census.js`; do not infer success from
   `modifiedby` alone.

### Parked

1. **Reviewer cron-reminders ledger slice.** Built on
   `feature/reviewer-cron-reminders-ledger`; migration 038 remains unapplied
   everywhere. Merge only after the current reviewer cycle ends, following
   `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` items 7–10.
2. **Preference-matrix slice and PD tutorial refresh.** Re-open only after the
   reminders-ledger promotion.
3. **Invitation-link strictness.** Deliberate post-cycle decision; current
   duplicate-identical-token and trailing-punctuation tolerance stays pinned.
4. **Public git history rewrite.** Owner-gated under
   `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`.
5. **Reviewer matching/resolver tuning and destructive reviewer cleanup.**
   Remain owner-gated behind measured promotion decisions.

### Verify Before Acting

1. **Phantom co-PI residual cleanup.** Production writes require owner
   confirmation and a fresh read-only preflight; the importer fix remains
   Connor-owned.
2. **Logistics PATCH retirement.** There is no in-app write caller, but the
   service and validation remain intentionally live. Re-grep callers before
   proposing retirement.
3. **Request `1002379` as a future smoke vehicle.** It has no writeup state but
   retains the proposal narrative. Re-run the exact inventory probe before and
   after any authorized mutation; do not request Activity delete privileges.
4. **Queue/docs freshness.** This stop pass reconciled the recipient feature,
   immediate Executor-budget priority, and Session 468 production milestones.
   Detailed older implementation plans remain historical/current-reference
   documents, not implied backlog.

### Do Not Reopen Without New Decision

1. Recipient-directory members are menu choices only; they are never
   auto-added to email drafts.
2. Contact name search uses one bounded Dataverse request and returns at most 50
   rows with an explicit “refine search” warning when more exist.
3. Most-recent funding-history citation remains the newest Research program
   grant; count/sum remain all-program rollups.
4. Do not merge the parked reminder slice mid-cycle.
5. Do not re-run the 1002852 hard-failure smoke or resurrect removed Site Visit
   logistics/calendar UI without a new owner decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/config/executorBudgets.js` | Closed budget schema, safety ranges, descriptions, and reviewed outage fallback |
| `lib/services/executor-budget-service.js` | Append-only read/publish, concurrency/idempotency, validation, and model-ceiling contract |
| `pages/api/admin/executor-budgets.js` | Superuser-only budget read/publication route |
| `shared/components/admin/PromptTemplatesSection.js` | Atomic budget editor plus prompt publication UI |
| `lib/services/execute-prompt.js` | Enforces runtime token/timeout overrides and model ceilings |
| `lib/services/site-visit/curated-recipient-service.js` | Curated directory validation, Contact search cap/truncation, and live resolution |
| `shared/components/admin/SiteVisitRecipientsSection.js` | Admin draft/save/search UX |
| `pages/api/admin/site-visit-recipients.js` | Superuser directory state/search/write route |
| `lib/services/graph-service.js` | Graph search retry/cooldown behavior |
| `lib/services/operational-event-service.js` | Grouped event resolution and freshness contracts |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical delivery priority |
| `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md` | Reviewed, owner-gated Final design |

## Testing

Recipient-directory follow-up verification completed before merge:

```bash
npm test -- --runInBand
# 711 suites / 9,119 tests passed
npm run lint
# 0 errors; 75 existing warnings
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:route-service-boundary && npm run check:route-service-boundary:self-test
npm run check:atlas && npm run check:atlas:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npm run check:canonical-pointers && npm run check:canonical-pointers:self-test
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test
npx next build --webpack
```

The canonical local Turbopack build was blocked by the Codex sandbox's local
port restriction; the webpack production build passed, and Vercel built the
exact merged commit successfully to a Ready Production deployment.
