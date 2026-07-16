---
name: project-reviewer-holistic-redesign-parallel-build
description: The reviewer finding/identity redesign is ACTIVE under the owner-approved hybrid model: safe legacy-default slices reach main through short branches; containment promotes per invariant; the baseline freezes after shared containment; cohort activation is server-owned; destructive cleanup waits through a controlled pilot and one campaign of observation.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-16 via the frozen M1.1 benchmark/import audit, frozen M1.2 cohort, and M1 asset gates
---

## Recall Rule

Read this when planning or starting reviewer-finding work
(`lib/services/discovery/`, the discovery facade) or reviewer identity work
(`reviewer-identity-resolver.js`, `researcher.js` identity fields), or whenever
`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` is proposed for action.

## Current direction

The plan is **active under a hybrid incremental model**:

1. **Safe slices to main:** evaluation assets, additive schema artifacts, seams,
   dual writes, and shadow comparisons land through short branches while legacy
   behavior remains authoritative.
2. **C0 containment:** current save-boundary, correction, attestation-overwrite,
   and send-eligibility defects promote one verified invariant at a time on
   Tier-2 branches. C0.4 enforcement is dependency-gated by authoritative Wave
   13 population and shadow proof; it is not a standalone send-service patch.
3. **Measured switches:** the baseline freezes after shared containment. New
   readers/finding behavior activate only through a server-owned deterministic
   request cohort; missing/invalid assignment selects baseline.
4. **D1 cleanup:** Track B or heuristic deletion waits until promotion and one
   complete campaign of old/new observation.

Wave 13 identity-binding schema is **deployed but not authoritative to policy
readers**. The
owner-approved production-only apply completed 2026-07-12 after the ancient
sandbox was rejected as an unsuitable validation target. **[VERIFIED
2026-07-13 via `node scripts/preflight-reviewer-identity-binding-fields.mjs
--target=prod --include-population`]** typed metadata remains 0 ABSENT / 10
EXACT / 0 DIVERGENT. The ten
nullable fields cover person binding generation and per-field lineage plus
proposal COI binding/context currency. No live application reader/writer uses
the suggestion fields. The person fields have an ETag-protected binding writer
and narrow adapter seam. The owner approved its first production caller on
2026-07-13; PR #57 merged at `00ffb09c` and Vercel production deployment
`dpl_4YpnVVdRmDHyuzgPVSKXNcx22bKu` reached READY: acceptance-drain self-report
only, keyed by stable `accepted_at`.
The same reproducible population probe rerun immediately after deployment
returned zero person and zero suggestion rows. By the later owner-authorized
S363 smoke, the fresh pre-run baseline was one person and zero suggestion rows;
the pre-existing person's origin was not adjudicated. The synthetic smoke rows
were deleted and absence-verified, restoring that exact baseline. None of this
makes legacy/unknown rows eligible by default. Broader caller and policy-reader
migration remains gated.

**C0.4 read-only contract audit (2026-07-14):** a fresh explicit-target preflight
reported 0 ABSENT / 10 EXACT / 0 DIVERGENT and a current population of one person
row / zero suggestion rows with any Wave 13 value. Send and render re-read only
legacy email provenance/status; neither loads durable binding/COI currency, and
render can rotate the external-token hash before send. The current
low-email-confidence acknowledgement is address-specific but is not an identity
action policy. Runtime enforcement is therefore not ready: first land an inert
pure policy/projection/test slice, populate/classify and shadow the durable
fields under I1/I2 gates, then owner-gate render+send enforcement. Audit:
`docs/audits/reviewer-c0-4-send-eligibility-audit-2026-07-14.md`.

**S359 adversarial review (2026-07-13 artifact): fixes implemented and
promoted.** The inert
writer branch merged to `main` at `4e0ae1bd` after the review census re-proved
every new surface production-inert. A live read-only sample confirmed that
Dataverse returns persisted resolver timestamps at second precision; F1 now
normalizes strict second-/millisecond-precision UTC timestamps once on
load/event boundaries. The S362 smoke-readiness adversarial review found format
normalization alone left a retry hazard (a millisecond-bearing `accepted_at`
never round-trips equal to the stored `wmkf_identityboundat`, so a job retry
reclassified its own replay as a rebind or ordering block); the capture service
now truncates the self-report event identity to second precision before the
writer, making a retry an exact no-op; F2
requires a valid server receipt before writing the client-carried resolver
decision; F3's named guards have direct complement tests; F4/F5/F7 are also
closed; F6 uses the owner-approved 14-day receipt lifetime. F8 is captured
reproducibly at
`docs/audits/reviewer-identity-binding-prod-preflight-2026-07-13.md`. The first
self-report caller is now production-live. Three immediate post-deploy drain
runs had no error-level logs, while that immediate population probe remained
zero. S363 then merged PR #60 (`5bb6a8b8`) and ran the owner-authorized positive
control against deployment `dpl_BqCBSFWoRto2noQdrovHG7fBsA6X`: maintenance run
`15060` attributed exact completed job `25`; the exact Wave 13 `self_reported`
binding passed; no contact or system alert was created; synthetic Dataverse rows
were deleted and absence-verified; and the completed queue job was retained by
owner decision. Automated writers, decline, backfill, action-policy readers,
and other callers remain gated.

The pure non-I/O contracts are built in
`reviewer-identity-binding-contract.js` and `institution-coi-context.js`, with
focused negative tests. They freeze strict canonical anchors, binding tuples,
pair-atomic seven-field lineage, and server-loaded proposal institution context
hashing. `reviewer-identity-binding-writer.js` supplies the person
read/conditional-write seam with bounded 412 recompute, explicit source
precedence, monotonic human-event ordering, manual-lineage protection, and
fail-closed legacy handling. Automation cannot refresh a human binding until a
durable refresh-ordering signal exists. Durable institution-COI `clear` still
requires server-owned reviewer affiliations covered by the binding generation.

