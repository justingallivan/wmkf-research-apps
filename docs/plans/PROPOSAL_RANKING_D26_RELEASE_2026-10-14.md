# Proposal Ranking — D26 production release plan

Date: 2026-10-14. Status: **PLANNED; not approved for production mutation or promotion.**
Owner decisions: launch for D26; Beth Pruitt and Justin Gallivan must have simultaneous facilitator access.
This release plan supplements the October 13 design/implementation plan. Shared facilitation is a new requirement, not a claim about the tested implementation.

## Scope and evidence boundary

Change surface: integrate the tested assessment/reveal workflow with current main, add two-facilitator authorization, and deliberately activate a fresh D26 production round.
Entry points: suite app registry, `/proposal-ranking`, `/api/proposal-ranking`, Admin facilitator settings, schema tooling and release operator actions.
Persistence: existing Dataverse cycle/round/list entities and system settings; existing Postgres identity/role and accepted-sentiment sources are read dependencies.
Consumers: private preparation, shared discussion, history, workbook, Admin, source previews, tests and release documentation.
Prior findings: shared-round conflicts affected independent PD saves; bounded private retry fix was tested and owner-confirmed in the dedicated Preview. Its receipt is `docs/audits/PROPOSAL_RANKING_PD_SAVE_CONFLICT_2026-10-14.md`.

No production writes, schema apply, settings change, grant change, round cancellation, main merge or production deployment is authorized by this planning pass. Read-only production probes were performed.

## Verified baseline

| Claim | Evidence | Status and limitation |
|---|---|---|
| Suite already has an app entry and explicit ranking grant | `shared/config/appRegistry.js`; `pages/proposal-ranking.js`; `pages/api/proposal-ranking.js` | VERIFIED source. No separate product/site is needed. Registry feature copy still describes the incumbent composite workflow. |
| Candidate is `2bb11ac1e` on `codex/ranking-pd-save-conflicts` | Git log/status; prior dedicated Preview deployment `dpl_G41fPqnqwLYVzS2sxE6ATGYiL5RE` | VERIFIED. Latest copy change is included. |
| Current remote main is `63a09b740eca2874add39a4a82b9a1537514f32b` | `git fetch origin`, `git log`; Vercel production listing | VERIFIED 2026-10-14. Main has 8 commits absent from candidate; candidate has 33 absent from main. |
| Merge is mechanically clean | `git merge-tree --write-tree origin/main HEAD`, exit 0, tree `2fcb1e74f6db0dabe52b81001c9d575dcdc3c418` | VERIFIED conflict check only. No branch was merged; merged runtime/build remains untested. |
| Production deployment is Ready on that main SHA | Vercel project `prj_56SJKzNer1aV38kKVoP8tl3X0lf3`, deployment URL `wmkfresearchapps-5egsmi2j8-justin-gallivans-projects.vercel.app` | VERIFIED deployment metadata, not a signed-in health test. Record the then-current deployment again immediately before release. |
| Production has one active D26 v1 round | GET-only `scripts/probe-ranking-d26-release.js`, 2026-10-14T18:19:30Z | VERIFIED: `83a45de0-8fcc-4e34-8b23-10af7636bf8d`, 23 frozen proposals, Justin facilitator, seven draft PD lists, one submitted PD list, two collecting meeting lists. No ranking contents printed. |
| Production v2 fields are absent | Same probe: exact Memo attribute endpoints returned 404 | VERIFIED: `wmkf_workflowjson` expected 65,536 and `wmkf_assessmentjson` expected 524,288. Full wave32 metadata/search-exclusion/privilege revalidation is still required. |
| Application identity has the named ranking role | Same probe, WhoAmI and role association GET | VERIFIED role assignment only, not exhaustive privilege proof. |
| Default production facilitator is Justin | Same probe, system setting and enabled user lookup | VERIFIED; Beth is not currently co-facilitator. |
| Four staff have ranking grants | Same probe | VERIFIED: Beth, Justin, Jean Kim, John Sader. Only Justin has an explicit Meeting Tracker grant among these four; fresh profile mapping and superuser roles were not probed. |
| D26 has 25 ordinary Phase II Pending Research requests, 23 after the trial cutoff | Same probe; `trial-cutoff.js`, source adapter | VERIFIED: two excluded by number >=1003220; no missing/malformed numbers, leads, amounts or currency references. This is not full review-scale/funding/current-source validation. The probe queries pending requests only; runtime scans all cycle statuses before cutoff validation and unexpected-status diagnostics, so this count does not prove opening will succeed. |
| v2 creation flags are not configured in production metadata | `vercel env ls production --project wmkf_research_apps --scope justin-gallivans-projects --format json` | VERIFIED absence of `PROPOSAL_RANKING_WORKFLOW_V2` and `PROPOSAL_RANKING_V2_SCHEMA_READY`; existing ranking/isolation/interlock keys present. Values and effective deployed environment NOT VERIFIED. |

