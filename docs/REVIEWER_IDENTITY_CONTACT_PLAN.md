---
title: Reviewer Identity & Contact — Disambiguation, Affiliation/COI, and Email Plan
domain: reviewer-identity
kind: plan
status: draft
summary: "DRAFT/no-build roadmap for reviewer disambiguation, affiliation/COI matching, and email discovery — sequenced and owner-gated; nothing built."
canonical: false
cataloged: 2026-07-18
owner: product-engineering
related:
  - docs/audits/reviewer-disambiguation-email-external-alternatives-fable-2026-07-18.md
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - lib/services/reviewer-identity-evidence.js
  - lib/services/reviewer-identity-resolver.js
  - lib/services/deduplication-service.js
  - lib/services/openalex-service.js
  - lib/services/contact-enrichment/scholarly-email.js
---

# Reviewer Identity & Contact — Disambiguation, Affiliation/COI, and Email Plan

## Status and posture

**DRAFT — NO BUILD.** This plan sequences the work identified in the
2026-07-18 assessment; it is a roadmap, not an approved build. Every phase is
`[PLANNED]`. Rationale and evidence live in the companion audit
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
- COI matcher matches on shared institution id/name with no umbrella exemption;
  the alias table folds Janelia into HHMI. `[VERIFIED — audit §5b.2]`
- OpenAlex `associated_institutions` (typed `parent`/`child`/`related`) links
  Broad→MIT/Harvard, Whitehead→MIT, Harvard→40 affiliated hospitals; IAS→empty.
  `[VERIFIED via probe — audit §5b.3/5b.4]`
- Structured scholarly-email tier abstains on a top-2 address tie
  (`scholarly-email.js:249`), so dual-appointment alternates false-abstain.
  `[VERIFIED — audit §5b.4]`
- ORCID is not a unique key in practice (duplicate iDs). `[owner-stated + EXTERNAL — audit §5b.1]`

## Guiding invariants (apply to every phase)

1. **Safety posture is preserved.** Abstain-is-safe, fail-closed at the
   persistence/send boundary, forename-contradiction gate, and
   `research_only`-never-sends remain unchanged. No phase weakens them.
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
  vendors (Prophy evaluation is an owner decision, not assumed); changing the
  origination engine (Claude stays the spine).

---

## W0 — Institution identity substrate (shared foundation) `[PLANNED]`

**Goal.** One pure, cached helper: affiliation string → `{ openAlexId, ror,
country, displayName, associatedInstitutions[] }`, reusing
`OpenAlexService.searchInstitutions`/`getInstitution`. Underpins W1 and W2.

