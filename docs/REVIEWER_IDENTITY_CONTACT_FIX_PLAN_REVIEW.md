# Reviewer Identity / Contact-Enrichment Fix Plan Review

Date: 2026-06-08
Scope: read-only engineering review of `docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md` against live code.

## 1. Per-Fix Verdicts

### Fix A — Thread ORCID-resolved affiliation into Tier 3/4

Verdict: SOUND, with one required detail.

Reason: [VERIFIED `lib/services/contact-enrichment-service.js:199`] the identity anchor is computed before ORCID Tier 2, and [VERIFIED `lib/services/contact-enrichment-service.js:306-308`] ORCID current affiliation is only collected later as `contactEnrichment.orcidAffiliation`. [VERIFIED `lib/services/contact-enrichment-service.js:354`] Tier 3 still calls `claudeWebSearch(candidate, ...)` with the original candidate, and [VERIFIED `lib/services/contact-enrichment-service.js:429`] Tier 4 still calls `SerpContactService.findContact(candidate, ...)` with the original candidate. [VERIFIED `lib/services/serp-contact-service.js:33-43`] contact search uses `candidate.affiliation` to build the query, and [VERIFIED `lib/services/serp-contact-service.js:451-455`] Scholar search does the same. [VERIFIED `lib/services/contact-enrichment-service.js:115-128`] the contradiction check cannot reject institution conflicts when the anchor institution is empty.

Required detail: [VERIFIED `lib/services/contact-enrichment-service.js:503-510`] `_attachScholarMetrics` also receives `candidate` and calls `findScholarProfile(candidate, ...)`; Fix A must use the same effective-institution clone for Scholar lookup, not only email/contact search, otherwise the bibliometric side of the Smirnova class remains bare-name.

Break-risk: [VERIFIED `lib/services/contact-enrichment-service.js:213-221` and `lib/services/contact-enrichment-service.js:254-255`] Tier 0 and recent PubMed-email early returns go straight to `_finalize`; if the implementation only computes the effective clone after Tier 2, those early-return paths remain unchanged. That is probably acceptable for ORCID-driven Fix A because no ORCID affiliation exists yet on those paths, but [INFERRED from `lib/services/contact-enrichment-service.js:503-565`] they can still run bare-affiliation Scholar metrics unless Fix B/C adds a general anchor policy.

### Fix B — Anchor contact/bibliometrics to work-grounded author, else abstain

Verdict: NEEDS-CHANGE.

Reason: [VERIFIED `lib/services/reviewer-work-author-resolver.js:133-148`] the resolver already returns `openAlexAuthorId`, `orcid`, `institution`, topics, anchors, identity, and identity note from the matched work author. [VERIFIED `lib/services/discovery-service.js:793-813`] `mapTrackBIdentityResult` already carries `openAlexAuthorId`, `openAlexWorkId`, `orcid`, `identityEvidence`, `identityAnchors`, `identityNote`, and sets `affiliation: resolverResult.institution || candidate.affiliation`. So the plan's "ensure the OpenAlex author institution is carried onto the candidate" is mostly already built for resolved Track-B candidates.

The change needed is policy and gating, not a new handoff. [VERIFIED `lib/services/discovery-service.js:808`] the only carried institution is `affiliation`; there is no separately named `openAlexAuthorInstitution` field. [INFERRED from `lib/services/contact-enrichment-service.js:68-75`] using `candidate.affiliation` as the anchor after Track-B mapping will work for resolved candidates but blurs original discovery affiliation vs work-author institution. A dedicated provenance field would make persistence/contact validation less ambiguous.

Break-risk: [VERIFIED `lib/services/reviewer-work-author-resolver.js:128-130`] identity resolution currently uses `candidate.affiliation || author.institution` as the claimed institution. [INFERRED from `lib/services/discovery-service.js:808`] because mapped candidates replace empty affiliation with the OpenAlex author institution, later contact search will become institution-scoped without an extra fetch for many Track-B resolved candidates. The larger risk is over-abstaining unanchored candidates whose contact was previously usable; that is acceptable for sendable email and bibliometrics, but should be visible in UI as contact unresolved.

### Fix C — Persistence must not write unvalidated contact/bibliometric fields

Verdict: SOUND, but incomplete as written.

Reason: [VERIFIED `pages/api/reviewer-finder/save-candidates.js:122-125`] current save gating blocks only resolver-sourced identity fields via `blockByIdentity` / `blockScholar`. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:127-156`] `email`, `affiliation`, `website`, and `facultyPageUrl` are written regardless of contact validation. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:140-150`] ORCID, Scholar URL/id, and metrics are the only fields currently nulled by identity/scholar gates.