Probe usage: `node scripts/probe-ranking-d26-release.js /absolute/path/to/.env.local`.
The script fixes the registered production hostname and enforces preview-class read-only production access. It uses only GET for Dataverse; OAuth token acquisition is authentication, not a data mutation. Output includes bounded metadata and dependency telemetry, never tokens or private assessment content. Local credentials/flags do not prove deployed production flags.

## Decisions still pending

1. **Pre-reveal visibility:** current source returns all preparation to the facilitator (`workflow-service.js`, `publicView.facilitatorLists`). The earlier conversational promise that all preparation is private until reveal was inaccurate. Owner was asked whether both facilitators retain that visibility or whether preparation becomes strictly own-only until reveal. Do not silently broaden or remove this access.
2. **D26 pool:** owner was asked whether to retain the 23-proposal trial cutoff or include all 25 ordinary eligible proposals. Do not remove `trial-cutoff.js` or change its callers until decided; the cutoff is live in the source reader and probes/tests.
3. **Existing trial retirement:** propose retaining and closing the existing v1 round, then opening a fresh v2 round. One submitted list exists. Before executing, show the exact old round, retained data, new pool/roster and effects to Justin. No destructive erase or automatic conversion of v1 rankings to grades/confidence.
4. **Sentiment readership:** verify active profiles and superuser status for all four PDs. If they lack access, propose either explicit Meeting Tracker grants (which grant more than sentiment) or a narrowly reviewed ranking-reader authorization change. Do not silently grant another app or bypass its current reader guard.

## Proposed two-facilitator contract

PLANNED engineering design, subject to implementation review:

- Store a bounded, canonical, duplicate-free array of system-user GUIDs in a new versioned default-facilitator setting. Configure exactly Beth and Justin for D26. Do not hard-code personal identities in runtime code.
- Capture the resolved facilitator set in the v2 round's server-owned workflow JSON at opening. Existing round membership remains stable when defaults change. Keep the scalar legacy column for v1 compatibility and designate its meaning explicitly (primary/legacy facilitator); it must not override the v2 set.
- A missing new configuration may use the old scalar setting for backward compatibility. A present but invalid/empty configuration fails closed. Likewise, old v2 rounds lacking the new set may use their scalar; malformed new-format sets must not fall back. Validate both user enablement and ranking app grants before opening.
- Resolve membership once through a shared server helper for preview/open/read/history/export and transitions; audit every raw `wmkf_facilitatorsystemuserid` consumer. UI capability rendering follows the server response, never a supplied user ID.
- Both facilitators may open, reveal, reopen preparation, reset collective work and restart the round. Being a facilitator adds no vote; each participant owns only their own preparation writes. Group-edit permissions for other participants remain the agreed existing behavior.
- Preserve the complete set through restart. An active-round membership change, if supported, must be a separate authorized, ETag-fenced, attributed policy change that invalidates stale confirmations. Default-setting edits alone must not silently change an active round.
- Explicitly handle legacy `transfer`, `cancel`, `excuse`, `save`, `submit`, `generate`, `edit`, and `publish` actions on v2 rounds. Dispatch by persisted snapshot version before mutation. A scalar-only transfer must not appear to succeed while leaving the authoritative v2 set unchanged.
- Preserve real actor attribution in every write/receipt/history entry. Do not substitute the primary facilitator ID for the acting user.
- Reuse the round ETag plus list/coordinator ETags and atomic changesets. Simultaneous shared actions produce one winner and a visible stale/conflict response. Do not extend the private-save automatic rebase to shared actions. Unknown outcomes retry the same operation identity and payload.

