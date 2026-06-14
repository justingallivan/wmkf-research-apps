# Reviewer Finder — Track-B Identity Discipline (work→author resolution + enrichment anchoring) — SPEC (Fix C)

Status (updated S253, 2026-06-13): **PARTIALLY OVERTAKEN — read as historical.** The
enrichment-anchoring discipline this spec calls for (resolved-identity anchors drive
contact/bibliometric enrichment instead of bare-name searches; verified-domain drop) SHIPPED and
is owned by `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` §6–§7. The **Track-B discovery lane**
this spec wires the spine into was subsequently **ARCHIVED OFF** (S248,
`DiscoveryService.TRACK_B_ENABLED=false`; see `docs/REVIEWER_FINDER.md` + agent-wiki
`reviewer-origination`), so the Track-B-specific spine wiring is dormant, not live.

Original status: **PROPOSED**. Builds on the shipped S232 ORCID spine (Track A), the S233 honorific +
topic-threshold fixes (Fixes 1/2), and the S233 Track-B dedup + cross-field guards (Fixes A/B).
`[VERIFIED]` = read from current source / observed in the S233 1002794 trace; `[PROPOSED]` = this spec.

## 1. Problem & goal
`[VERIFIED via trace]` After Fixes 1/2, **Track A** (Claude/proposal-named suggestions) resolves well
through the ORCID spine (1002794: 0→7-8 of 12 selectable, proposal-named giants like Ursula Keller now
`confirmed` with ORCID). But **Track B** — candidates discovered from the secondary literature searches
(arxiv / pubmed / biorxiv / chemrxiv senior/corresponding authors, `DiscoveryService.searchArXiv` etc.) —
**still bypasses the spine entirely**. Track-B candidates are pushed straight to `results.discovered` as
`literature_retrieved`, filtered only by MIN_PUBLICATIONS + COI (+ the new S233 cross-field source guard),
and surface as **selectable with no verified identity and no ORCID**.

`[VERIFIED]` Two consequences observed on 1002794:
1. **Wrong-namesake contact.** Because a discovered candidate carries no resolved ORCID,
   `/enrich-contacts` → `ContactEnrichmentService.enrichCandidate` Tier 2 re-searches ORCID **by bare
   name** (`contact-enrichment-service.js:208`, `ORCIDService.findContact({ name, affiliation })`), and
   Tier 3/4 (Claude web search / SerpAPI) search by name too. They drift to a namesake → e.g. the real
   attosecond Olga Smirnova shown with an ITMO (`@metalab.ifmo.ru`) email; "Yanjun Chen" shown with a
   `@gmail.com`. The spine's disambiguation never reaches the contact info.
2. **A needs-review proposal-named peer can coexist with its discovered twin.** `discover()` dedups
   Track-B against **verified** Track-A names only (`discovery-service.js` ~line 234), not **unverified**
   ones. So a proposal-named candidate that abstained to needs-review (Smirnova, Landsman) sits in
   `needs_identity_review` while the *same person*, found authoring a relevant arxiv paper, surfaces
   separately in `literature_retrieved`.

**Goal:** bring Track-B candidates under the same identity discipline as Track A — give each a
**verified ORCID anchored to the specific work that surfaced them** — so (a) enrichment attaches the
RIGHT person's contact, (b) ambiguous/unresolvable ones abstain to needs-review instead of surfacing as
confident selectable, and (c) a discovered candidate that IS a proposal-named peer **merges into and
recovers** that peer rather than duplicating it.

## 2. Why the Track-A spine does NOT transfer to Track B as-is
`[VERIFIED]` `ReviewerIdentityEvidence.evaluateSuggestion` searches OpenAlex **by name** and selects the
record by `claimedInstitution`/topic match, abstaining when neither matches. Track-B candidates:
- have **no claimed institution** (arxiv supplies none; biorxiv supplies an article-level institution
  only), and
- the spine's `probable` **requires an `affiliation_match`** (topic-only → `unresolved`, per
  `REVIEWER_ORCID_SPINE_SPEC.md` §12.2).

So a naive name-search spine pass over Track B would **abstain on essentially every arxiv author** and
dump the good ones into needs-review — the opposite of the goal. The disambiguation signal Track B
actually has is **authorship of a specific, field-matched paper** — and that, not the name, must anchor it.

