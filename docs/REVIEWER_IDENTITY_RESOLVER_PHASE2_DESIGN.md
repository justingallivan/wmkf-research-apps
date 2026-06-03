# Reviewer Identity Resolver — Phase 2 design (v3)

**Status:** Design spec, pre-implementation. **v3 (S214, 2026-06-02)** resolves the PR1-blocking inconsistencies Codex flagged in its v2 re-review. **No code yet.**

**v3 changelog (what the v2 re-review changed):**
- **PR1 resolver reframed as a post-enrichment *classifier*** — it consumes the ORCID/Scholar evidence the existing enrichment pipeline already gathered; **no new network calls, no new enumeration** in PR1. (Resolves: "no new external calls" vs §3 enumeration, "wrap not replace," where enumeration comes from.)
- **§4 vs §9.1 contradiction fixed:** a lone weak anchor (public-ORCID name match, or Scholar match alone) → `unresolved`; `probable` requires one *strong* anchor OR **≥2 corroborating weak signals** agreeing on the same person.
- **`confirmed` is explicitly NOT reachable in PR1** (needs the deferred faculty-page + publication-cluster evidence). PR1 tops out at `probable`.
- **Rejected-anchor memory marked PR1-deferred** (lands with the Postgres audit table); PR1 clearing is driven by the *current person record*, not memory.
- **Clear-on-downgrade scoped to resolver-sourced fields only** (Scholar id/url + metrics, ORCID id/url) — PR1 never touches faculty/website (provenance unknown).
- **Schema-first build order;** read-only legacy audit *before* broad write-gating; concrete **identity-bearing field/write inventory** added.
- **`confidenceBand` status→band map locked** (rejected/unresolved get *no* band).
- **Identity-level `rejected` given a deterministic rule;** EvidenceSource adapter boundary tightened; Scholar enumeration decided (single-candidate + displayed-name floor in PR1; multi-result deferred); ambiguity tests ride on ORCID multi-match (which already abstains).

**Relationship to prior work:** `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md` (the redesign plan; this is its Phase 2). **Phase 1 shipped** (`40d7327`/`5bf8d3b`/`c836f4a`): Scholar displayed-name guard, ORCID name-scoring, persistence gates, prod audit+remediation. `outputs/perplexity_reviewer_identification_strategy.md` (principle adopted, scope rejected).

**Guiding principle:** *unresolved is acceptable; wrong-and-confident is not.*

---

## 0. Decisions locked

| Q | Decision |
|---|---|
| **Storage substrate** | **Dataverse fields on `wmkf_potentialreviewers`** for the current decision (status/version/resolved-at/summary/compact anchor JSON). A **Postgres append-only audit table** (leads + rejected-anchor memory) lands **only when external/web leads are introduced** — not PR1. |
| **First-slice scope** | **Option (b):** a **post-enrichment classifier** `resolveIdentity()` that formalizes the Phase 1 floors + assigns `status`/`resolverVersion`, consuming evidence the enrichment pipeline already gathered. **No new external calls.** |
| **Resolver placement** | **Wrap** the existing flow: the resolver runs *after* `ContactEnrichmentService.enrichCandidate` (which already calls ORCID + Scholar) and *after* `verifyClaudeSuggestions`; it classifies, it does not re-fetch. Not replacing either in PR1. |
| **Confidence→status** | **Rule-based statuses only**; `confidenceBand` is display-only with a fixed map (§2.2). No numeric cutoffs. |
| **Legacy revalidation** | Read-only audit over the ~7 verified persons **first**, before any write-gating; remediation is a separate script/PR. |

**Scope staging:** PR1 = classifier + status model + write-gates + clear-on-downgrade + relevance gate (deterministic, no new calls). Later PRs: PubMed-cluster + faculty-page verification (enables `confirmed`), Postgres leads/rejected-anchor table + memory, ROR domain classification, Perplexity Search-API lead source, human-review/competitor UI.

---

## 1. Principles

1. **Deterministic resolver is the only decider;** hard floors override any signal.
2. **LLM/web sources are untrusted *lead* sources** — zero score (deferred; not in PR1).
3. **Re-verify anchors + enumerate competitors** (deferred enumeration beyond what enrichment already returns; see §3).
4. **Two levels of "no":** anchor-level (`RejectedAnchor` — *this evidence* is wrong; the default failed-check outcome) vs identity-level (`status: rejected` — *the whole hypothesis* is the wrong human; rare, deterministic rule in §3). **A bad Scholar lead rejects the anchor, never the candidate.**
5. **Shell first; web leads second.**

