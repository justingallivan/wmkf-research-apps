# Reviewer Identity Resolver — Phase 2 design (v2)

**Status:** Design spec, pre-implementation. **v2 (S214, 2026-06-02)** incorporates a Codex pre-impl review of v1 (rescue-path) + a verified pass over the Perplexity API docs. **No code yet.**

**v2 changelog (what the Codex review changed):** identity-level vs anchor-level rejection split; status now drives **every** identity-bearing write, not just Scholar; explicit **clear/invalidation** semantics on downgrade; `confidence` demoted to display-only bands (rule-based status, no numeric cutoffs); `VerifiedAnchor.weight` → enum + `canonicalKey`; "authenticated ORCID" reclassified (we only have public ORCID search); faculty-domain policy generalized; `EvidenceSource` returns leads-only (verification is resolver-owned); `identity_leads` store + ROR + faculty-fetch + pub-cluster-as-confirmed **deferred** out of PR1; storage substrate decided (Dataverse fields on the person, Postgres audit table only when web leads land); staged build plan added.

**Relationship to prior work:**
- `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md` — the Codex redesign plan; this is its concrete Phase 2.
- **Phase 1 shipped** (`40d7327`/`5bf8d3b`/`c836f4a`): Scholar displayed-name guard, ORCID name-scoring, persistence gates, prod audit+remediation. Phase 2 generalizes those point-fixes into one resolver.
- `outputs/perplexity_reviewer_identification_strategy.md` — Perplexity's proposal; principle/status model adopted, scope rejected.

**Guiding principle:** *unresolved is acceptable; wrong-and-confident is not.*

---

## 0. Decisions locked (from Codex pre-impl review)

