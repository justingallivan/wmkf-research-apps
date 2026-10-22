# Remaining active-memory inventory and repair audit — 2026-10-22

**Whole-read inventory complete; all-claim verification AUDIT INCOMPLETE.**
Sol agents whole-read the remaining 176 active memory leaves in three disjoint
batches (75 operating/feedback, 55 reviewer/finance, 46 application/strategy).
Together with the earlier named samples, all 272 active leaves have a recorded
whole-read disposition. This is not a claim that every sentence, live state,
external product behavior, or historical receipt was freshly verified.

Luna owns the documentation repairs; the parent checks the actual diffs and
material source branches. No live system actions, network probes, authentication,
process termination, environment changes, migrations, worktree changes, sends,
paid calls, or pushes are part of this pass. The owner-review-burden leaf and the
unrelated critique/output artifacts remain untouched.

## Contract and evidence

Sweep Mode B / contract-reconcile review: memories are the instruction entry
points, repository docs are durable persistence, and later agents are consumers.
Source and explicit owner decisions establish truth; dated prose does not prove
present deployment, roles, published prompts, prices, or tenant configuration.
Large source files were read in relevant logical regions, not claimed whole-read.
All assigned memory leaves were read whole. The companion coverage CSV is the
exact per-leaf inventory, including earlier samples and bounded dispositions.

| Finding | Evidence / disconfirming check | Documentary repair and preserved boundary |
|---|---|---|
| Broad Git process kill and lock-to-ref replacement | `env-broken-git-autogc.md` active recovery assumes ownership and that `main.lock` is the correct ref. Current preservation and destructive-carryover rules require actual ownership and current evidence. | Preserve S175/July observations as history; no broad kill or ref replacement recipe. Current recovery requires exact repository/process/lock ownership, ref/reflog evidence, and explicit repair scope. |
| Broad config staging / hard reset | `claude-config-git-sync.md` names an allowlist but then prescribes `git add -A` and first-install `reset --hard`. Current ownership rules contradict that general recipe. Actual external configuration was not accessed. | Stage only owned allowlisted paths; preserve existing configuration and inspect actual state. Do not infer present remote/hooks/OAuth state from July receipts. |
| Historical auth bypass promoted to current smoke setup | `docs/AUTHENTICATION_SETUP.md:102,250-255` documents normal localhost auth. `lib/utils/auth.js:311-315` bypass returns before CSRF/session/profile checks. | Preserve S204 smoke history; no blanket localhost-impossible claim or routine auth bypass. Actual tenant redirect registration remains UNKNOWN. |
| Mandatory cache clearing and repeated parallel load | The Jest-cache memory Recall limits diagnosis, while its tail demands clearing for every citable run and unspecified repeated parallel runs. Explicit load-ceiling policy applies. | Bound diagnosis and rerun to actual evidence and a finite task-appropriate budget; cache causation remains unproven. |
| Staleness warning clears only through literal marker | `document-guards.js:359-366` verifies one-line path/marker; `session-lifecycle.js:200-203` also handles removed document or removed source mention. | Explain mechanical scope without suggesting deleting prose to silence a warning. A marker is not evidence that substantive reconciliation happened. |
| Old answer-snapshot implementation pointer | Thin submit route now calls service (`pages/api/external/review/[token]/submit.js:33,75`); lookup-value constant/builders live in `lib/dataverse/adapters/review-answer.js:58,262-279` and `lib/external/review-answer-snapshot.js:70,79-84`. | Update source pointers; preserve value-attribute alternate-key contract. No external upsert proof was run. |
| Drop ledger tables to replay changed migration 054 | `lib/db/ledger-migrations.js:127-135` refuses changed tracked checksums and requires forward migrations. `tests/integration/test-request-run-ledger.pg.test.js:17-28` requires scratch/local storage; cleanup scopes generated IDs/schema. | Preserve local setup history; no replay/drop directive against durable/shared ledgers. Disposable fixture setup is separate from existing-DB migration. |
| Delete queued jobs before workflow recovery | `transcription-pilot/store.js:579-599` and `workflow-dispatch.js:96-140` implement state-qualified exact-run recovery, not general queued-job deletion. | Preserve S586 observed deployment pinning/recovery/billing result; require exact inventory, state, ownership, and authorized recovery. No universal no-second-charge promise. |
| Removing UI proves backing route is unused | Old S280 connectivity and SESSION_PROMPT next-step text do not establish present callers/consumers. Source search did not close retirement scope. | Preserve rollout intent; require present source/caller/consumer and owner-scope checks before removal. No code retirement occurs here. |
| Direct app Dataverse writes remain future | `execute-prompt.js:156,281-282` calls persistence; `persistOutputs:986-1083` writes through `grantRequestAdapter.updateById:1065-1071`. | Distinguish source-built direct writes from dated permission/PA observations; preserve original backend vision as historical planning, not unmet write-access prerequisite. |
| Conceptual target presented as implemented architecture | Existing prompt-storage memory separates Vercel Executor from dated PA absence. Reviewer lifecycle source exists; intake remains owner-parked on GOApply. | Preserve two-axis/backbone design principles, label PA/conformance targets and original gap statements appropriately, and route current state to source/Atlas/canonical contracts. |
| Search results are browser-only before Save | `useReviewerDiscovery.js:267-365` POSTs and reads back; roster service `:338-415` validates/prunes; `reviewer-roster-store.js:120-153` upserts operational state; `useReviewerRoster.js` reloads buckets. | Separate successfully retained operational pre-save roster from canonical saved suggestions; failed retention may remain ephemeral. Preserve no person paper-list policy and display-only smoke's explicit no-POST fence. |
| BILL onboarding and auth-only Postgres remain universal | Fragmentation leaf current instructions conflict with July 12 BILL tabling and approved contact/address flow; operational roster persistence above disproves auth-only request state. | Preserve banking/routing-PII prohibition and dated S158/S216/backfill/drop evidence. Do not re-enable BILL or rebuild the canonical-domain migration. |
| Automatic next-cycle BILL promise | Address memory Ground truth promises vendor payload next cycle while its own July 12 decision makes that premise moot. | Preserve required address/phone and opt-out validation; BILL resumption needs a new owner decision. |
| Stale roadmap / security / prompt / harness snapshots | Four memories mix two dated security phases, already-shipped matching, August prompt-version/smoke state, or June hook counts with current operating guidance. | Separate explicit history and current routing without asserting fresh GitHub visibility, live prompt version, current vendor hook semantics, or compliance-code absence. Preserve decisions, not old deployment assumptions. |

