---
title: Reviewer Workflow Stabilization Directive
domain: reviewers
kind: plan
status: canonical
summary: "Freeze reviewer feature work; prove five golden workflows; repair lifecycle, roster, confirmation, and document selection before data repair."
canonical: true
cataloged: 2026-07-31
last_verified: 2026-07-31
owner: product-engineering
related:
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
  - docs/REVIEWER_CANDIDATE_PROMOTION_REMEDIATION_PLAN.md
  - docs/REVIEWER_MATERIALS_FOLDER_SPEC.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Reviewer Workflow Stabilization Directive

## Controlling instruction for the next session

The reviewer workflow is in **stabilization mode**. Do not resume reviewer
feature development, speculative cleanup, or one-symptom-at-a-time patching.
Do not perform another production roster repair until the runtime recurrence
path is closed. Do not roll back reviewer work blindly: the authoritative
Dataverse invitation/contact state inspected on Request `1002912` remains
intact, and an unverified rollback could restore earlier duplicate-person and
missing-email defects.

The next session must first establish one executable contract across:

1. Dataverse reviewer lifecycle and engagement;
2. the Postgres `reviewer_find_roster` working projection;
3. SharePoint proposal-document selection;
4. applicant-reviewer enrichment and cache identity; and
5. staff identity/contact confirmation.

This directive outranks older reviewer backlog items for the stabilization
session. When it conflicts with an older plan's description of current
behavior, source, live probes, and the Atlas remain authoritative.

## Why the stop is necessary

Ten hours of iterative reviewer work produced meaningful safety improvements,
but the verification method remained too local. Fixes were tested at individual
routes and UI surfaces while the same reviewer could simultaneously have:

- authoritative engagement in Dataverse;
- a legacy terminal Postgres roster row;
- a newer canonical active roster row;
- an orphaned pre-merge roster row; and
- enrichment/cache state tied to a proposal file chosen only in browser state.

That makes another local UI or endpoint fix likely to move the symptom rather
than close the contract. The remedy is a bounded stabilization slice with
executable end-to-end acceptance tests, not another open-ended review loop.

## Verified incident baseline — Request `1002912`

Evidence was established on 2026-07-31 PT / 2026-08-01 UTC through current
source, read-only Production Dataverse/Postgres probes, and Vercel request logs.
No production write was made during this diagnosis.

| Claim | Evidence | Status |
| --- | --- | --- |
| Ralph Isberg's invitation is intact | Dataverse suggestion `fdd093f6-fc68-f111-a826-000d3a3064b7` is `selected=true`, `invited=true`, with invitation email/token timestamps | **VERIFIED** |
| Rotem Sorek's engagement is intact | Dataverse suggestion `522d186b-a68b-f111-ab0f-70a8a59cded0` is `invited=true`, `declined=true`, `selected=false`, with invitation email/token timestamps | **VERIFIED** |
| Find incorrectly resurfaced both as unresolved prospects | Both have canonical active applicant rows in `reviewer_find_roster`, while older terminal rows remain under noncanonical `candidate:` keys | **VERIFIED** |
| Sorek also has stale pre-merge roster state | Active roster key `suggestion:bb81d1f6-fc68-f111-a826-000d3a306da2` points to a Dataverse suggestion that returns 404 | **VERIFIED** |
| Applicant enrichment ignores engagement | `findApplicantRecommendedByRequest` filters on applicant disposition but not selected/invited/declined; `enrichRecommended` processes the returned set | **VERIFIED via source** |
| Ingestion computes but drops selected state | `ensureApplicantRecommended` returns `selected`; `ingestApplicantReviewers` omits it from the response DTO | **VERIFIED via source** |
| Legacy saved keys do not satisfy the terminal cache contract | `rosterFromRows` exposes `savedKeys` only when the stored key equals canonical `suggestion:<id>` | **VERIFIED via source and live rows** |
| Christopher Lima's correction did not commit | Two `PATCH /api/workbench/reviewer-roster` requests returned 409; the roster row retains no staff confirmation or manual contact fields | **VERIFIED** |
| Lima's immediate failure is a key-contract defect | the SSE candidate omitted explicit `candidateKey`; the confirmation request therefore lacked the canonical key required by the authoritative roster lookup | **VERIFIED via source** |
| Proposal selection can destabilize the same cache loop | default loading is strict canonical-file-only; a manual dropdown choice is component state rather than reload-stable navigation state; applicant enrichment keys itself to the chosen file | **VERIFIED via source** |

The incident is therefore a **projection and orchestration regression**, not
loss of the inspected invitation records.