The documented sandbox is reachable but ancient/unknown and lacks
`wmkf_appreviewersuggestion`; Wave 13 was not partially installed there. The
owner explicitly approved the production-only schema exception. The later
2026-07-13 decision separately authorizes only the narrow acceptance-drain
self-report caller described above.

**M1 measurement foundation (updated 2026-07-16):** the identity benchmark carries
an owner-approved 40-case public-evidence pool (20 hazard / 20 clean-positive) assembled
without either reviewer pipeline. Every case has frozen candidate/upstream
response shapes, at least one ORCID, institutional, or publisher source, and a
frozen expected outcome. Justin completed every human decision under the
single-reviewer blinded protocol; the benchmark froze on 2026-07-16 with 23
Bind and 17 Abstain labels. There is no separate labeler or adjudicator and no
inter-rater claim. The tracked import audit preserves the source workbook hash,
all 40 raw workbook rows, deterministic blind-ID mappings, normalization rules
and notes, and the five owner-approved resolutions. The validator requires the
frozen benchmark and import to agree exactly and permits institutional-profile
anchors only when they match authoritative case evidence. The blinded
proposal-evaluation asset is frozen at
`docs/audits/reviewer-holistic-proposal-evaluation-v1.json`. A read-only
production inventory on 2026-07-16 produced the mechanically stratified proposal
at `docs/audits/reviewer-holistic-proposal-cohort-proposal-v1.json`: ten unique
requests, five Phase I thin-signal documents, five Phase II full-signal documents,
four Science and Engineering Research cases, six Medical Research cases, and an
immutable SHA-256 hash for every selected document. No selected request number
appears in the tracked repository, but the available API telemetry has no request
identifier and cannot prove non-use. On 2026-07-16 the owner approved the ten,
attested to the best of their knowledge that none tuned the redesign, and named
Justin as the blinded scorer. The frozen evaluation contains ten unique opaque
seed-derived proposal IDs, exact document hashes, and only the randomization
seed's SHA-256 commitment; the raw seed is retained locally in ignored
`.env.m1.local`. Run, candidate-arm membership, and score arrays remain empty.
The overall evaluation manifest remains draft until exact baseline/redesign
commits and identical runtime configuration are frozen; no M1.2 run has started.
M1.3 is built and captured as an aggregate-only,
read-only production artifact: 668 suggestion engagement rows, 275 exclusive
token and 393 multi-touch, across 11 observed source tokens. The artifact
labels selection as mutable, materials sent as a proxy, and token totals as
overlapping rather than unique people. No resolver or runtime behavior changed.

## Required evidence model

- Identity confidence is not provenance. The durable contract separates
  binding source, version, canonical anchor, evidence lineage, correction, and
  action eligibility.
- Existing tests/eval scripts may seed fixture shapes but do not supply ground
  truth. One reviewer labels the identity benchmark blind to curator strata and
  both pipelines' outputs before A/B output is unblinded; the result is not
  described as inter-rater validated or adjudicated.
- The existing suggestion ledger supports an observational channel baseline,
  not a causal historical experiment: source tokens can overlap and current
  selected/engagement state is mutable.
- Offline A/B qualifies a limited controlled pilot; it cannot measure
  acceptance or review completion while the redesign remains off production.
- The staff decline-referral callout and Add-or-Refer handoff are already
  shipped. Measure conversion; do not rebuild them.

## Do

- Start with the plan's B0 manifest foundation; freeze only after shared C0.
- Keep every production slice small, legacy-default, and independently reversible.
- Build phases one at a time; do not batch the redesign into one opaque change.
- Preserve fail-closed identity reads and the no-COI-regating posture.
- Run `/contract-reconcile` for containment, binding/schema, and cross-layer
  phases; run `/sweep` for durable fact changes.
- Require raw-field consumer/projection fan-out before retiring
  `wmkf_identitystatus` as a trust signal.
- Use the plan's single-reviewer blinded identity gates, blinded proposal A/B,
  and controlled-pilot thresholds for promote/stop.

## Do not

- Do not activate runtime behavior without the relevant promotion gate.
- Do not treat the old P0→P4 sequence or a single
  `wmkf_identitybindingsource` column as the current plan.
- Do not let client-supplied nested identity state establish persistence or
  action eligibility.
- Do not infer self-report from legacy `confirmed`; unproven rows stay
  legacy/unbound until reviewed.
- Do not call mutable suggestion rows an immutable shortlist/panel history.
- Do not delete Track B or other retrieval/ranking code before the offline
  comparison, controlled pilot, explicit promotion, and campaign observation.

## Ground truth

- Reconciled plan: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`
- Controlling synthesis: `docs/audits/reviewer-holistic-review-comparison-2026-07-09.md`
- Current-tree review: `docs/audits/reviewer-holistic-review-codex-2026-07-09.md`
- Strategic source review: `docs/audits/reviewer-holistic-review-fable-2026-07-08.md`
- Owner sourcing constraints: [[project-reviewer-sourcing-constraints]]
- Identity safety context: [[project-reviewer-self-report-orcid-sticky-confirmed]],
  [[project-reviewer-verify-fail-dangerous]]

Related: [[project-reviewer-apps-redesign-direction]] (Workbench/UI is a
different axis), [[project-reviewer-recall-over-precision]],
[[project-reviewer-count-invariant]].
