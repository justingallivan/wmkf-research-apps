# Reviewer Identity Verification Findings

Date: 2026-06-08

Scope: read-only verification of two previously inferred claims from `docs/REVIEWER_IDENTITY_STRATEGY_EVALUATION.md` and `docs/REVIEWER_IDENTITY_RECONCILIATION_EDITS.md`.

## Claim 1: Deferred Track-B Candidates Remain Selectable Downstream

Verdict: VERIFIED.

Deferred Track-B candidates can become selectable and savable. The UI/save path does not require an anchored identity before rendering them with checkboxes or sending them to `/api/reviewer-finder/save-candidates`.

Important nuance: the save API has a partial identity-field gate for ORCID/Scholar/bibliometrics when resolver evidence exists, but that is not an anchor-or-abstain gate for the candidate row itself. It still creates/updates the potential reviewer and writes a selected reviewer suggestion.

### Producer Trace

`DiscoveryService.discover()` caps Track-B identity resolution to a top-N slice and leaves the rest as `deferred`:

- `lib/services/discovery-service.js:273` sets `identityLimit`.
- `lib/services/discovery-service.js:274` creates `toResolve`.
- `lib/services/discovery-service.js:275` creates `deferred`.
- `lib/services/discovery-service.js:281` resolves only `toResolve` via `resolveTrackBIdentities()`.
- `lib/services/discovery-service.js:286-289` passes `[...]resolvedTrackB, ...deferred]` into `mergeTrackBWithNeedsReviewBySharedOrcid()`.
- `lib/services/discovery-service.js:291` assigns `results.discovered = mergeResult.discovered`.

Resolved Track-B candidates receive identity fields in `mapTrackBIdentityResult()`:

- `lib/services/discovery-service.js:793-819` returns mapped candidates with `verified`, `verificationStatus`, `identityStatus`, `needsIdentification`, `openAlexAuthorId`, `openAlexWorkId`, `orcid`, `identityEvidence`, `identityAnchors`, and `identityNote`.

Deferred candidates do not pass through that mapper. They are the original ranked candidates from before identity resolution. From the traced code, no equivalent `needsIdentification`, `identityStatus: unresolved`, or `verificationStatus: unresolved` is added to deferred candidates before they enter `results.discovered`.

### API Response Trace

The discover API carries `discoveryResults.discovered` through to the response:

- `pages/api/reviewer-finder/discover.js:286` initializes `enhancedDiscovered = discoveryResults.discovered`.
- `pages/api/reviewer-finder/discover.js:294-303` optionally runs reasoning over all discovered candidates, not identity gating.
- `pages/api/reviewer-finder/discover.js:307` filters only `isRelevant === false`.
- `pages/api/reviewer-finder/discover.js:337` filters discovered proposal authors.
- `pages/api/reviewer-finder/discover.js:343` marks institution COI.
- `pages/api/reviewer-finder/discover.js:357-361` includes discovered candidates in `combinedResults`.
- `pages/api/reviewer-finder/discover.js:364-367` ranks all candidates.
- `pages/api/reviewer-finder/discover.js:380-386` sends `verified`, `unverified`, `discovered`, and `ranked` to the client.

There is no identity-status filter between `results.discovered` and the `ranked`/`discovered` payload.

### UI Render Trace

In the Workbench reviewer search UI, the client uses `ranked` as the primary candidate list:

- `shared/components/reviewers/ReviewerSearchSection.js:526` stores `data.ranked`.
- `shared/components/reviewers/ReviewerSearchSection.js:537` only hard-filters excluded names.
- `shared/components/reviewers/ReviewerSearchSection.js:545` initializes `enriched = kept`.
- `shared/components/reviewers/ReviewerSearchSection.js:550-555` enriches all kept candidates, including deferred/unanchored candidates.
- `shared/components/reviewers/ReviewerSearchSection.js:583` re-ranks enriched candidates.
- `shared/components/reviewers/ReviewerSearchSection.js:585` stores them in `candidates`.
- `shared/components/reviewers/ReviewerSearchSection.js:667` builds `displayCandidates` from all `candidates` plus active roster candidates.

The provenance grouper would put a candidate into `needs_identity_review` only if explicit flags exist:

