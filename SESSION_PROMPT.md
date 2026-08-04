# Session 400 Prompt: Enrichment identity-verdict investigation

> **Handoff, 2026-08-04 (Session 399).** Production is healthy and carries the
> full latency arc: S397 blob cache, S398 increment C (auth gate), and S399
> increment D (parallel slot ingestion + no-op PATCH skip), all
> production-verified with scaffolding removed. Owner directive for this
> session: **investigate the enrichment identity-verdict findings** recorded in
> `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` §"S399 addendum" — start
> with the local consistency-checker probe. Run `/start` first.

## Session 399 Summary

Full arc: D0 evidence increment → increment D build/review/ship/verify →
an owner-driven enrichment investigation that produced four source-verified
stabilization findings.

### What Was Completed

1. **D0 — N=0 fixed-floor attribution (evidence-only, complete).** Temporary
   Tier-0 timing logs (`fa57ed85`, removed exactly in `8dc4ab6f`) across 5
   deliberate production loads. **There is no steady-state server floor**:
   warm handler ~230ms at N=0 (~350ms client). The S398 2,941ms sample
   decomposes into idle/cold artifacts: stale guard+overrides cache reloads
   (~0.8–1.0s, sequential), ~950ms platform TTFB overhead on idle hits
   [ASSUMED, unattributable from outside], ~150ms connection setup, cold
   module-init. At ~twice-a-year usage every real hit IS the idle/cold case.
   Evidence: findings doc §D0 (gitignored `outputs/`).
2. **Increment D SHIPPED + PRODUCTION-VERIFIED (`1b3e9b3e`; docs `01610bbf`).**
   Slot materialization now parallel (dedup pre-await, allSettled, ordering
   preserved); `ensureApplicantRecommended` skips its no-op PATCH, scoped to
   `!requireEtag` (sole `requireEtag` caller is reviewer-merge's provenance
   union — its 412 signal preserved). Sized by a true-cold N=5 measurement:
   slot loop was 2,041ms of a 3,419ms handler. Review chain: author
   adversarial pass → Codex adversarial review (**approve, no material
   findings**). Owner chose smoke-on-main; smoke passed (two 200s, zero error
   logs, all 5 applicant-referred cards rendered). 6,796 tests green. Branch
   deleted local+origin. Wiki: workbench topic "Ingestion performance
   contract"; memory router updated (A/C/D live).
3. **Enrichment identity-verdict findings (owner-driven dig, read-only).**
   All five 1002903 applicant-referred reviewers flag "Institution mismatch"
   REPRODUCIBLY on a fresh owner-triggered run. Four source-verified findings
   recorded in the stabilization directive §"S399 addendum": misleading
   verdict copy (fail-closed catch renders errors as affirmative mismatch;
   banner structurally unable to name the institution it claims), no durable
   verdict observability (SSE-only; Vercel runtime logs cannot witness the
   request), stale-cache verdict replay without provenance, silent no-op
   button risk.

### Commits (session, chronological)
- `fa57ed85` chore(reviewers): temporary D0 timing decomposition logs
- `8dc4ab6f` chore(reviewers): remove D0 timing instrumentation
- `1b3e9b3e` perf(reviewers): parallelize applicant slot ingestion + skip no-op PATCH
- `01610bbf` docs: record increment D ship
- (this handoff commit) docs: S399 addendum + Session 400 prompt

## Next Items

### Owner-Directed Starting Task

1. **Enrichment identity-verdict investigation** (directive §"S399 addendum",
   read it first). Step 1: run
   `createInstitutionConsistencyChecker().areConsistent(...)`
   (`lib/services/institution-affiliation-consistency.js`) locally against the
   five visible institution pairs from request 1002903 (Vanderbilt University
   Medical Center, Columbia University, North Carolina State University,
   Texas A&M, UC San Diego vs. plausible PubMed variants; OpenAlex is
   keyless). Outcome decides: checker machinery broken/throwing (→ fix or
   reason-code logging) vs over-strict genuine falses (→ copy fix + matching
   review). The four findings are stabilization backlog regardless; fixes to
   the enrichment surface are Tier 1–2 (reviewer flows) — branch, not main.

### Verified Open (carried)

1. **Blob-cache hazard watch (passive, open-ended).** Not a gate.

### Owner Decision Needed (carried)

1. **postcss moderate advisory** (Dependabot 62) — likely needs a `next`
   upgrade; tier deliberately if approved.
2. **Enrichment-cache staleness on in-place proposal updates** (S397 Codex
   finding) — now ALSO implicated by S399 finding 3 (stale verdict replay).
3. **Increment E — ProfileProvider double-fetch**
   (`shared/context/ProfileContext.js:456-489`): doubles
   user-profiles + user-preferences on every page. [ASSUMED ~0.5–1s tail].
4. **Latency secondary candidates from D0** (only if owner wants more):
   parallelize guard+overrides in the route (~0.3–0.5s on stale-cache hits);
   hydrate is 408ms at N=5.

### Parked (carried)

1. **Candidate B (exclusion-parse cache)** — helps only ~8% of requests;
   largely obsoleted if structured intake ships.
2. **Excluded-reviewers intake Phases A/B** — field names should survive the
   Justin×Connor reconciliation meeting
   (`docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md` §6).

### Verify Before Acting

1. **Any latency-work expansion**: read
   `.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md` and
   `project-reviewer-find-usage-cadence-blocks-observation-windows.md`;
   one increment at a time, tier-gated, deliberate smokes.
2. **Enrichment fixes**: the fail-closed posture (comparison error ⇒
   needs-review) is deliberate safety behavior
   (`project-reviewer-verify-fail-dangerous`); fix the *copy/observability*,
   never weaken the gate without owner sign-off.

### Do Not Reopen Without New Decision

1. Reverted warm-reconciliation range `5b6757df..7072d52a` and branch
   `reviewer-find-outcome-contract` — never merge/cherry-pick.
2. Request `1002903` mutation work — read-only absent new exact owner
   authorization (page views + owner-triggered enrichment runs are fine —
   S397/8/9 protocol).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` §"S399 addendum" | The four findings + first probe |
| `lib/services/institution-affiliation-consistency.js` | Checker to probe locally (step 1) |
| `lib/services/workbench/enrich-recommended-service.js:607-660,899-949` | Verdict derivation + withheld-fields DTO (line refs are pre-instrumentation; shifted up to ~62 lines while the S400 `TEMP S400` verdict trace is in — see directive addendum marker) |
| `shared/components/reviewers/ReviewerSearchSection.js:419,1313-1386` | Mismatch banner, enrichRecommended, cache restore |
| `lib/services/workbench/applicant-reviewers-service.js` | Increment D parallel slot ingestion (shipped) |
| `lib/dataverse/adapters/reviewer-suggestion.js:647+` | `ensureApplicantRecommended` no-op skip (shipped) |
| `outputs/reviewer-find-warm-revisit-step0-findings.md` | Full latency evidence trail (gitignored) |

## Testing

```bash
npm run check:types
npx jest --testPathPatterns "applicant-reviewers|reviewer-suggestion-disposition"  # increment D contracts
npx jest                                                # full suite, 6,796
# Local checker probe (step 1): node -e with createInstitutionConsistencyChecker
# against the five 1002903 institution pairs; OpenAlex needs no key.
```
