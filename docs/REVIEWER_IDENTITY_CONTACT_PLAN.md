---
title: Reviewer Identity & Contact — Disambiguation, Affiliation/COI, and Email Plan
domain: reviewer-identity
kind: plan
status: active
summary: "W0/W1 and three email improvements are live; W2 combined mode and W4.1 persistence are built behind the legacy default, with cutover gated."
canonical: false
cataloged: 2026-07-19
owner: product-engineering
related:
  - docs/audits/reviewer-disambiguation-email-external-alternatives-fable-2026-07-18.md
  - docs/audits/reviewer-serpapi-contact-strategy-adversarial-2026-07-18.md
  - docs/REVIEWER_PAGE_FIRST_EMAIL_EXPERIMENT_PLAN.md
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - lib/services/reviewer-identity-evidence.js
  - lib/services/reviewer-identity-runtime.js
  - lib/services/reviewer-works-first.js
  - lib/services/reviewer-identity-resolver.js
  - lib/services/institution-identity-resolver.js
  - lib/services/deduplication-service.js
  - lib/services/openalex-service.js
  - lib/services/contact-enrichment/scholarly-email.js
---

# Reviewer Identity & Contact — Disambiguation, Affiliation/COI, and Email Plan

## Status and posture

**ACTIVE ROADMAP — PARTIALLY BUILT.** This plan sequences the work identified in
the 2026-07-18 assessment. W3.1's NCBI + Europe PMC core-record tier and W3.2's
narrow current-affiliation alternate tie-break are live. The W3.1 full-text
fallback and W3.4 page-first cascade completed evaluation and were not promoted.
W0's additive institution-identity substrate and W1's affiliation/COI correction
are implemented. W2's works-first resolver passed its frozen 40-case gate and
now sits behind a server-owned runtime seam. Reviewer discovery, Workbench
applicant-recommended verification, and contact enrichment default
independently to legacy, support comparison-only shadow execution, and contain
an explicit owner-gated `combined` mode scoped to that caller. The current
evaluation branch changes no deployed mode. W4.1's additive evidence-bundle generation and
persistence path are built on the existing Wave 13 verified-anchors memo;
re-resolution on later reuse and W4.2 dedup remain `[PLANNED]`. Broader
email-alternate handling also remains `[PLANNED]`.
Rationale and evidence live in the companion audit
(`docs/audits/reviewer-disambiguation-email-external-alternatives-fable-2026-07-18.md`,
§§1–5b); this plan holds the *what, in what order, behind which gate*, and does
not restate the audit's detail. Where this plan and the audit conflict, the
audit's grounded evidence wins and this plan is corrected.

Boundary with the active identity plan: `REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`
owns the versioned identity-**binding contract**, evaluation-manifest governance,
and redesign rollout. This plan owns the **mechanics** of disambiguation,
affiliation/COI matching, and email discovery. W4 below reconciles with that
plan's Wave 13 binding model rather than duplicating it.

## Evidence basis (already established, not re-derived here)

- Works-first disambiguation prototype (40-case benchmark, head-to-head):
  spine 14 correct-bind / 3 false-bind / 11 miss; works-recipe v1 21 / 7 / 1.
  Identity-verified: only 2 of the 7 works false-binds are genuinely unsafe
  (Tsai merged cluster); the recipe recovers ~half the spine's misses.
  `[VERIFIED via run — audit §5a]`
- Corrected W2 evaluation (same frozen 40 cases, same-run head-to-head): the
  current spine produced 13 correct-bind / 2 genuine false-bind / 1
  right-person-policy bind / 12 miss / 12 correct-abstain; the combined policy
  produced 22 / 0 / 1 / 3 / 14. The hard gate passed with +9 correct binds,
  zero genuine wrong-person binds, and three misses. Eleven automatic outcomes
  changed; the two changed review cases are the already-labeled unsafe
  initials-only A. Patel and J. Kim cases, so the run created no new mandatory
  human adjudication. The evaluation/scoring client made 176 OpenAlex requests
  costing $0.104; this explicitly excludes the current spine's internal
  OpenAlex requests and is not a total-run cost. `[VERIFIED 2026-07-19 via
  clean post-extraction npm run eval:reviewer-identity:w2 output]`