Files: `config.js`, `preview-service.js`, `service.js`, `workflow-service.js`, `workflow.js`, adapter projections if needed, Admin API/UI, `ProposalRankingApp.js`, `AssessmentWorkflow.js`, API contract and targeted tests. An additional Dataverse field is not currently proposed for facilitator membership; validate the workflow field and schema compatibility before committing to that choice.

## Implementation and release sequence

### 1. Integrate and settle source contracts

- Preserve the dedicated ranking Preview and existing worktree; prepare a release branch from the tested candidate with current main integrated. Re-run the merge check against the actual current head before merging.
- Resolve the pending privacy/pool decisions. Validate exact D26 source preview including review scales, ordinary/synthetic markers, identity/profile linkage, currency, funding data and roster. Source reads must remain read-only in production shadow mode.
- Implement shared facilitation and version-safe mutation dispatch. Update Admin selection and suite feature descriptions. Reconcile the design, API contract, Atlas, implementation plan, service catalogue and release receipt to the accepted behavior; historical receipts remain dated.
- Audit the dedicated-test changes in shared identity mapping, app-grant service, source adapter and deployment policy. Prove production excludes fictional identities, synthetic reviews and sample presentation/sentiment. Test malformed test configuration as well as unset/off.

### 2. Prove behavior in sandbox and integrated preview

- Both Beth and Justin independently sign in and can perform facilitator actions; Jean/John cannot perform facilitator-only actions; revoked/disabled/unmapped actors fail closed.
- Verify chosen pre-reveal privacy at API and UI, not merely hidden controls. Include a populated other-PD assessment in negative tests.
- Race Beth vs Justin on open, reveal, collective reorder, reset and restart. Race readiness/reopen with reveal and private saves across PDs. Prove no partial commit, duplicate reveal, lost edit or misattributed actor.
- Exercise definite 409 recovery versus network/timeout ambiguity; old-tab operations after reset/restart; exact operation replay after later edits; malformed memberships; unknown versions; legacy action payloads against v2.
- Rehearse at the actual D26 size (25 or chosen pool, four PDs), including saved reveal, workbook and retained history. The prior 100/12 memory fixture is not evidence of maximum live transaction support.
- Confirm genuine accepted/current sentiment for an authorized PD; stale/withdrawn/unavailable sentiment must not become sample content or block core ranking. No new AI generation is required by the ranker.
- Run ranking and cross-cutting identity/policy tests, lint, types, production build and relevant gates with each self-test sequential. Include API-route, Atlas, document/fact consistency, status, DAL/context and schema/privacy boundaries; inspect package scripts for exact current gate names.

### 3. Prepare production, without opening the round

- Re-probe full ranking schema, alternate keys, app-role privileges, staff privacy/search exclusions, flags, active profiles and source preview. Read current v1 data again, because staff may have changed it since this inventory.
- Apply additive wave33 with supported schema tooling only after exact preflight/review. Verify lengths/readback. Do not grant ordinary staff direct table access.
- Deploy the integrated v2-aware candidate with v2 creation disabled; record this deployment as the v2-compatible rollback floor after signed-in v1 read verification. The old main deployment is not a safe fallback after v2 data exists.
- Configure the reviewed Beth/Justin setting and readiness only after dependencies pass. Keep `PROPOSAL_RANKING_TEST_ENABLED` unset/off in production and both Dataverse protections on. Verify effective deployed values, not local copies or key presence.

