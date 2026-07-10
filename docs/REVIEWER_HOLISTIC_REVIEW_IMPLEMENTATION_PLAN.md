---
title: Reviewer Holistic Review — Implementation Plan
domain: reviewer-identity
kind: plan
status: draft
summary: "Phased plan for the 2026-07-08 holistic-review direction: identity provenance split, eval-first hardening, referral loop-closure, deletions."
canonical: false
cataloged: 2026-07-08
owner: product-engineering
related:
  - docs/audits/reviewer-holistic-review-fable-2026-07-08.md
  - lib/services/reviewer-identity-resolver.js
  - lib/dataverse/adapters/researcher.js
  - .claude-memory/project-reviewer-sourcing-constraints.md
---

# Reviewer Holistic Review — Implementation Plan

Original direction source: `docs/audits/reviewer-holistic-review-fable-2026-07-08.md`.
Before using this parked plan, read
`docs/audits/reviewer-holistic-review-comparison-2026-07-09.md`; it preserves
the useful direction while correcting evidence overclaims, the now-shipped
P3.1 staff handoff, and the identity-contract scope.

## Execution model (owner, S349 — where the phases land, not how they're staged)

Justin's chosen model (2026-07-08): **keep the staged, phased build** (P0 → …
→ P4, one phase at a time, don't batch — probably required, as the plan lays
out). What changes is only *where the phases land and how success is judged*:

- **Phases accumulate on a dedicated testing branch, they are NOT merged to
  main one at a time.** The redesign is held off main until it is built out in
  full, so that a whole-pipeline comparison is even possible (if each phase
  shipped to main, main would just *become* the redesign and there'd be nothing
  to compare against).
- **Success = an end-product head-to-head.** The fully-built redesign branch is
  compared against the current state-of-the-art on **main** — two fully-built
  pipelines on separate branches — before any merge decision.
- Stand up the eval layers early so that comparison is measurable, not a vibe
  check: **P2.1** (frozen identity eval fixtures), **P3.2** (A/B on 2–3
  D26-style proposals), **P3.3** (per-channel accept-yield report) are the
  comparison harness against main.
- All safety invariants and **[OWNER-GATE]** markers still bind on the branch.
- **Status: PARKED — not green-lit.** Do not start the build without explicit
  owner go. Intent recorded in `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`.

> **Reconciled 2026-07-09:** P3.1's staff-facing decline-referral surface and
> one-click Add-or-Refer handoff shipped on main in S349 (`e955a1df`). Its
> historical build steps below are retained as provenance, not remaining work.
> The external decline-acknowledgment/referral email is still a separate open
> choice. All other phases remain parked and should be reassessed against the
> comparison memo before owner approval.

## How to use this plan (implementing agent: read this section fully)

- **One phase per session/PR — onto the testing branch, not main.** Phases are
  ordered by risk-reduction per unit of work and are independently buildable.
  Do not batch phases. (Per the Execution model above, "PR" means a PR into the
  redesign testing branch; the phases are not merged to main individually —
  main stays the comparison baseline until the end-product head-to-head.)
- **Read before each phase** (non-negotiable): the memory files listed in that
  phase's "Read first" line, plus `.claude-memory/project-reviewer-sourcing-constraints.md`
  and `.claude-memory/project-reviewer-self-report-orcid-sticky-confirmed.md`
  for anything touching identity.
- **Probe before asserting.** Every `[ASSUMED]` marker in this plan is a claim
  the plan's author did NOT verify against source — verify it live before
  building on it. Claims marked `[VERIFIED …]` were checked on 2026-07-08 at
  repo HEAD (`6563c7c5`); re-verify line numbers, which drift.
- **Owner gates.** Items marked **[OWNER-GATE]** need Justin's explicit go
  before execution — the plan records the recommendation, not the approval.