## Safety claims selectively checked and retained

- Researcher adapter origin/ETag/overlapping-anchor guards and automated
  confirmed-to-probable containment: `researcher.js:399-499`. The sticky-confirmed
  note accurately limits itself to adapter containment; versioned capture is a
  distinct path, not a reason to loosen that guarantee.
- Accepted institution linking requires trusted acceptance, complete active
  candidate scans, unique normalized exact match, fill-empty parent semantics,
  and ETag conflict handling. Existing owner policy remains unchanged.
- Hidden legacy review-upload UI does not establish dead server code. Current
  writer checks shared receipt authorization and uses its authorizing ETag;
  no route/field deletion is authorized by hiding the control.
- Settled app-level org-open merge/download authorization remains preserved.
  Request-bound mutation exceptions require their own source trace.
- Behavioral feedback norms remain owner policy, with incidental implementation,
  pricing, counts, and machine-state claims bounded rather than timestamp-refreshed.

## Remaining prioritized source-verification backlog

These are actionable investigations, not proven runtime defects or permission for
live probes. The CSV identifies leaves whose claims were retained without a full
current contract trace. Owner holds stay in force.

| Priority | Investigation / evidence gap | Required result |
|---|---|---|
| P1 | PI fallback versus institutional-officer role — source conflict confirmed | Follow-up [PI/authorization audit](pi-identity-request-mutation-audit-2026-10-22.md) traced the unconditional fallback and consumers, including unresolved contact-name rejection. Owner role semantics remain settled; no approved legacy exception found. Runtime repair and affected-population assessment remain pending; documentation now states the conflict. |
| P1 | Narrow request-mutation authorization — bounded source trace recorded | The [follow-up audit](pi-identity-request-mutation-audit-2026-10-22.md) traced withdrawal/release, closeout and due-date routes through session actor, server ownership, lead-PD/superuser gate, ETag writes and UI. Due-date request pinning and concurrent ownership/context changes retain explicit follow-ups; no confirmed bypass or fresh hosted-state proof. |
| P1 | Identity/COI/exclusion and provenance — bounded follow-up recorded | The [identity/COI/referral audit](identity-coi-referral-provenance-audit-2026-10-22.md) distinguishes Find promotion, manual Add/Refer, address authority, COI exemptions and referral/acknowledgement evidence. It confirms a shared-person field/decision write-ordering gap; sibling writers, full consumer proof and affected populations remain open. |
| P1 | Action-specific read-only exceptions — Awardee trace recorded | The [Awardee audit](awardee-read-only-exceptions-audit-2026-10-22.md) establishes bounded read/render contracts for Preview email, Copy website HTML and Cycle export, preserving auth and owner scope. Late browser effects and partial export completeness remain follow-ups. The [remaining-read audit](remaining-read-only-exceptions-audit-2026-10-22.md) traces reviewer GET, proposal cache, IRS lookup/refresh and distinct Factory rechecks; matrix/roster/export contract gaps remain explicitly open. |
| P2 | Current prompt publication and mutable output policy | Compare governance/Executor/truncation claims with local source and published-row evidence only when separately authorized. Record model, effort, budget and live version as UNKNOWN until proven; do not reseed or republish. |
| P2 | Current enforcement coverage | Derive registered gate roots, syntax, exemptions, hooks/CI and error behavior from current source; whole-file reading or a green bounded gate is not universal coverage. |
| P2 | Tool/platform and local-machine contracts | Validate CLI flags/log schema/env-presence-versus-value behavior, config sync and database restore constraints when needed. Keep dated observations; no global settings or credentials changes from memory alone. |
| P2 | Current external state | Tenant schema/roles, published prompts, live flags/deployment/automation/payment populations and provider pricing need a named, authorized read-only evidence plan. This audit performed none. |
| P3 | Structural size debt | Compress large lifecycle/history hubs after facts are reconciled; preserve owner decisions and source authority. Do not delete useful history or tune checker keywords merely to clear advisory flags. |