- An earlier post-extraction attempt hit five late OpenAlex 429s and remains
  invalid historical evidence. The runner rate-paces requests and makes zero
  provider failures a hard gate, so throttling cannot pass by being
  misclassified as ordinary misses. The subsequent clean full rerun satisfied
  that gate with zero provider failures. `[VERIFIED 2026-07-19 via clean
  post-extraction npm run eval:reviewer-identity:w2 output and
  provider-failure gate tests]`
- Before W1, the COI matcher matched shared institution id/name with no umbrella
  exemption and the alias table folded Janelia into HHMI. W1 now exempts
  Broad/HHMI-only overlap and separates Janelia. `[HISTORICAL finding; VERIFIED
  fixed via lib/services/deduplication-service.js and
  lib/services/discovery/match-signals.js]`
- OpenAlex `associated_institutions` (typed `parent`/`child`/`related`) links
  Broad→MIT/Harvard, Whitehead→MIT, Harvard→40 affiliated hospitals; IAS→empty.
  `[VERIFIED via probe — audit §5b.3/5b.4]`
- The original structured scholarly-email tier abstained on every top-2 address
  tie, producing a measured false-abstain for Jie Shan. The narrow W3.2 rule now
  resolves a tie only when exactly one domain matches the claimed/current
  affiliation. W0 now supplies the institution identities needed for a future
  broader rule, but no broader dual-appointment equivalence is implemented.
  `[VERIFIED — audit §5b.4 + W3.2 artifact below]`
- The live NCBI + Europe PMC core-record tier found a structured address for
  27/40 frozen subjects (20 `ready`, 7 `quick_check`); it uses full-name/ORCID
  identity matching, candidate-affiliation corroboration, and distinct-work
  counting. `[VERIFIED via
  the owner-only archived frozen scholarly-email receipt,
  lib/services/contact-enrichment/scholarly-email.js, and
  docs/audits/local-operational-data-retention-audit-2026-07-27.md]`
- ORCID is not a unique key in practice (duplicate iDs). `[owner-stated + EXTERNAL — audit §5b.1]`

## Guiding invariants (apply to every phase)

1. **Safety posture is preserved.** Abstain-is-safe, fail-closed at the
   persistence/send boundary, forename-contradiction gate, and
   `research_only`-never-sends remain unchanged. No phase weakens them.
   *Current clarification (S391, outside this plan):* the send gate still refuses
   `research_only` unconditionally and still ignores client-supplied confidence.
   Evidence-backed staff attestation now uses
   `/api/workbench/reviewer-address-trust`; a valid bundle for the exact
   `staff_verified` address is ready, while legacy source-only values remain
   `quick_check`. The former provenance-only `verifyEmailAddress` action is
   retired. No phase of this plan relies on `research_only` being permanent for
   a given address.
2. **Match institutions in ID space.** Resolve to OpenAlex `I-id`/ROR before
   comparing; names/aliases/geography are fallbacks, not the primary key.
3. **`associated_institutions` is a consistency tool only — it must NEVER widen
   the COI hard-drop set.** The single associated-org input to COI is the
   exemption overlay, and it only *narrows*.
4. **ORCID is a corroborator, not the key.** Anchor on the person
   (name + institution + works); carry a *set* of ORCIDs; dedup on the union of
   anchors.
5. **Provisional-until-attested.** Automated resolution holds identity and the
   contact address loosely; the magic-link self-report is the closing signal
   (identity and preferred email are reviewer-owned).
6. **Eval before mechanism.** No new promotion branch, anchor type, or heuristic
   gate lands without a failing case in the frozen 40-case benchmark first.
7. **Legacy default + branch-by-abstraction.** Behavior changes ship behind a
   seam, legacy-authoritative until an eval + owner gate; COI/send changes use a
   branch and deliberate promotion (campaign-release strategy).

## Scope / non-goals

- **In scope:** institution ID-resolution substrate; COI/affiliation correctness;
  works-first disambiguation resolver; duplicate-ORCID handling; structured +
  alternate-aware email; evidence-bundle persistence.
- **Non-goals:** reviving retrieval-first origination or Track B; re-gating COI
  more aggressively (this plan only *narrows* false drops); new external data
  vendors (the owner has closed the Prophy option and chosen the in-house
  resolver); changing the origination engine (Claude stays the spine).

---

## W0 — Institution identity substrate (shared foundation) `[IMPLEMENTED 2026-07-18; ACTIVE FOUNDATION]`