**Approach.** Additive service; no behavior change on its own. Cache per run.
Fail-open (unresolved institution → null, callers degrade to today's behavior).

**Invariant.** Pure/side-effect-free; returns null rather than guessing.
**Tests.** Resolution + associated-institutions shape for HHMI, Broad, Whitehead,
IAS (US vs DE), Harvard, Dana-Farber; unresolved/garbage → null.
**Gate.** Unit tests; no runtime surface, so no red-gate exposure.

## W1 — Affiliation & COI correctness (highest near-term value; live bug) `[PLANNED]`

Fixes false COI hard-drops and false affiliation-mismatch alerts. Ships first
because it has a live user-visible cost (good reviewers silently dropped).

- **W1.1 ID-space COI matching.** `institutionsMatchForCOI` resolves both sides
  via W0 and compares ids first; keep the existing name/abbreviation/campus
  fallback for unresolved cases.
- **W1.2 Mechanism-2 exemption overlay.** A curated id set (HHMI `I1344073410`,
  Broad `I107606265`) where a *shared* such institution alone is not COI.
  **Scoped to the institute id — a shared parent university still counts.**
- **W1.3 Un-fold the alias.** Remove `janelia` from the `'hhmi'` alias
  (`match-signals.js:158`) so the employer and the physical campus stop being
  conflated; Janelia-vs-Janelia stays a valid match.
- **W1.4 Mechanism-1 consistency (mismatch alert + resolver corroboration).**
  Two institutions are consistent when they share an id OR one is in the other's
  `associated_institutions`. Applied to `alert-reviewer-affiliation-mismatch.js`
  (stop false Broad/MIT, Dana-Farber/Harvard alerts) and to the resolver's
  institution-corroboration (a hospital `last_known_institution` no longer fails
  against a claimed university).
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
**Owner-gate.** Broad exemption strength (always vs only-when-primary-differs);
which umbrella orgs beyond HHMI/Broad.

## W2 — Works-first disambiguation resolver v2 (eval-gated) `[PLANNED]`

Hardens the prototype into a promotion-safe resolver. Built behind a seam;
production resolution does not switch until the eval gate + owner decision.

- **W2.1 Works-first candidate generation.** `raw_author_name.search` byline
  query + institution-id disambiguator (via W0), nickname/CJK variants,
  surname+forename byline gate. (Prototype in audit §5a.)
- **W2.2 ORCID-as-corroborator + duplicate-ORCID resolution.** Carry an ORCID
  *set*; distinguish duplicate-iD (same person: shared institution/co-authors/
  topic → bind, keep both) from namesake (contradicting → abstain) by
  corroboration agreement.
- **W2.3 Cluster-quality gates.** ORCID-richest/anchored-cluster preference (fixes
  the Keller fragment and Tsai merged-cluster false-binds); name-rarity /
  unique-anchor gate (abstain on high-fragmentation names without a unique
  anchor).
- **W2.4 Name-comparator consolidation.** Fold the three forename implementations
  (`discovery/name-matching`, `reviewer-identity-evidence`, work-author resolver)
  into one module with the benchmark as its spec; passthrough, no new defaults.

**Invariant.** Purely provisional (`probable` ceiling for automated); recall
gains do not regress safety — the eval gate below is the hard bar.
**Eval gate (hard).** Re-run the 40-case benchmark. Require: zero genuine
merged-cluster wrong-binds; misses ≤ current spine (11); correct-binds ≥ current
(14); no clean-positive abstention regression beyond the benchmark's tolerance.
No new rule without a first failing benchmark case (invariant 6).
**Owner-gate.** The abstain-vs-bind-right-person policy on fragmented famous
names (changes what the benchmark counts as correct); production cutover.

## W3 — Email discovery `[PLANNED]`

- **W3.1 Structured corresponding-author email.** Parse Europe PMC OA full-text
  `<corresp>` / `corresp="yes"` for a disambiguated corresponding email, instead
  of regex-tailing the affiliation string. Highest cheap recall+precision win.
- **W3.2 Alternates-not-conflict.** In `scholarly-email.js` selection, treat two
  addresses as same-person *alternates* (not a `conflict` abstain) when their
  domains are consistent with one person's institution set — shared registrable
  domain (psl) or domains mapping to `associated_institutions`. Pick one; a real
  `conflict` is only cross-person/unrelated-institution.
- **W3.3 Preferred email is reviewer-owned.** Pick a deliverable address for the
  invite; the magic-link accept confirms/corrects the preferred one
  (provisional-until-attested). No new schema.
- **W3.4 Paid-tier decision.** Resolve the Claude/Serp search tiers' fate given
  they currently yield mostly-unsendable `research_only` leads: either route
  their yield through the page-fetch tier (turn it on for an `institution_page`
  grade) or retire them to a staff faculty-page link.

**Invariant.** No search-sourced address becomes invitation-sendable
(Contract 3 unchanged); alternates resolution never promotes a cross-person
address.
**Tests.** `<corresp>` extraction fixtures; alternates-vs-conflict matrix
(harvard.edu subdomains → alternate; unrelated domains → conflict).
**Gates.** `check:prompt-injection-tagging` + self-test if the Tier-3 surface is
touched.
**Owner-gate.** Paid-tier fate; opt-in page-fetch tier on/off.

## W4 — Durable identity model `[PLANNED]`

- **W4.1 Evidence-bundle persistence.** Store `{ ORCID set, 3–5 anchor DOIs, ROR,
  OpenAlex author-id }` and re-resolve from anchors on reuse (OpenAlex 2026
  split/merge churn rots bare author-ids). Reconcile with the Wave 13 binding
  anchor rather than adding a parallel model.
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
| 1 | W0 substrate | — | main (additive, inert) | none (tests only) |
| 2 | W1 affiliation/COI | W0 | branch → main, tests + contract-reconcile | Broad policy; umbrella set |
| 3 | W2 disambiguation v2 | W0 | seam on main, legacy default | eval gate; cutover |
| 4 | W3 email | (W0 for 3.2) | branch → main | paid-tier fate; page-fetch |
| 5 | W4 durable model | W2 | additive schema wave | schema apply |

W1 is the highest near-term value (live false-drop bug) and is independent of the
disambiguation rebuild. W3.1 (`<corresp>`) is independent and could parallel W1.
W2 is the largest and is eval-gated. W4 underpins persistence and reconciles with
Wave 13.

## Open owner decisions

1. **Broad COI-exemption strength** — always exempt a shared Broad, or only when
   the two people's primary campuses differ?
2. **Umbrella/exempt org set** beyond HHMI + Broad (CZ Biohub, Simons/HFSP…)?
3. **Paid search-tier fate** — rehabilitate via the page-fetch tier, or retire to
   a staff faculty-page link?
4. **Turn on the opt-in page-fetch tier** (`REVIEWER_PAGE_EMAIL_TIER_ENABLED`)?
5. **Abstain vs bind-the-right-person** on fragmented famous names — does the
   benchmark keep abstain-expected, or credit a correct bind with a verify flag?
6. **Buy-vs-build** — evaluate Prophy for the discovery/disambiguation front half
   (it returns contact info; it is the ERC's tool), or stay fully in-house?
7. **Appetite / first pick** — stabilize (W1 only) vs rebuild (W1→W2→…)?

## Verification & regression strategy

- The frozen **40-case identity benchmark is the standing regression gate** for
  W2 (and any future disambiguation rule) — extend it, never bypass it. Exact
  numerators/denominators only; no population claims from 40 cases.
- W1 lands with a COI + affiliation-mismatch **test matrix** as its spec.
- Relevant red gates run sequentially with self-tests for the surfaces each phase
  touches; `/contract-reconcile` precedes every COI/persistence promotion;
  `/sweep` reconciles durable docs when a changed fact appears in multiple homes.

## Completion rule

Each workstream is "ready to promote" only when its named invariant holds under
test, its eval/matrix gate passes, the relevant red gates + self-tests are green,
and its owner gate is answered. Any unverified claim stays `[PLANNED]`/`[ASSUMED]`;
any red relevant gate blocks completion. Nothing in this plan is built until the
owner selects a first pick (decision 7).