## Parent review and verification

All 19 assigned memory repairs and the narrow lifecycle-wiki correction have
received parent diff/source review. The parent corrected a missed stale Recall
rule, a negative-list inversion, unsupported extra claims, and overcompressed
historical test/security evidence. The S158 fragmentation/payment sample and
S216/S217 backfill history were compared with the committed originals and remain
unchanged. The owner-review-burden memory remains byte-unchanged.

The final memory-router, fact-consistency, canonical-pointers, doc-symbol-refs,
build-claim-freshness, agent-wiki, harness-framing, doc-currency, agent-invariant,
and docs-catalog checks passed; applicable gate/self-test pairs ran sequentially.
The earlier safety batch also passed API-route and Atlas gates/self-tests and
verified the two JavaScript edits contain comments only. No executable code was
changed in this continuation. The CSV has 272 unique, existing active leaf paths
and no outside-sample row. The active whole-read inventory is closed; all-claim
source and live-state verification remains explicitly incomplete.

Final memory health: **16 advisory flags** across 304 leaves: eight shadow-atlas,
six weak-basis, two oversize-routed; no no-recall or stale-routed flags. The new
shadow-atlas flag names the preserved Git incident/recovery note. The six
weak-basis files are Colima setup, New AI capabilities, Preview rehearsal,
private-repo CI, prompt governance, and identity-resolution Phase 1. Their
historical/current-state limits are visible in the notes; no live data was
refreshed and no checker or keyword suppression was used. Two routed size debts
remain the grantee-email and site-visit-materials handoffs. These advisories are
retained dispositions/evidence gaps, not a claim that sixteen runtime defects exist.

Work is committed locally on `main`; no push or deployment was performed. The
unrelated critique report and `output/` remain untouched.