**Result.** One isolated, per-run cached resolver: affiliation string →
`{ openAlexId, ror,
country, displayName, associatedInstitutions[] }`, reusing
`OpenAlexService.searchInstitutions`/`getInstitution`. The resolver is additive
and request-scoped. W1 now opts in from COI narrowing, mismatch-alert, and
identity-corroboration paths; the W2 shadow arm now uses it for fail-closed
institution-id disambiguation.

**Selection contract.** Normalize the affiliation, rank exact name above
multi-token whole-phrase containment above an explicit acronym, optionally
constrain by an ISO-2 country code, and hydrate only a unique strongest OpenAlex identity.
Search rank never breaks a tie. Provider failures and unresolved, weak, or tied
matches return `null`; caller cancellation propagates. Settled identities and
definitive misses are cached only within the resolver instance.

**Invariant.** No persistence or caller mutation; deterministic candidate
selection returns `null` rather than guessing. W1 callers preserve their lexical
fallback when resolution abstains or the provider fails.
**Verification.** Unit fixtures cover HHMI, Broad, Whitehead, IAS (US vs two DE
identities), Harvard, Dana-Farber, ambiguity, garbage, caching, transient
provider failure, hydration mismatch, token-boundary matching, and cancellation.
Live OpenAlex probes resolved the named US institutions, kept unqualified IAS
ambiguous, resolved IAS-US with a country hint, and retained IAS-DE ambiguity
because OpenAlex returns two equally named German identities.
**Gate.** Unit tests; no runtime surface or red-gate exposure.

## W1 — Affiliation & COI correctness `[IMPLEMENTED 2026-07-18]`

Fixes false COI hard-drops and false affiliation-mismatch alerts. Ships first
because it has a live user-visible cost (good reviewers silently dropped).

- **W1.1 ID-space COI matching.** Production discovery, enrichment, workbench,
  and authoritative save paths use async W0-backed COI decisions. Resolution is
  deliberately lazy: it may confirm or refute a pre-existing lexical/direct
  match, but a lexical non-match never becomes a new hard drop. OpenAlex/ROR ids
  compare first; provider abstention preserves the existing name fallback.
- **W1.2 Mechanism-2 exemption overlay.** A curated id set (HHMI `I1344073410`,
  Broad `I107606265`) where a *shared* such institution alone is not COI.
  **Scoped to the institute id — a shared parent university still counts.**
- **W1.3 Un-fold the alias.** Remove `janelia` from the `'hhmi'` alias
  (`match-signals.js:158`) so the employer and the physical campus stop being
  conflated; Janelia-vs-Janelia stays a valid match.
- **W1.4 Mechanism-1 consistency (mismatch alert + resolver corroboration).**
  Two institutions are consistent when they share an id OR one is in the other's
  `associated_institutions`. Applied to `alert-reviewer-affiliation-mismatch.js`
  (stop false Broad/MIT, Dana-Farber/Harvard alerts) and
  `reviewer-identity-evidence.js` institution corroboration (a hospital
  `last_known_institution` no longer fails against a claimed university).
- **W1.5 Hospital firewall.** Explicit invariant + tests that W1.4 never widens
  COI: different hospitals stay distinct (Dana-Farber ≠ MGH → no drop); a
  shared parent ecosystem is at most a soft surfaced signal, never a hard drop.

**Invariant.** COI hard-drop set only stays or *narrows*; never widens.
Fail-closed save-time COI (`save-candidates-service`) semantics preserved.
**Tests.** COI matrix: HHMI/HHMI (exempt), HHMI/host-university (real, via
parent), Broad/Broad (per owner policy), Dana-Farber/MGH (no drop),
Dana-Farber/Harvard (soft only), IAS/Princeton (no match), same-hospital (drop).
Affiliation-mismatch matrix incl. institute/hospital cases.
**Gates.** `check:route-service-boundary`, `check:dataverse-access-layer` (if the
save-time COI path is touched) + self-tests, sequentially; `/contract-reconcile`
before promotion (COI is a fail-closed gate).
**Owner decision.** Shared Broad alone is always exempt from automatic hard
drop, matching HHMI; direct shared MIT/Harvard/hospital/campus affiliations still
drop. The exempt set remains exactly HHMI + Broad. Any additional umbrella org
requires a later owner decision.

## W2 — Works-first disambiguation resolver v2
`[COMBINED MODE BUILT; LEGACY DEFAULT; PRODUCTION NOT CUT OVER]`