| Q | Decision |
|---|---|
| **Storage substrate** | **Dataverse fields on `wmkf_potentialreviewers`** for the *current* decision (status, resolver version, resolved-at, evidence summary, compact verified-anchor JSON). A small **Postgres append-only audit table** for leads + rejected-anchor memory is added **only when external/web leads (Search API/Perplexity) are introduced** — not in PR1. (Dataverse = reviewer-identity ground truth; high-volume experimental leads don't belong on the person row.) |
| **First-slice scope** | **Option (b):** formalize the Phase 1 floors + `status`/`resolverVersion` into a `resolveIdentity()` that the existing endpoints call, plus cheap ORCID/Scholar normalization already available. No PubMed-clustering or faculty-page fetching in PR1. |
| **Resolver placement** | **Wrap** `verifyClaudeSuggestions`, do not replace it in PR1 (it also supplies publications/affiliation/COI inputs/UI fields — replacing risks regression). |
| **Confidence→status** | **Rule-based statuses only**, with optional **display-only confidence bands**. No tunable numeric cutoffs (a numeric knob drifts into "score buys back a failure"). |
| **Legacy revalidation** | Re-run the resolver over the ~7 already-verified persons, **read-only audit report first**, remediation as a separate script/PR. |

**Scope staging:** PR1 = enforcement boundary + status model + write-gates + relevance gate (deterministic, no new external calls). Later PRs add: PubMed-cluster + faculty-page verification, the Postgres leads/rejected-anchor table, ROR, and the Perplexity Search-API lead source.

---

## 1. Principles

1. **Deterministic resolver is the only decider.** Hard rejection floors override any score.
2. **LLM/web sources are untrusted *lead* sources** — zero direct score; they surface anchors to verify.
3. **Re-verify anchors deterministically AND enumerate competitors** (validating a provided anchor in isolation is insufficient — selection bias).
4. **Two levels of "no":**
   - **anchor-level** (`RejectedAnchor`) — *this evidence* is wrong/doesn't belong to the target. The default outcome of a failed check.
   - **identity-level** (`status: rejected`) — *this whole reviewer hypothesis* maps to the wrong human. Rare; requires positive evidence, not just a failed anchor. **A bad Scholar lead rejects the anchor, never the candidate.**
5. **Shell first, web leads second.**

---

## 2. Data model

### 2.1 Input — `CandidateHypothesis`
Discovery produces a hypothesis, not a resolved person. **Field mapping (existing call sites):** `claimedInstitution` ← `candidate.suggestedInstitution` ?? `candidate.affiliation`; `seedPublications` ← `candidate.publications`. A single adapter normalizes hypotheses from `verifyClaudeSuggestions`, applicant recommendations, and saved candidates so call sites don't drift.
```
CandidateHypothesis { name, claimedInstitution?, expertiseTerms[], seedPublications[], source, reason? }
```

### 2.2 Output — `ResolvedIdentity`
```
ResolvedIdentity {
  status: 'confirmed' | 'probable' | 'ambiguous' | 'unresolved' | 'rejected',  // IDENTITY level
  confidenceBand: 'high' | 'medium' | 'low',   // DISPLAY ONLY — derived from status, never a sort key
  anchors: VerifiedAnchor[],          // verdict:'pass' only
  rejectedAnchors: RejectedAnchor[],  // verdict:'fail' + reason (anchor-level, NOT identity rejection)
  competitors: CompetingIdentity[],
  evidenceSummary: string,
  resolverVersion: string,            // semver of the rule set
  resolvedAt: ISO8601
}
```
`status: rejected` is reserved for the rare case where positive evidence shows the *whole hypothesis* is the wrong human; a failed anchor alone yields `rejectedAnchors` + a lower status (ambiguous/unresolved), not identity rejection.

### 2.3 `VerifiedAnchor` / `RejectedAnchor` (provenance unit)
```
VerifiedAnchor {
  type: 'orcid_public' | 'faculty_page' | 'institutional_email' | 'scholar_profile' | 'publication_cluster',
  canonicalKey: string,    // e.g. 'orcid:0000-...', 'scholar:<author_id>' — dedupe + rejection-memory key
  value: string,
  weight: 'strong' | 'weak',          // ENUM, not a number (no soft-weight system)
  sourceUrl: string?,      // optional for publication_cluster
  retrievedAt: ISO8601,
  fetchResult: 'ok' | 'http_error' | 'blocked_domain' | 'wrong_content_type',
  parserOutput: object,    // what we extracted (e.g. displayed name on the page)
  verifier: string,        // which deterministic check + version
  verdict: 'pass' | 'fail'
}
RejectedAnchor = VerifiedAnchor + { reason: string }
```

### 2.4 `CompetingIdentity`
```
CompetingIdentity { name, primaryAnchor: {type, canonicalKey}, competingAffiliations[], conflictingEvidence[], whyUnresolved }
```

### 2.5 Persisted fields (Dataverse, on `wmkf_potentialreviewers`)
New: `identitystatus`, `identityconfidenceband`, `identityresolverversion`, `identityresolvedat`, `identityevidencesummary`, `identityverifiedanchorsjson` (compact). **Requires a small schema deploy (new wave)** — flagged as a task.

### 2.6 Clearing / invalidation semantics (Codex critical gap #2)
`researcher.js` upsert **prunes nulls** (metrics overwrite; identifiers fill-empty) — so a downgrade can't clear a wrong value through the normal path. Add an explicit **`clearIdentityFields(personId, fields[])`** that PATCHes explicit nulls (via `DynamicsService.updateRecord`, which does not prune — same mechanism the S214 remediation used). When a resolver decision downgrades below `probable` or rejects an anchor that was previously persisted, the corresponding fields (`wmkf_googlescholarid/url`, `wmkf_orcid/url`, `wmkf_hindex/i10index/totalcitations`, faculty/website if anchor-derived) are explicitly cleared.

---

## 3. Algorithm (deterministic core)

```
resolveIdentity(hypothesis, evidence):
  1. ENUMERATE candidates independently (not from a single provider's pick).
       PR1: ORCID name-matched records (orcid-service), Scholar profile(s).
       NOTE: SerpContactService.findScholarProfileViaGoogle returns only the FIRST
       citations result today → PR1 either (a) treats Scholar as single-candidate
       and relies on the displayed-name floor, or (b) defers Scholar enumeration.
       Later PR: PubMed author cluster(s), Search-API results[].
  2. CONSULT rejected-anchor memory by canonicalKey — skip/auto-fail anchors
       previously rejected for this person (keyed (personId, canonicalKey, resolverVersion);
       a resolver-version bump invalidates old rejections so rules can be re-applied).
  3. VERIFY each anchor deterministically (resolver-owned, NOT in the source layer):
       scholar  → displayed-name match (Phase 1 scholarNameMismatch) — HARD floor
       orcid    → name match + (later) publication-cluster overlap
       email    → domain compatible with a known affiliation (conservative; ROR later)
       faculty  → page displayed-name match + trusted-institutional-domain + content-type
  4. CONTRADICTION search: lab-name-in-snippet with a DIFFERENT profile name = reject anchor.
  5. HARD FLOORS: displayed-name mismatch → that anchor rejected; name+institution only → status ≤ ambiguous.
  6. STATUS (rule-based, no numeric cutoff):
       confirmed  : multi-source agreement — e.g. faculty-page name match + ORCID name match
                    + consistent publication cluster, no live contradiction.
                    (Single public-ORCID or single Scholar match is NOT enough — see §4.)
       probable   : one strong anchor OR cross-source name agreement, no contradiction.
       ambiguous  : ≥2 viable competitors evidence can't separate.
       unresolved : insufficient evidence.
       rejected   : positive evidence the best candidate is the wrong human (rare).
  7. Identity-bearing fields attach ONLY when status ∈ {confirmed, probable}; else clear (§2.6).
```
**Publication-cluster invariants (Codex critical gap #5):** a PubMed *count* alone never yields `confirmed`. A cluster counts as a strong anchor only with internal consistency checks (recurring coauthors + stable affiliation lineage + topical coherence) — **deferred to the later PR**; PR1 does not treat pub-cluster as confirming.

---

## 4. Evidence weighting (hard floors, not soft weights)

- **Strong:** *authenticated* ORCID (reviewer-claimed via OAuth — **we don't have this flow today**); verified institutional faculty/staff page; verified institutional email/domain; internally-consistent publication cluster; multi-source agreement.
- **Weak (never sufficient alone):** **public ORCID search match** (what `ORCIDService.findContact` actually produces — name-scored, not reviewer-authenticated); same institution; same lab; shared coauthors; topical similarity; Scholar profile similarity; name variants.
- **Negative / hard-reject:** displayed-name mismatch; source belongs to a different same-lab person; conflicting affiliation w/o corroboration; non-aligning clusters; cross-identifier disagreement.

**Consequence:** until an authenticated-ORCID flow exists, `confirmed` requires **multi-source agreement**; a lone public-ORCID or lone Scholar match tops out at `probable`.

---

## 5. Evidence-source interface

```
EvidenceSource.gatherAnchors(hypothesis) → CandidateAnchor[]   // LEADS + source metadata ONLY
```
Sources return **unverified leads with provenance** (`{type, value, sourceUrl, retrievedAt, rawSnippet}`) — **never** verifier fields or verdicts. Verification + enumeration + scoring are **resolver-owned** (else a source smuggles decisions into the lead layer). Deterministic sources (ORCID, PubMed, faculty-page fetch) and lead sources (Perplexity Search API) implement the same contract; a lead source can never return a status or score.

---

## 6. Persistence & governance

- **PR1:** persist the resolver decision (§2.5 Dataverse fields) on the person; gate **all** identity-bearing writes on status (Codex gap #1 — not just Scholar); clear on downgrade (§2.6).
- **Later:** Postgres append-only `identity_leads` + rejected-anchor memory table (only when web leads land); resolver-versioned decisions enable replay/drift measurement.
- **Legacy revalidation:** re-run over the ~7 verified persons → read-only report → remediation script (separate PR).

---

## 7. Perplexity (DEFERRED — later PR, spec only)

Behind a flag + provider allowlist (`vrp-providers.js`). **Use the Search API (`/search`), not sonar chat** — verified in docs: returns a ranked `results[]` array (`title/url/snippet/date/last_updated`) giving counter-candidate enumeration + freshness + structured provenance; sonar returns one prose answer to distrust. Anchors come from `results[].url` (retrieved pages), **never model-authored URLs** (Perplexity's docs warn those hallucinate). Untrusted-input handling: A7 wrap before parse + before any downstream prompt; domain allowlist + content-type check before re-fetch (`safeFetch` only protects transport). Freshness via `date`/`last_updated` or label stale. Cost: only after cheap deterministic sources fail, only for ambiguous/selected candidates, cache by (query+resolverVersion), never hot-path. **Required before enabling any persistence path: a contract test against real Search-API responses** (Codex did not independently re-verify the `date`/`last_updated` fields this round; the docs-pass did, but pin it with a live contract test).

---

## 8. Hard cases → rules (gold set / regression targets)

| Case | Rule |
|---|---|
| Same-lab member (Tsai→Nakano) | profile displayed-name mismatch = hard anchor-reject |
| Common name (Wei Zhang) | ≥2 independent strong signals required; else `ambiguous` + show competitors |
| Moved affiliation | prioritize identity/pub anchors over current-affiliation snippet; mark contact stale until a current page/ORCID employment confirms |
| Sparse senior PI | faculty page + ORCID + landmark pubs can confirm; separate identity from reviewer-activity score |
| Shared profile id (Noe/Clementi) | one author_id on >1 person → de-collide via displayed name; reject the non-owner's anchor |

---

## 9. Staged build plan

**PR1 (deterministic shell, no new external calls):**
1. `lib/services/reviewer-identity-resolver.js` `resolveIdentity(candidate, evidence)` → §2.2 shape; **Phase-1-derived rules only** (Scholar name/institution skip, public-ORCID name-matched → `probable`, unresolved fallback).
2. Thread `resolvedIdentity` through `ContactEnrichmentService.enrichCandidate`, `save-candidates.js`, `enrich-recommended.js`; gate **every** identity-bearing write + clear-on-downgrade.
3. `scoreRelevance()` counts h-index/citations **only** when persisted status ∈ {confirmed, probable}.
4. Dataverse schema deploy for §2.5 fields (new wave).
5. Regression tests: Tsai/Nakano, Wei Zhang ambiguity, ORCID multi-match abstain, stale-metric-not-reused, relevance gating.
6. Read-only legacy audit over the ~7 verified persons → report (remediation separate).

**Later PRs:** PubMed-cluster + faculty-page verification (with cluster invariants); `identity_leads`/rejected-anchor Postgres table; ROR domain classification; Perplexity Search-API lead source + contract test; human-review queue + competitor UI.

---

## 10. Remaining open questions
1. Dataverse field naming/types for §2.5 + which wave; does `identityverifiedanchorsjson` risk row-size limits? (compact only.)
2. PR1 Scholar enumeration: single-candidate + floor (a) vs defer Scholar entirely (b) until multi-result enumeration exists.
3. Exact `confidenceBand` mapping from status (display only) — needed for the staff card.
4. Trusted-institutional-domain classification without ROR: match against the candidate's known affiliation tokens only, or a static allowlist?

## 11. Integration points (verify signatures at impl)
`lib/services/discovery-service.js` (`verifyClaudeSuggestions`, `checkInstitutionMismatch`, `generateNameVariants`) · `lib/services/contact-enrichment-service.js` (`enrichCandidate`, `_attachScholarMetrics`, `scholarIdentityStatus`) · `lib/services/serp-contact-service.js` (`scholarNameMismatch`, `findScholarProfileViaGoogle`) · `lib/services/orcid-service.js` (`findContact`, `_nameMatchesTarget`) · `lib/dataverse/adapters/researcher.js` (`upsertByPotentialReviewer`, + new `clearIdentityFields`) · `lib/utils/contact-parser.js` (`namesMatch`) · `lib/utils/relevance-score.js` (`scoreRelevance`) · `pages/api/reviewer-finder/{discover,save-candidates,my-candidates}.js` · `pages/api/workbench/enrich-recommended.js` · `lib/services/multi-llm-service.js` (`_callPerplexity`) / new Search-API adapter.
