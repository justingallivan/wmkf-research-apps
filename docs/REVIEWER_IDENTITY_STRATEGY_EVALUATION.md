# Reviewer Identity Strategy Evaluation

Date: 2026-06-08

Scope: strategy-level evaluation of reviewer identity/contact enrichment failures for request 1002794, grounded in HEAD versions of:

- `lib/services/contact-enrichment-service.js`
- `lib/services/serp-contact-service.js`
- `lib/services/discovery-service.js`
- `lib/services/reviewer-work-author-resolver.js`
- `lib/services/openalex-service.js`
- `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`
- `docs/REVIEWER_TRACK_B_IDENTITY_SPEC.md`

## 1. Is Anchor Identity First The Correct Spine?

Yes: anchor identity first, then enrich, else abstain is the correct spine.

[VERIFIED] The current code already partly moved this way: Track-B discovery now resolves top-ranked literature candidates through `ReviewerWorkAuthorResolver.resolveCandidate`, which resolves a specific work, matches exactly one byline author, then emits authorship/ORCID/topic anchors before mapping identity status in discovery. See `reviewer-work-author-resolver.js` and `discovery-service.js`.

The frame is still incomplete at the enrichment boundary. [VERIFIED] `ContactEnrichmentService` builds an ORCID anchor from existing candidate ORCID, but the anchor institution is still only `candidate.affiliation || institution || primaryAffiliation`, not the ORCID-resolved current affiliation later collected into `contactEnrichment.orcidAffiliation`. That exactly matches the Smirnova-class hole: the better institution arrives too late to constrain Tier 3/4.

The sharper formulation is: identity anchor must govern every identity-bearing field at the moment that field is selected, not merely before persistence. [VERIFIED] `_finalize` resolves identity only after Scholar/contact search work has already run, then applies affiliation override afterward. That is useful for persistence gating, but too late to prevent wrong web search selection.

## 2. What Are We Missing Or Assuming Wrongly?

[VERIFIED] Strategy A is necessary but not sufficient. Threading ORCID affiliation into query and contradiction checks fixes ORCID-anchored empty-affiliation cases, but only when the candidate already has ORCID or Tier 2 finds the right ORCID. For Chen-like cases with no ORCID and no institution, there is no real anchor to thread.

[INFERRED] The Chen failure is not mainly a better-search problem. It is an unanchored-identity problem. A same-name web result plus topic-ish overlap should not produce "identity confirmed." Topic overlap can support an already-grounded identity; it should not create one from a bare name.

[VERIFIED] There is a stale documentation assumption: `docs/REVIEWER_TRACK_B_IDENTITY_SPEC.md` says Track-B "still bypasses the spine entirely" and that Tier 2 ignores candidate ORCID, but HEAD code now does work-author resolution and uses `getProfile(orcid)` when `identityAnchor.orcid` exists. Any strategy based on the doc alone will overstate what remains unbuilt.

[VERIFIED] Another blind spot is that deferred Track-B candidates are still passed onward after the top-25 identity cap. Discovery slices `rankedForIdentity` into `toResolve` and `deferred`, then merges `resolvedTrackB` plus `deferred` into discovered results. If deferred candidates remain selectable downstream, that is a direct violation of "anchor-or-abstain." This evaluation does not assert UI behavior from these files alone, but structurally the discovered output includes unresolved deferred candidates.

## 3. Highest-Leverage, Lowest-Wall-Clock Path

The highest leverage is not more Scholar/Google. It is using anchors already produced or cheaply available during discovery, then refusing to emit identity-bearing enrichment when those anchors are absent.

[VERIFIED] Track-B already has work -> byline -> OpenAlex author resolution for the top-ranked set. That gives `openAlexAuthorId`, optional ORCID, institution, topics, and identity anchors without broad web search.

Latency-wise, broadening SerpAPI search is the wrong default. [VERIFIED] `ContactEnrichmentService.enrichCandidates` enriches candidates sequentially. Track-B identity resolution is also sequential. `SerpContactService.findContact` can do a primary Google query plus several fallback queries serially.

The path that reduces round trips is: treat unanchored contact fields as non-emittable, not as requiring another query. [INFERRED] For Smirnova, use the ORCID-derived institution already fetched. For Chen, abstain. For candidates with work-grounded OpenAlex author IDs, prefer those anchors over fresh name search. The existing work resolver is exactly the asset to lean on; more Google is where the errors enter.

## 4. Sanity Check Of Strategies A-E

Strategy A is sound and targeted. [VERIFIED] Current `_resultContradictsAnchor` can only compare against `anchor.institution`, and `_institutionsContradict` returns false when the anchor institution is empty. ORCID-resolved affiliation must matter before Tier 3/4 selection, not only after `_finalize`.

Strategy B is the correct policy, with one caveat: "institution+topic corroboration" is weaker than the wording makes it sound. [INFERRED] Institution+topic can be enough for low-risk display fields, but it is shaky for sendable email, website, Scholar metrics, or "identity confirmed" on common names. The codebase history explicitly says name+institution failed for Tsai/Nakano.

Strategy C, Scholar-first, is weak. [VERIFIED] Scholar lookup is still ordinary Google search over `site:scholar.google.com`, takes the first citations URL, and only then flags mismatch. The current name guard helps, but Scholar-first mostly relocates the first-hit problem to a more academic-looking surface. It reduces pianist-style false positives, but it does not solve same-name academic false positives.

Strategy D, topic-keyword disambiguation, is useful only as a negative filter or weak scorer. [VERIFIED] The code already uses topic/expertise terms for PubMed query disambiguation and relevance filtering, but the identity plan correctly warns that topicality is not identity. Treating no-result as abstain is sound. Falling back to bare-name is the dangerous part.

Strategy E, multi-profile scoring, is selectively worth it, not as per-candidate web fan-out. [INFERRED] Multi-profile scoring is appropriate for already-open result sets or bounded identity resolver surfaces. It is not worth serial Google/Scholar expansion across many candidates under the current loops. The better multi-profile source is OpenAlex work authorships and already-returned Scholar result lists, not more fallback searches.

## 5. Existing Architecture To Reuse Or Avoid

Reuse Track-B work-author resolver heavily. [VERIFIED] It is the strongest existing architecture because it starts from the surfaced work, not the name. It abstains on no publication, unresolved work, source outage, no author match, and ambiguous author match.

Reuse the keep-biased guards, but do not mistake them for confirmation. [VERIFIED] `institutionConflicts` and `scholarNameMismatch` are designed to reject positive contradictions while keeping ambiguous cases. That is good for avoiding false negatives, but a non-rejection is not an identity proof.

The dead end is "better broad search." [VERIFIED] `SerpContactService.findContact` is fundamentally first-hit extraction from snippets/URLs plus broad fallbacks, keyed by name and optional affiliation. For unanchored names, improving query wording does not change the core risk.

## Final Skeptical Verdict

The strategic spine is right, but the safest low-latency version is more abstention and more reuse of work-grounded/OpenAlex/ORCID anchors already in hand, not Scholar-first or broader SerpAPI exploration.

The key flawed assumption to kill is that topic overlap can confirm a human identity. It can rank relevance; it cannot license contact details.