Need change: [VERIFIED `lib/services/contact-enrichment-service.js:167-188`] enrichment already has source fields (`emailSource`, `websiteSource`, `affiliationSource`, `orcidAffiliation`, `scholarAffiliations`) but no field-level "validated against identity anchor" flag. [INFERRED from `lib/services/contact-enrichment-service.js:213-221`, `lib/services/contact-enrichment-service.js:310-315`, and `lib/services/contact-enrichment-service.js:453-468`] `emailSource` alone is too coarse: `orcid` is strong, `pubmed` may be publication-author-grounded, but `serp_search`/`claude_search` can be safe only when the search/result was anchored and not contradictory. The plan should require explicit persisted DTO flags such as `emailPersistAllowed`, `websitePersistAllowed`, `affiliationPersistAllowed`, and `scholarPersistAllowed`, or equivalent per-field provenance with allowlist semantics.

Break-risk: [VERIFIED `pages/api/reviewer-finder/save-candidates.js:189-195`] the route reports per-row partial failures, and [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:751-779`] the client handles saved names rather than assuming all selected rows saved. Tightening fields to null should not break partial-save UI, but rejecting whole unanchored candidates would change current success counts.

### Fix D — `buildIdentityNote` should surface authorship grounding

Verdict: SOUND.

Reason: [VERIFIED `lib/services/reviewer-work-author-resolver.js:110-121`] Track-B emits `authorship_grounded` and optionally `topic_match`. [VERIFIED `lib/services/reviewer-identity-resolver.js:165-169`] `authorship_grounded` is what makes Track-B confirmed/probable. [VERIFIED `lib/services/reviewer-identity-evidence.js:249-258`] `buildIdentityNote` lists affiliation, ORCID employment, cross-source ORCID, and topic, but not authorship grounding, so a confirmed work-grounded candidate can display as topic-corroborated without naming the stronger work-authorship basis.

Break-risk: [INFERRED from `shared/components/reviewers/ReviewerSearchSection.js:245`] display-only text change; no persistence or routing break-risk identified.

### Fix E — Deferred/unanchored Track-B candidates must not be silently selectable

Verdict: SOUND, with a merge-order constraint.

Reason: [VERIFIED `lib/services/discovery-service.js:273-291`] only the top 25 Track-B candidates are identity-resolved; deferred candidates are merged into discovered without passing through `mapTrackBIdentityResult`. [VERIFIED `lib/services/discovery-service.js:793-819`] the mapper is what adds `identityStatus`, `needsIdentification`, and OpenAlex/ORCID anchors. [VERIFIED `lib/utils/reviewer-provenance.js:171-181`] `provenanceGroupOf` routes to `needs_identity_review` only when explicit unresolved flags exist, otherwise literature-retrieved candidates remain in the selectable literature section. [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:1015-1023`] every provenance section is rendered with toggleable `CandidateCard`; [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:169-176`] the checkbox appears unless `readOnly` is passed; [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:1059-1067`] only the separate unverified suggestions section currently passes `readOnly`.

Merge-order constraint: [VERIFIED `lib/services/discovery-service.js:827-835`] `mergeTrackBWithNeedsReviewBySharedOrcid` only merges a Track-B candidate into unverified Track-A when it has `openAlexAuthorId` and `identityStatus` confirmed/probable. Deferred candidates without those fields do not merge today. Relabeling deferred candidates as unresolved is safe if it happens after any resolved candidate mapping and does not overwrite confirmed/probable resolved candidates.

Break-risk: [INFERRED from `shared/components/reviewers/ReviewerSearchSection.js:664-678`] making `needs_identity_review` read-only changes bulk select-all semantics because `toggleAll` currently selects every `displayCandidate`. The implementation must exclude read-only identity-review rows from `selected` and save eligibility, not only hide the checkbox.

## 2. Fix C Deep-Dive