- **Universal invariants that this plan must never violate:**
  - Sticky-skip + fail-closed reads in `writeIdentityDecision` /
    `clearIdentityFields` (`lib/dataverse/adapters/researcher.js`) survive
    every refactor — removing them reintroduces the silent-wipe bug
    (memory `project-reviewer-self-report-orcid-sticky-confirmed`, "Do not").
  - Forename-gate polarity stays contradiction-only (`forenameContradicts
    !== true`) on the affiliation/topic promotions and agreement-required
    (`forenameAgrees === true`) on the employment-only promotion — the S236
    regression (Keller/Sang) is the proof this distinction is load-bearing
    [VERIFIED via `reviewer-identity-resolver.js:267-296`].
  - Reviewer self-report remains the highest-trust ORCID source and always
    beats a resolver guess.
  - No COI re-gating; surface-not-gate posture unchanged
    (memory `project-reviewer-coi-rely-on-self-disclosure`).
  - Behavior-freeze rules for extractions/consolidations: characterization
    tests first, passthrough-no-default
    (memory `feedback-behavior-freeze-passthrough-no-default`).
  - External-token routes stay token-authenticated public surfaces
    (`.claude/rules/external-reviewers.md`); app routes use `requireAppAccess`
    and register in `docs/API_ROUTE_SECURITY_MATRIX.md`.
- **Gates.** After each phase: `npm test` (full suite — green means the FULL
  suite, memory `feedback-green-requires-full-test-suite`), plus the
  phase-specific gates listed. Doc/wiki edits → `npm run check:agent-wiki` and
  a `/sweep`-style restatement grep. Anything touching durable state or
  cross-layer contracts (P1, P3.1) → run `/contract-reconcile`.

## Non-goals (do not do these, even if they look adjacent)

- No retrieval-first inversion revival; no Track-B resurrection.
- No roster-reuse / per-person reviewer-history features (owner practice:
  effectively no reuse — deprioritized, not impossible; revisit only on owner
  signal).
- No "elevate applicant recs" slate changes (recent ~1/panel anti-stacking
  policy).
- No new identity statuses; no COI gating changes; no new soft COI flags.
- No new external data sources.

---

## P0 — Identity safety patches (small, ship first)

**Read first:** `.claude-memory/project-reviewer-self-report-orcid-sticky-confirmed.md`,
`.claude-memory/project-reviewer-verify-fail-dangerous.md`,
audit doc §4.1. **[OWNER-GATE]** — this resolves the triage-doc open question
("downgrade spine `confirmed`?") in the downgrade direction; Justin has seen
the recommendation but has not explicitly approved execution.

### P0.1 Spine `confirmed` → `probable`

- Change the two automated `confirmed` emissions to `probable`:
  `lib/services/reviewer-identity-resolver.js:261` (authorship_grounded +
  topic/employment) and `:279` (strong affiliation + employment + topic)
  [VERIFIED via direct read 2026-07-08]. Update the stale header comment at
  `reviewer-identity-resolver.js:16` and the branch comments.
- Behavior consequences to handle deliberately, not incidentally:
  - `mayPersistIdentity` (`reviewer-identity-resolver.js:390`) treats
    confirmed/probable identically — persistence eligibility is unchanged
    [VERIFIED via direct read].
  - `lib/services/discovery/track-b-identity.js` maps spine `confirmed`
    to `verificationConfidence: 0.95` [ASSUMED exact lines ~66-82 via reader
    trace — re-verify by reading the file]; decide the `probable` mapping
    explicitly (existing probable mapping applies; do NOT invent a new
    confidence constant).
  - Tests lock the old behavior: `tests/unit/reviewer-identity-evidence.test.js`
    (and possibly `discovery-verification-status.test.js`) assert spine
    `confirmed` [ASSUMED which cases — grep first]. Update assertions as part
    of the change, citing this plan; do not weaken unrelated cases.
  - UI: anywhere that renders a "confirmed"-tier badge from spine results
    [ASSUMED — grep `identityStatus` consumers in `shared/components/reviewers/`]
    should degrade gracefully to the probable badge; verify no selectability
    regression (probable is persist-worthy and selectable).
- Acceptance: `rtk grep -n "'confirmed'" lib/services/reviewer-identity-resolver.js`
  shows no automated emission; full suite green; one manual discovery run
  (capture mode — see memory `reviewer-invite-capture-mode-not-full-sandbox`)
  shows previously-confirmed spine candidates now probable and still
  selectable.

### P0.2 Close the attestation-overwrite hole

- Today an incoming `confirmed` skips the sticky read and overwrites
  unconditionally — including over a stored human attestation
  (`lib/dataverse/adapters/researcher.js:238-239` [ASSUMED exact lines via
  reader trace + memory; re-verify by reading `writeIdentityDecision` in
  full]). After P0.1 no automated path emits `confirmed`, but the adapter
  should not depend on that staying true (that is exactly how the original
  invariant broke — prose, not enforcement).