## Authoritative contract to enforce

### 1. Dataverse lifecycle always wins

Dataverse `wmkf_appreviewersuggestion` is authoritative for whether a reviewer
has entered or completed engagement. An applicant recommendation is already
handled when it is selected or carries an invitation, response, token,
materials, review, or completion signal. A handled reviewer must not be
re-enriched or shown as a new actionable Find prospect, even if Postgres is
stale or incomplete.

Postgres may retain a compact terminal ledger for deduplication, but it cannot
move a reviewer backward from invited/declined/accepted/completed to unresolved.

### 2. Postgres is a working projection, not lifecycle authority

`reviewer_find_roster` owns temporary Find evidence and staff actions. Its state
must yield to Dataverse engagement. Canonical keys remain required for mutable
applicant actions, but noncanonical historical rows must not cause an engaged
reviewer to reappear. Missing suggestion anchors must be ignored or quarantined
until a reviewed repair removes them.

### 3. Proposal identity is the exact SharePoint file key

The stable proposal identity is `library::folder::filename`, not the random
Blob URL. Changing the exact file may invalidate proposal-dependent enrichment;
reloading the same file must not. Applicant recommendations and their
Dataverse lifecycle remain accessible while the proposal resolves.

### 4. Automation cannot reverse staff or lifecycle decisions

Enrichment may add evidence. It must never erase an actor-bound confirmation,
reactivate a terminal roster row, or reinterpret an engaged suggestion as an
unhandled recommendation. Concurrent enrichment must use the existing snapshot
/ compare-and-set protections and have explicit race tests.

### 5. Every blocking message has an executable remedy

A user-facing error must provide the action that can resolve it: reload stale
state, retry a transient verification, select a proposal file, correct contact
information, or navigate to the lifecycle stage where the reviewer already
lives. “Already invited” and “declined” are statuses, not errors.

## Required execution sequence

### Phase 0 — Freeze and baseline

1. Start from a clean, current `main` and create a Tier 1–3 stabilization branch.
2. Do not deploy, roll back, or write Production data during baseline work.
3. Build one read-only diagnostic harness that accepts a request number and
   reports, in one bounded result:
   - Dataverse suggestion/person anchors and engagement signals;
   - Postgres roster key/status/suggestion anchors;
   - duplicate, noncanonical, and missing-suggestion rows;
   - resolved proposal file key and fallback/override source;
   - applicant cache validity and the reason for a miss; and
   - contradictions between Dataverse and the roster projection.
4. Run it against Request `1002912` and at least one untouched request before
   changing runtime code. Commit the harness so the evidence is reproducible.

### Phase 1 — Write the five golden workflows before the fix

Each workflow must be represented by service/route tests plus the smallest
useful UI contract test. At least one test per current regression must fail
against the baseline before implementation.

1. **Reload without model work:** reopening Find with the same proposal and a
   valid cache restores applicant recommendations without a new Claude call.
2. **Engagement is monotonic:** selected, invited, declined, accepted, or
   completed applicant reviewers never render as actionable new prospects.
3. **Confirmation persists:** correcting Lima-style identity/contact commits,
   survives reload, and survives an overlapping enrichment run.
4. **Promotion is exactly once:** one unhandled applicant recommendation is
   promoted once, retains its authoritative email, produces one suggestion,
   and disappears from the actionable Find set.
5. **Proposal selection is deterministic:** canonical, legacy fallback, and
   deliberate override resolve predictably and remain stable across reload.

### Phase 2 — Implement one bounded stabilization patch

#### A. Engagement-aware applicant projection

- Project server-derived engagement/stage information from applicant ingestion.
- Filter handled suggestions inside `enrich-recommended` as a server-side
  invariant; do not rely on browser filtering.
- Make the client terminal set include server-derived Dataverse engagement in
  addition to canonical roster terminal keys.
- Restrict restored applicant roster rows to the current expected suggestion
  set so an orphaned pre-merge row cannot render.
- Render handled recommendations in a compact **Already handled** summary with
  their actual stage and a navigation action, rather than identity-warning cards.

#### B. Identity/contact confirmation contract

- Emit the canonical server-derived `candidateKey` on every applicant candidate.
- Include that exact key in the confirmation mutation.
- Keep the stored-row/key/request binding fail-closed.
- Return a typed stale/missing-row response with an in-modal Reload/Retry action.
- Prove both confirmation-before-enrichment and confirmation-during-enrichment
  races preserve the staff decision.

#### C. Proposal document selector fallback — explicit todo

Implement this precedence for **Reviewer Finder proposal ingestion only**:

1. If exactly one active
   `Reviewer Materials/Proposal_{Request#}.pdf` exists, select it.
2. If the canonical file is absent, look for the exact legacy filename
   `Project Narrative.pdf` in the request's server-listed document set.
3. If exactly one legacy match exists, select it automatically.
4. If neither exists, or legacy matches are ambiguous, require the existing
   authenticated dropdown selector.
5. A duplicate canonical file remains an error; do not silently fall back.
6. Persist a deliberate override in reload-stable navigation state (for
   example a validated URL file-key parameter), and revalidate it server-side.
7. Do not rerun Claude when reload resolves the same exact file key. Rerun only
   when the exact key changes or staff explicitly selects **Update applicant
   suggestions**.
8. Keep cached applicant rows visible while file resolution is in progress;
   gate only actions that genuinely require proposal-dependent evidence.

This compatibility fallback does **not** change the outbound reviewer-materials
contract: newly prepared packages still use
`Reviewer Materials/Proposal_{Request#}.pdf`. Do not restore `classifyFile`,
best-guess PDF selection, or filename heuristics.

#### D. No-dead-end UI contract

- Stale row: Reload and retry.
- Missing/ambiguous proposal: Select a file.
- Already invited: navigate to Invite/Track.
- Declined/removed: navigate to the declined or Removed record.
- Contact/identity issue: open the exact correction/verification action.

### Phase 3 — Reconcile data only after recurrence is closed

Create a dry-run-default, backup-producing repair script. It must verify each
suggestion against Dataverse and refuse request mismatches or ambiguous pairs.
Then:

1. audit all noncanonical saved rows with suggestion anchors;
2. audit canonical active rows whose Dataverse suggestion is already engaged;
3. audit roster rows whose suggestion no longer exists;
4. print denominators, planned operations, skips, and failures;
5. obtain explicit Production-write authorization;
6. pilot Request `1002912`; and
7. re-probe before considering a broader execution.

Expected Request `1002912` disposition, subject to the new dry run:

- Isberg: one canonical terminal roster row reflecting an already-invited
  suggestion; remove the redundant legacy saved twin after backup.
- Sorek: one canonical terminal roster row reflecting invited/declined state;
  remove the redundant legacy saved twin and the verified missing-suggestion
  orphan after backup.
- Lima: remain active/unhandled; retry staff confirmation only after the runtime
  key contract is deployed.

No Dataverse lifecycle repair is presently indicated for Isberg or Sorek.
Re-probe immediately before any write.

### Phase 4 — Review, release, and observe

1. Run focused tests, the full unit/integration suite, lint, type checks, build,
   relevant documentation gates, and their self-tests sequentially.
2. Perform one adversarial review of the complete plan/contract and one of the
   finished implementation. Do not start another speculative review loop.
3. A new review finding enters scope only when it is tied to a reproduced
   failure, a violated invariant, or a verified caller→persistence→consumer gap.
4. Deploy deliberately under the campaign release strategy.
5. Run a signed-in, no-send pilot on Request `1002912`:
   - Isberg is legible as already invited, never actionable in Find;
   - Sorek is legible as declined, never actionable in Find;
   - Lima correction persists across reload without unnecessary re-analysis;
   - proposal override survives reload; and
   - no invitation, acceptance, contact promotion, or external email is sent.
6. Inspect production logs and state after the pilot before authorizing data repair.

## Stop rules

Pause and report instead of continuing when:

- a proposed fix requires Dataverse to yield lifecycle authority to Postgres;
- the baseline diagnostic and the UI disagree about a reviewer stage;
- a golden workflow cannot be made deterministic without production writes;
- the implementation grows into unrelated identity-policy or schema work;
- two commits or roughly 30 minutes of support/review work pass without making a
  golden workflow fail or pass for a concrete reason;
- a review produces another architectural redesign rather than a bounded
  contract violation; or
- any relevant gate is red.

## Exit criteria

Stabilization is complete only when all are true:

- the five golden workflows pass;
- opening or reloading Find cannot move a reviewer backward in lifecycle;
- same-file reload performs no unnecessary model call;
- handled reviewers are legible but not actionable as new prospects;
- every blocking message offers a working remedy;
- no duplicate/orphan roster row can affect the active Find projection;
- the Request `1002912` no-send production pilot passes;
- the dry-run repair has explicit, reviewable operations and backups; and
- source, Atlas, wiki, memory, session prompt, and route/service documentation
  agree on the final contract.

Until those criteria are met, label the reviewer workflow **stabilizing**, not
finished or fully production-proved.
