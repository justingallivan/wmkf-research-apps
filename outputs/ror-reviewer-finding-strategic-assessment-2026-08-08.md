# ROR and Reviewer Finding — Strategic Assessment and Evaluation Plan

Author: Fable (read-only strategic pass), 2026-08-08.
Assignment: `docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md`.
Nothing in this document is implemented; every proposed run requires the owner
decisions in §5. No Claude search, schema, telemetry, or authority change is
proposed. Reviewer names are cited only by case ID or by files that already
carry them.

---

## 1. Capability and contract decomposition

Three capabilities were collapsed into one `bind/review/abstain` vocabulary.
Their actual contracts:

### C3 — Institution normalization
- **Input:** one affiliation string, optional country code and domain evidence.
- **Output:** exactly one ROR id (`resolved`), `review`, or `unresolved`. The
  production implementation then hydrates the single resolved ROR through
  OpenAlex; a missing/mismatched bridge yields null, never a broader result
  (`lib/services/ror-institution-identity-resolver.js:84-114`).
- **Safety contract:** vetoes run before scoring; ROR rank/`chosen:true` is
  retrieval evidence only; zero wrong automatic resolutions, in particular zero
  sibling-campus errors.
- **Abstention meaning:** "this string does not safely identify one canonical
  organization." Abstention is cheap here *only if the consumer treats it as
  review, not as a contradiction* — the request-1002903 incident
  (`outputs/s400-institution-checker-probe-findings.md`) shows abstention on
  decorated bylines being surfaced as "institution mismatch."

### C2 — Person identity
- **Input:** candidate name plus *claimed* institution.
- **Output:** `bind` to a stable anchor (ORCID, else OpenAlex author id),
  `review`, or `abstain` (`lib/services/reviewer-works-first.js:302-464`;
  legacy spine in `reviewer-identity-evidence.js`).
- **Safety contract:** fail closed — full-forename contradictions block, distinct
  ORCID clusters force review, bind requires an anchor
  (`.claude-memory/project-reviewer-verify-fail-dangerous.md`).
- **Abstention meaning:** "could not corroborate the person," which is a
  **recall cost**, not a safety win. The S408 audit's mechanism — the bounded
  50-work newest-first retrieval fills with namesakes before the target's
  institution-corroborated byline appears, ending in
  `no_institution_corroborated_byline` — is a property of this contract.
- **Coupling that matters:** C2 *consumes* C3. `resolveWorksFirst` resolves the
  claimed affiliation through the institution resolver
  (`reviewer-identity-runtime.js:127-130`); an unresolved institution forces
  `review (claimed_institution_unresolved)` and a resolved one gates which
  byline candidates count. So C3 quality moves C2 outcomes, and a C3 change can
  be scored on C2's own benchmark without inventing anything new.

### C1 — Reviewer finding and relevance
- **Input:** a proposal; **output:** suitable reviewer candidates.
- Owner: the Claude/PubMed search pipeline. "PubMed bind" in the 15-row
  diagnostic meant *verification of a search result*, not person identity.
- There is **no ground truth without human judgment**. No existing labeled set
  answers "was this reviewer suitable," and none can be derived from resolver
  data. This is a product-analytics question (e.g., staff accept/decline and
  completion history), not a resolver contract.

Downstream contracts C4 (current affiliation) and C5 (contact attribution)
remain as decomposed in
`docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`; neither is a
promotion target now.

### Why the 15-row diagnostic cannot gate anything
It compared C1-verification (PubMed) against C2 (Works-first) while the change
under evaluation was C3 (ROR). Agreement between the first two contracts is
evidence about neither the third nor "reviewer finding overall." The four
consensus rows and 11 differences are anecdote for mechanism-hunting, already
harvested (S408 three-case audit). Discard it as decision evidence.

---

## 2. Reusable benchmarks — all from existing evidence, no new Claude search