- Change: `writeIdentityDecision` accepts `confirmed` only when the caller
  passes an explicit attestation marker (e.g. `{ attested: true }` option),
  supplied ONLY by `lib/services/capture-self-reported-orcid.js`
  (`writeIdentityDecision` call ~`:81` [ASSUMED via reader trace]). Caller
  list to re-verify by grep before editing [ASSUMED via reader trace]:
  `contact-enrichment/persistence.js:129`, `save-candidates-service.js:772`,
  `enrich-recommended-service.js:393`, `capture-self-reported-orcid.js:81`,
  two backfill scripts. A non-attested `confirmed` is downgraded to
  `probable` (log it) rather than thrown — fail-safe, not fail-crash, since
  this path runs non-fatally inside accept/decline.
- Preserve verbatim: sticky-skip on stored `confirmed` for non-confirmed
  incomings, fail-closed read-error propagation, `clearIdentityFields`
  no-op-on-confirmed. Add a unit test for each of the four cells
  (attested/stored × yes/no).
- Acceptance: new tests + existing `tests/unit/capture-self-reported-orcid.test.js`
  green; grep shows no other caller passes the attestation marker.

### P0.3 Comment/memory reconciliation

- Fix `capture-self-reported-orcid.js` header (~`:12-17`, "resolver NEVER
  emits confirmed" — false until P0.1, true after; make it state the enforced
  rule, not history).
