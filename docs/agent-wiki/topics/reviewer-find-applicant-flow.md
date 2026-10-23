---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Inherited hub date; extraction integrity only, no claim or live-state recertification"
stale_after_days: 90
owner: reviewers
title: "Reviewer Find and Applicant Reviewer Flow"
source_files:
  - shared/components/reviewers/ReviewerFindPanel.js
  - shared/components/reviewers/ReviewerSearchSection.js
  - shared/components/reviewers/ReviewersTab.js
  - pages/api/reviewer-finder/my-candidates.js
  - pages/api/workbench/applicant-reviewers.js
  - pages/api/workbench/promote-applicant-reviewer.js
  - pages/api/workbench/reviewer-roster.js
  - lib/services/workbench/reviewer-roster-service.js
  - lib/services/reviewer-finder/save-candidates-service.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
watch_paths:
  - shared/components/reviewers/ReviewerFindPanel.js
  - shared/components/reviewers/ReviewerSearchSection.js
  - pages/api/workbench/applicant-reviewers.js
  - pages/api/workbench/promote-applicant-reviewer.js
  - pages/api/reviewer-finder/my-candidates.js
  - lib/services/reviewer-finder/save-candidates-service.js
update_triggers:
  - "Find and applicant-suggested reviewer flow changes"
  - "Roster, promotion, selection, or candidate reconciliation changes"
extracted_from: docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
extraction_source_sha256: fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7
extraction_segments:
  - "139-179"
  - "360-391"
  - "808-944"
  - "1117-1146"
  - "1204-1253"
  - "2201-2255"
---

# Reviewer Find and Applicant Reviewer Flow

> The source page mixed current guidance with dated history and owner decisions; those distinctions are preserved in the extracts. The inherited `last_verified` date does not certify these claims anew. This pass verifies only extraction bounds and byte provenance, not runtime behavior, repository-wide drift, or live state.

<!-- source-lines: 139-179 -->
## Reviewer Find warm-reconciliation incident — RESOLVED BY REVERT (2026-08-03, S396)

The warm-revisit/stage-reconciliation build (deployed through `7072d52a`) hit a
production incident on Request `1002903`: a narrow recovery (Katherine Ferrara
regained selection authority) alongside a remaining loop (Kanaka Rajan
retryable/queued, showing a per-card **Refresh contact evidence** action even
though the persistent identity/institution condition required a staff
decision). The incident is now CLOSED — `main` was fast-forwarded to
`2fc29b82` (tip of `reviewer-find-revert-baseline`), restoring the runtime
tree byte-for-byte to the pre-rollout `94c5b9d9` baseline (keeping only the
unrelated `edbe6931` `institution-coi-context.js` permissive-`isGuid` fix). The
experimental warm-reconciliation work in range `5b6757df..7072d52a` is **not
live**. Owner-verified production behavior (S396): the Find warm roster shows
checkboxes on selectable rows (`ReviewerSearchSection.js` `CandidateCard`
`checked`/`onToggle`); identity-gated rows render read-only with a
"confirm identity" affordance (`onConfirmIdentity`) rather than an automatic
evidence refresh; there is **no** "Reconcile previously found reviewers"
button and **no** per-card evidence-refresh control. Forward-fix branch
`reviewer-find-outcome-contract` is abandoned (kept for history). Full
chronology, root cause, and resolution evidence:
`docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md` (see
"Resolution" section first — the rest of that doc is the historical
pre-revert assessment). Root-cause/process lessons:
`.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md`.

**Warm-revisit proposal blob cache (S397, 2026-08-04, production-live).**
On top of that baseline, `lib/services/reviewer-finder/load-proposal-service.js`
now `head()`-checks a deterministic Blob path (hash of request + file
identity + `lastModified`/`size`) before SharePoint, so an unchanged warm
revisit skips the PDF re-download/re-upload (`blob cache HIT`/`MISS` log
lines; owner-smoked `1003010` MISS→HIT and `1002903` ~3.1s vs 5.9s baseline).
Hazards already adjudicated (do not re-litigate without new evidence): size
validation on hit and on the list→download race; a natural TTL from the maintenance blob sweep (default 90d —
`lib/services/maintenance-service.js:376,814`; runtime `config.blob_days`
can override); Preview/Production share the blob store so Preview
smokes pre-warm production paths. Enrichment-cache staleness on in-place
proposal updates is PRE-EXISTING and deferred as its own backlog item.
Record of truth for the increment (gitignored working doc):
`outputs/reviewer-find-warm-revisit-step0-findings.md`; durable summary in
`SESSION_PROMPT.md` "incremental plan ACTIVE" section.