## 3. Key insight: resolve identity from the WORK, not the name
A discovered candidate arrived *because* they are the senior/corresponding author of a real paper whose
query matched the proposal's field. The byline of that paper is an unambiguous disambiguator: within a
single work, "Olga Smirnova" is exactly one OpenAlex author with one (optional) ORCID and a
publication-time institution — no name-collision search required.

`[PROPOSED]` Resolve each Track-B candidate by looking up the **work** that surfaced them, matching the
extracted author within that work's authorship list, and reading that authorship's `author.id` /
`author.orcid` / `institutions`. This is **deterministic given the work** and immune to the namesake
trap that breaks name-search.

## 4. Architecture (reuse, don't rebuild)
```
discovered candidate (name + publications[] from arxiv/pubmed/biorxiv/chemrxiv)
   └─> [NEW] work-resolver: resolve the surfacing work in OpenAlex
   │        (by DOI → by PMID → by arxiv id → by title), then match the extracted
   │        author within work.authorships → { openAlexAuthorId, orcid, institution, topics }
   ├─> [EXISTING] ORCIDService.getProfile(orcid) — corroborate employment (bonus, not a gate)
   ├─> [EXISTING] ReviewerIdentityResolver.classify(anchors) — REUSE the resolver + anchor model
   │        (authorship_grounded[strong] is a NEW anchor; see §6)
   └─> map → verificationStatus + provenance + UX (§7), then MERGE into a matching
            Track-A needs-review twin if present (§8)

selected candidate (now carrying a resolved, validated ORCID)
   └─> [CHANGE] ContactEnrichmentService Tier 2: if candidate.orcid present, fetch by
            getProfile(orcid) — do NOT name-search; constrain Tier 3/4 to the anchored identity (§9)
```
- **`[NEW]`** `lib/services/reviewer-work-author-resolver.js` (or extend `openalex-service.js` with
  `getWorkByExternalId`/`getWorkByTitle` + an author-match helper). Author search BARRED here — this
  path is work-anchored on purpose.
- **`[EXISTING]`** `reviewer-identity-resolver.js` — reuse; add the `authorship_grounded` anchor + a rule
  (§6). Do not give it fetching responsibility.
- **`[EXISTING]`** `orcid-service.js#getProfile` — already used by the Track-A spine; reuse for
  employment corroboration and for the enrichment anchoring (§9).

## 5. `[PROPOSED]` Work-resolver contract
Input: `{ name, publications[] }` (the Track-B candidate; `publications[0]` is the surfacing paper) +
`fieldText` (proposalInfo.primaryResearchArea) + AbortSignal.
Resolution order for the work (first hit wins; all via `safeFetch`, polite-pool mailto):
1. **DOI** — `GET /works/doi:<doi>` (arxiv/biorxiv/chemrxiv carry DOIs; arxiv DOI form
   `10.48550/arXiv.<id>` — prefer this for arxiv rather than an arxiv-id filter).