- Reconcile `.claude-memory/project-reviewer-self-report-orcid-sticky-confirmed.md`:
  the S235 discrepancy is CLOSED by P0.1/P0.2; rewrite the warning block to
  record the resolution (reconcile-don't-append). Update
  `docs/REVIEWER_ORCID_SPINE_SPEC.md` §6 (its "confirmed must remain
  reachable" argument is overruled — note why) and
  `docs/agent-wiki/topics/reviewer-identity.md`. Run the restatement grep:
  `rtk grep -rn "never emits" lib/ docs/ .claude-memory/`.

---

## P1 — Binding provenance (the structural fix)

**Read first:** audit §4.1 "structurally"; `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md`
§14; `.claude-memory/reference-dataverse-audit-trail-actor-detection.md`.
**[OWNER-GATE]** — new Dataverse column. Run `/contract-reconcile` on the
design before implementation (durable state, cross-layer).

- **Schema:** add a choice column `wmkf_identitybindingsource`
  (`self_reported` | `staff_confirmed` | `automated`) on the person entity
  (`wmkf_potentialreviewerses` — adapter `lib/dataverse/adapters/researcher.js`).
  Probe how prior `wmkf_identity*` columns were added (schema scripts vs.
  manual maker-portal — check `lib/dataverse/schema/` and ask Connor/Justin;
  [ASSUMED] there is a repeatable path).
- **Writes:** `writeIdentityDecision` gains a `bindingSource` param —
  `capture-self-reported-orcid` → `self_reported`; a future staff-confirm
  action and the S285 `pdIdentityConfirmed` override → `staff_confirmed`
  (probe where that override lives before wiring [ASSUMED:
  workbench/enrich-recommended path]); everything else → `automated`.
- **Guards:** sticky-skip and `clearIdentityFields` no-op key on
  `bindingSource !== 'automated'` instead of `status === 'confirmed'`. Order
  of trust for overwrites: `self_reported` > `staff_confirmed` > `automated`;
  equal-or-higher source may overwrite, lower may not. Keep fail-closed reads.
- **Backfill:** existing rows where `wmkf_identitystatus = 'confirmed'` —
  distinguish self-report-set rows via the Dataverse audit trail if feasible
  (see actor-detection memory); otherwise default existing `confirmed` to
  `self_reported` (conservative: preserves protection; the population is
  reviewers who went through Stage 2a [ASSUMED — verify no other historical
  confirmed-writers existed before defaulting]). Write the backfill as a
  dry-run/apply/verify script like `scripts/backfill-contact-orcid.js`.
- **After P1, `confirmed`-as-sentinel is fully retired**: status is pure
  confidence; P0.2's attestation marker becomes `bindingSource`, and the P0.2
  special-casing can be simplified away.
- Acceptance: four-cell overwrite tests re-expressed against sources; merge
  guard (`lib/services/reviewer-merge.js:232-236` identity non-downgrade
  [ASSUMED lines via reader trace — re-verify]) re-keyed and tested;
  contract-reconcile findings addressed; docs/memory reconciled (§14 backprop
  doc, spine spec, wiki identity topic).

---

## P2 — Eval-first hardening and consolidation

**Read first:** `scripts/eval-orcid-spine-sweep.mjs` header;
`.claude-memory/project-reviewer-verify-fail-dangerous.md`;
`.claude-memory/feedback-behavior-freeze-passthrough-no-default.md`.

### P2.1 Frozen identity eval fixtures

- Extract the known hazard cases into offline JSON fixtures (no live API in
  CI): fabricated wrong-forename (Alfred/Alain Laederach), initial-only real
  reviewers (U. Keller, R. T. Sang), affiliation drift (Olga Smirnova),
  namesake collision (Robert Sang/Florida State), OpenAlex merged cluster
  (Wen Li), plus 5–10 clean positives. Source the shapes from the existing
  tests and eval scripts; record expected classification per case.
- Add `npm run eval:identity` running `classifySpineEvidence` /
  `resolveIdentity` over the fixtures; wire as an advisory check first
  (promote to red gate only with owner sign-off — new gate fixtures can trip
  scanner gates, memory `feedback-new-gate-fixtures-trip-scanner-gates`).
- **Adopt the standing rule (add to `docs/agent-wiki/topics/reviewer-identity.md`):**
  no new anchor type, promotion branch, or gate-polarity change lands without
  a fixture that fails before the change and passes after.

### P2.2 Name-comparison consolidation

- Three parallel implementations exist [ASSUMED via reader trace — re-verify
  each by reading]: `lib/services/discovery/name-matching.js` (PubMed byline
  logic, nickname map), `reviewer-identity-evidence.js` (~`:288-330`,
  `givenNameToken`/`forenameFullyAgrees`/`forenamesContradict`), and the
  work-author-resolver's parser path. Consolidate into one module
  (suggest `lib/services/identity/name-compare.js`) exposing the *existing*
  semantic predicates unchanged — behavior-freeze: write characterization
  tests capturing current outputs for the P2.1 fixture names FIRST, then
  extract with passthrough semantics, no default-value changes.
- Acceptance: characterization tests green before and after; the three call
  sites import the shared module; `eval:identity` unchanged.

### P2.3 Stratum-3 decision

- Either run the spine spec §10 early-career/no-ORCID eval (extend
  `eval-orcid-spine-sweep.mjs` with a stratum-3 name set; cited-reference
  ground truth per the spec) **or** amend
  `docs/REVIEWER_ORCID_SPINE_SPEC.md` §10 to state the accepted posture:
  "early-career names abstain to the human; unmeasured tail acknowledged."
  **[OWNER-GATE]** on which. Do not leave the current state (gate marked
  TODO, slice marked implemented).

---

## P3 — Finding investments

**Read first:** `.claude-memory/project-reviewer-sourcing-constraints.md`
(the owner constraints that shaped these), `.claude-memory/project-reviewer-referral-capture.md`,
`docs/REVIEWER_FINDER_REFERRAL_CAPTURE_DESIGN.md`.

### P3.1 Close the staff-facing referral loop — SHIPPED S349

**Current state [VERIFIED 2026-07-09 via source + `e955a1df`]:** the workbench
reader, Track Reviewers callout, and one-click prefill into the normal
Add-or-Refer identity flow are live. See
`docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` “Decline-referral
surface + one-click add.” The remainder of this subsection records the
pre-build state and acceptance contract.

Historical pre-build state [VERIFIED 2026-07-08 via direct reads]: capture existed on both sides —
staff "Add or Refer a Reviewer" (S249; route
`pages/api/workbench/manual-reviewer.js:55,77` accepts `referredBy` and
delegates to `lib/services/workbench/manual-reviewer-service.js`) and the
external decline form persisting free text
(`shared/components/external/DeclineFormView.js:102-111` "Anyone you'd
suggest instead?" → `pages/api/external/review/[token]/respond.js` →
`applyReviewerResponse` → `lib/dataverse/adapters/reviewer-suggestion.js:1343-1344`
writing `wmkf_declinereferral`). **Zero staff-side readers** of
`wmkf_declinereferral` exist (disconfirming grep across `shared/components/`,
`lib/services/{review-manager,workbench}/`, `pages/api/`); `respond.js:7`
explicitly defers "referral handoff" to a follow-up build.

Historical build sequence (completed for surface + one-click resolve):
1. **Surface:** in the workbench Track Reviewers panel, render a visible
   "referred: <free text>" callout on any declined suggestion whose
   `wmkf_declinereferral` is non-empty (probe first: how declines render
   today [ASSUMED — read the Track panel component and its data service];
   ensure the field is in that read path's `$select`). A per-request badge
   ("2 unread referrals") is the minimum viable notification; a decline-ack
   email trigger is optional follow-up **[OWNER-GATE]** (external email).
2. **One-click resolve:** "Add as candidate" from that callout, pre-filling
   the existing Add-or-Refer flow (`ReviewerFindPanel.js` card →
   `POST /api/workbench/manual-reviewer` with `referredBy` = the declining
   reviewer's name) so provenance lands as `referred` exactly as S249 built
   it. Free-text→identity uses the existing abstain-or-confirm resolution in
   `manual-reviewer-service.js` (resolution modes `reuse_reviewer` /
   `reuse_contact` / `create_new` [VERIFIED via `manual-reviewer.js:29`]);
   never auto-resolve to a namesake
   (memory `project-reviewer-verify-fail-dangerous`).
3. **Dismissal state:** staff can mark a referral handled/ignored [ASSUMED no
   existing field — probe; a local suggestion-row flag or reuse of an existing
   status field beats a new column; escalate to owner if a column is needed].
- Auth: the surface/resolve UI is staff-side (`requireAppAccess` route
  family); do NOT add staff data to the external token surface
  (`.claude/rules/external-reviewers.md`).
- Run `/contract-reconcile` (new read path over durable state + UI state).
- Acceptance: decline with referral in capture-mode e2e → callout appears →
  one-click add creates a `referred`-provenance candidate surviving a
  `my-candidates` reload (the S249 durability lesson).

### P3.2 Applicant recommendations as neighborhood seeds

- Feed the request's `wmkf_potentialreviewer1..5` names+affiliations into the
  Stage-1 `analyze` context as **community anchors** with an explicit
  instruction: "candidates similar in expertise-community to these, but
  independent of the applicant; do NOT return these people." Prompt-level
  first — no new lane, no OpenAlex expansion machinery (simplest thing;
  measure before building more). Verify the applicant-suggested exclusion
  covers analyze output, not just dedup [ASSUMED — grep applicant-exclusion
  handling in `pages/api/reviewer-finder/discover.js` and the dedup service].
- Prompt changes go through the Dataverse-resolved prompt row + Executor
  contract (`docs/EXECUTOR_CONTRACT.md`; memory `project-prompt-governance`;
  `.claude/rules/llm-and-prompts.md` — run `check:prompt-injection-tagging` +
  self-test sequentially if the surface is registered) — prod reseed is
  Justin's step.
- Acceptance: A/B on 2–3 D26-style proposals (owner sniff test — the S246
  method): does the seeded run surface more on-community candidates?
  **[OWNER-GATE]** for the prod prompt reseed.

### P3.3 Channel-level outcome report (no schema work)

- Write a read-only probe script (`scripts/probe-origination-outcomes.mjs`)
  tallying, per `wmkf_sources` token / provenance kind on
  `wmkf_appreviewersuggestion` rows: invited → accepted → declined →
  review-submitted counts. The suggestion ledger carries provenance +
  lifecycle state per `docs/REVIEWER_DATA_MODEL.md` [ASSUMED exact status
  fields — probe the entity columns before writing the script].
- Output an evidence artifact under `docs/atlas/evidence/` (follow the
  existing gitignored-artifacts convention there). Run once per cycle; this
  replaces sniff-test-by-necessity with real accept-yield per channel.
- No UI, no cron, no persistence — a script and a habit.

---

## P4 — Deletions and doc retirement (destructive; verify-before-destructive applies)

**Read first:** `.claude-memory/feedback-verify-before-destructive-carryover.md`;
CLAUDE.md rule 2. Grep live callers for EVERY deletion; stop and report if
anything is live.

### P4.1 Delete Track B **[OWNER-GATE]**

- Preconditions to verify live: `TRACK_B_ENABLED` is hard-coded `false` with
  no env/runtime override (`lib/services/discovery/constants.js:47`
  [VERIFIED via reader trace 2026-07-08 — re-verify]); its query generation
  was already removed S253 (analyze PART 3); no non-test caller reaches
  `lib/services/discovery/literature-search.js` except the
  `TRACK_B_ENABLED`-gated facade delegations (the module self-describes as
  "ARCHIVED OFF … kept intact and dormant" with characterization net
  `tests/unit/discovery-literature-search.test.js` [VERIFIED via direct read
  of `literature-search.js:1-16`]).
- Remove: `literature-search.js` + its characterization test, the
  `TRACK_B_ENABLED` branches, and the always-empty merge/defer/resolve tail
  (`discovery-service.js:249-300` [ASSUMED range via reader trace — re-read
  the whole facade section first]). **Keep**: `track-b-identity.js` exports
  that live paths use (probe imports — the name is misleading [ASSUMED]);
  the route-level COI pass in `discover.js` (the in-service partition it
  duplicated was only "already run" for Track B — re-read both sites and keep
  exactly one authoritative pass, documented).
- Characterization tests for `discover()` output on a fixture proposal before
  and after (identical output = the tail was truly dead).
- Reconcile docs/memory: wiki origination topic, redesign plan references,
  any `TRACK_B` mentions (`rtk grep -rn "TRACK_B" --include="*.md" docs/ .claude-memory/`).
- Note the facade constraint: `discovery-service.js` static passthroughs are
  a deliberate call-site/test-compatibility surface
  (`docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md`) — removing delegations
  must follow that plan's C1 rules, not ad-hoc deletion.

### P4.2 Retire the retrieval-first inversion formally

- Add a supersession banner to `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`
  Part A §4/§7 (and the §4.5 cited-reference lane): "deferred by the S246
  experiment; posture lives in the origination wiki topic." Do not rewrite
  the historical content (durable-docs rule: classify, don't silently
  rewrite). Reconcile the origination wiki frontmatter if it implies the
  plan is current direction.

### P4.3 Heuristic dedupe (opportunistic, lowest priority)

- One institution-alias source: `match-signals.js` (~`:140-189`) vs.
  `deduplication-service.js` (~`:422+`) [ASSUMED lines via reader trace] —
  merge or delete in favor of spine structured matching where the caller has
  spine data. One 5-year-recency implementation. Retire the biology-biased
  synonym table (`match-signals.js` ~`:56-79`) **only** with
  characterization tests showing Track-A verification outcomes on the P2.1
  fixtures are unchanged or justified. If the diff is behavioral, stop and
  surface to owner.
- SerpAPI/contact-enrichment tier reduction (audit §5.3) is **explicitly
  deferred** out of this plan — bigger blast radius, needs its own
  behavior-freeze design. Do not fold it into P4.3.

---

## Sequencing summary

| Phase | Size | Risk | Owner gate | Blocking gates |
|---|---|---|---|---|
| P0 identity safety | S | Low (guards preserved) | Yes (design call) | full tests |
| P1 binding source | M | Medium (schema + guards) | Yes (new column) | contract-reconcile, full tests |
| P2 eval + consolidation | M | Low (behavior-frozen) | Only for red-gate promotion / stratum-3 choice | full tests, eval:identity |
| P3.1 staff referral loop | SHIPPED S349 | — | External email only | shipped in `e955a1df` |
| P3.2 seeds | S | Low (prompt-level) | Prod reseed | A/B sniff, prompt-injection gate if registered |
| P3.3 outcome report | S | None (read-only) | No | — |
| P4 deletions | M | Medium (destructive) | Yes (P4.1) | characterization tests, live-caller greps, /sweep |

Recommended order for remaining parked work: reassess against the 2026-07-09
comparison memo, then P0 → P3.3 (free, informs everything) → P1 → P2 → P3.2 →
P4 if owner-approved. P3.1's staff handoff is already shipped. P0 and P3.3 fit
one session each; nothing in remaining P3/P4 depends on P1.

## Open owner decisions (collected)

1. Approve P0 downgrade direction (resolves triage finding #1).
2. Approve the P1 `wmkf_identitybindingsource` column + backfill default.
3. Stratum-3: run the eval or document always-abstain (P2.3).
4. Referral decline-ack / handoff email — send externally or badge-only (P3.1).
5. Prod prompt reseed for seeded analyze (P3.2).
6. Approve Track B deletion (P4.1).