<!-- end-source-lines: 139-179 -->
<!-- source-lines: 360-391 -->
## Find → Invite promotion contract (production-live)

Find retention is no longer equivalent to Invite readiness. The shared
`projectReviewerContact` projection derives one server-reproducible decision
from nested identity evidence, the exact normalized email/source, persistence
flags, affiliation rescue, and anti-scrape policy. Only `ready` candidates are
selectable for **Promote to Invite**. `needs_identity_confirmation` and
`missing_email` remain visible with their exact staff action and produce no
person/suggestion write.

Current automated receipts mint v3; verification accepts v1/v2/v3. V3 binds
the request, derived candidate key, optional roster key when supplied, identity
and contact digests, and eligibility status/evidence digest. Its
`contactAuthorityBound` signal requires an exact contact-digest match and a
`ready` projected contact decision; save still applies separate address-trust
checks. V2 can bind the full identity decision; v1/v2 have no contact binding
and retain their historical 14-day TTL. V3 does not bind
`eligibilityCheckStatus`. A staff override remains an exact
actor-bound server record. `save-candidates-service`
recomputes authority before adapters, resolves a unique active exact-email
owner before creation, converges create races, checks applicant exclusion, and
returns exact per-key `saved`/`withheld`/`failed` results. Only the server
finalizes an exact roster key as `saved`; the roster endpoint rejects browser
`action:'saved'`. An applicant-excluded collision becomes durable read-only
`blocked`.

On a partial non-2xx response, Find still reconciles server-confirmed saved
keys. After an unknown transport outcome it refetches roster/Invite state
before retry, and never graduates by normalized name. Invite continues to read
only the linked canonical person email; a legacy selected email-empty row shows
a diagnostic rather than falling back to the roster address.

<!-- end-source-lines: 360-391 -->
<!-- source-lines: 808-944 -->
## Applicant-Suggested Reviewer Flow (S263/S264)

Applicant-suggested reviewers (`disposition=recommended` junction rows from `wmkf_potentialreviewer1..5`) are integrated into the main candidate list on the Find tab rather than shown in a separate bottom card. As of S264, ingestion creates these rows with `wmkf_selected=false`; the candidate pool is the PD-selected set, and applicant-suggested rows enter it only when a Program Director explicitly promotes the existing junction row.