Is field-level validation the right model? Yes. [VERIFIED `lib/services/reviewer-identity-resolver.js:260-263`] `mayPersistIdentity` is person-level and only says whether identity-bearing resolver fields may persist. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:122-156`] the current route applies that person-level decision to ORCID/Scholar/metrics but not email/website/affiliation. [INFERRED from the Chen failure described in the plan and verified by the route shape] a confirmed identity can still carry unvalidated contact fields, so the persistence gate must be field-level.

Cleaner existing signals: partially. [VERIFIED `lib/services/contact-enrichment-service.js:167-188`] there are `emailSource`, `websiteSource`, and `affiliationSource` fields. [VERIFIED `lib/services/contact-enrichment-service.js:217-220`] affiliation-embedded email is tagged `affiliation`; [VERIFIED `lib/services/contact-enrichment-service.js:241-244`] PubMed email is tagged `pubmed`; [VERIFIED `lib/services/contact-enrichment-service.js:311-315`] ORCID email is tagged `orcid`; [VERIFIED `lib/services/contact-enrichment-service.js:370-372` and `lib/services/contact-enrichment-service.js:454-457`] Claude/Serp emails are tagged by search source. These are useful inputs but not sufficient as the gate because they do not encode whether a paid-search result was anchored to the resolved identity.

Partial-write / atomicity hazard: yes. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:127-156`] the save route awaits potential reviewer upsert, then researcher overlay upsert. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:168-179`] the selected reviewer suggestion is a later write. [INFERRED from these separate awaits] if potential reviewer or researcher overlay succeeds and suggestion write fails, the route records an error and continues, but leaves a partial person/overlay row without the selected suggestion. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:181-185`] `savedCount` increments only after suggestion write, so the client will not mark it saved, but cleanup/rollback is absent. [VERIFIED `lib/services/contact-enrichment-service.js:817-866`] the enrichment-side `saveToDatabase` has the same partial-write awareness for potential reviewer vs researcher sidecar, but logs and returns rather than providing atomic rollback.

Recommended model: [INFERRED] add field-level persist booleans/provenance during enrichment and have save-candidates null disallowed fields before both `potentialReviewerAdapter.upsertByEmail` and `researcherAdapter.upsertByPotentialReviewer`. Do not reject whole candidates solely because contact is unresolved unless identity itself is unresolved and the UI has intentionally blocked selection.

## 3. Fix B Feasibility

Is the work-grounded OpenAlex author institution available post-resolution without an extra fetch? Yes for candidates that pass Track-B resolution. [VERIFIED `lib/services/reviewer-work-author-resolver.js:102-109`] the resolver matches one OpenAlex work byline author. [VERIFIED `lib/services/reviewer-work-author-resolver.js:133-143`] it returns `author`, `openAlexAuthorId`, `orcid`, `institution`, and topics. [VERIFIED `lib/services/discovery-service.js:803-809`] discovery maps the author id and institution onto the candidate.

Does this require `lastKnownInstitution` author fetch? [UNVERIFIED — could not confirm from the listed files alone] The listed work-author resolver uses the institution present on the work authorship author object, not an extra OpenAlex author record fetch. The plan's phrase "OpenAlexService author record `lastKnownInstitution`" is not verified by the reviewed code; it may be true inside `openalex-service.js`, but that file was not in the requested read list.

If abstain dominates, does it gut usefulness? [INFERRED from `lib/services/discovery-service.js:281-291`] no for top resolved Track-B candidates where `author.institution` is present, because they keep identity/relevance and can show contact unresolved. [INFERRED from `lib/services/discovery-service.js:275-288`] yes for deferred candidates if the UI blocks them entirely; that is intentional if the system treats unanchored literature names as unsafe for outreach. The better UX is selectable confirmed/probable identity with contact unresolved, and read-only unresolved/deferred identity.

Cheaper anchors: [VERIFIED `lib/services/reviewer-work-author-resolver.js:122-126`] OpenAlex authorship ORCID, when present, is already available and can drive anchored ORCID profile lookup. [VERIFIED `lib/services/contact-enrichment-service.js:77-106`] `_getAnchoredOrcidProfile` can fetch the anchored ORCID profile and produce current affiliation. [UNVERIFIED — could not confirm from listed code] using "grounding work's other bylines" as an institution anchor is not implemented in the reviewed files and risks substituting coauthor institutions for the target author unless OpenAlex authorship has target-specific raw affiliations.

## 4. Fix A Invariant Safety

The search-only candidate clone preserves the S224 invariant if it is used only for Tier 3/4 contact and Scholar search calls. [VERIFIED `lib/services/contact-enrichment-service.js:176-184`] the contact enrichment object documents that source affiliations are collected without mutating `candidate.affiliation` so `resolveIdentity` runs on the original discovery affiliation. [VERIFIED `lib/services/contact-enrichment-service.js:570-572`] `_finalize` builds the identity hypothesis from `candidate.affiliation`. [VERIFIED `lib/services/contact-enrichment-service.js:606-631`] `_applyAffiliationOverride` mutates only the result object after identity resolution, not the input candidate.