---

## 2. Data model

### 2.1 Input — `CandidateHypothesis`
```
CandidateHypothesis { name, claimedInstitution?, expertiseTerms[], seedPublications[], source, reason? }
```
**Mapping from existing call sites** (one normalizer, so sites don't drift):
- `name` ← `candidate.name`
- `claimedInstitution` ← `candidate.suggestedInstitution` ?? `candidate.affiliation`
- `expertiseTerms` ← `candidate.expertiseAreas` ?? split(`candidate.expertise`)
- `seedPublications` ← `candidate.publications`
- `source` ← `candidate.source` (`claude` | `pubmed` | `arxiv` | `biorxiv` | `applicant`); applicant recs carry `source:'applicant'`, saved candidates carry their original discovery source
- `reason` ← `candidate.reasoning` ?? `candidate.generatedReasoning`

### 2.2 Output — `ResolvedIdentity`
```
ResolvedIdentity {
  status: 'confirmed' | 'probable' | 'ambiguous' | 'unresolved' | 'rejected',  // identity level
  confidenceBand: 'high' | 'medium' | null,   // DISPLAY ONLY; see map below
  anchors: VerifiedAnchor[],          // verdict:'pass'
  rejectedAnchors: RejectedAnchor[],  // verdict:'fail' + reason (anchor-level)
  competitors: CompetingIdentity[],   // populated only when status='ambiguous'
  evidenceSummary: string,
  resolverVersion: string,
  resolvedAt: ISO8601
}
```
**`confidenceBand` map (locked):** `confirmed`→`high`, `probable`→`medium`, **`ambiguous`/`unresolved`/`rejected`→`null` (no band shown)**. The band is never a sort key.

### 2.3 `VerifiedAnchor` / `RejectedAnchor`
```
VerifiedAnchor {
  type: 'orcid_public' | 'scholar_profile' | 'institutional_email'
      | 'faculty_page' | 'publication_cluster',   // last two: later PR only
  canonicalKey: string,   // 'orcid:0000-...', 'scholar:<author_id>' — dedupe + (later) rejection memory
  value, weight: 'strong' | 'weak',   // ENUM
  sourceUrl?, retrievedAt, fetchResult, parserOutput, verifier, verdict: 'pass'|'fail'
}
RejectedAnchor = VerifiedAnchor + { reason }
```

### 2.4 `CompetingIdentity`
```
CompetingIdentity { name, primaryAnchor:{type,canonicalKey}, competingAffiliations[], conflictingEvidence[], whyUnresolved }
```

### 2.5 Persisted fields (Dataverse, on `wmkf_potentialreviewers`)
New: `identitystatus`, `identityconfidenceband`, `identityresolverversion`, `identityresolvedat`, `identityevidencesummary`, `identityverifiedanchorsjson` (compact; row-size-bounded — open Q §10). **Requires a schema deploy (new wave) — PR1 step 1.**

### 2.6 Clear-on-downgrade (PR1, memory-free)
Detection uses the **current person record** the adapter already reads (`getRecord` in `researcher.js`), not rejected-anchor memory: if the resolved status is **below `probable`** (or an anchor was rejected) **and** a resolver-sourced identity field is currently populated, clear it. Because `researcher.js` prunes nulls (won't clear), add **`clearIdentityFields(personId, fields[])`** that PATCHes explicit nulls via `DynamicsService.updateRecord` (the mechanism the S214 remediation used).
**PR1 clears ONLY resolver-sourced fields:** `wmkf_googlescholarid`, `wmkf_googlescholarurl`, `wmkf_hindex`, `wmkf_i10index`, `wmkf_totalcitations`, `wmkf_orcid`, `wmkf_orcidurl`. **Never `wmkf_website`/faculty fields in PR1** — their provenance (manual? applicant? enrichment?) is unknown; clearing waits until provenance tracking exists.

---

## 3. Algorithm (PR1 — deterministic classifier, no new calls)

```
resolveIdentity(hypothesis, evidence):   // evidence = what enrichment already gathered
  INPUTS (already fetched by ContactEnrichmentService.enrichCandidate):
    - scholar:  { displayName, scholarId, institutionMismatch, nameMismatch }  (Phase 1)
    - orcid:    findContact result OR an 'ambiguous'/null abstain (Phase 1 multi-match)
    - claimedInstitution, displayed/known affiliation

  1. ANCHOR CHECKS (Phase-1 floors, deterministic):
       scholar  → nameMismatch||institutionMismatch ⇒ RejectedAnchor('scholar', reason)
                  else weak VerifiedAnchor('scholar_profile')
       orcid    → findContact returned a name-matched record ⇒ weak VerifiedAnchor('orcid_public')
                  findContact abstained on multi-match ⇒ no anchor + competitors populated
       (institutional_email weak anchor: only if a verified-domain check is cheap; else skip PR1)
  2. (rejected-anchor memory consult — DEFERRED to the web-leads PR; not in PR1)
  3. STATUS (rule-based):
       confirmed  : NOT REACHABLE IN PR1 (requires faculty-page + consistent pub-cluster — later PR)
       probable   : one STRONG anchor (none available in PR1) OR ≥2 CORROBORATING WEAK signals
                    agreeing on the same person (e.g. orcid_public name-match AND scholar_profile
                    name-match, not contradicted)
       ambiguous  : ORCID multi-match abstain, or ≥2 competitors evidence can't separate
       unresolved : ≤1 weak signal, or none (a lone public-ORCID or lone Scholar match → unresolved)
       rejected   : DETERMINISTIC rule — a passing anchor positively resolves to a DIFFERENT named
                    human (its displayed name strongly matches someone other than the target) AND no
                    anchor supports the target. (Rare; not "subjective wrongness".)
  4. confidenceBand ← map(status) (§2.2)
  5. WRITE GATE: identity-bearing fields attach only when status ∈ {confirmed, probable};
       else clearIdentityFields(...) per §2.6.
```
**Scholar enumeration (decided):** PR1 treats Scholar as **single-candidate** and relies on the displayed-name floor (`findScholarProfileViaGoogle` returns one result today). Multi-result Scholar enumeration is a later PR. **Ambiguity is exercised via ORCID multi-match**, which Phase 1 already abstains on.
**Later PR adds:** PubMed-cluster + faculty-page verification (with cluster invariants: recurring coauthors + stable affiliation lineage + topical coherence; count alone never confirms), enabling `confirmed` and competitor enumeration beyond ORCID.

---

## 4. Evidence weighting (hard floors, not soft weights)

- **Strong** (can support `confirmed` — **all later-PR**): authenticated ORCID (reviewer OAuth — *not built*); verified faculty/staff page; verified institutional email/domain; internally-consistent publication cluster; multi-source agreement.
- **Weak** (never sufficient *alone*): **public ORCID search match** (`ORCIDService.findContact` — name-scored, not authenticated); Scholar profile match; same institution/lab; shared coauthors; topical similarity; name variants.
- **Negative / hard-reject:** displayed-name mismatch; source is a different same-lab person; conflicting affiliation w/o corroboration; cross-identifier disagreement.

**Promotion rule (resolves the v2 contradiction):** a lone weak anchor → `unresolved`. `probable` needs **≥2 corroborating weak signals** (or one strong, which PR1 lacks). So in PR1, public-ORCID-alone and Scholar-alone are both `unresolved`; the two *agreeing* → `probable`.

---

## 5. Evidence-source interface (later PR; stated for completeness)

```
EvidenceSource.gatherAnchors(hypothesis) → CandidateLead[]   // {type,value,sourceUrl,retrievedAt,rawSnippet} ONLY
```
Sources return **leads with provenance, never verdicts/scores**. **Verification, enumeration, and the existing ORCID/Scholar selection logic (name-scoring, single-result) are resolver-owned** — i.e. in PR1 the resolver consumes the enrichment result and applies the §3 rules; it does not let a source emit a status. When the Search-API lead source lands, it implements this same leads-only contract.

---

## 6. Persistence & governance
- **PR1:** persist the §2.5 decision on the person; gate **all** identity-bearing writes on status; clear-on-downgrade (§2.6).
- **Later:** Postgres append-only `identity_leads` + rejected-anchor memory; resolver-versioned decisions → replay/drift.
- **Legacy:** read-only audit over ~7 persons → report → remediation script (separate PR), run **before** broad write-gating.

---

## 7. Perplexity (DEFERRED — later PR, spec only)
Search API (`/search`, not sonar) — ranked `results[]` (`title/url/snippet/date/last_updated`) → counter-candidate enumeration + freshness + provenance. Anchors from `results[].url` only (never model-authored URLs — Perplexity docs warn they hallucinate). A7-wrap before parse/downstream prompt; domain allowlist + content-type before re-fetch. Freshness via `date`/`last_updated` or label stale. Invoke only after cheap deterministic sources fail, ambiguous/selected candidates only, cache by (query+resolverVersion), never hot-path. **Required before any persistence path: a live contract test against real Search-API responses** (the docs-pass verified the fields; pin with a test).

---

## 8. Hard cases → rules (gold set)
| Case | Rule |
|---|---|
| Same-lab member (Tsai→Nakano) | Scholar displayed-name mismatch = hard anchor-reject |
| Common name (Wei Zhang) | ORCID multi-match → `ambiguous` + competitors; never auto-pick |
| Moved affiliation | (later) prioritize identity/pub anchors over current-affiliation snippet; mark contact stale |
| Sparse senior PI | (later) faculty + ORCID + landmark pubs → confirmed; identity ≠ activity score |
| Shared profile id (Noe/Clementi) | one author_id on >1 person → de-collide via displayed name; reject non-owner's anchor |

---

## 9. PR1 build plan (schema-first, safe order)

1. **Dataverse schema deploy** — the 6 §2.5 identity fields on `wmkf_potentialreviewers` (new wave). *Must precede any code that reads/writes them.*
2. **`lib/services/reviewer-identity-resolver.js`** — `resolveIdentity(hypothesis, evidence)` → §2.2 shape, PR1 rules only (§3). Pure/unit-testable; no network.
3. **Read-only legacy audit** over the ~7 verified persons using the new resolver → report proposed downgrades/clears. *Before* enabling write-gates. (Remediation = separate PR.)
4. **Thread `resolvedIdentity`** through `ContactEnrichmentService.enrichCandidate` → its consumers; gate **all** identity-bearing writes + clear-on-downgrade at the write paths:
   - **Fields gated/cleared:** `wmkf_googlescholarid`, `wmkf_googlescholarurl`, `wmkf_hindex`, `wmkf_i10index`, `wmkf_totalcitations`, `wmkf_orcid`, `wmkf_orcidurl`.
   - **Write paths:** `researcherAdapter.upsertByPotentialReviewer` (from `save-candidates.js` + `enrich-recommended.js`) and `researcherAdapter.updateById` (from `my-candidates.js` PATCH). `discover.js` is search-only (no persist). New `clearIdentityFields`.
5. **`scoreRelevance()`** counts h-index/citations only when persisted `identitystatus ∈ {confirmed, probable}`.
6. **Regression tests:** Tsai/Nakano anchor-reject; ORCID multi-match → `ambiguous`; lone weak signal → `unresolved`; two-weak-agree → `probable`; stale persisted metric not reused; relevance gating off below `probable`.

---

## 10. Remaining open questions (genuinely open)
1. Dataverse field types + which wave for §2.5; does `identityverifiedanchorsjson` risk row-size limits (keep compact / cap anchors)?
2. `evidence` object shape handed to `resolveIdentity()` — exact fields `enrichCandidate` exposes today vs what the classifier needs (verify at impl).
3. (Later PR) trusted-institutional-domain classification without ROR — affiliation-token match vs static allowlist.

## 11. Integration points (verify signatures at impl)
`lib/services/contact-enrichment-service.js` (`enrichCandidate`, `_attachScholarMetrics`, `scholarIdentityStatus`) · `lib/services/serp-contact-service.js` (`scholarNameMismatch`, `findScholarProfileViaGoogle`) · `lib/services/orcid-service.js` (`findContact`, `_nameMatchesTarget`) · `lib/dataverse/adapters/researcher.js` (`upsertByPotentialReviewer`, `updateById`, + new `clearIdentityFields`) · `lib/utils/contact-parser.js` (`namesMatch`) · `lib/utils/relevance-score.js` (`scoreRelevance`) · `pages/api/reviewer-finder/{save-candidates,my-candidates,discover}.js` · `pages/api/workbench/enrich-recommended.js` · `lib/services/discovery-service.js` (`verifyClaudeSuggestions` — wrapped, not replaced).