**Ingestion performance contract (increment D, S399, production-verified):** the on-demand `GET /api/workbench/applicant-reviewers` slot materialization runs all populated slots **concurrently** (`Promise.allSettled`; the S210 person-dedup set is fully built before any await, response slot ordering and per-slot failure isolation unchanged), and `ensureApplicantRecommended` **skips its PATCH when it would be a no-op** (row already `disposition=recommended` + `applicant` in sources + no empty descriptive field to fill). The skip is scoped to `!requireEtag` — the sole `requireEtag:true` caller (the merge service's provenance-union in `lib/services/reviewer-merge.js`, grep-verified S399) deliberately keeps its always-write ETag-conditional PATCH so a raced disposition flip still 412s before a loser-row delete. D0 evidence basis (2026-08-04, single true-cold N=5 production sample): the old sequential loop was ~2.0s of a ~3.4s handler total; measurements in `outputs/reviewer-find-warm-revisit-step0-findings.md` §D0.

**Institution-verdict contract (S400, merged; byline false-mismatch fix SHIPPED Wave 6 composite, production 2026-08-09):** the S399 "all five Institution mismatch" verdicts on request 1002903 were attributed via a one-run production operand capture to genuine checker `false` returns comparing raw PubMed byline evidence against clean listed institutions (evidence: `outputs/s400-institution-checker-probe-findings.md`, gitignored). Live on main: verdict copy carries contradiction provenance (`compared`/`comparison_error`/`prior_flag` — an error never reads as an affirmative mismatch; a decided contradiction names both compared strings); a permanent compact `[institution-verdict]` log line per candidate makes verdicts attributable from runtime logs; the success-path DTO writes the reconciled verdict instead of the stale pre-comparison flag; the banner attributes applicant-listed institutions to the applicant (not "Claude") and uses source-neutral "linked evidence shows"; `APPLICANT_ENRICHMENT_CACHE_VERSION` is 4 so pre-fix cached rows re-enrich once. **The byline false-mismatch class itself is fixed (Wave 6 + round-6 composite, production 2026-08-09):** `institutionEvidenceConnectsIdentity` now clears when EITHER the legacy checker (one-hop associated-link corroboration — preserves VUMC↔Vanderbilt-class related-entity clears) OR the staged segment-comparison checker (exact segment match + decoration proof — clears the request-1002912 Lunenfeld class) clears; strictly additive vs pre-Wave-6 production, throws propagate to the fail-closed catch, `identityConfirmed` conjunction unchanged. A **seam stop-rule** (owner-directed 2026-08-09) forbids further iteration on this surface; findings route to Stage 2 typed relationships. Full mechanism, gate history (wave6 157/157; frozen-40 identical to baseline), and stop-rule: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` Wave 6. **Standing hazard (still in force):** a byline core-extraction comparison fallback was built and REVERTED pre-Wave-6 — `normalizeAffiliationForComparison` is an aggregation key whose comma-truncation/50-char paths collapse comma-qualified sibling institutions (UC San Diego/San Francisco) into false CONSISTENTs that would clear `identityNeedsReview` (a Dataverse write gate). Never widen same-institution equivalence at that seam with a lossy extractor — the shipped segment-whole path is the sanctioned widening (sibling-false pinned by the 148-row uc-sibling live suite); pins live in `tests/unit/enrich-recommended-institution-evidence.test.js`. Directive addendum (`docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` §S399) carries per-finding status.

**Historical warm-reconciliation build, reverted (deployed through `7072d52a`,
reverted 2026-08-03 S396 — see the incident section above):** the abandoned
build gave `ReviewerFindPanel` a cached-then-reconciled roster read with
staged server-owned repair/reconciliation and a per-candidate stage plan; it
was not product-complete (see the incident section above) and is **not
live**. Current production `ReviewerFindPanel`/`ReviewerSearchSection`
behavior is the pre-rollout baseline: a warm roster read renders
checkboxes on selectable rows, identity-gated rows are read-only with a
confirm-identity affordance, and there is no reconcile button or per-card
evidence-refresh control. The former automatic `useEffect` enrichment flow
remains historical and must not be restored as a warm repair mechanism.

**Historical Production defect — owner-accepted 2026-08-01; engagement
projection subsequently deployed.**
The roster-only terminal contract above is insufficient. Re-probed 2026-08-01
and still live on Request `1002912`: Ralph Isberg holds a noncanonical saved row
plus a canonical active applicant row while Dataverse reads
`selected=true, invited=true`; Rotem Sorek has the same twin shape at
`selected=false, invited=true` plus an active row whose pre-merge suggestion
404s, so he renders twice. Find shows both as unresolved prospects.

**Two distinct causes — this matters for the fix.** Sorek-shaped resurfacing is
a **regression**: `fe825933` read applicant rows via
`findByRequest(..., { selectedOnly: true })`, which excluded declined reviewers
because decline archival sets `selected=false`, and `ad8e0299` (2026-06-16)
replaced it with a disposition-only read while making applicant rows
`selected=false` by default. Isberg-shaped resurfacing is the **latent
roster-twin gap** — he was `selected=true`, so the old filter passed him
through too. Projecting engagement fixes both; restoring `selectedOnly` would
fix only Sorek and would break the S264 explicit-promotion design.

**Owner decision:** engagement is an independent terminal input for **every
roster row carrying a suggestion anchor**, not applicant rows only. Work order:
`SESSION_PROMPT.md`. Evidence and corrections:
`outputs/reviewer-workflow-stabilization-fable-assessment.md` §0/§3 plus the
verbatim independent review in
`outputs/reviewer-workflow-codex-adversarial-review-2026-08-01.md`. The
deployed implementation projects
the engagement tuple, enrichment partitions handled rows before model work,
and the roster GET makes one complete request-scoped Dataverse read for every
suggestion-anchored visible roster row. Handled rows render only in a compact
**Already handled** summary with Invite/Removed/Track navigation. An excluded
row is also revalidated against Dataverse before it can return to active Find.
Focused source tests and later signed-in no-send checks covered this engagement
projection. Do not confuse that historical repair with the separate,
now-reverted warm-reconciliation build described above.

**Re-discovery reconciliation (S401, Kwong confusion 2026-08-04):** the server
roster reconcile above only covers rows WITH a suggestion anchor — a fresh,
unanchored search result for an already-engaged person rendered as a fully
invitable card whenever discovery's exact normalized-name exclusion filter
missed a name variant. Closed client-side at the display merge:
`shared/utils/reviewer-rediscovery.js` indexes the saved pool's ENGAGED rows
(stage beyond 'selected') by every identity key (person GUID, ORCID —
extracted from `orcidUrl` too — Scholar id, OpenAlex id, diacritic-folded
name), and `ReviewerSearchSection` partitions `displayCandidates` against it:
matches leave the actionable/selectable/save lists and render in the **Already
handled** summary as a "Re-found by search" entry keyed by the saved row's
`suggestion:` anchor (so it folds into an existing handled entry for the same
person rather than duplicating). A merely-'selected' saved row deliberately
does NOT collapse its twin. Name-key matches are rejected when a shared
anchor type CONFLICTS (same-name different-ORCID people stay separate —
Codex adversarial finding); an anchor-less name match still collapses, the
accepted ambiguous-namesake trade — the entry stays visible with stage +
navigation, and manual add remains the namesake escape. `ReviewersTab` now
passes `savedPool` (was `savedPoolNames`): active candidates PLUS declined
removed rows (declines archive to `selected=false`, so they live only in
`removedCandidates` — second Codex finding; `projectRemovedCandidates` now
emits person/ORCID/Scholar anchors for them); staff-removed-not-declined rows
stay out deliberately. Exclusion-union names derive inside the section. Also corrected: an `invited`-stage handled entry navigates to
Invite (pending list) instead of Track, where an unaccepted person is not
visible. Tests: `tests/unit/reviewer-rediscovery.test.js`,
`tests/unit/reviewer-search-rediscovery.test.js`.

**Unified candidate list:** Enriched applicant candidates (`recCandidates`) are prepended into `displayCandidates` so fresh enrichment wins over stale roster copies. Candidates with a resolved identity surface in the `applicant_suggested` provenance section — which appears after `cited_or_proposal_named` and `literature_retrieved` in that order — via `provenanceGroupOf` detecting `isApplicantRecommended: true` → `APPLICANT_SUGGESTED` kind. **Exception:** candidates where enrichment could not confirm identity (`needsIdentification: true`, typically when the applicant provided no affiliation) route to `needs_identity_review` instead — `provenanceGroupOf` checks `needsIdentification` before `APPLICANT_SUGGESTED` (reviewer-provenance.js:228 vs :231). The `applicant_suggested` section is selectable unless normal safety gates make a row read-only; selecting it calls `POST /api/workbench/promote-applicant-reviewer` with the existing `suggestionId` instead of `save-candidates`.

**Roster persistence:** `/api/workbench/enrich-recommended` snapshots each
canonical suggestion row and its roster `updated_at`, stamps each final
applicant-enriched row with `enrichedProposalKey` and the current cache version,
prunes it through `pruneCandidateForRoster`, and records it through the
concurrency-guarded roster store as `active` or direct-deceased `ineligible`.
The current-run verification institution outranks stale stored affiliation in
the final coherence check. The prune retains bounded actor-owned staff
confirmation. Browser POST/exclude strips client-supplied authority and
restores only a genuine server confirmation; the browser cannot write `saved`
or `blocked`. Concurrently confirmed/excluded/saved/blocked rows resist stale
enrichment. `suggestionId` remains the exact applicant-promotion anchor.
Exclusion removes an applicant row from the active roster; only a successful
server promotion finalizes it `saved`, while an authoritative
applicant-excluded collision finalizes it `blocked`.

**Explicit applicant promotion (production-live):**
`/api/workbench/promote-applicant-reviewer` validates request and
suggestion ownership/disposition, requires the canonical
request/`suggestion:<id>` roster row, and rechecks identity, eligibility, COI,
and canonical contact authority before selection. Hand corrections are limited
to fields explicitly marked manual and remain bound to the suggestion's
server-read person. When no manual email exists, the route can backfill only the
email authorized by the same canonical contact projection as ordinary Find
promotion; it then freshly reads the person and refuses selection unless the
canonical email is present. Duplicate-email collision, stale write, missing
roster authority, and roster-finalization failure are blocking outcomes—not
partial successful promotions. After `wmkf_selected=true` succeeds, the server
finalizes the exact roster key as `saved`. There is no name fallback and no
successful no-roster legacy path.

Slice A adds a fresh engagement check before any person/contact mutation and a
second compare-and-set immediately before selection, bound to the suggestion
ETag. A concurrent decline therefore wins and returns a reload-required 409.
The ordinary `save-candidates` upsert path applies the same engagement check
and ETag-bound selection rule, including its alternate-key conflict winner, so
it cannot become a second re-selection door for search-origin rows.
The explicit Restore path retains its separate ETag-bound reset authority.
Manual/referral re-add of an applicant-recommended person unions provenance
only: it never selects or clears lifecycle fields, and returns
`promotion_required`, `restore_required`, or `already_handled` with an
executable Find/Invite/Removed/Track remedy. **[VERIFIED via focused source tests
and deployed source, reconciled 2026-08-03]**

Find-discovered rows still receive their exact suggestion/person anchors after
ordinary save. The read-only reconciler remains a legacy backstop: it requires
an existing server-stored suggestion anchor, uses `pickVettedEmail` as a thin
caller of the canonical projection, and never creates/selects a suggestion.
Contact enrichment partial-timeout behavior is unchanged.

**Status card:** The bottom card below the search is a status/progress/error surface only — no candidate list or per-person verification control. It shows ingestion state, enrichment progress while running, a done summary ("N verified — see Applicant-suggested section above") with an **Update applicant suggestions** batch action, or an error with a "Try again" button.

**Publication count for applicant rows (S264):** Applicant-recommended reviewers skip PubMed/preprint discovery, so they carry no publications list and used to show a FALSE "0 publications" beside a real h-index. `enrich-recommended.js` now backfills `publicationCount5yr` from the OpenAlex author it already resolves for the metrics — `OpenAlexService.getWorksByAuthor(openAlexId, { yearFrom: year - DiscoveryService.YEARS_LOOKBACK, limit: 1 }).totalCount` (count-only query; same window as `DiscoveryService.countRecentPublications`). Gated on `blockScholar` like the other metrics (no count for an unconfirmed/wrong-person match); best-effort (a failure leaves it null). One extra OpenAlex call per applicant reviewer.

<!-- end-source-lines: 808-944 -->
<!-- source-lines: 1117-1146 -->
**Expertise for applicant rows (2026-09-21):** applicant-recommended reviewers
arrive with `expertiseAreas: []` (only Reviewer Finder candidates get Claude-written
areas, which promotion writes to `wmkf_areaofexpertise`), so their person rows
never had `wmkf_keywords` either and the Pre-Site Visit Reviews paragraph's
expertise sentence silently omitted them. `enrich-recommended-service.js`
`expertiseKeywordsFor` now falls back to the accepted OpenAlex author's
`researchTopics` (`OpenAlexService.mapAuthorRecord`, from the current author
object's specific `topics` list sorted by count — NOT the broad deprecated
`x_concepts` that `topics`/`topTopics` read for identity grounding), sentence-cased
for mid-sentence use, top three, carried on `ce.openAlexResearchTopics` past the
identity gate. Gated on `blockScholar` like the h-index; `wmkf_keywords` is
fill-if-empty in the researcher adapter, and **(S530)** that PATCH is
ETag-conditional whenever the read row carries one — not only for the
email-source-upgrade path — with one re-read-and-retry on a 412, so a
concurrent staff edit wins the race rather than being silently overwritten.
Sentence-casing (`sentenceCaseTopic`) only lowercases a plain Title-Case word
(`/^[A-Z][a-z]+$/`); anything mixed-case, hyphenated, or digit-bearing is left
exactly as the provider supplied it, so scientific tokens like `mTOR`,
`scRNA-seq`, and `p53` are preserved rather than destroyed.
**Reach:** enrichment skips `handled` suggestion rows (selected/invited/…), so this
fixes future applicant rows enriched before promotion; an already-promoted row
(request 1002852) needs a one-time hand fill of the person's Keywords or Area of
Expertise, then a brief regenerate.

**"Scholar profile" vs "Scholar search" label (S266):** Enrichment populates `googleScholarUrl` with a Google Scholar *search* URL by default (`ContactEnrichmentService.buildGoogleScholarUrl` — OpenAlex exposes no Scholar `user=` id), so the card's label MUST NOT be a truthiness check on `googleScholarUrl` (that mislabels every enriched reviewer as having a "profile"). The label is gated on `isRealScholarProfileUrl(url)` (`lib/utils/scholar-url.js`) — true only for `scholar.google.com/citations?user=<id>`, false for `?view_op=search_authors&mauthors=…`. Applied at all three render/export sites (`ReviewerInvitePanel.js`, `ReviewerSearchSection.js` card + export). Today no flow produces a real `user=` profile URL for these reviewers, so they correctly read "Scholar search". **S388 adds a FOURTH site with a stricter rule:** the identity-evidence disclosure on `identityUnverified` cards always builds its link with `buildScholarSearchUrl(name, affiliation)` and never reads `googleScholarUrl`, so a stored `user=` profile can never surface there even if one appears later. That is deliberate and must not be "fixed" into label-gating like the other three — on an unresolved row a real profile URL is the namesake trap itself, not a better link.

**Board-writeup identity edit (S308):** clicking a reviewer in the workbench opens `CandidateEditModal`, which now also edits three person-level confirmed fields — academic rank, primary department, main institution (saved-candidate edit mode only; hidden in the pre-save Find-card `onApply` + `confirmMode` paths). They PATCH `my-candidates` → `potentialReviewerAdapter.update` (server-derived `personId`, never client-supplied) → dedicated person columns (`wmkf_academicrank`/`wmkf_primarydepartment`/`wmkf_maininstitution`), emitted on the candidate DTO. These are first captured (required) at Stage 2a accept (see external-reviewer-portal topic). **Main-institution fallback (S310):** when `wmkf_maininstitution` is empty the modal prefills Main institution from the enrichment Affiliation (`mainInstitutionFallback` = `candidate.mainInstitution ‖ candidate.affiliation`), mirroring the reviewer accept-form prefill (`context.js buildStage2aPrefill`) so staff see the same value the reviewer will. The same fallback is the change-comparison baseline, so opening + saving never silently writes the affiliation into the dedicated column — only a genuine staff edit persists. (h-index was dropped from the modal S310 — auto-fetched, not staff-editable.) See reviewer-identity for the field rationale.

**Review history on the Invite card (S308):** the Invite-tab candidate DTO (`my-candidates` GET) carries `priorReviewCount` + `lastReviewAt`, derived (not stored) from `suggestionAdapter.aggregateReviewHistory(personIds)` — one batched query over `wmkf_appreviewersuggestion` filtered to received-only rows (`wmkf_reviewreceivedat ne null`) for the request's candidate person-ids. "Completed a review" = the reviewer's review was **received** (`wmkf_reviewreceivedat`), NOT the PD's closeout stamp (`wmkf_completedat`). `ReviewerInvitePanel` renders "reviewed N× · last <date>" only when `priorReviewCount > 0`. The aggregation is supplementary — its query failure is caught non-fatally in `my-candidates` (degrades to no history; never 500s the candidate list). Not yet surfaced on Track Reviewers (fast-follow).

<!-- end-source-lines: 1117-1146 -->
<!-- source-lines: 1204-1253 -->
**Export to Excel (S264; Invite-tab export + Expertise-tags column S308):** Two surfaces post to `POST /api/workbench/export-candidates`. (1) **Find tab** — a bottom-row "Export to Excel (N)" button (next to Save) exports the **selected** search candidates; (2) **Invite Reviewers tab** (`ReviewerInvitePanel`) — a header "⬇ Export to Excel" button exports the **active saved candidate list** (all non-removed rows on the tab; declined reviewers are archived below and therefore excluded), mapping the persisted DTO into the same slim per-row shape. Both send a slim per-row DTO; the route fetches request metadata (number/institution/PI) authoritatively by `requestId` and streams back a two-sheet `.xlsx` (Request Info + Candidates). Column formatting (Source/Why/**Expertise tags**/Conflicts/ORCID/Scholar) lives in `lib/services/reviewer-candidate-export.js` so the sheet and the cards agree; the Expertise-tags column reads `keywords` (Find tab joins `expertiseAreas`; Invite tab uses the persisted `keywords`). Invite-tab exports carry only invite-stage fields — search-time COI / 5-yr-pub-count / seniority aren't persisted, so those columns read "None noted"/blank (board-writeup identity is captured at acceptance, not here). On the Find tab, `needs_identity_review` rows aren't selectable (so naturally excluded) UNLESS a PD used the S285 identity override ("✓ This is the right person") to confirm + add one, which makes it selectable and thus exportable. The "reviewer diversity"/temperature slider was removed the S264 cycle (search runs at the server default 0.3).

**Re-verify removed intentionally:** The "Re-verify" button was dropped because enrichment output is static within a cycle (COI computed against a fixed proposal author list; PubMed/Scholar data stable over weeks). The valid re-run use case is error recovery ("Try again"). Keep the general re-verify path retired; if a re-resolve-after-edit pattern is ever needed, see the Future Work section in `reviewer-identity.md`.

**Unverified-suggestion rescue (S402):** the Find tab's collapsed "Unverified
suggestions" section (Claude suggestions the searched databases couldn't
verify) is no longer a dead end — each card carries the same S285
confirm-identity affordance as the needs-identity-review section, plus
Exclude. The load-bearing ordering: these rows are EPHEMERAL (deliberately
never recorded on `reviewer_find_roster`, S224) while the server
`confirm_identity` action only updates an existing ACTIVE roster row, so
`confirmIdentityContact` first POSTs the row to the roster (upsert;
`preserveStoredRosterAuthority` in
`lib/services/workbench/reviewer-roster-service.js` makes a retry after partial
failure safe),
then confirms, then moves it from the ephemeral `unverified` state into
`rosterActive`, where the existing just-confirmed → selectable machinery
applies. Keys are stamped with `withReviewerCandidateKey` when unverified
rows land in state so the record POST and confirm PATCH agree on one key even
after the PD edits affiliation in the modal. Exclude reuses the durable PATCH
(server `setExcluded` is already an upsert) via a dedicated handler whose
failure rollback must NOT restore the row into `rosterActive` (it was never
active) and must restore `rosterNames` to its prior membership (else the
failed exclude phantom-suppresses the name from every later search).
Adversarial-review hardening (same session): discover.js applies
`filterProposalAuthors` to the unverified list too (rescuable rows must cross
the same PI/co-investigator boundary as verified ones), and `confirm_identity`
re-checks both the submitted and server-stored candidate names against the
server-resolved PI (`resolveProposalPI`) plus the canonical
`wmkf_apprequestperson` Co-PI junction (`fetchCoPIs`), rejecting matches with
422 `proposal_author_candidate` — no browser-carried proposal analysis is
trusted at that boundary. Pinned:
`tests/unit/reviewer-search-unverified-rescue.test.js`,
`tests/unit/reviewer-discover-unverified-author-filter.test.js`,
`tests/unit/reviewer-roster-endpoint.test.js`.

**Exact applicant-linked person hydration (production-live; authenticated
Request `1002912` visual check passed 2026-07-31):** populated
`akoya_request.wmkf_potentialreviewer1..5` slots are exact
`wmkf_potentialreviewers` GUIDs. Applicant ingestion and enrichment now re-read
only that person, preserve a bounded `applicantKnownReviewer` email/source pair
plus affiliation/ORCID, and render “Existing linked reviewer record” separately
from general-search `dataverseContactEvidence`. Active exact-email ownership
must resolve to the same person. Person-read failures remain per-row and
retryable; all-read failure cannot become a false empty success. Promotion
freshly revalidates the suggestion, person, and owner and may reuse canonical
contact without an email write, but identity/COI and the invitation address
classifier still govern selection and sending. Contract 9 in
`docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` owns the enforcement details.

<!-- end-source-lines: 1204-1253 -->
<!-- source-lines: 2201-2255 -->
- **Save-time Tier-0 affiliation-email rescue — "reviewer has no email on the Invite tab" trap (S317).**
  When contact enrichment RUNS but does not COMPLETE (a partial / timed-out run — the person
  record carries `wmkf_lastchecked` but no `wmkf_metricsupdatedat`/`wmkf_hindex`), a
  PubMed-style affiliation that embeds the reviewer's own corresponding address
  ("… Boston Children's Hospital. christopher.walsh@childrens.harvard.edu.") used to be saved
  with the email ORPHANED inside `wmkf_primaryaffiliation` and an EMPTY `wmkf_emailaddress`
  ("no email — can't invite" on the Invite Reviewers tab), because enrichment's own Tier-0
  extraction (`contact-enrichment/tiers.js` `applyTier0`, using
  `ContactParser.extractPrimaryEmail`) never ran to completion.
  `reviewer-finder/save-candidates-service.js` re-applies that extraction as a
  last step: if no email was captured
  and the affiliation being persisted contains one (`ContactParser.extractPrimaryEmail`), it is
  stored as `emailSource='affiliation'` — a grounded, name-adjacent address that enrichment
  trusts unconditionally (Tier 0 returns before domain validation, so it is immune to the
  paid-search domain-contradiction drop). Same safety envelope as the normal email persist:
  skipped for a contact-blocked (unresolved cited/PI-named) row and for PD-confirmed rows, and
  only when the affiliation itself is allowed to persist; it only fills a GAP, never overrides a
  captured email. Diagnosed live on request 1003020 (Walsh, Akbarian). Tests:
  `tests/unit/reviewer-route-identity-gate.test.js` ("Tier-0 affiliation-email rescue").
- **Name-based dedup collapses reviewers who share a NORMALIZED name — a recurring "missing reviewers" trap (S312).**
  Two shared normalizers both lowercase and strip everything non-alpha via
  `.replace(/[^a-z\s]/g, '')` — **which deletes digits**: `normalizeReviewerName`
  (`lib/utils/reviewer-name-match.js:33`) and `normalizeName`
  (`lib/utils/name-normalization.js:18`). That normalized key is the dedup identity
  in several pre-roster/display passes: display
  `dedupeByName` → `candKey` → `normalizeReviewerName` (`ReviewerSearchSection.js`),
  the `/discover` server dedup, and `DeduplicationService` (`deduplication-service.js:112`,
  its own copy of the same regex). Consequences to watch for when "not all reviewers
  show" in the Find tab: (a) **test data** — names differing only by a trailing digit
  (`tester2/3/4/5 testing` → all normalize to `tester testing`) collapse to one row;
  use alphabetically-distinct test names. (b) **real same-name reviewers** — two
  genuine "John Smith"s collapse to one surfaced/rostered row. The underlying person
  records + `disposition=recommended` junction rows are NOT lost — the collapse is in
  the remaining name-dedup surfaces, not the roster database key. Migration 025 changed
  the roster unique key to `(request_id, candidate_key)`, so distinct rows that reach
  persistence can coexist; `normalized_name` remains only a conservative cross-run
  exclusion value. A complete fix requires replacing the remaining display/discovery
  name dedup with identity-aware correlation. The digit-strip itself still affects
  search exclusion and matching, so do not casually change it.
- **Source-person edits after a successful terminal enrichment are not automatically cache-invalidating (remaining S312 residual).**
  The cache now requires the complete non-terminal expected canonical `suggestion:<id>`
  set (after canonical excluded/saved staff actions are subtracted), so legacy-key
  rows and partial persistence no longer suppress a refresh. Completed
  completed batches expose **Update applicant suggestions**, and reruns preserve
  staff-confirmed rows. A resolved/deceased terminal row still has no source-person
  version token, however, so a later rename or affiliation/email correction in
  `wmkf_potentialreviewerses` does not itself invalidate that otherwise-valid cache.
  Add a source version/modified timestamp to the contract before claiming automatic
  refresh for this residual; do not clear request roster rows as routine UI behavior.
- Roster reload must preserve fields that keep deferred/unresolved/conflicted rows non-selectable.
- Cross-run dedup is durable; do not casually drop carryover.
- Reviewer removal/reset behavior often spans UI state, roster store, and Dataverse suggestion state.
- Applicant-suggested rows are persisted as `disposition=recommended` but are **not** in the candidate pool until `wmkf_selected=true`; keep the promotion route as the only UI save path for these rows.
- The auto-enrichment effect depends on `proposalKey`, not just `blobUrl`: same-key applicant-origin roster rows are a valid restore cache, but a null key is never a cache hit and a different key must re-enrich. Be careful if adding new proposal-load effects that they do not treat the random-suffixed Blob URL as durable identity.

<!-- end-source-lines: 2201-2255 -->
