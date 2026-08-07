# Handoff — institution resolution architecture → Codex lead (S406, 2026-08-07)

**Owner:** Codex (design lead, from this point)
**Branch:** `main`
**Status:** Architecture direction set by Codex's adversarial review; Claude's
assessment superseded. No runtime code changed. Nothing built yet.
**Changed surfaces:** documentation only —
`outputs/institution-resolution-runtime-architecture-2026-08-07.md` (assessment,
now banner-marked superseded), this note, `SESSION_PROMPT.md`.
**Commits:** `5e34ce08` (assessment), plus this handoff.
**Verification:** doc gates green. No tests affected — no runtime change.
**Dirty worktree:** none.
**Next owner/action:** Codex owns the model. Claude is off this surface.

Owner decision, 2026-08-07: **Codex takes the lead on the institution-resolution
model.** Claude's assessment
(`outputs/institution-resolution-runtime-architecture-2026-08-07.md`) went to
adversarial review and came back `needs-attention` with five findings, all
accepted. The architecture of record is now **Codex's claim-oriented pipeline**,
not Claude's tiered design.

## What Codex's review established (the model to build from)

Parse organization spans and evidence → retrieve a **candidate union** from a
compact ROR index → apply explicit **non-overridable vetoes** (multi-org,
sibling, domain, country, type, granularity) → score survivors with
provenance-aware features → abstain.

Governing principle: **exact aliases are retrieval evidence, not decision
authority.** Vetoes run *before* scoring.

Superseded from Claude's assessment, do not build from these:
- the three-tier design (exact-alias lookup as a *decisive* tier);
- "~110k ROR records" (live count is **132,706 active**, verified 2026-08-07);
- shipping the raw ROR dump as a bundled static asset (raw JSON exceeds
  Vercel's 250 MB standard function limit before app code);
- measuring cardinality from saved Dataverse candidates (survivorship-biased);
- "resolve-at-save may dominate the design" (withdrawn — resolution already
  happens at discovery *and* the save-time COI gate);
- "S2AFF never deploys" (reopened — profile before deciding).

## Claude's refinements to the model

Additive to Codex's five findings, not disagreements. Nothing here contradicts
the review.

1. **The falsification suite is the acceptance test for the veto set — wire it
   in first.** The 166 frozen cases already encode exactly the failures the
   vetoes must catch (sibling substitution, parent-mixed, multi-org, hierarchy,
   granularity). Add `adapters-scorer.js` and run it through the existing
   `run-comparator.js` against the same cases. That gives the new design a
   ready-made red/green target and makes it directly comparable to both prior
   systems. **Bar to beat:** ROR's 64 unsafe / 44 matcher-attributable, while
   exceeding the incumbent's 11/47 positive resolutions.

2. **Domain evidence has no transport today — this is a concrete API change.**
   `createInstitutionIdentityResolver().resolve(affiliation, { countryCode,
   signal })` has **no parameter for domain evidence**
   (`lib/services/institution-identity-resolver.js:145`). The cases carry it as
   `input.domain_evidence`, and the harness's `institutionResolve` adapter is
   handed the whole `input` object — so the suite can exercise a new signature
   the moment the resolver accepts one. Changing this boundary is a prerequisite
   for the domain veto, not a later refinement.

3. **`uc-sibling-domain` is a built-in progress metric.** That 20-case family
   currently discriminates *neither* system — both discard the evidence, one
   resolving unsafely (ROR 20/20 unsafe) and one abstaining blindly (incumbent
   20/20 "safe"). The moment domain evidence is consumable it becomes a real
   scoreboard. Treat movement there as the signal that the domain veto works.

4. **The versioned envelope needs an explicit staleness policy.** The
   input/evidence-hash + ROR-release + resolver-version envelope is right, but
   it creates an invalidation surface: a ROR release or resolver bump makes
   *every* envelope stale at once. Decide up front which fields trigger
   recompute and whether invalidation is lazy or eager. At this volume lazy
   recompute on read is almost certainly correct — but name the cost in the
   design rather than discovering it on the first ROR release.

5. **Two comparator-#1 review findings are now on the critical path**, not
   deferred cleanup:
   - **canonical expected ROR ids in the cases** — without them the naming-artifact
     class stays unadjudicable in *both* frozen runs, and the granularity veto
     cannot be scored at all;
   - **a relationship-aware pair adapter** — the current same-ROR-id-only rule
     cannot express hierarchy, so parent/child consistency is unmeasured.

6. **Treat the first increment as a measurement vehicle, not a perf fix.**
   Claude flagged and deliberately deferred the resolver-hoist defect
   (`lib/services/reviewer-identity-runtime.js:78` constructs the resolver
   *inside* the per-suggestion function — loops at `:324`/`:337` — so that path
   gets a fresh empty cache per candidate and zero cross-candidate reuse;
   `save-candidates-service.js:681` and `discover.js:292` correctly construct
   once per request). Codex is right to promote it to first **because** it pairs
   it with telemetry and stays reversible. Keep that pairing: the value is the
   instrumented before/after, and `feedback-latency-plan-scope-accretion-postmortem`
   (S395) applies directly to this surface.

## Harness constraints Codex should not trip over

- `run.js`, `judge()`, and everything under `cases/` are **frozen for
  comparability**. Both prior runs used byte-identical harness and cases;
  changing the judge (e.g. to ROR-id comparison) **resets the comparison and
  requires re-running every prior system**. That may well be worth doing — but
  it is a deliberate reset, not a tweak.
- `run-comparator.js` **refuses to overwrite an existing results slug**. New
  runs need new slugs; the frozen files are the record.
- The suite must stay **jest-invisible** — no `*.test.js` names under
  `benchmarks/`. Verify with `npx jest --listTests`.
- Comparator runs hit live providers. Per the incumbent baseline's hard-won
  lesson: **a uniformly abstaining resolver is a broken credential, not a
  result.**

## Evidence trail

| Artifact | What it holds |
|---|---|
| `benchmarks/fuzzy-matching-falsification/baseline/incumbent-2026-08-06.md` | Frozen incumbent baseline (+ 2026-08-07 addendum marking its artifact classification unadjudicated) |
| `benchmarks/fuzzy-matching-falsification/baseline/ror-chosen-2026-08-07.md` | Comparator #1, **corrected after review** — read the correction banner before quoting any figure |
| `outputs/institution-resolution-runtime-architecture-2026-08-07.md` | Claude's assessment — **superseded**, retained for the reasoning trail |
| `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` | Comparator list; S2AFF architecture description |
| `outputs/fuzzy-matching-owner-answers-2026-08-06.md` | The six owner answers this all serves (Q1: ambiguity must WIDEN checks) |

## Standing constraint

High-risk automation stays **review-only** until the representative 1–2k
benchmark exists (owner-parked, consequence accepted). Nothing in this model
changes that: the abstention path is a product requirement, not a fallback.