- `lib/utils/reviewer-provenance.js:171-175` returns `needs_identity_review` only when `needsIdentification`, `identityStatus === 'unresolved'`, or `verificationStatus === 'unresolved'`.
- `lib/utils/reviewer-provenance.js:180-181` otherwise returns `literature_retrieved` for `LITERATURE_RETRIEVED` provenance.

Because deferred candidates are literature-retrieved and do not receive the unresolved flags in the producer trace above, they fall into `literature_retrieved`, not `needs_identity_review`.

Even candidates that do land in `needs_identity_review` are still rendered in the same selectable list:

- `shared/components/reviewers/ReviewerSearchSection.js:797-818` builds `provenanceSections`, including `needs_identity_review`, from `displayCandidates`.
- `shared/components/reviewers/ReviewerSearchSection.js:1021-1023` renders every section item with `<CandidateCard ... onToggle=... />` and does not pass `readOnly`.
- `shared/components/reviewers/ReviewerSearchSection.js:169-176` renders a checkbox whenever `readOnly` is false.

Controlling UI line: `shared/components/reviewers/ReviewerSearchSection.js:1022`. All provenance sections, including `needs_identity_review`, are rendered as normal toggleable `CandidateCard`s.

By contrast, the separate `unverified` suggestions section is explicitly non-selectable:

- `shared/components/reviewers/ReviewerSearchSection.js:1059-1067` renders `unverified` candidates with `readOnly`.

The standalone `/reviewer-finder` page is also permissive:

- `pages/reviewer-finder.js:960-962` receives `data.ranked`.
- `pages/reviewer-finder.js:1044-1046` builds selected objects from all ranked candidates.
- `pages/reviewer-finder.js:1681-1689` renders database discoveries with `CandidateCard` and `onSelect`.
- `pages/reviewer-finder.js:183-188` always renders a checkbox in `CandidateCard`.

### Save Trace

Workbench save sends selected `displayCandidates` directly:

- `shared/components/reviewers/ReviewerSearchSection.js:728` computes `chosen = displayCandidates.filter(...)`.
- `shared/components/reviewers/ReviewerSearchSection.js:738-747` POSTs those candidates to `/api/reviewer-finder/save-candidates`.

The save route loops every submitted candidate and does not reject unresolved/deferred candidates:

- `pages/api/reviewer-finder/save-candidates.js:60-62` iterates all raw candidates and wraps provenance.
- `pages/api/reviewer-finder/save-candidates.js:122-125` computes identity-field blocks, but only for resolver-sourced fields.
- `pages/api/reviewer-finder/save-candidates.js:127-133` upserts the potential reviewer.
- `pages/api/reviewer-finder/save-candidates.js:135-156` writes the researcher overlay, with ORCID/Scholar/bibliometrics nulled only when blocked.
- `pages/api/reviewer-finder/save-candidates.js:168-179` writes the reviewer suggestion with `selected: true`.
- `pages/api/reviewer-finder/save-candidates.js:181-182` increments `savedCount` and records the name.

The adapter confirms that the suggestion row is selected:

- `lib/dataverse/adapters/reviewer-suggestion.js:222-234` accepts `selected = true`.
- `lib/dataverse/adapters/reviewer-suggestion.js:248` writes `incoming.wmkf_selected = !!selected`.

Potential reviewers can be created even without email:

- `lib/dataverse/adapters/potential-reviewer.js:82-85` documents that on miss or no email it creates a new row.
- `lib/dataverse/adapters/potential-reviewer.js:123-124` creates and returns the new record.

Controlling save line: `pages/api/reviewer-finder/save-candidates.js:168`. The route writes a selected suggestion after only field-level identity blocking; it does not require anchored identity for the candidate itself.

## Claim 2: Topic Overlap Is Displayed As Identity Confirmation

Verdict: PARTIAL.

The exact displayed string can be produced:

`Identity confirmed (no public ORCID): corroborated by research-topic overlap.`

However, the code does not show that topic overlap alone can produce `confirmed`. For Track-B, the `confirmed` status requires a strong `authorship_grounded` anchor plus topic or employment corroboration. The display text is misleading because `buildIdentityNote()` omits `authorship_grounded` from the corroboration phrase, making a work-grounded identity look like topic-only confirmation.

### Literal String Trace

The label is built in `buildIdentityNote()`:

- `lib/services/reviewer-identity-evidence.js:244` defines `buildIdentityNote()`.
- `lib/services/reviewer-identity-evidence.js:247` uses `no public ORCID` when no ORCID is present.
- `lib/services/reviewer-identity-evidence.js:254` adds `research-topic overlap` when a `topic_match` anchor exists.
- `lib/services/reviewer-identity-evidence.js:256-258` returns `Identity confirmed (${idText}): corroborated by ${corroText}.` when status is `confirmed`.

The UI renders that note directly:

- `shared/components/reviewers/ReviewerSearchSection.js:245` renders `c.identityNote`.
- `shared/components/reviewers/reviewer-search-logic.js:187-189` preserves `identityNote` into the roster DTO.

### Backward Trace: Where The Status Comes From

Track-B work-author resolution emits the relevant anchors:

- `lib/services/reviewer-work-author-resolver.js:102-106` requires exactly one byline author match for the resolved work.
- `lib/services/reviewer-work-author-resolver.js:110-116` always emits `authorship_grounded` as a strong anchor after that match.
- `lib/services/reviewer-work-author-resolver.js:117-121` optionally emits `topic_match`.
- `lib/services/reviewer-work-author-resolver.js:122-126` optionally emits `orcid_present`.
- `lib/services/reviewer-work-author-resolver.js:128-130` calls `resolveIdentity()` with those anchors.
- `lib/services/reviewer-work-author-resolver.js:146-148` builds the displayed `identityNote`.

The resolver condition for Track-B confirmation is not topic-only:

- `lib/services/reviewer-identity-resolver.js:161` detects `topic_match`.
- `lib/services/reviewer-identity-resolver.js:163` detects strong `authorship_grounded`.
- `lib/services/reviewer-identity-resolver.js:165-166` returns `confirmed` only when `authorshipGrounded && (topic || employment)`.
- `lib/services/reviewer-identity-resolver.js:168-169` returns only `probable` for `authorshipGrounded` without topic/employment.
- `lib/services/reviewer-identity-resolver.js:178` returns `unresolved` when those conditions are absent.

Controlling resolver line: `lib/services/reviewer-identity-resolver.js:165`. Topic can confirm Track-B only when paired with the strong work-grounded authorship anchor.

### Can Topic Alone Reach The Confirmed Label?

No evidence in the traced code shows topic-only confirmation.

For Track-A/OpenAlex name-search evidence:

- `lib/services/reviewer-identity-evidence.js:125-127` may select a record based on affiliation or topic match.
- `lib/services/reviewer-identity-evidence.js:207-211` can emit a lone `topic_match` anchor.
- `lib/services/reviewer-identity-resolver.js:175-176` returns `probable` only for `anyAffiliation && topic` or strong affiliation.
- `lib/services/reviewer-identity-resolver.js:178` returns `unresolved` otherwise.

So a lone `topic_match` anchor does not reach `confirmed` or even `probable` through the spine classifier.

What is VERIFIED is a display bug: when Track-B has `authorship_grounded + topic_match` and no ORCID, the note can say only "research-topic overlap" as the corroborator:

- `lib/services/reviewer-work-author-resolver.js:110-121` creates both authorship and topic anchors.
- `lib/services/reviewer-identity-resolver.js:165-166` classifies that pair as `confirmed`.
- `lib/services/reviewer-identity-evidence.js:249-258` builds a confirmed note but only lists affiliation, ORCID employment, cross-source ORCID, and topic in the human-readable `corroborated` list; it does not list `authorship_grounded`.

Controlling display line: `lib/services/reviewer-identity-evidence.js:254`. It is the only line that adds `research-topic overlap` to the confirmation note, and there is no corresponding line adding work-grounded authorship.

## Final Summary

Claim 1 is VERIFIED: deferred/unanchored Track-B candidates can be selectable and savable. The strongest controlling UI evidence is `ReviewerSearchSection.js:1022`; the strongest save evidence is `save-candidates.js:168`.

Claim 2 is PARTIAL: the exact "Identity confirmed (no public ORCID): corroborated by research-topic overlap" label can be produced, but topic overlap alone does not produce `confirmed` in the traced resolver. The root issue is misleading display text: the resolver requires `authorship_grounded + topic_match`, while the note mentions only topic overlap.