Other readers between Tier 2 and `_finalize`: [VERIFIED `lib/services/contact-enrichment-service.js:354`] `claudeWebSearch` reads candidate affiliation for prompt/query construction. [VERIFIED `lib/services/contact-enrichment-service.js:429`] Serp contact search reads it. [VERIFIED `lib/services/contact-enrichment-service.js:503-510`] `_attachScholarMetrics` reads it through `findScholarProfile`. [VERIFIED `lib/services/contact-enrichment-service.js:885-901`] `claudeWebSearch` extracts an institution from `candidate.affiliation` and sends it to the model. [VERIFIED `lib/services/serp-contact-service.js:33-43` and `lib/services/serp-contact-service.js:451-455`] both Serp contact and Scholar search use it directly. A clone must cover all three readers.

Existing mutations: [VERIFIED `lib/services/contact-enrichment-service.js:164-198`] `result` is a copy of `candidate`. [VERIFIED `lib/services/contact-enrichment-service.js:606-631`] the only affiliation override mutates `result` at finalize. [UNVERIFIED — could not confirm a mutation of input `candidate.affiliation` in this file] no direct mutation of the input candidate was found in the reviewed contact-enrichment code.

## 5. Fix E Hazard

Relabeling deferred candidates as `needs_identity_review` is safe for grouping, but insufficient by itself. [VERIFIED `lib/utils/reviewer-provenance.js:171-175`] explicit `needsIdentification` or unresolved status will route them to `needs_identity_review`. [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:1015-1023`] that section is currently still selectable. Therefore Fix E must include UI save/selection blocking, not only relabeling.

Consumer assumptions: [VERIFIED `lib/services/discovery-service.js:2045-2067`] `rankAllCandidates` combines verified and discovered candidates and does not require identity resolution. [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:526-586`] the Workbench client accepts ranked candidates, enriches kept candidates, reranks, and stores them without requiring identity resolution. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:60-62`] the save route accepts whatever candidates are submitted. I did not find a consumer in the listed files that assumes every `results.discovered` candidate is resolved; the hazard is the opposite: consumers tolerate unresolved rows too broadly.

Collision with `mergeTrackBWithNeedsReviewBySharedOrcid`: [VERIFIED `lib/services/discovery-service.js:827-835`] the merge only fires for candidates with `openAlexAuthorId` and confirmed/probable identity status. [INFERRED] marking deferred rows unresolved will not create false merges. The implementation should avoid changing resolved rows that already passed through `mapTrackBIdentityResult`.

## 6. Sequencing and Latency

"Fix C + A first" is the right harm-first order. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:127-156`] Fix C blocks wrong contact persistence. [VERIFIED `lib/services/contact-enrichment-service.js:354`, `lib/services/contact-enrichment-service.js:429`, and `lib/services/contact-enrichment-service.js:503-510`] Fix A changes already-existing Tier 3/4/Scholar calls rather than adding new calls. This gives immediate reduction in wrong data without increasing sequential wall-clock.

Latency risks: [VERIFIED `lib/services/contact-enrichment-service.js:667-692`] candidate enrichment is sequential. [VERIFIED `lib/services/discovery-service.js:759-772`] Track-B identity resolution is sequential. [VERIFIED `lib/services/serp-contact-service.js:96-164`] Serp contact can issue multiple fallback queries serially. [VERIFIED `lib/services/contact-enrichment-service.js:529-531`] Scholar metrics adds a second SerpAPI call after profile lookup. Fixes should avoid adding per-candidate author-profile fetches or extra Serp searches.

How to avoid added round-trips: [INFERRED] use the candidate fields already emitted by `mapTrackBIdentityResult`; use ORCID anchored lookup only when an ORCID is already known or already being fetched in Tier 2; implement abstain by skipping unanchored paid searches and metrics rather than replacing them with more queries.

## 7. Section-7 Open Questions