The evaluated resolver is now shared by the pinned runner and the runtime
shadow arm. `ReviewerIdentityRuntime` is the sole production call seam for
non-biomedical/PubMed-off Track-A verification. Unset, `legacy`, and every
unknown value return `ReviewerIdentityEvidence` exactly as before. `shadow`
settles every authoritative legacy result in the candidate batch first, then
runs bounded W2 comparison work, emits a redacted decision-only comparison,
and still returns the exact legacy objects. Discovery and Workbench pass the
parent signal and deadline timestamp; W2 skips if its complete allocation plus
a reserve no longer fits. Comparison/error observation shares the allocation.
One 16-request OpenAlex budget per resolution covers works searches, ROR hydration,
author/anchor profiles, and combined ORCID-profile hydration; exhaustion fails
safe. Storage failures still cannot alter the reviewer result. The explicit
`combined` mode adapts W2 rescues into the established result contract with an
automated `probable` ceiling, uses the current OpenAlex profile rather than
overwriting it with the claimed affiliation, and fails back to the legacy
result on W2 provider failure. No tracked environment enables `combined`.

- **W2.1 Works-first candidate generation — IMPLEMENTED IN RUNTIME SEAM.**
  `raw_author_name.search` byline
  query + institution-id disambiguator (via W0), nickname/CJK variants,
  surname+forename byline gate. (Prototype in audit §5a.)
- **W2.2 ORCID-as-corroborator — IMPLEMENTED IN RUNTIME SEAM, FAIL-CLOSED.** Same-ORCID OpenAlex
  fragments collapse to the richest cluster. Any set containing distinct
  ORCIDs goes to review: shared institutions or coauthored paper titles are not
  identity-specific enough to merge them automatically. The frozen
person-equivalence overlay affects benchmark scoring only and cannot change a
resolver decision. Runtime consensus and the evaluator share the same
overlay-free OpenAlex-to-ORCID anchor canonicalizer.
- **W2.3 Cluster-quality gates — IMPLEMENTED IN RUNTIME SEAM.** ORCID-richest/anchored-cluster preference (fixes
  the Keller fragment and Tsai merged-cluster false-binds); name-rarity /
  unique-anchor gate (abstain on high-fragmentation names without a unique
  anchor).
- **W2.4 Name-comparator consolidation — NOT BUILT.** Fold the three forename implementations
  (`discovery/name-matching`, `reviewer-identity-evidence`, work-author resolver)
  into one module with the benchmark as its spec; passthrough, no new defaults.

**Invariant.** Purely provisional (`probable` ceiling for automated); recall
gains do not regress safety — the eval gate below is the hard bar.
**Eval gate (hard) — PASSED 2026-07-19.** The pinned runner requires at least
three additional correct binds, zero genuine false binds, no increase in
right-person-policy binds, at most eight misses, and zero provider failures.
The corrected clean run achieved +9 / 0 / no increase / 3 / 0. The benchmark
and person-equivalence overlay are hash-pinned; mutation fails and requires a
new version. A throttled or partial rerun is invalid, not a regression result.
The evaluator uses the production W0 institution resolver rather than trusting
OpenAlex rank one, and a structured author-profile provider failure also fails
the zero-provider-failure gate. Its W0 and anchor-canonicalization adapters
propagate otherwise hidden provider failures, invalidating the run rather than
scoring them. No new rule without a first failing benchmark case (invariant 6).
**Runtime seam invariant.** The discovery, Workbench-recommended, and
contact-enrichment mode variables independently accept explicit `shadow` and
`combined`; unset/`legacy`/unknown/authoritative-looking values such as `w2` and
`cutover` execute legacy only. The former generic variable cannot promote these
tagged live callers. Shadow failures never change or replace legacy results;
combined-mode W2 provider failure retains legacy.
The production batch completes all legacy provider work before W2 can consume
provider quota. OpenAlex retry backoff observes the overall shadow abort but is
not incorrectly governed by an expired per-request timeout. No client-provided
mode exists.
**Owner-gate.** The abstain-vs-bind-right-person policy on fragmented famous
names (changes what the benchmark counts as correct); enabling `combined` in a
deployed environment; production cutover.

## W3 — Email discovery `[ACTIVE; W3.1/W3.3/W3.4 DECIDED; W3.2 NARROW RULE LIVE]`