2. **PMID** — `GET /works/pmid:<pmid>` (pubmed).
3. **arXiv id** — `GET /works?filter=ids.arxiv:<id>` — **`[PROBE-REQUIRED]`** current OpenAlex docs list
   external work ids as DOI/PMID/PMCID/MAG and do NOT confirm an `ids.arxiv` filter; verify live before
   relying on it. The arxiv DOI form (#1) is the safe primary path; treat this as a best-effort fallback.
4. **Title** — `GET /works?search=<title>&per-page=5` (use the top-level `search` param; the `.search`
   *filter* form is deprecated). Accept only a high-similarity title match (guard against title collisions).
Then within `work.authorships[]`, match the extracted `name` (honorific-stripped, surname + given-name
initial) to **exactly one** authorship. Return:
```
{ openAlexAuthorId, orcid|null, institution|null, topics: string[], workId,
  matchQuality: 'doi'|'pmid'|'arxiv'|'title', authorMatch: 'unique'|'ambiguous'|'none' }
```
- `authorMatch:'ambiguous'` (two same-surname authors on the paper, can't disambiguate) → treat as
  abstain (needs-review), never guess.
- `authorMatch:'none'` (name not found on the resolved work — parse/extraction mismatch) → abstain.
- Work not resolvable (no id hit + no confident title match) → abstain; **source outage fails OPEN to
  needs-review**, never to a wrong verify (mirror spine §8).

## 6. `[PROPOSED]` Resolver anchors + rule
Emit anchors for the work-resolved author and run them through the EXISTING resolver:
- `authorship_grounded` (**strong**) — the candidate is a matched author on a real, field-relevant work.
- `topic_match` (weak) — work/author topics overlap `fieldText` (now meaningful post-Fix-2).
- `orcid_present` (weak) + `orcid_employment_corroborated` (strong, via `getProfile`) — ORCID bonus;
  **absence is not a demoter** (eval lesson, carried from the spine).
New rule (consistent with the 1-strong-OR-2-weak model):
- `confirmed`: `authorship_grounded` **and** (`topic_match` **or** `orcid_employment_corroborated`).
- `probable`: `authorship_grounded` alone (real author of a field-matched paper, ORCID not corroborated).
- `unresolved`: `authorMatch` ambiguous/none, or work unresolvable, or source outage.
Rationale: authorship of a field-matched paper is a **stronger** identity signal than the Track-A
claimed-affiliation guess, so `authorship_grounded` alone reaching `probable` is justified and keeps the
good arxiv authors selectable (avoids the abstain-all failure of §2).
**Scope of `authorship_grounded` (Codex review):** it establishes "this is the real author of this
field-relevant paper" — it does NOT by itself establish "this is the SAME person the proposal named." The
standalone Track-B candidate is whoever authored the paper, so `probable` is correct here; asserting
identity *equality* with a proposal-named peer is a separate, stricter decision owned by the §8 merge
(which requires shared-ORCID corroboration, not a name match, to upgrade). The §5 gate already blocks the
weak cases: `probable` requires a uniquely-resolved work AND a unique authorship match — ambiguous/none
→ `unresolved`.

## 7. `[PROPOSED]` verificationStatus / provenance / UX mapping
| Resolver result | verificationStatus | provenance.sources | UX |
|---|---|---|---|
| `confirmed`/`probable` | `verified`/`probable` | += `openalex`,`orcid`; verificationSource `orcid` | selectable; ORCID + identity note attached |
| `unresolved` | `unresolved` | unchanged | needs-review (NOT selectable); plain-language note |
Provenance `kind` stays `literature_retrieved` (origin unchanged); only identity status/sources change —
same contract as the Track-A spine. Reuse `buildIdentityNote` so cards explain what corroborated identity.

## 8. `[PROPOSED]` Merge a discovered candidate into its Track-A needs-review twin
After Track-B resolution, before presenting: consider a work-resolved discovered candidate that matches a
Track-A **unverified/needs-review** candidate by honorific-robust `areNamesSimilar`.
**Merge-and-upgrade requires shared-ORCID corroboration** (Codex review): only when the discovered
candidate's work-resolved ORCID equals an ORCID on the Track-A candidate (or the Track-A candidate has no
ORCID and the discovered ORCID's employment/topics corroborate the proposal-named context) do we keep the
Track-A provenance `kind` (`proposal_named`/`applicant`), upgrade its identity with the work-resolved
ORCID + status, and drop the Track-B duplicate. A bare **name match is NOT sufficient to upgrade** — same
surname + initial is exactly the namesake trap this whole effort exists to avoid. When the work has no
ORCID (or ORCIDs disagree): **do NOT merge/upgrade** — preserve BOTH provenance paths (the Track-A
needs-review row stays, the Track-B candidate surfaces on its own authorship grounding), and let the
reviewer adjudicate. Effect: a proposal-named peer that abstained on name-search (Smirnova, Landsman) is
recovered and made selectable **only when an ORCID actually ties the two records together**, not on a
hopeful name match. Separately, extend `discover()` dedup to run against unverified names too (not only
verified), but that dedup-drop likewise requires the same-ORCID gate before collapsing two rows into one.

## 9. `[PROPOSED]` Enrichment anchoring (the actual wrong-email fix)
`[VERIFIED]` `ContactEnrichmentService.enrichCandidate` Tier 2 calls `ORCIDService.findContact({ name })`
unconditionally — ignoring any ORCID the candidate already carries.
`[PROPOSED]` Change: when `candidate.orcid` is present and validated (mod-11-2), Tier 2 fetches by that
ORCID (`ORCIDService.getProfile(orcid)`) and **skips the name search**. Tier 3/4 (Claude web / SerpAPI)
must be constrained to the anchored identity (search `name + ORCID-current-institution`, and reject a
result whose institution/ORCID contradicts the anchor) — never attach a contact from a record that
disagrees with the resolved ORCID. This applies to **both** Track-A spine-resolved and Track-B
work-resolved candidates, and is what stops Smirnova→ITMO / Chen→gmail. (Without it, §3–§8 fix *which
person* but the wrong email could still ride in.)

## 10. `[PROPOSED]` Fan-out / budget / latency / abort
- Per discovered candidate: 1 OpenAlex work lookup + (if ORCID) 1 ORCID `/employments`. **Cap** to the
  top-N discovered candidates by `rankByRelevance` AFTER dedup (default N≈20–30) so a 100-author arxiv
  haul doesn't blow the route deadline; `log()`/stat the number deferred (no silent truncation).
- Plumb the existing `discover.js` AbortSignal + `reviewer.time_budget_seconds` through the resolver and
  OpenAlex/ORCID fetches. Per-source timeout + 1 retry on 429/5xx, none on 4xx. Outage → needs-review.
- Only public names/ids leave the system; polite-pool mailto (env-only, see Fixes 1/2 lessons).

## 11. Out of scope (deferred)
- Replacing the S233 coarse cross-field **source** guard (Fix B, bioRxiv-drop) with a per-candidate
  **topic** guard — work-resolver topics make this possible later; not required for this slice.
- Biomedical/PubMed Track-A ORCID-spine cross-source corroboration (its own slice).
- Persisting work→author resolutions as a cache (perf optimization; correctness first).
- Full publication-cluster anchor (co-author/affiliation-history clustering).

## 12. `[PROPOSED]` Test plan
Unit: work-resolver (DOI/PMID/arxiv/title resolution; unique vs ambiguous vs none author match; title
collision rejected; outage→abstain); resolver `authorship_grounded` rule (probable on authorship alone;
confirmed with topic/ORCID; ambiguous→unresolved); enrichment anchoring (candidate.orcid present →
getProfile, no name search; Tier 3/4 reject contradicting institution); merge (shared-ORCID match
upgrades a needs-review proposal_named twin; **name-only match does NOT merge/upgrade — both rows
preserved**; ORCID-disagreement does not collapse). Integration: 1002794 trace shows Track-B candidates
carrying ORCIDs, abstainers in needs-review, and Smirnova/Landsman recovered ONLY where an ORCID ties the
discovered author to the proposal-named row (otherwise both surface for human adjudication).
Gates: `npm run build` (Claude runs locally — NOT the Codex sandbox), `npx jest reviewer discovery
analyze pubmed verification provenance contact orcid identity openalex dedup`, `check:api-routes` if
enrich-contacts request/response shape changes, `check:atlas` if any persistence shape changes.

## 13. Open decisions for the implementer
1. **New file vs extend `openalex-service.js`?** Lean: keep `openalex-service.js` as low-level fetch
   (add `getWorkByExternalId`/`getWorkByTitle`), put the author-match + classify orchestration in a NEW
   `reviewer-work-author-resolver.js` (mirrors the Track-A `reviewer-identity-evidence.js` split).
2. **Top-N cap value** (latency vs coverage) — measure on 1002794 (≈100 arxiv authors) before fixing N.
3. **Does `authorship_grounded` alone → `probable` (selectable)?** Recommended yes (§6 rationale); the
   alternative (require ORCID for selectable) reintroduces the abstain-all problem for the no-ORCID tail.
4. **Merge confirmation** — RESOLVED per Codex review (§8): a bare honorific-robust name match never
   collapses or upgrades two rows; merge-and-upgrade requires shared-ORCID corroboration. Without a
   tying ORCID, preserve both provenance paths. (Open sub-question: when the Track-A row has no ORCID,
   is discovered-ORCID employment/topic corroboration of the proposal-named context enough to upgrade,
   or must we wait for a human? Lean: surface both, let the reviewer adjudicate.)