1. Is identity-validated != contact-validated the right gate model? Yes. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:122-156`] current identity gating does not cover email/website/affiliation, and [VERIFIED `lib/services/reviewer-identity-resolver.js:260-263`] `mayPersistIdentity` is too coarse for contact fields.

2. Is work-grounded OpenAlex author institution available post-resolution without extra fetch? Yes for resolved Track-B candidates. [VERIFIED `lib/services/reviewer-work-author-resolver.js:133-143`] the resolver returns `institution`; [VERIFIED `lib/services/discovery-service.js:803-809`] mapping carries it onto `affiliation`. [UNVERIFIED] whether this is the OpenAlex author record's `lastKnownInstitution` specifically is not confirmed from the requested files.

3. Does Fix A's search-only candidate clone preserve the S224 invariant? Yes if `_finalize` still receives the original candidate and the clone is limited to web/contact/Scholar searches. [VERIFIED `lib/services/contact-enrichment-service.js:570-579`] identity resolution and affiliation override sequencing depends on the original candidate.

4. Is email-domain-vs-institution contradiction worth adding? Yes, but as a secondary guard, not a replacement. [VERIFIED `lib/services/contact-enrichment-service.js:123-128`] current contradiction only checks ORCID and institution fields returned by a result. [VERIFIED `lib/services/serp-contact-service.js:69-73`] Serp contact result has email/page/website but no institution field, so institution contradiction often has nothing to compare. [INFERRED] domain-vs-anchor checks would catch results where the snippet lacks a structured institution but the email domain clearly belongs elsewhere.

5. Any ordering/atomicity hazard in Fix C? Yes. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:127-179`] candidate save is three separate writes. [INFERRED] suggestion failure after person/overlay success leaves partial rows. Field nulling should happen before the first write; whole-candidate rejection should happen before any write.

6. Anything in deferred-candidate path making relabel unsafe? No blocking issue found in the listed files. [VERIFIED `lib/services/discovery-service.js:286-291`] deferred candidates enter discovered; [VERIFIED `lib/utils/reviewer-provenance.js:171-181`] unresolved flags route them to needs-review; [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:1015-1023`] the UI must also make that section read-only. [INFERRED] the merge helper remains safe because it requires confirmed/probable work resolution.

## 8. Missing / Risks

- Missing persisted-field contract. [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:597-604`] search results are pruned and saved to the durable roster. [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:664-667`] roster candidates later re-enter the selectable display list. [INFERRED] any new contact validation flags must survive `pruneCandidateForRoster`; otherwise reloaded candidates may lose the gate evidence and save incorrectly or over-null.

- Contact status display is not implemented. [VERIFIED `shared/components/reviewers/ReviewerSearchSection.js:262-284`] cards display email/website/ORCID when present, but there is no "contact unresolved" status. [INFERRED] Fix B's abstain behavior needs a visible field or users will read missing contact as lookup failure rather than intentional safety.

- `emailSource` allowlisting can backfire. [VERIFIED `lib/services/contact-enrichment-service.js:217-220`] affiliation-email source depends on the discovery affiliation string, and [VERIFIED `lib/services/contact-enrichment-service.js:240-244`] PubMed source depends on extracted publication contact. [INFERRED] those may be acceptable for publication-grounded candidates but still require identity context when the publication cluster itself is weak or deferred.

- Existing enrichment side-write remains a parallel persistence path. [VERIFIED `lib/services/contact-enrichment-service.js:790-877`] `saveToDatabase` can persist email/affiliation/website/faculty page when `persist` is true. [INFERRED] Fix C must cover both `save-candidates.js` and this enrichment-side path, or a wrong field can still be written outside explicit candidate save.

- Scholar-first, topic-keyword, and multi-profile are correctly scoped out for now. [VERIFIED `lib/services/serp-contact-service.js:450-490`] Scholar lookup is still first matching Google result plus mismatch flags, so Scholar-first would relocate first-hit risk. [VERIFIED `lib/services/reviewer-identity-resolver.js:161-178`] topic alone does not confirm identity, so topic-keyword expansion is not a sufficient contact gate. [VERIFIED `lib/services/contact-enrichment-service.js:641-692` and `lib/services/discovery-service.js:759-772`] sequential loops make broad multi-profile fan-out a latency risk.

## 9. Final Recommendation

Verdict: Go with named changes; No-Go as written.

Top required changes before implementation:

1. Expand Fix A to use the effective-institution clone for `_attachScholarMetrics` / Scholar lookup as well as Tier 3/4 contact search. [VERIFIED `lib/services/contact-enrichment-service.js:503-510`]
2. Redefine Fix B as "reuse already-carried Track-B institution/ORCID and add explicit contact-anchor provenance"; do not plan a new OpenAlex author fetch unless a later probe proves the existing authorship institution is missing too often. [VERIFIED `lib/services/reviewer-work-author-resolver.js:133-143`; `lib/services/discovery-service.js:803-809`]
3. Make Fix C a concrete field-level contract that covers both save paths and survives roster pruning; source labels are inputs, not the gate itself. [VERIFIED `pages/api/reviewer-finder/save-candidates.js:127-156`; `lib/services/contact-enrichment-service.js:790-877`; `shared/components/reviewers/ReviewerSearchSection.js:597-604`]