- **W3.1 Structured corresponding-author email — DECIDED 2026-07-18: keep the
  live core-record tier; do not add the tested OA full-text fallback.** The live
  resolver already queries NCBI PubMed and Europe PMC `resultType=core`, accepts
  email only from the matched author's recent, institution-corroborated
  affiliation, and deduplicates the same work across providers. It found 27/40
  addresses on the frozen cohort (20 `ready`, 7 `quick_check`). A bounded
  `fullTextXML` prototype then parsed explicit JATS `<corresp>` linkage for up
  to five PMC articles only when core evidence missed. It added **0** addresses:
  the same 20/7/13 result remained, while the nine missing subjects without a
  provider error moved from 375 ms median to 1,052 ms. Targeted checks for
  Wherry, Berg, and Shan confirmed the recent PMC papers listed them as
  coauthors but did not link correspondence to them. The prototype was removed;
  production behavior is unchanged. Revisit only with a failing benchmark case
  where full text contains a candidate-linked address absent from the core
  record. `[VERIFIED via
  the owner-only archived full-text trial receipt; its redundant ignored
  source was disposed under the local operational-data retention audit]`
- **W3.2 Alternates-not-conflict — NARROW RULE IMPLEMENTED 2026-07-18.** On an
  exact publication-support tie, select an address only when exactly one email
  domain has an exact non-generic label from the candidate's claimed/current
  institution; preserve every other tied address as an evidence alternate.
  Missing affiliation, generic-only overlap, unrelated domains, and two matching
  domains still abstain as `conflict`. On the frozen 40 this changed exactly one
  subject: Jie Shan moved from a 2-vs-2 conflict to ready at
  `jie.shan@cornell.edu`; every other subject's action/email/status was
  byte-for-byte unchanged (21 ready, 7 quick-check, 12 missing, 0 conflicts).
  Broader email-alternate equivalence through registrable domains or OpenAlex
  `associated_institutions` remains `[PLANNED]`; W0/W1 now provide the grounded
  institution and one-hop consistency substrate, but email promotion still
  requires its own frozen-case evaluation rather than inheriting a COI or
  identity decision. `[VERIFIED via
  the owner-only archived alternates trial receipt,
  tests/unit/scholarly-email.test.js, and the local operational-data retention
  audit]`
- **W3.3 Preferred email is reviewer-owned — IMPLEMENTED 2026-07-18.** The
  deliverable address sends the invitation and prefills the magic-link accept
  form. Acceptance confirms or corrects the engagement-scoped address on the
  suggestion row; the post-accept confirmation now prefers that reviewer-attested
  address over the older person-record email. A differing CRM contact email is
  alerted for staff reconciliation rather than silently overwritten. No new
  schema. `[VERIFIED via Stage2aView.js → respond-service.js →
  reviewer-suggestion.js → reviewer-acceptance-drain.js →
  reviewer-acceptance-email.js plus tests/unit/reviewer-acceptance-drain.test.js
  and tests/unit/reviewer-acceptance-email.test.js]`
- **W3.4 Paid-tier decision — DECIDED 2026-07-18: do not promote the tested
  page-first cascade.** The staged experiment completed with zero manually
  confirmed wrong-person results, but the fresh 20-person cohort gained only
  one correct-ready subject over the current arm (2/20 versus 1/20), below the
  predeclared +3 gate; no non-US subject became ready. Production ordering and
  send policy remain unchanged. Raw Claude/Serp addresses remain
  `research_only`; first-party page links remain useful staff leads. Evidence
  and exact call/latency counts:
  `REVIEWER_PAGE_FIRST_EMAIL_EXPERIMENT_PLAN.md`.

**Invariant.** No search-sourced address becomes invitation-sendable
(Contract 3 unchanged); alternates resolution never promotes a cross-person
address.
**Tests.** Existing structured-tier identity, affiliation, distinct-work,
provider-failure, conflict, and cancellation fixtures remain authoritative.
The narrow W3.2 matrix covers a unique Cornell-domain match, generic-token
abstention, and two matching-domain abstention. Broader associated-institution
alternates require W0-backed fixtures before implementation.
**Gates.** `check:prompt-injection-tagging` + self-test if the Tier-3 surface is
touched.
**Owner-gate.** Closed for the tested page-first cascade: do not promote.
Any materially different paid-tier design requires a new bounded experiment.

## W4 — Durable identity model `[W4.1 PERSISTENCE BUILT; REUSE + W4.2 PLANNED]`

