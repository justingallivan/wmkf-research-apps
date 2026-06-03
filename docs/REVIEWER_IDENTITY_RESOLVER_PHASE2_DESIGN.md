# Reviewer Identity Resolver — Phase 2 design

**Status:** Design spec, pre-implementation (S214, 2026-06-02). Author: Claude, incorporating a Codex adversarial review (rescue-path) and a verified pass over the Perplexity API docs. **No code yet** — this is the artifact for Codex pre-impl review before the shell is built.

**Relationship to prior work:**
- `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md` — the Codex redesign plan. This doc is the concrete **Phase 2** spec (the shared resolver) it called for.
- **Phase 1 shipped** (commits `40d7327`/`5bf8d3b`/`c836f4a`): Scholar displayed-name guard (`SerpContactService.scholarNameMismatch`), ORCID name-scoring (`ORCIDService._nameMatchesTarget`), persistence gates in `save-candidates.js` + `workbench/enrich-recommended.js`, and a prod audit+remediation. Phase 2 generalizes those point-fixes into one resolver.
- `outputs/perplexity_reviewer_identification_strategy.md` — Perplexity's own (grandiose) proposal. We adopt its principle and status model, reject its scope (person-graph, licensed DBs, training) for now.

**Guiding principle (unchanged):** *unresolved is acceptable; wrong-and-confident is not.*

---

## 1. Locked principles (decided S214)

1. **The deterministic resolver is the only decider.** Status ∈ `confirmed | probable | ambiguous | unresolved | rejected`. **Hard rejection floors** (e.g. displayed-name mismatch) override any relevance/bibliometric score — a score can never buy back a name failure.
2. **LLM/web sources are untrusted *lead* sources, never confidence sources.** They surface candidate **anchors** to verify; they add **zero** score directly. (Phase 1 already proved the deterministic name check, not an LLM, catches the live failures.)
3. **Anchors are re-verified deterministically, and the resolver enumerates its own competitors.** Validating a lead-provided anchor in isolation is insufficient (selection bias — the provider chose which anchor to surface and may omit competitors). Every anchor competes against independently-discovered alternatives + an explicit contradiction search.
4. **Physical separation of leads from verified evidence.** Unverified leads (any source) live in a separate store and can never drive persistence or ranking. Only verified anchors promote to the person record.
5. **Shell first, Perplexity second.** Build the resolver + evidence model Perplexity-agnostic; web/LLM lead sources plug in behind a flag. Any Perplexity prototype before the shell is **evaluation-only, no persistence, no product path.**

---

## 2. Data model

### 2.1 Input: `CandidateHypothesis`
Discovery produces a *hypothesis*, not a resolved person.
```
CandidateHypothesis {
  name: string,                 // as discovered
  claimedInstitution: string?,  // suggested/applicant-provided affiliation
  expertiseTerms: string[],
  seedPublications: { pmid?, doi?, title?, year? }[],
  source: 'claude' | 'pubmed' | 'arxiv' | 'biorxiv' | 'applicant' | ...,
  reason: string?
}
```

### 2.2 Output: `ResolvedIdentity`
```
ResolvedIdentity {
  status: 'confirmed' | 'probable' | 'ambiguous' | 'unresolved' | 'rejected',
  confidence: number,           // 0..1, derived; NEVER a hidden sort key
  anchors: VerifiedAnchor[],    // only anchors that PASSED deterministic verification
  rejectedAnchors: RejectedAnchor[],  // with reason — prevents the same bad lead resurfacing
  competitors: CompetingIdentity[],   // other plausible humans found during enumeration
  evidenceSummary: string,      // human-readable "why"
  resolverVersion: string,      // semver of the rule set that produced this
  resolvedAt: ISO8601
}
```

### 2.3 `VerifiedAnchor` (the provenance unit — addresses Codex #5)
```
VerifiedAnchor {
  type: 'orcid' | 'faculty_page' | 'institutional_email' | 'scholar_profile'
      | 'publication_cluster' | 'ror_org',
  value: string,                // ORCID iD, URL, domain, scholar author_id, ROR id
  sourceUrl: string,            // the page this anchor was extracted from
  retrievedAt: ISO8601,         // freshness stamp (from search_results.date/last_updated where available)
  fetchResult: 'ok' | 'http_error' | 'blocked_domain' | 'wrong_content_type',
  parserOutput: object,         // what we extracted (e.g. displayed name on the page)
  verifier: string,             // which deterministic check confirmed it + its version
  verdict: 'pass' | 'fail',
  weight: number                // strong | weak (see §4)
}
```
`RejectedAnchor` = same shape with `verdict:'fail'` + `reason`.