### 4. Deliberate D26 cutover

- Justin approves the exact release and retained v1 retirement after seeing its current summary. Current v1 cancel retains lists and clears the coordinator atomically; it refuses published rounds. Recheck this precondition immediately. If now published, stop and design a retained replacement path; do not bypass the guard.
- Close the old round using the supported operation, preserve its ID/history, and verify readback before opening. If opening fails, keep an explicit recoverable waiting state; do not erase or reinterpret old data.
- Enable v2 creation only after the compatible deployment/schema/settings are verified; open the fresh D26 round from a freshly confirmed source preview. Confirm the exact approved proposal pool, four-PD roster and both facilitators before any assessments are entered.
- Verify independent staff sign-in, own-list save/readback, both facilitators' access and the non-facilitator denial. Avoid performing a real reveal/reset merely as a smoke test after colleagues start work.
- Record exact commit/deployment, flags, setting revision, round ID, expected durable writes, checks, owner approval and rollback operator in a release receipt.

## Rollback and operational limits

- Before v2 data: revert candidate deployment if needed; retain additive schema and old data.
- After v2 data: first pause access using a verified app-level readiness control if writes must stop, then promote the recorded v2-compatible deployment. Verify that the selected control actually blocks reads/writes before relying on it.
- `PROPOSAL_RANKING_WORKFLOW_V2` gates creation, not existing v2 access: `getRoundResponse` dispatches on stored snapshot version, and workflow actions dispatch independently. Turning it off is not a v2 emergency stop.
- Code rollback does not revert accepted assessments, revealed versions, settings or the active-cycle pointer. Reconcile these explicitly; do not restore old snapshots over new work. Never restore v1 code as the rollback floor after a v2 round is created.
- Observe authorization errors, 409 frequency, uncertain operations and save failures during initial use; log metadata, not private rankings. Provide a named operator and stop/recovery steps to Beth and Justin.

## Contract-reconcile review status

Whole flow: source traced page/client → guarded API → service/reducer → ETag changeset → response/UI; proposed facilitator-set implementation is not built.
Partial success: adapter commits one changeset; actual two-facilitator race and D26-size persistence remain required tests.
Async/stale state: existing private retry has own/scope checks; new shared-role and policy changes require fresh race tests.
Helper extraction: proposed membership helper must preserve v1/v2 and malformed/missing differences.
Durable surface: additive wave33 absent in production; proposed setting/JSON contract needs docs, validation and tests.
Doc reconciliation: this is a bounded release inventory, not a claim that all older ranking documents are current. Accepted new decisions must be reconciled during implementation.
Symbol fan-out: scalar facilitator appears in config, preview, opening, v1 service, v2 load/reducer/restart and UI; all must be reviewed when implementing the set.

Verdict: **PLAN DRAFT — production promotion blocked by named decisions, implementation, schema and acceptance checks above.** No production-readiness claim is made.

## Inspection incident

A documented `vercel env run` inspection unexpectedly entered the CLI deployment path. The suite deployment attempt failed validation; a second attempt from `/tmp` created an empty `tmp` project and failed before deployment. The accidental project `prj_iTJjzHqGWxdfPltq3mpkmCHlp4Uc` was removed with a confirmed CLI success. A fresh production listing proved the same Ready production URL/SHA. No production flag values were established by these attempts; do not use `env run` for this release's inspection.

## Planning verification

A fresh read-only agent review found no blocking errors in the scoped plan/probe, and confirmed the source contracts for scalar authorization, pre-reveal visibility, version dispatch, retained cancellation and rollback. It did not independently repeat the live probe. The inventory limitation about pending-only source counts is recorded above. Document-currency, symbol-reference and fact-consistency gates and their sequential self-tests passed. Syntax checking passed; final probe lint is recorded in the commit verification. This is planning evidence, not runtime release acceptance.
