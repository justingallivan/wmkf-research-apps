# Reviewer Identity Reconciliation Edits

Date: 2026-06-08

Purpose: proposed reconciliation edits for the reviewer identity docs after comparing the strategy evaluation against HEAD code. This file is a review artifact; it does not itself update the canonical plan/spec documents.

Related write-up: `docs/REVIEWER_IDENTITY_STRATEGY_EVALUATION.md`

## Summary

Several statements in `docs/REVIEWER_TRACK_B_IDENTITY_SPEC.md` and `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md` describe earlier planned or pre-implementation states. HEAD code now implements part of the Track-B identity architecture, including work-first author resolution and ORCID-anchored enrichment. The docs should be reconciled so future readers do not re-plan shipped work or miss the remaining gaps.

## Reconciliation Edits For `docs/REVIEWER_TRACK_B_IDENTITY_SPEC.md`

### 1. Status Header

Current issue: the document is still marked `Status: PROPOSED`, but HEAD contains core pieces of the proposal.

Suggested edit:

Replace the status line with:

```md
Status: PARTIALLY IMPLEMENTED. HEAD includes work-first Track-B author resolution, top-N identity resolution, shared-ORCID merge into needs-review Track-A candidates, OpenAlex work lookup by DOI/PMID/arXiv DOI/title, and candidate-ORCID anchored Tier-2 enrichment. Remaining gaps include fully threading ORCID-resolved current affiliation into Tier-3/4 queries and contradiction guards, enforcing anchor-or-abstain for deferred Track-B candidates, and preventing topic overlap from being displayed as identity confirmation.
```

### 2. Section 1: Track-B Still Bypasses The Spine

Current issue: the section says Track-B still bypasses the spine entirely and surfaces as selectable with no verified identity and no ORCID. HEAD now routes the top-ranked Track-B candidates through `resolveTrackBIdentities()` and `ReviewerWorkAuthorResolver.resolveCandidate()`.

Suggested replacement for the affected claim:

```md
[STALE as of 2026-06-08] Earlier versions pushed Track-B candidates straight to `results.discovered` after MIN_PUBLICATIONS + COI filtering. HEAD now resolves the top-ranked Track-B candidates through `DiscoveryService.resolveTrackBIdentities()` and `ReviewerWorkAuthorResolver.resolveCandidate()`, producing work-grounded authorship anchors, optional ORCID, OpenAlex author/work IDs, identity status, and identity notes.

[VERIFIED REMAINING GAP] Candidates beyond `TRACK_B_IDENTITY_RESOLUTION_LIMIT` are deferred and still flow into the discovered output alongside resolved candidates. If those deferred candidates remain selectable downstream, they violate anchor-or-abstain.
```

### 3. Section 4: Architecture Markers

Current issue: items marked `[NEW]` and `[CHANGE]` are now partly implemented.

Suggested edit:

Change:

```md
[NEW] `lib/services/reviewer-work-author-resolver.js`
```

to:

```md
[IMPLEMENTED] `lib/services/reviewer-work-author-resolver.js` exists and resolves a candidate from the surfacing publication by OpenAlex work lookup, exact-title fallback for title search, unique authorship match, and identity anchors.
```

Change:

```md
[CHANGE] ContactEnrichmentService Tier 2: if candidate.orcid present, fetch by getProfile(orcid)
```

to:

```md
[PARTIALLY IMPLEMENTED] `ContactEnrichmentService` now builds an identity anchor from candidate ORCID and calls `_getAnchoredOrcidProfile()` / `ORCIDService.getProfile()` instead of name-searching ORCID when that anchor exists. Remaining gap: ORCID-resolved current affiliation is collected into `contactEnrichment.orcidAffiliation` but is not used early enough to constrain Tier-3/4 search queries or the anchor contradiction guard.
```

### 4. Section 5: Work Resolver Contract

Current issue: the proposed contract mostly exists, but implementation details differ.

Suggested note to add after the contract:

```md
[IMPLEMENTED NOTES as of 2026-06-08]
- `OpenAlexService.getWorkByExternalId()` supports DOI, PMID, and arXiv via canonical arXiv DOI (`10.48550/arXiv.<id>`), not `ids.arxiv`.
- `ReviewerWorkAuthorResolver.resolveWork()` trusts a unique external-ID hit without exact title matching, because arXiv/preprint titles can drift; exact normalized title matching is used on title-search fallback.
- `ReviewerWorkAuthorResolver.resolveCandidate()` abstains on no publication, source outage/timeout, unresolved work, no author match, or ambiguous author match.
```

### 5. Section 6: Resolver Anchors + Rule

Current issue: the doc says ORCID employment corroboration is part of the proposed rule, but HEAD `ReviewerWorkAuthorResolver` emits `authorship_grounded`, `topic_match`, and `orcid_present`; it does not fetch ORCID employment in that resolver path.

Suggested edit:

```md
[PARTIALLY IMPLEMENTED] HEAD emits `authorship_grounded` as strong, `topic_match` as weak when OpenAlex work topics exist, and `orcid_present` as weak when OpenAlex authorship carries ORCID. The resolver path does not currently perform ORCID employment corroboration during Track-B identity resolution.
```

### 6. Section 8: Merge Into Track-A Needs-Review Twin

Current issue: shared-ORCID merge is implemented, but only when both sides already have matching ORCID.

Suggested edit:

```md
[IMPLEMENTED WITH NARROWER RULE] `DiscoveryService.mergeTrackBWithNeedsReviewBySharedOrcid()` upgrades an unverified Track-A candidate only when the discovered candidate is work-resolved, has a normalized ORCID, and an unverified Track-A row has the same normalized ORCID. It does not currently merge by name-only, and it does not implement the looser "Track-A has no ORCID but discovered ORCID employment/topics corroborate proposal-named context" option.
```

### 7. Section 9: Enrichment Anchoring

Current issue: the doc states candidate ORCID is ignored by Tier 2; this is stale. The actual remaining bug is narrower.

Suggested replacement:

```md
[STALE] Tier 2 no longer unconditionally ignores candidate ORCID. HEAD builds an identity anchor from candidate ORCID and fetches the ORCID profile by ID when present.

[VERIFIED REMAINING GAP] The ORCID profile's current affiliation is captured only after Tier 2 returns, as `contactEnrichment.orcidAffiliation`. Tier 3/4 still receive the original candidate object, and `_resultContradictsAnchor()` compares against the original anchor institution. When discovery affiliation is empty, the contradiction guard remains toothless even if ORCID later resolved the true institution.
```

### 8. Section 10: Fan-Out / Budget / Latency

Current issue: the cap exists, but the sequential wall-clock risk remains.

Suggested edit:

```md
[PARTIALLY IMPLEMENTED] Discovery caps Track-B identity resolution at `TRACK_B_IDENTITY_RESOLUTION_LIMIT` and records deferred count. However, `resolveTrackBIdentities()` still processes candidates sequentially, and contact enrichment is also sequential per candidate. Latency remains a binding constraint even with the cap.
```

## Reconciliation Edits For `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`

### 1. Status Header

Current issue: the plan says "Design proposal (no code yet)." HEAD contains Phase-1-like Scholar name guard and Phase-2-like identity resolver pieces.

Suggested edit:

```md
Status: PARTIALLY IMPLEMENTED / HISTORICAL DESIGN PLAN. This document records the original redesign rationale. HEAD now includes a Scholar displayed-name mismatch guard, identity-gated Scholar persistence behavior in enrichment save paths, Track-B work-author identity resolution, and candidate-ORCID anchored Tier-2 enrichment. Remaining architectural gaps are tracked separately in the 2026-06-08 reconciliation notes.
```

### 2. Verified-at-code-Level Claim About Scholar First-Result Without Name Guard

Current issue: this was true at plan creation, but HEAD now has `extractScholarDisplayName()` and `scholarNameMismatch()`, and `_attachScholarMetrics()` skips profile metrics when `nameMismatch` is true.

Suggested edit:

```md
[STALE as of 2026-06-08] The original Tsai/Nakano diagnosis was accurate when written, but HEAD now includes a strict Scholar displayed-name mismatch guard. The remaining limitation is that Scholar search is still first citations URL from ordinary Google search; non-rejection is keep-biased and must not be interpreted as identity confirmation.
```

### 3. ORCID As Enrichment Tier, Not Disambiguation Authority

Current issue: still partly true, but candidate-ORCID anchoring now exists.

Suggested edit:

```md
[PARTIALLY STALE] ORCID name search remains risky for unanchored candidates, but `ContactEnrichmentService` now uses an existing candidate ORCID as an anchor and fetches by ORCID ID. The remaining risk is unanchored ORCID name search and late use of ORCID current affiliation for subsequent web-search anchoring.
```

### 4. Persistence Accepts Identity Fields Without Confidence

Current issue: this may still be true in some save paths not reviewed for this evaluation, but the reviewed enrichment save path has identity gating.

Suggested edit:

```md
[NEEDS RE-VERIFICATION] The original plan states that persistence accepts enriched identity fields without identity-confidence status. In the reviewed `ContactEnrichmentService.saveToDatabase()` path, identity gating now blocks resolver-sourced ORCID/Scholar fields when `mayPersistIdentity()` fails and clears resolver-sourced fields on downgrade. Other save paths named in this plan should be rechecked before this claim is repeated globally.
```

### 5. Phase 1 / Phase 2 Adoption

Current issue: parts of Phase 1 and Phase 2 are implemented, but the plan still reads as future work.

Suggested edit:

```md
[PARTIALLY IMPLEMENTED] Phase 1 Scholar displayed-name guard exists. Phase 2 exists in partial form: Track-B has work-grounded identity resolution, and enrichment attaches resolver verdicts before persistence. The unresolved design question is no longer whether to introduce the resolver; it is how strictly to enforce anchor-or-abstain across deferred candidates and contact/bibliometric field emission.
```

## Open Reconciliation Questions

1. Should `docs/REVIEWER_TRACK_B_IDENTITY_SPEC.md` remain as a historical spec with implementation-status annotations, or should it be rewritten as the current contract?
2. Should `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md` be preserved as historical rationale and linked forward to a newer contract doc?
3. Which downstream UI/save paths decide whether deferred Track-B candidates are selectable? This reconciliation only verified that deferred candidates flow into discovered output from `DiscoveryService.discover()`.
4. Are topic-overlap labels generated in UI code outside the reviewed files? The strategy evaluation verified the risk from the failure case and source-level topic usage, but not the exact card rendering path.

## Reconciled Bottom Line

The original direction was right, but the docs lag HEAD. The remaining work is not "build Track-B identity resolution from scratch." It is tightening enforcement:

- ORCID-resolved current affiliation must constrain Tier-3/4 search and contradiction checks.
- Unanchored/deferred candidates must not emit confident contact, website, Scholar, or bibliometric fields.
- Topic overlap must remain relevance evidence, not identity confirmation.
- More broad Google/Scholar search should not be treated as the primary fix under the current sequential latency model.