### C3 — already has a passed falsification bar; needs representativeness, not more cases
- **Exists, frozen, passed:** the 166-case falsification suite
  (`benchmarks/fuzzy-matching-falsification/cases/` — 120 UC-matrix, 14
  byline-normalization, 7 hierarchy, plus person/affiliation/contact files);
  the v3 veto-first resolver passed all 141 in-scope institution labels with 0
  wrong automatic resolutions [VERIFIED via
  `outputs/institution-resolution-handoff-to-codex-2026-08-07.md` and the
  research doc's decision record].
- **Missing:** evidence on WMKF's *real input distribution*. Two sources exist
  without any new search:
  1. **Request-1002903 production captures** —
     `outputs/s400-verdict-trace-capture-2026-08-04.log` and the probe findings
     hold five real decorated PubMed bylines vs clean listed institutions, with
     adjudicated outcomes (4 byline-normalization false mismatches, 1 possibly
     substantive). These are exactly the input shape production sees.
  2. **Saved-candidate affiliation strings** as an *unlabeled distribution* for
     measuring resolution/review/unresolved rates and veto frequencies. The
     Codex handoff explicitly rejected saved Dataverse candidates for
     *cardinality* measurement as survivorship-biased; that objection stands.
     The proposal here is narrower: use the strings only to measure the
     resolver's abstention profile on realistic inputs, with the bias stated in
     the artifact. No accuracy labels are claimed from this source.
- **Proposed C3 evaluation (one bounded offline run, owner-gated):** replay the
  existing frozen suite plus the five 1002903 strings through the *production*
  resolver module. Pass = §3 gates. This is hours, not weeks; the comparator
  harness already exists (new slugs, frozen cases untouched).

### C2 — the benchmark exists and has never had a clean run
- `docs/audits/reviewer-holistic-identity-benchmark-v2.json`: **40 frozen
  cases** (frozen 2026-07-16, SHA-pinned in
  `scripts/evaluate-reviewer-works-first.js`), stratified with hazard types, 25
  expected binds / 15 expected abstains, with a person-equivalence overlay and
  blind labeling policy.
- The only recorded run
  (`outputs/reviewer-holistic-m1/reviewer-identity-works-first-w2-v1.json`)
  failed on **all 40 cases with network failure** (`spine: openalex_outage`,
  `works: error: fetch failed`) [VERIFIED via the artifact's rows]. Its gate
  verdicts are meaningless. **Works-first has never been measured on its own
  frozen benchmark.**
- **Smallest experiment that can change an owner decision:** one clean rerun of
  the existing evaluation script from a working network, with the current
  runtime wiring (i.e., the ROR institution stage Works-first now uses). Zero
  new code, zero Claude spend, bounded live OpenAlex/ROR calls. It
  simultaneously measures C2 and the *effect of the C3 change on C2* — the
  question the 15-row diagnostic could not answer.
- **Additive falsification (later, cheap):** fold the S408 three audit cases
  (two common-name misses, one distinctive-name correct bind; row-level names
  stay local) and the 11 `person-identity.jsonl` cases into the benchmark's
  next version. Versioning, not editing: the frozen 40 stay frozen.

### C1 — no benchmark; do not manufacture one
Building relevance ground truth means human labels on proposal↔reviewer pairs.
The cheapest honest evidence is retrospective staff behavior (invitations
accepted, reviews completed, manual replacements) on past cycles — existing
records, but a product-analytics effort with its own design questions. Do not
let any resolver metric stand in for it, and do not run a new Claude search to
generate it.

---

## 3. Go/no-go criteria

### C3 — gate for making ROR the institution stage authoritative *within works-first*
(Note: production already routes works-first's institution lookups through the
ROR resolver when the W2 arm runs; production *authority* remains
`legacy-default`, so no reviewer-visible result uses it. [VERIFIED via
`reviewer-identity-runtime.js:58-67` fail-closed mode normalization and the
2026-08-07 live authority check recorded in the handoff; re-verify live config
before any mode change, per SESSION_PROMPT.])

- **Hard gates (any failure = no-go):**
  - 0 wrong automatic resolutions on the frozen suite; 0 sibling-campus
    errors specifically.
  - 0 cases where a veto is overridden by score/rank.
  - The five 1002903 byline strings: ≥ the incumbent's correct behavior, and no
    new wrong resolution.
- **Comparative gates:** resolution rate on decorated/real-shaped inputs ≥
  incumbent (the incumbent resolves ~0 of the decorated-byline class per S400);
  provider error/timeout profile within the burst bound already computed in the
  handoff (~2,000 req/5 min/IP ceiling).
- **Non-gates:** PubMed agreement; any single combined score; the 15-row panel.

### C2 — gate for `combined` mode ever becoming authoritative
Use the gates **already encoded** in
`evaluatePromotion` (`reviewer-works-first.js:572-622`) on the frozen 40:
- `falseBinds = 0` (hard); `rightPersonPolicyBinds` ≤ spine's; `providerFailures = 0`
  (a run with provider failures is void, as W2 v1 demonstrated);
- `correctBindGain ≥ 3` and `misses ≤ 8` — these two are the **recall knobs**
  and are an owner policy choice, not an engineering constant (§5.3).

### C1 — no go/no-go now
Any promotion framed as "reviewer finding is better" requires the retrospective
staff-outcome evidence above. Until then, C1 claims stay out of gate language.

---

## 4. Keep / reshape / stop

**Keep**
- The ROR candidate adapter, veto-first decision resolver, and exact-ROR
  OpenAlex bridge (`ror-institution-*`), production-wired and dormant. It is
  the only component with a passed falsification bar. Cost of keeping: zero
  reviewer-visible behavior while authority is `legacy-default`.
- The runtime seam and its fail-closed mode normalization
  (`reviewer-identity-runtime.js`), including shadow deadline, failure
  isolation, and aggregate PII-free metrics.
- All frozen benchmark artifacts and the refuse-to-overwrite harness
  discipline.
- The fail-closed identity and invitation safeguards, unchanged.

**Reshape**
- **The superuser comparison panel:** keep as a request-local *observability*
  diagnostic, permanently disqualified as a promotion gate. If it is retained
  long-term, its natural future use is C2-vs-C2 (legacy spine vs works-first on
  the same identity contract), not PubMed-vs-works-first.
- **The common-name abstention mechanism:** document as a stated recall
  limitation of the C2 contract (`no_institution_corroborated_byline` under
  namesake flooding), not a bug queue. Whether it is *acceptable* is §5.3; any
  retrieval-widening fix waits for a failed recall gate on the frozen 40, so
  the fix is justified by a benchmark, not an anecdote.
- **The 1002903 byline-normalization finding:** the S400-identified fix
  direction (extract institution core before consistency comparison — the
  extractor already exists in `discovery/affiliation.js`) is a *consumer-side*
  C3 fix, separable from ROR promotion and arguably higher user-visible value
  than promotion itself. It deserves its own small work order.

**Stop**
- PubMed↔Works-first agreement as evidence for anything.
- Per-name heuristics, OpenAlex cap tuning, provider fallbacks, combined-score
  patches — all remain closed until a frozen-benchmark gate fails and names
  the mechanism.
- Expanding diagnostics before a promotion target is chosen.
- Treating deployment readiness or panel output as progress toward promotion.

---

## 5. Minimum owner decisions

1. **Promotion target.** Recommendation: **C3 (institution normalization)
   first.** It is the only contract with a passed falsification bar, a
   production-wired implementation, and a bounded remaining question
   (real-input behavior). C2 second, contingent on decision 2. C1 is not a
   resolver problem and should exit this workstream.
2. **Authorize the two bounded measurement runs** (read-only, no Claude, no
   deploy, no schema): (a) the clean rerun of the frozen 40-case W2 benchmark
   through current wiring; (b) the C3 replay over the frozen suite plus the
   1002903 strings via the production resolver module. These two runs produce
   every number §3 needs.
3. **Recall policy for C2.** Standing feedback says recall is the Reviewer
   Finder's headline utility
   (`feedback-prioritize-contact-recall-over-identity-precision`), and the
   S408 audit shows works-first abstaining on real people at their real
   institutions. `evaluatePromotion`'s `misses ≤ 8` and `correctBindGain ≥ 3`
   encode a recall budget nobody has ratified. Owner sets the miss budget —
   engineering then tunes to the budget, never the reverse.
4. **Shadow observation window.** Decide whether, after (2a)/(2b) pass, the
   production seam may run a bounded `shadow` observation period. This is the
   only path from "benchmarked" to "promotable" and is currently unauthorized.
   Deployment Ready does not imply this; live authority must be re-verified at
   decision time.

**Decision order:** 2 → 1 → 3 → 4. The measurement runs are cheap and inform
the target choice; choosing a target before running them would repeat the
pattern this reset exists to end.