- **W4.1 Evidence-bundle persistence — BUILT BEHIND COMBINED MODE.** W2 collects
  `{ ORCID set, up to 5 matched-byline anchor DOIs, ROR set, OpenAlex author-id
  set }`. The authoritative adapter emits typed canonical anchors, and the
  server-owned contact-enrichment decision threads them into the existing
  `wmkf_identityverifiedanchorsjson` persistence boundary. No Dataverse schema
  addition or parallel binding model was needed. A version-2 server receipt
  binds every persisted decision field and compact anchors survive the Find
  roster reload; legacy receipts remain valid only for their previously bound
  metrics and cannot authorize an identity write. The parser needed for later
  anchor reuse is built and fail-closed; wiring a future reuse read to
  re-resolve from those anchors remains `[PLANNED]`. Production's authoritative
  result remains legacy, so no W4.1 evidence has been written by this path yet.
- **W4.2 Dedup on the union of anchors** (any shared ORCID, shared author-id,
  strong name+institution+works overlap), storing every observed ORCID — closes
  the duplicate-ORCID duplicate-record hole.

**Invariant.** Additive to the Wave 13 binding contract; no confidence-as-
provenance regression; fail-closed reads preserved.
**Gates.** `check:atlas` + self-test (schema/read-path docs);
`/contract-reconcile` + `/sweep` (durable surface + symbol fan-out).
**Owner-gate.** Any Dataverse schema addition (separate additive wave; production
apply is a distinct owner-approved operation).

---

## Sequencing

| Order | Workstream | Depends on | Ships to | Owner gate |
|---|---|---|---|---|
| 1 | W0 substrate `[IMPLEMENTED; ACTIVE FOUNDATION]` | — | branch → main | none |
| 2 | W1 affiliation/COI `[IMPLEMENTED]` | W0 | branch → main, tests + contract-reconcile | Broad policy closed; future umbrella additions gated |
| 3 | W2 disambiguation v2 `[COMBINED BUILT; LEGACY DEFAULT]` | W0 | runtime seam, legacy authoritative in production | combined-mode enablement/cutover |
| 4 | Broader W3.2 follow-on | W0 | branch → main | co-affiliate policy |
| 5 | W4.1 evidence persistence `[BUILT BEHIND COMBINED]` | W2 | existing Wave 13 verified-anchors memo | combined-mode enablement |
| 6 | W4.2 dedup + reuse re-resolution | W4.1 | later branch | policy + any required schema |

W1 addressed the highest near-term live false-drop bug and remains independent
of the disambiguation rebuild. W3.1 is closed: keep the live core-record tier
and do not add the tested full-text fallback. W2 has passed its offline gate and
the legacy-default seam, explicit combined mode, and W4.1 evidence persistence
are built. Remaining W2 work is owner-approved cutover plus optional comparator
consolidation. W4 reuse re-resolution and W4.2 dedup remain later work.

## Open owner decisions

1. **Umbrella/exempt org set** beyond HHMI + Broad (CZ Biohub, Simons/HFSP…)?
2. **Abstain vs bind-the-right-person** on fragmented famous names — does the
   benchmark keep abstain-expected, or credit a correct bind with a verify flag?

Closed decisions: W0 institution substrate — implemented; W1 — implement the
no-widening COI correction; shared Broad alone is always exempt, and the exempt
set is currently HHMI + Broad only; W3.1 full-text XML fallback — do not promote;
W3.4 page-first paid-search cascade — do not promote; buy-vs-build — continue
with the in-house resolver and do not evaluate Prophy. `[OWNER DECISION
2026-07-18; owner-reported Prophy assessment, not independently benchmarked]`

## Verification & regression strategy

- The frozen **40-case identity benchmark is the standing regression gate** for
  W2 (and any future disambiguation rule) — extend it, never bypass it. Exact
  numerators/denominators only; no population claims from 40 cases.
- W1 landed with a COI + affiliation-mismatch **test matrix** as its spec.
- Relevant red gates run sequentially with self-tests for the surfaces each phase
  touches; `/contract-reconcile` precedes every COI/persistence promotion;
  `/sweep` reconciles durable docs when a changed fact appears in multiple homes.

## Completion rule

Each workstream is "ready to promote" only when its named invariant holds under
test, its eval/matrix gate passes, the relevant red gates + self-tests are green,
and its owner gate is answered. Any unverified claim stays `[PLANNED]`/`[ASSUMED]`;
any red relevant gate blocks completion. The completed W0/W1 work and W3.1/W3.4
decisions do not authorize the remaining planned behavior changes.