### 2.4 Two stores (addresses Codex #1, #4, persistence semantics)
- **`identity_leads`** — every unverified anchor from any source (Perplexity, Scholar search, ORCID search). Append-only, keyed by (personId?, query, resolverVersion). **Never read by ranking or persistence.**
- **Verified evidence on the person** (`wmkf_potentialreviewers`) — bibliometrics/contact fields promote here **only** when backed by a passing `VerifiedAnchor`. (Continues the Phase 1 rule: nothing persists on a name/institution mismatch.)
- **Rejected-anchor memory** — so a previously-refuted lead (e.g. Noe→Clementi's profile) does not get re-surfaced and re-applied on the next run.

> Storage substrate (Postgres table vs Dataverse fields vs JSON column) is an **open question for Codex** — see §9.

---

## 3. Resolver algorithm (deterministic core)

```
resolve(hypothesis):
  1. ENUMERATE candidates independently (do NOT start from a lead's pick):
       - ORCID searchByName  → all name-matching records
       - PubMed author cluster(s) for the name + variants
       - (later) Search-API results[] for "<name> <institution> faculty"
  2. For each candidate identity, gather ANCHORS and verify each deterministically:
       - orcid:        name match (namesMatch) + publication-cluster overlap with seedPublications
       - faculty_page: page displayed-name matches target (namesMatch) AND domain allowlisted AND content-type ok
       - inst_email:   domain matches a verified current/past affiliation (via ROR normalization)
       - scholar:      displayed profile name matches target (Phase 1 scholarNameMismatch) — HARD floor
       - pub_cluster:  internally-consistent coauthors/affiliation over time
  3. CONTRADICTION search: actively look for evidence the anchor belongs to someone else
       (same-lab member, homonym). Lab-name-in-snippet with a DIFFERENT profile name = REJECT, not match.
  4. HARD FLOORS (override everything):
       - displayed-name mismatch on a profile anchor → that anchor REJECTED
       - if the only positive evidence is name+institution → status cannot exceed `ambiguous`
  5. SCORE → STATUS:
       - confirmed: ≥1 strong anchor (authenticated ORCID / verified faculty page+email /
                    consistent pub-cluster) AND no unresolved contradiction
       - probable:  cross-source agreement but no single authoritative anchor
       - ambiguous: ≥2 viable competitors that evidence can't separate
       - unresolved: insufficient evidence
       - rejected:  positive evidence the best candidate is the wrong human
  6. Bibliometrics/contact may attach ONLY when status ∈ {confirmed, probable}.
```

**Relevance is computed separately and never feeds identity confidence** (and vice-versa). `relevance-score.js` must stop counting bibliometrics unless `status ∈ {confirmed, probable}` *(integration point — verify signature at impl).*

---

## 4. Evidence weighting (with hard floors, not soft weights)

**Strong (can support `confirmed`):** authenticated ORCID; verified institutional faculty/staff page; verified institutional email/domain; internally-consistent publication cluster; agreement across independent sources.

**Weak (never sufficient alone):** same institution; same lab; shared coauthors; topical similarity; name variants; Scholar profile similarity.

**Negative / hard-reject:** displayed-name mismatch; evidence the source is a different person in the same lab; conflicting affiliation history without corroboration; non-aligning publication clusters; source disagreement across independent identifiers.

This is the formalization of the Phase 1 point-fixes.

---

## 5. Evidence-source interface (the anti-role-creep boundary)

All sources — deterministic and LLM/web — implement one contract and funnel through the same verify gate:
```
EvidenceSource.gatherAnchors(hypothesis) → CandidateAnchor[]   // UNVERIFIED leads only
```
- **Deterministic sources:** ORCID, PubMed, Crossref, ROR, direct faculty-page fetch. Their output is still verified, but they don't synthesize.
- **Lead sources (LLM/web):** Perplexity Search API. Output is **leads only**; the resolver owns verification + enumeration + scoring. A lead source can **never** return a status or a score.

This interface is what makes Perplexity swappable/optional and prevents it from becoming the decider.

---

## 6. Perplexity integration (DEFERRED — spec only)

When added, behind a flag + provider allowlist (VRP pattern, `vrp-providers.js`):

- **Use the Search API (`https://api.perplexity.ai/search`), not sonar chat.** Verified in the docs: it returns a ranked `results[]` array of *real retrieved sources* (`title/url/snippet/date/last_updated`) — which gives (a) counter-candidate enumeration for free, (b) per-result freshness stamps, (c) structured provenance. sonar chat returns one prose answer we'd have to distrust. New small adapter; reuses `PERPLEXITY_API_KEY` + `safeFetch` infra.
- **Anchors come from `results[].url` (pages actually retrieved) — NEVER URLs a model writes into prose/JSON.** Perplexity's own docs warn model-authored links hallucinate. (If we ever use sonar instead, take anchors from its `search_results` field, not `citations` and not the answer text.)
- **Untrusted-input handling (Codex #4):** wrap all returned text under A7 hardening *before parsing and before any downstream prompt reuse*; allowlist domains (orcid.org, institutional/.edu, scholar.google.com, ror.org) + check content-type *before* re-fetching an anchor (`safeFetch` only protects transport).
- **Freshness (Codex "what's missing"):** "current institution" requires a timestamped/current-page anchor (`date`/`last_updated`) or is labeled `stale`/`unknown`. Volatile sources (lab alumni pages, news) down-weighted.
- **Cost/latency policy:** invoke **only** after cheap deterministic sources fail to resolve, and only for selected/ambiguous candidates — never the per-candidate hot path. Cache lead results by (query + resolverVersion). Note the structured-output 10–30s first-request warmup if JSON mode is used.

---

## 7. Hard cases → rules (regression targets)

| Case | Rule |
|---|---|
| Same-lab member (Tsai→Nakano) | profile displayed-name mismatch = hard reject; lab-name-in-snippet with different profile name = suspicious, not supporting |
| Common name (Wei Zhang) | require ≥2 independent strong signals or one authenticated anchor; else `ambiguous` and show competitors |
| Moved affiliation | prioritize publication/identity anchors over current-affiliation snippet; mark current contact stale until a current page/ORCID employment confirms |
| Sparse senior PI | faculty page + ORCID + landmark pubs can confirm identity even with low recent PubMed volume; separate identity from reviewer-activity score |
| Shared/duplicated profile id (Noe/Clementi) | one author_id on >1 person → at least one rejected; resolver de-collides via displayed-name |

These become the **gold set** for evaluation (Codex #7 / eval section).

---

## 8. Ranking & UX (separation)

Staff card shows, as distinct fields: why relevant · identity confidence + status · which sources support · which evidence conflicts · whether human review is required. A highly-relevant but `unresolved` candidate stays unresolved — never silently elevated by h-index. Ambiguous candidates surface competing identities rather than a guess. (Human-review queue is a later slice; not in the shell.)

---

## 9. Open questions for Codex pre-impl review

1. **Storage substrate** for `identity_leads` + rejected-anchor memory + `resolverVersion`d decisions: new Postgres table(s), Dataverse fields on the person, or a JSON evidence column? (Bibliometrics now live on `wmkf_potentialreviewers`; identity-confidence status would join them.)
2. **Scope of the shell's first slice** — minimum that's useful without Perplexity: is it (a) ORCID + PubMed-cluster + faculty-page verification with the status model, or (b) just formalize the Phase 1 floors + status enum into a `resolveIdentity()` the existing endpoints call?
3. **Where the resolver sits relative to `discover.js` / `enrich-recommended.js`** — replace `verifyClaudeSuggestions`'s implicit identity step, or wrap it?
4. **Confidence→status thresholds** — concrete cutoffs, or rule-based only (no numeric score) to avoid a tunable that drifts?
5. **Legacy revalidation** — re-run the resolver over the (small: ~7) already-verified persons, or only gate new writes?

## 10. Integration points (verify exact signatures at impl)
`lib/services/discovery-service.js` (`verifyClaudeSuggestions`, `checkInstitutionMismatch`, `generateNameVariants`) · `lib/services/contact-enrichment-service.js` (`enrichCandidate`, `_attachScholarMetrics`, `scholarIdentityStatus`) · `lib/services/serp-contact-service.js` (`scholarNameMismatch`) · `lib/services/orcid-service.js` (`findContact`, `_nameMatchesTarget`) · `lib/utils/contact-parser.js` (`namesMatch`) · `lib/utils/relevance-score.js` (`scoreRelevance`) · `pages/api/reviewer-finder/{discover,save-candidates,my-candidates}.js` · `pages/api/workbench/enrich-recommended.js` · `lib/services/multi-llm-service.js` (`_callPerplexity` — or a new Search-API adapter).
