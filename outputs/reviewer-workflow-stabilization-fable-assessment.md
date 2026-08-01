# Reviewer Workflow Stabilization — Fable Independent Assessment (Session 393)

Author: Claude Fable, 2026-08-01. Read-only session; no runtime edits, no data
repair, no Production writes. Evidence basis: current source on
`main`@`ca9e9c5`, the durable docs listed in the session brief, and **one
owner-run read-only Production probe** (`scripts/probe-roster-dump.mjs
--request 1002912 --include-dataverse`, executed 2026-08-01 after the session's
own attempts were denied by the permission classifier; interlock logged
`mode=on deployment=local target=production`, reads only). Probe results are
labeled `[VERIFIED via probe 2026-08-01]`; where the probe does not print a
field, the claim stays `[UNKNOWN]`.

Verdict (details in §4): **PLAN SOUND WITH NAMED CHANGES**.

---

## 1. Executive verdict and reframe

**The staff problem, in my own terms.** When a Program Director opens the Find
tab, the system must answer one question correctly for each applicant-named
reviewer: *"is there anything left for me to do with this person, and if not,
where do they live now?"* Today Find computes "anything left to do" from the
wrong store. Its only notion of "handled" is a set of canonical Postgres roster
keys (`excluded` + `saved`), while the durable facts that actually make a
person handled — invited, declined, accepted, review received — live in
Dataverse and never reach the projection. The result on Request `1002912`: two
reviewers who had completed their part of the lifecycle were re-presented as
fresh, actionable prospects, and the enrichment machinery re-ran on them every
time the tab opened.

**Three independent defects, not one.** The July 31 diagnosis is substantially
correct, but its three symptoms are three *separate* defects that happen to
co-occur, and each has a much smaller fix than the plan's framing suggests:

1. **Missing terminal-state input (the resurfacing).** Applicant enrichment
   selects rows by `wmkf_applicantdisposition=Recommended` only, and the client
   terminal set is roster-keys-only. Engagement is never consulted — even
   though the enrichment query *already fetches every engagement field* and
   then discards them. `[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:1093-1098, lib/dataverse/core/entity-registry.js:106-182, shared/components/reviewers/reviewer-search-logic.js:443-455]`
2. **Identity-key emission gap (the Lima 409).** Fresh enrichment output omits
   `candidateKey` from its DTO; the roster route's fail-closed binding compares
   the client blob's key against the stored row's key, so `confirm_identity`
   and `exclude` on a freshly enriched applicant candidate 409 by
   construction. `[VERIFIED — full chain in §2 hop 8]`
3. **Non-durable proposal override (the reload gating).** The manual file pick
   lives in component state and reload always re-requests strict
   canonical-only, so on requests without a canonical file, staff re-pick every
   visit. `[VERIFIED via shared/components/reviewers/ReviewerFindPanel.js:129-153, lib/services/reviewer-finder/load-proposal-service.js:129-145]`

**"Regression" is the wrong word, and it matters.** I found no evidence that
engagement filtering ever existed on this path: the S263/S264 design read by
disposition from the start, and the wiki describes the current behavior as
standing ("the enrichment route reads by `wmkf_applicantdisposition=Recommended`
… so it currently verifies and surfaces both unpromoted and already-engaged
applicant rows"). `[VERIFIED via docs/agent-wiki/topics/reviewer-workbench-lifecycle.md §Applicant-Suggested Reviewer Flow; no removed filter found in the traced source]`
This is a **latent contract gap first exposed by revisiting a request whose
applicant reviewers had progressed through the lifecycle** — probably the first
request where a full invite→decline cycle happened *and* legacy `candidate:`
saved twins existed. Consequences of the reframe: there is nothing to roll
back, "recurrence" is deterministic rather than probabilistic (every affected
request re-mints state on every tab open), and the fix is completing a
projection, not repairing an orchestration.

**Finding A — the referral/manual-add path is an ungated promotion door
(owner-prompted, 2026-08-01; the most serious finding in this assessment).**
Owner ground truth: Wolberger was invited and **declined**, and her decline
referral named Christopher Lima — who was also an applicant-recommended slot
reviewer. Tracing that scenario: the Track-tab one-click "Add as candidate"
(and the Find tab's Add-or-Refer form) POST to `/api/workbench/manual-reviewer`
→ `addManualReviewer` → `ensureStaffManualCandidate`. When a junction row for
that person/request **already exists** — which is exactly the case for an
applicant-recommended person — it does not create anything; it calls
`patchStaffManualReselect`, which writes `wmkf_selected = true`, and, because
the applicant row is `selected === false`, **also applies
`ENGAGEMENT_STAMP_RESET`**.
`[VERIFIED via manual-reviewer-service.js:225-234, reviewer-suggestion.js:739-773, 684-724, 660-682]`

Consequences, in order of severity:

1. **It promotes an applicant-recommended reviewer with none of the promotion
   gates.** `promoteApplicantReviewer` exists to enforce identity confirmation,
   deceased/eligibility, COI, canonical contact, address-trust receipt, and
   roster finalization before `selected=true`. This path flips the same bit
   with none of them. The disposition stays `recommended`, so the row becomes
   `disposition=recommended, selected=true` — a promoted applicant reviewer
   that never passed the applicant promotion contract.
2. **It can silently clear a decline.** `ENGAGEMENT_STAMP_RESET` fires on any
   `selected=false` row, and a declined applicant reviewer is `selected=false`.
   So adding a declined person as a referral wipes their decline/response
   state — the deliberate Restore semantics, applied without staff choosing
   Restore.
3. **It is reachable by exactly the workflow Justin described**: a declining
   reviewer names someone the applicant also recommended. That is not an exotic
   case — decline referrals and applicant slots draw from the same small expert
   pool.

This is deliberate to a point — the adapter's own comment says "Applicant
recommendation state is preserved when present so a row can carry both
origins," and dual provenance is a legitimate goal. The defect is that
*carrying both origins* was implemented as *selecting the row*, so a provenance
merge doubles as an ungated promotion.

**Did door A fire on Lima's existing row?** No. His suggestion's `sources` is
`applicant` only; a committed referral add against *that row* would have unioned
in `staff_manual,referred`
`[VERIFIED via probe 2026-08-01 vs manual-reviewer-service.js:225]`, and he is
`selected=false, invited=false`.

**But Finding C explains why door A was bypassed rather than exercised:** if the
referral text was a concatenated/variant name, the lookup never resolved to
Lima's existing person at all, so `ensureStaffManualCandidate` took the
*create* branch on a NEW person instead of the *reselect* branch on his existing
row. That is consistent with every piece of evidence — Lima's row untouched, and
a separate duplicate entry that later needed name editing. **The two findings
are complementary, not competing: a clean referral name hits door A; a malformed
one hits Finding C.** Both need closing, and neither has damaged Lima's
applicant row.

**Finding C — the decline-referral add sends free text as a name, and a
malformed name auto-creates a duplicate person (owner-prompted, 2026-08-01).**
Owner ground truth: the Lima entry involved a "Christopher" vs "Chris" name
conflict, and **two names were concatenated in the name field**, needing manual
editing later; the entries may have been treated as distinct people. The source
reproduces that exactly:

1. **No name extraction.** `decline-referrals-service` returns the reviewer's
   raw answer as `referralText` `[VERIFIED via decline-referrals-service.js:66-81]`,
   and the one-click Add sets `const name = (referral?.referralText || '').trim()`
   — **the entire free-text answer becomes the reviewer's name**
   `[VERIFIED via ReviewersTab.js:186-202]`. A reviewer answering "Chris Lima
   and Dan Finley" produces a person literally named that.
2. **The codebase already solved this problem once, on the analogous surface.**
   The applicant's free-text excluded-reviewers field goes through
   `extractExcludedReviewers`, a hardened Claude extraction that yields clean
   names `[VERIFIED via applicant-reviewers-service.js:157-172]`. The referral
   surface has no equivalent. That asymmetry is the whole defect.
3. **A malformed name cannot match anything, so dedupe never runs.**
   `splitName` takes token 0 as the forename and *the entire remainder* as the
   surname `[VERIFIED via potential-reviewer.js:21-28]`, so "Chris Lima and Dan
   Finley" searches for surname "Lima and Dan Finley" — zero rows
   `[VERIFIED via potential-reviewer.js:194-207]`. Lookup returns
   `outcome:'none'`, which auto-resolves to `{ mode: 'create_new' }`
   `[VERIFIED via manual-reviewer-service.js:131-138]` → **a brand-new person
   row, plus a suggestion created with `wmkf_selected = true`**
   `[VERIFIED via reviewer-suggestion.js:775-784]`. Two distinct entities for
   one human, the second one selected into the candidate pool.
4. **The existing safety guarantee is one-directional.** The documented promise
   is that "a free-text suggestion never auto-resolves to a namesake" — true,
   and the ambiguous case correctly returns a staff picker. But it guards the
   *wrong-match* direction only. It offers nothing against *no match because the
   input was garbage*, which silently takes the create-new branch with no picker
   at all. **The worse the input, the quieter the failure.**

Note what does *not* break here: a clean "Chris Lima" is fine —
`startswith(wmkf_firstname,'Chris')` matches "Christopher"
`[VERIFIED via potential-reviewer.js:202-204]`, and the name-fallback path always
returns candidates for staff confirmation rather than auto-resolving
`[VERIFIED via reviewer-identity-lookup.js:411-422]`. **The diminutive alone is
handled; the concatenation is what defeats it.**

*Related latent item, labeled hypothesis, not tested:* in the enrichment-side
resolver, `forenamesContradict` returns true whenever two full forenames differ
`[VERIFIED via reviewer-identity-evidence.js:336-341]`, so "Chris" vs
"Christopher" would register as a forename *contradiction* and demote an
otherwise-correct match. Lima's stored reason cites an institution
contradiction, not a forename one, so **I am not claiming this caused his
unresolved state** — but a diminutive being treated as evidence of a different
person deserves its own test.

**Finding B — the resurfacing also has an ungated promotion door.**
The resurfacing is not display-only — it exposes a **state-corrupting write
path**. `promoteApplicantReviewer` validates only
`wmkf_applicantdisposition=recommended` before flipping `wmkf_selected=true`;
it never checks `invited`/`declined`/`accepted`. `updateLifecycle`'s guard read
refuses only applicant-excluded rows and terminal `wmkf_reviewstatus` values
(withdrew/released) — `declined=true` is not a barrier.
`[VERIFIED via lib/services/workbench/promote-applicant-reviewer-service.js:315-323,603-607 and lib/dataverse/adapters/reviewer-suggestion.js:1326-1339]`
So a PD who clicks Promote on a resurfaced declined reviewer (the Sorek shape)
writes `selected=true` while `declined=true` and the decline metadata remain —
a hybrid state the decline-archival invariant ("declined ⇒ leaves the active
pool") assumes cannot exist, entered without the deliberate
`ENGAGEMENT_STAMP_RESET` that the explicit Restore path uses.

**Finding D — WITHDRAWN as a safety concern (measured and then read, 2026-08-01;
§3.2). The code-level hazard is real — exclusion enforcement is name-matching
only, so a category exclusion cannot be honored — but reading the affected
answers shows 8 of 10 are simply prose for "none" (a no-op is correct), 1 is
junk, 1 is a genuine inverted request, and 0 are names the parser missed. The
scenario I described occurs in ~1% of substantive exclusions, not 8%. Retained
below only so the reasoning and its correction are both on the record.** Exclusion enforcement is exact normalized-name matching
`[VERIFIED via lib/utils/reviewer-name-match.js:54-65]`. A substantive answer
that states a category rather than names ("direct competitors") parses to zero
names, so the excluded set is empty and **no candidate is filtered**
`[VERIFIED via reviewer-exclusion-parser.js:167-171]`. The text is shown to
staff, who may hand-type names, but nothing requires it
`[VERIFIED via ReviewerSearchSection.js:2531-2534]`. The applicant believes
they excluded someone; the system blocked no one. This is **fail-open**, it is
independent of the `1002912` incident, and unlike Findings A–C it may be
affecting requests right now. It needs no form change to measure — see §6a for
the exposure read, and note that measuring it is worth doing before the next
campaign regardless of whether any input is ever restructured.

**Findings A and B are the same missing invariant seen through two doors.**
Nothing enforces "a row carrying live engagement cannot become `selected=true`
except through an explicit, staff-chosen reset." Door B (promote) resets
nothing and leaves a contradictory hybrid; door A (referral/manual add) resets
everything and erases the decline. Both bypass the applicant promotion
contract. That is why the guard belongs at a chokepoint covering every writer
of `selected`, not in either route — see §5 I-2 and §6 step 5. The directive's
five golden workflows cover neither door; the revised set in §5 does.

---

## 2. Whole-flow map (authoritative lifecycle → staff-visible Find state)

Each hop: producer → persistence → key → consumers, with the disagreement
behavior that matters. Hops marked N/A were traced far enough to confirm they
are not implicated.

1. **Request/proposal selection (UI).** `ReviewerFindPanel` auto-runs ingestion
   and `loadProposal()` on mount; a manual file pick calls
   `loadProposal(fileKey)` and lands in `doc` component state only.
   **Not reload-stable; no URL/nav state.** `[VERIFIED via ReviewerFindPanel.js:107-153]`
2. **SharePoint file resolution.** `loadProposal` lists all files, then: explicit
   `fileKey` override, else exactly one active
   `Reviewer Materials/Proposal_{Request#}.pdf`; zero → 404 with `allFiles`,
   two+ → 409. No filename heuristics. `[VERIFIED via load-proposal-service.js:110-145]`
3. **Blob handoff / cache identity.** Blob upload uses `addRandomSuffix:true`,
   so `blobUrl` is per-load-random; the stable cache key is
   `picked` = `library::folder::filename` (`proposalKey`). Content changes
   in-place under the same key are invisible to the cache — accepted risk,
   mitigated by the explicit **Update applicant suggestions** rerun.
   `[VERIFIED via load-proposal-service.js:147-164, reviewer-search-logic.js:457-506]`
4. **Applicant slot ingestion.** `ingestApplicantReviewers` materializes
   `wmkf_potentialreviewer1..5` into `disposition=recommended, selected=false`
   junction rows via race-safe `ensureApplicantRecommended`, which deliberately
   never touches `wmkf_selected` on existing rows and returns `selected` on
   every branch — **which the response DTO then drops**. The DTO carries no
   engagement information at all. `[VERIFIED via applicant-reviewers-service.js:100-201, reviewer-suggestion.js:526-626]`
5. **Dataverse lifecycle reads.** `findApplicantRecommendedByRequest` filters
   `disposition=recommended AND not-excluded` — no engagement predicate — but
   its `$select` is the full `FIELD_SELECT`, which includes `wmkf_selected`,
   `wmkf_invited`, `wmkf_accepted`, `wmkf_declined`, `wmkf_emailsentat`,
   `wmkf_responsereceivedat`, `wmkf_reviewreceivedat`, `wmkf_completedat`, and
   more. **The engagement facts are in memory in `enrichRecommended` and are
   discarded.** `[VERIFIED via reviewer-suggestion.js:1088-1100, entity-registry.js:106-182]`
6. **Applicant enrichment.** `enrichRecommended` preserves rows with an
   actor-bound staff confirmation, then enriches everything else in the
   recommended set — engaged or not. Output DTOs (needs-review branch and
   resolved branch) carry `suggestionId` but **no `candidateKey`**; only the
   `preservedConfirmed` branch sets one. `[VERIFIED via enrich-recommended-service.js:238-295 (preserve), 286 (key set), 870-916 and 917-963 (branches without key)]`
7. **Roster write/restore/terminal ledger.** `recordSurfaced` canonicalizes the
   key server-side (`withReviewerCandidateKey` → `suggestion:<id>` when the
   anchor exists) and stamps it into the blob; `candidateFromRow` back-fills
   `candidateKey` from `candidate_key` on read, so **stored rows always expose
   a key**. `savedKeys` counts only rows whose stored key equals canonical
   `suggestion:<id>` — a legacy `candidate:` saved twin is invisible to the
   terminal calculation by design. `[VERIFIED via reviewer-roster-store.js:86-101,42-57,662-665]`
8. **Confirmation/promotion binding.** The roster route resolves applicant rows
   via the suggestion **anchor** (widened by S387), then fails closed unless
   `stored.candidateKey === candidate.candidateKey` — comparing against the
   raw client blob. The client sets fresh SSE results into state with no key
   stamping and sends the raw candidate in the PATCH. For a fresh-enrichment
   candidate, `candidate.candidateKey` is `undefined`, the equality fails, and
   `confirm_identity`/`exclude` return 409 ("reload before…"). Roster-restored
   candidates DO carry keys (hop 7), so **the failure bites precisely in the
   post-enrichment window — the moment staff naturally act on the card.**
   Promotion keeps the stricter canonical-key-only lookup and fails 422 without
   the canonical row (correct fail-closed posture).
   `[VERIFIED via reviewer-roster.js:93-98,294-299,328-345; ReviewerSearchSection.js:1296-1299,1721-1751; reviewer-candidate-key.js:16-43; promote-applicant-reviewer-service.js:330-360]`
9. **Reload / concurrency / stale generation.** Cache validity requires every
   currently expected recommendation to have its exact canonical
   active/ineligible row at the current cache version with a terminal gate
   result, or be staff-terminal (`excluded`/`saved` canonical keys). Note
   `identityStatus==='unresolved'` **counts as a satisfied gate result**, so an
   engaged reviewer's canonical row can satisfy the cache — the auto-run effect
   (`blobUrl && proposalKey && recommended.length>0 && rosterLoaded && !haveValidCache`)
   then does *not* fire, and the stale engaged card simply restores from the
   roster. Whether `1002912` currently re-enriches on every open depends on
   `applicantEnrichmentCacheVersion`/`applicantKnownReviewer` per row, which the
   probe does not print — `[UNKNOWN]`. Either way the **display** defect holds:
   valid cache restores the engaged rows, invalid cache re-mints them.
   Enrichment races are guarded by per-suggestion `updated_at` snapshots
   (changed rows are skipped and reported).
   `[VERIFIED via reviewer-search-logic.js:457-506,499-505; ReviewerSearchSection.js:1320-1340; enrich-recommended-service.js:250-308]`
10. **Rendering and remedies.** `displayRosterActive` restores any active
    applicant-origin row whose `enrichedProposalKey` matches the current
    proposal — there is **no restriction to the current expected suggestion
    set**, so an orphaned pre-merge row (missing/404 suggestion) renders; and
    because dedupe is keyed by candidate key (not name), the same person can
    render twice under two suggestion ids. Fresh `recCandidates` are filtered
    only against the roster-derived terminal set. `[VERIFIED via ReviewerSearchSection.js:1347-1371, 118-131]`
11. **Tests/diagnostics/docs.** The four core suites
    (`workbench-enrich-recommended-service`, `reviewer-search-logic`,
    `reviewer-roster-endpoint`, `workbench-promote-applicant-reviewer-service`)
    contain **zero occurrences** of `invited`, `declined`, or `engagement`
    `[VERIFIED via grep -c across those four files: 0,0,0,0]` — engagement
    monotonicity is completely untested. A read-only diagnostic already exists:
    `scripts/probe-roster-dump.mjs --request <n> --include-dataverse` dumps
    roster blobs plus matching Dataverse person/suggestion rows and even
    special-cases Request `1002912`'s GUID shape in a comment.
    `[VERIFIED via scripts/probe-roster-dump.mjs:1-25]`

---

## 3. Claim matrix

Statuses: CONFIRMED / REFUTED / PARTIAL / UNKNOWN. "Disconfirming check" is
the check I ran (or the one that remains) that would have falsified the claim.

| # | Inherited claim | Status | Evidence | Disconfirming check |
|---|---|---|---|---|
| 1 | Applicant enrichment can process already-handled recommendations | **CONFIRMED** | Filter is disposition-only `[VERIFIED via reviewer-suggestion.js:1093-1098]`; full-set consumption minus staff-confirmed rows `[VERIFIED via enrich-recommended-service.js:238-295]` | Searched the service for any read of `wmkf_selected/invited/accepted/declined` — none exists; only staff confirmation short-circuits. Strengthened: the engagement fields are already fetched (`FIELD_SELECT`) and discarded. |
| 2 | Ingestion computes but drops `selected` | **CONFIRMED, but the framing is wrong** | `ensureApplicantRecommended` returns `selected` on all 5 branches `[VERIFIED via reviewer-suggestion.js:542,574,591,610,624]`; DTO omits it `[VERIFIED via applicant-reviewers-service.js:115-122,174-201]` | Projected `selected` alone would NOT have fixed Sorek: she was `selected=false, declined=true` — indistinguishable from unpromoted by `selected`. The correct projection is the engagement tuple (invited/accepted/declined/response/review/completed), all already in the fetched row. |
| 3 | Lima correction dead-ends on key mismatch (409) | **CONFIRMED as mechanism; PLAUSIBLE as the specific July 31 causation** | Full chain: DTO branches omit `candidateKey` `[VERIFIED via enrich-recommended-service.js:870-963]` → client stores/sends raw candidate `[VERIFIED via ReviewerSearchSection.js:1296-1299,1726-1743]` → route requires `stored.candidateKey === candidate.candidateKey`, stored key always present `[VERIFIED via reviewer-roster.js:96, reviewer-roster-store.js:44-46]` → `undefined ≠ 'suggestion:<id>'` → 409. Also applies to `exclude`. | The counter-case exists and localizes the bug: roster-GET-restored candidates DO carry keys, so a reload-then-confirm would succeed. That the two historical PATCHes were fresh-enrichment confirms cannot be re-derived from source — hence PLAUSIBLE on causation, CONFIRMED on mechanism. |
| 4 | Proposal/cache identity unstable across reload | **PARTIAL** | Canonical-only default + component-state override + random blob suffix all confirmed `[VERIFIED via load-proposal-service.js:129-152, ReviewerFindPanel.js:129-153]` | Same-key reload with a *valid* cache does NOT rerun Claude (`haveValidCache → recPhase 'done'` `[VERIFIED via ReviewerSearchSection.js:1330-1340]`) — the claim overstates instability for the happy path. The real instabilities: (a) override lost on reload when no canonical file exists; (b) claim-1's gap makes the cache invalid forever on affected requests → re-run on every open. |
| 5 | Isberg's Dataverse invitation intact | **CONFIRMED, still true today** | Suggestion `fdd093f6-fc68-f111-a826-000d3a3064b7`: `selected=true, invited=true`, sources `pubmed,proposal_named,applicant` `[VERIFIED via probe 2026-08-01]`. Unchanged from the July 31 baseline. **And he still has an `active/applicant_suggested` roster row** rendering as an unresolved prospect. | The disconfirming case would be an engaged reviewer with no active applicant row — Isberg is the opposite: engaged *and* actionable, live, today. |
| 6 | Sorek's engagement intact + stale pre-merge orphan | **CONFIRMED (engagement + orphan); `declined` flag UNKNOWN** | Suggestion `522d186b-a68b-f111-ab0f-70a8a59cded0`: `selected=false, invited=true` `[VERIFIED via probe 2026-08-01]` — engaged either way. The probe prints `selected/invited` only, so `declined=true` is not re-verified. **Sorek has THREE roster rows: two `active/applicant_suggested` + one `saved/proposal_named`** — the orphan render path from §2 hop 10, live. The two actives differ in shape (one has all-null persist fields), consistent with one pre-merge and one current. | Predicted from source (hop 10) *before* the probe ran and then observed — the duplicate-render path is real, not hypothetical. |
| 7 | Duplicate twins + canonical actives caused resurfacing | **CONFIRMED in mechanism and in live data** | `savedKeys` counts canonical-key rows only `[VERIFIED via reviewer-roster-store.js:662-665]`. Live: Isberg and Sorek each hold a `saved/proposal_named` roster row (a *search-origin* save, differently keyed) alongside their `active/applicant_suggested` row `[VERIFIED via probe 2026-08-01]` — so a save that did happen cannot terminalize the applicant twin. | The disconfirming shape (a non-canonical saved row that WOULD count as terminal) is impossible by code: the canonical-equality test is structural, not data-dependent. |
| 10 (added) | Lima's correction never committed | **CONFIRMED live** | Lima's roster row today: `staffConfirmed:false, receiptPresent:false`, `email=—`, identity `unresolved` `[VERIFIED via probe 2026-08-01]`; Dataverse `bdd093f6-…` is `selected=false, invited=false` — genuinely unhandled, correctly actionable. | Had the confirmation committed, the row would carry `staffIdentityConfirmation` + manual contact; it carries neither, 5 weeks later. |
| 8 | Incident is a projection/orchestration **regression** | **REFUTED as "regression"; CONFIRMED as projection gap** | No engagement filter was ever present on this path; wiki records disposition-only reads as standing S263/S264 behavior `[VERIFIED via wiki topic + absence in traced source]` | Ran the disconfirming check: `git log -S wmkf_invited` and `-S wmkf_declined` over `pages/api/workbench/enrich-recommended.js` + `lib/services/workbench/enrich-recommended-service.js` return **zero commits** `[VERIFIED via git history, 2026-08-01]` — the filter never existed, so nothing regressed. |
| 9 | "Dataverse lifecycle always wins" is the right invariant | **PARTIAL — overbroad as stated** | See §4 critique | The Restore feature (`ENGAGEMENT_STAMP_RESET`) is a deliberate, explicit re-entry transition — an absolutist "lifecycle always wins" would wrongly forbid it. The defensible invariant is narrower (§5, I-1/I-2). |

### 3.1 Live state of Request `1002912` (probe, 2026-08-01) — with denominators

Request `1002912` = `078498df-ce44-f111-88b4-000d3a306da2`; **19 roster rows**.

> **Denominator caveat — this probe cannot see a Finding-C duplicate.** It reads
> `reviewer_find_roster` for the request, then searches Dataverse **using those
> roster rows' `display_name` values only**
> `[VERIFIED via probe-roster-dump.mjs:77,113-117]`. A person created by the
> manual/referral add is written to Dataverse but **never to the roster**
> (`addManualReviewer` performs no roster write), and would carry a different or
> malformed name. Such a row is therefore **structurally invisible** to the
> output below. Everything in this section describes the Find-tab projection;
> none of it is evidence about duplicate person records. The exposure query in
> §8 is the one that would see them.

Applicant-recommended people: **5** (Lima, Finley, Laub, Isberg, Sorek), carried
by **6** `active/applicant_suggested` roster rows — the extra row is Sorek's
orphan duplicate.

| Person | Dataverse engagement | Roster rows | Correct to show as actionable? |
|---|---|---|---|
| Christopher Lima | `selected=false, invited=false` | 1 active | **Yes** — genuinely unhandled |
| Daniel Finley | `selected=false, invited=false` | 1 active | **Yes** |
| Michael Laub | `selected=false, invited=false` | 1 active | **Yes** |
| Ralph Isberg | `selected=true, invited=true` | 1 active + 1 `saved` twin | **No** — engaged, still rendering |
| Rotem Sorek | `selected=false, invited=true` | **2 active** + 1 `saved` twin | **No** — engaged, rendering twice |

**So the defect's live blast radius on this request is 2 of 5 applicant
recommendations wrongly actionable, plus 1 duplicate card — and 3 of 5 are
correct.** That 3/5 control group matters: it shows the projection is not
globally broken, which is exactly why a narrow engagement-input fix (§6) is the
right size of change and why a wholesale redesign is not.

Two observations the inherited diagnosis did not record:

- **The engaged pattern is not applicant-specific.** Cynthia Wolberger
  (`literature_retrieved`) is `selected=false, invited=true` with a `saved`
  roster row `[VERIFIED via probe 2026-08-01]`; **owner ground truth: she was
  invited and declined, and her decline referral named Lima.** She does not
  resurface only because her roster row is terminal — i.e. the search-origin
  path is protected by roster state alone, and would be exposed to the same
  class of bug if that row were keyed differently. The invariant in §5 (I-1)
  should therefore be written over *all* candidates, not just applicant-origin
  ones.
- **`selected=false, invited=true` is the decline signature.** Decline archival
  writes `selected=false` alongside the declined response state
  `[VERIFIED via docs/agent-wiki/topics/reviewer-workbench-lifecycle.md §Decline archival]`,
  and Wolberger — independently known to have declined — shows exactly that
  shape. **Sorek shows the same shape**, which corroborates the July 31
  `declined=true` reading even though this probe does not print the flag
  (claim 6). Two of this request's reviewers reaching a terminal decline is
  also what made `1002912` the request where the latent gap finally surfaced.
- **Duplicate person rows exist upstream.** Schulman and Sorek each return 2
  active name-matching `wmkf_potentialreviewers` rows, one of them empty
  (no email, no suggestion) `[VERIFIED via probe 2026-08-01]`. Out of scope for
  this slice and NOT a blocker, but it is latent fuel for future
  identity-binding confusion and belongs on the hygiene list, not in the
  stabilization slice.

### 3.2 Finding D measured (probe, 2026-08-01)

`scripts/probe-exclusion-enforcement-exposure.mjs`, owner-run, read-only,
whole-history (no `--since`):

| Bucket | Count |
|---|---|
| Requests with a non-null `wmkf_excludedreviewers` | **294** |
| …blank / "N/A" style — no exposure | 123 |
| …**substantive** (a real exclusion attempt) | **171** |
| — enforceable, names extracted | 158 |
| — **FAIL-OPEN, substantive but zero names** | **13** |
| — parser output unusable | 0 |
| — errored / unclassified | 0 |

**13 of 171 substantive exclusions (7.6%) block nobody.** Every one of the 13
shows `selected=0, invited=0` — no reviewer was ever chosen on any affected
request. Oldest 2024-10-30, newest 2026-04-30.

**Verdict: CONFIRMED as a real defect, but LOW severity and no observed harm.**
It is not a campaign blocker and should not jump the queue ahead of the §6
slice. I flagged it as "the thing I would measure first"; that was right, and
the result is that it moves *down* the list rather than up.

#### 3.2.1 The 13 read (second probe run, `--show-text`, 2026-08-01) — Finding D is REFUTED

The follow-up run capped correctly at the 200 most recent (reporting the 94 it
skipped), so it re-derived **10 of the 13**; within that window the ratio was
10 of 115 substantive (8.7%). Reading them decides the open question, and the
answer is the one that removes the finding rather than confirming it:

| What the 10 actually say | Count |
|---|---|
| **Prose ways of saying "none"** — "No exclusions", "No reviewers excluded.", "There are no reviewers to exclude." (×2), "There are no reviewers we would like to exclude.", "No reviewers are requested for exclusion.", "There are no potential reviewers the principal investigator wishes to exclude.", "The project team is not aware of any potential reviewers who would be biased against this application." | **8** |
| **Junk / apparent field-label leak** — "rev excluded names" | 1 |
| ~~A genuine unactionable exclusion~~ — "everybody who's not listed above." → **a TEST RECORD, see §3.2.2** | **0 real** |
| **Real names the parser missed** | **0** |

**Both hypotheses I offered are wrong.** The parser-defect hypothesis is dead:
zero missed names, and `extractExcludedReviewers` correctly returned nothing in
all 10 cases because there was nothing to return. And the Finding-D story —
applicants stating category exclusions they believe are honored — occurs in
**1 of 115 substantive answers (0.9%)** in this window, not at the 8.7% headline
rate. The 8.7% is almost entirely applicants politely writing "none" in a
sentence.

For those 8, a no-op is the **correct** behavior. There is no divergence between
what the applicant believed and what the system did, because the applicant
excluded nobody. My framing — "the applicant believes they excluded someone and
the system blocked no one" — does not describe them.

**Finding D is therefore REFUTED as a safety concern.** I escalated it on a
plausible reading of the code, then measured it down to "small", then read it
down to "essentially absent". The code-level observation that made me raise it
remains true — enforcement is name-matching only, so a category exclusion
cannot be honored — but it is a hazard almost nobody triggers, and it is not
fail-open in practice.

The one real instance is instructive rather than alarming: "everybody who's not
listed above" is an *inverted* request — an allowlist ("use only my
recommendations"), which no blocklist of names can express at any level of
input structure. That one needs a PD conversation, not a schema.

Residue, both trivial and neither safety-relevant:

- `isSubstantiveExclusionText` classifies prose negatives as substantive, so
  ~8 per 200 requests spend a Haiku call to return nothing. **No staff-facing
  consequence:** the resulting `excludedSubstantive` flag is returned by the
  service but consumed nowhere in the UI `[VERIFIED via grep across
  shared/components/reviewers/ and the route — no references]`. Extending the
  parser's `NOISE_VALUES` with a negation pattern would save the calls; the
  saving is pennies and the change is optional.
- One value reads like a form label or placeholder leaked into the field
  ("rev excluded names") — cosmetic, worth a glance at whatever produced it.

**Denominator honesty:** 10 of 13 read; the 3 oldest (requests `1001500`,
`1000972`, `1000916`, all 2024-10 to 2025-04) fell outside the 200-request
window and remain unread. Re-run with `--limit 300` to close that, though the
pattern across 10 makes a different answer in the remaining 3 unlikely, and all
three predate the current reviewer workflow.

**Base rate, now measured:** 5 of 20 sampled enforceable-exclusion requests have
selected reviewers (25%). So the zero-impact column is informative rather than
vacuous — at that rate roughly 2–3 of the 10 would be expected to have reviewers
had the exclusions mattered. Combined with the content finding, harm is ruled
out rather than merely unobserved.

#### 3.2.2 The last real instance was test data — incidence is zero

Owner asked for the identity of the one genuine case. Request **`1001931`**
(`f178c617-df7e-f011-b4cc-0022480aba6d`) is an **AkoyaGO test record**, not a
real application `[VERIFIED via read-only lookup 2026-08-01]`:

- `akoya_title` = "Test phase I project title"; `statuscode` = Inactive.
- `_akoya_applicantid_value` = **"W. M. Keck Foundation"** — the Foundation as
  its own applicant, which is precisely the established test-row predicate
  documented in `scripts/probe-akoya-test-record-predicate.js:6-15`.
- All five recommendation slots hold obviously synthetic people (surnames
  repeated across slots, `@dog.com` / `@fish.com` addresses, joke
  organizations).
- Zero `wmkf_appreviewersuggestion` rows on the request.

**So the category-exclusion scenario has ZERO observed real instances.** Not
"rare" — absent from the examined window. Finding D's motivating story is
supported by no production data at all: of the substantive exclusion answers,
every non-name case is either prose for "none" (correct no-op) or synthetic.

**A defect in my own probe, now fixed.** It did not exclude test records, so the
counts in §3.2 (294 / 171 / 115 / 13 / 10) are **upper bounds inflated by
synthetic rows** — this one certainly, others plausibly. The script now resolves
the "W. M. Keck Foundation" applicant account and filters those rows by default,
reporting how many it dropped, with `--include-test` to restore the old
behavior. Re-run for clean denominators. **The direction of the error is
favorable to the conclusion** — removing test rows can only shrink the fail-open
count — so the withdrawal of Finding D stands and strengthens.

**Owner's note, recorded:** these apps did not exist in 2025, so `selected=0` on
the older fail-open requests reflects the reviewer workflow not existing yet,
not that an exclusion was harmless. That confirms caveat (1) below: the
zero-impact column is uninformative for pre-2026 rows regardless of base rate,
and only the content reading (§3.2.1) actually settles the question.

**One consequence for §6a:** my recommended wording constraint "give the rare
non-name concern a destination" was justified solely by this instance. With it
reclassified as test data, that constraint is **judgment, not evidence** — still
harmless and probably kind, but no longer backed by an observed case.

#### 3.2.3 Original caveats from the first run

Three honest limits on the first run's reassurance, retained for the record —
(1) and (3) are now resolved by §3.2.1:

1. **The zero-impact reading is weak without a base rate.** All 13 affected
   requests having no reviewers may simply mean those requests never reached
   reviewer selection — many predate the reviewer workflow — rather than that
   the unenforced exclusion was harmless. The probe did not compute the
   comparison denominator on this run. **I have since added a base-rate sample
   to the script**, which reports how many *enforceable*-exclusion requests do
   have selected reviewers and states plainly when the zero-impact reading is
   uninformative. Re-run to get it.
2. **`--limit 200` did not bind on this run.** `queryAllRecords` paginates to
   completion — its `top` is a page size, not a cap — so all 294 rows were
   scanned rather than 200. Harmless here (broader coverage, 171 LLM calls), and
   **now fixed** so the flag caps as documented and reports what it skipped. The
   numbers above are therefore whole-history, not a recent-window sample.
3. **The 13 have not been read.** The script cannot distinguish "the applicant
   wrote a category" (the Finding-D story: input problem, form-level fix) from
   "the applicant wrote real names and the parser missed them" (a *parser* bug:
   worse, enforceable in principle, and a different fix entirely). Several are
   very short — two are 13 characters, several are 2–4 words — which reads more
   like a terse category or a stray value than a missed name list, but that is
   an impression, not evidence. **Reading 13 short strings settles it**:
   re-run with `--show-text`. Until then the *cause* of the 7.6% is
   `[UNKNOWN]`, even though its size is now known.

One clean result worth stating positively: **0 parse failures and 0 errors
across 171 LLM extractions.** `extractExcludedReviewers` is reliable on real
production text; whatever the 13 turn out to be, LLM flakiness is not it.

---

## 4. Critique of the stabilization directive

**What the directive gets right.** Stabilization-over-features; no blind
rollback; repair only after recurrence closes; the five contract areas; the
no-dead-end UI principle; dry-run-default repair with denominators. Contract 4
(automation can't reverse staff/lifecycle decisions) is already largely
enforced in the roster store and should be asserted by tests, not rebuilt.

**Named changes.**

1. **Drop the "regression" framing and the rollback anxiety with it.** Nothing
   was lost; a projection was never completed (claim 8). This removes a whole
   class of investigation ("what changed?") from the critical path.
2. **Contract 1 ("Dataverse lifecycle always wins") is overbroad.** As written
   it collides with the deliberate Restore/Reset transition and with the fact
   that Postgres legitimately owns facts Dataverse does not (staff identity
   confirmations, exclusion set-asides, eligibility evidence). The defensible
   version is the pair of invariants in §5 (engagement is terminal *for Find
   actionability*; re-entry only through explicit transitions). Contract 2 then
   follows without demoting Postgres to "disposable": it is authoritative for
   its own facts, and merely *insufficient* for actionability.
3. **Phase 0's diagnostic harness is mostly already built.** `probe-roster-dump.mjs
   --include-dataverse` covers Dataverse anchors/engagement, roster keys/status,
   and person rows today. Extend it (report duplicate/noncanonical/missing-
   suggestion rows and cache-validity verdicts explicitly) rather than building
   a new harness; budget an hour, not a phase.
4. **Phase 2-A is smaller than specified.** The engagement filter needs *no new
   query* — the data is already fetched and discarded (claim 1). The DTO
   projection should carry the engagement tuple, not `selected` (claim 2). The
   "restrict restored rows to the expected suggestion set" item is a one-
   predicate client change (§2 hop 10).
5. **Phase 2-B is one line plus tests, not a contract rework.** Emit
   `candidateKey: reviewerSuggestionCandidateKey(suggestionId)` in the two DTO
   branches (mirroring `preservedConfirmed`), plus a defensive
   `withReviewerCandidateKey` map at `setRecCandidates`. The fail-closed
   binding itself is correct and should not be loosened. The typed
   stale-row/Reload-remedy response is worth doing but is UX polish, not the
   defect.
6. **Phase 2-C (Project Narrative fallback) should be deferred pending demand
   evidence.** It expands the trusted-filename surface the codebase just spent
   sessions narrowing ("Do not restore classifyFile, best-guess PDF selection,
   or filename heuristics" — the directive's own words). Before building it,
   measure: how many active-cycle requests lack a canonical file and have a
   `Project Narrative.pdf`? If the answer is "a handful", the reload-stable
   override (a validated URL file-key param) alone removes the staff pain
   without a new heuristic. The override piece IS worth keeping in the slice.
7. **Add the missing golden workflow.** None of the five covers the
   promote-a-declined-reviewer write hazard (§1). That is the only known path
   by which this incident *corrupts* Dataverse state rather than just
   displaying wrongly; it must be a baseline-failing test.
8. **Phase 3 (data repair) is correctly sequenced but overstates its
   preconditions.** The repair script inventory (twins/orphans audit,
   dry-run, backups) matches the pattern already proven by
   `recanonicalize-reviewer-roster-anchors.mjs` and
   `dedupe-reviewer-roster-suggestion-twins.mjs`. One caution the plan already
   half-states and should make explicit: **the runtime fix makes most of the
   cleanup optional.** Once engagement is an independent terminal input, legacy
   twins stop mattering for display; repair then serves hygiene and cache
   efficiency, not correctness — which lowers its urgency and its blast
   radius.

**Answers to the four judgment questions in the brief:**

- **Problem boundary:** one stabilization slice, not an architecture redesign.
  The stores and keys are fine; one projection is incomplete and one DTO field
  is missing.
- **Authority simplification:** Dataverse owns engagement; Postgres owns staff
  working-state (confirmations, exclusions, evidence, dedup ledger). The one
  duplicated representation that should stop driving behavior is *roster
  terminal keys as the sole "handled" signal* — engagement joins it as an
  independent input. No store loses ownership; no schema changes.
- **Campaign-critical workflow set:** W2 (engagement monotonic), W3
  (confirmation persists — the candidateKey fix), W6 (no write path can
  re-select a declined/engaged reviewer without explicit reset). W1/W5 matter
  but are efficiency/UX; W4 (promotion exactly-once) is already substantially
  enforced server-side.
- **Smallest safe next slice:** §6.

---

## 5. Revised invariant and golden-workflow set

Invariants (replacing Contract 1's absolutism):

- **I-1 (actionability is monotonic against engagement).** Written over *all*
  candidates, not only applicant-origin ones (§3.1, Wolberger). A suggestion with
  `selected=true` or any of invited/accepted/declined/response/review/completed
  signals never renders as an actionable *new* Find prospect and is never
  re-enriched as one, regardless of roster state. It may (and should) render
  as a legible "already handled — <stage>" line with navigation.
- **I-2 (re-entry only through explicit transitions).** The only paths that
  return an engaged person to actionable state are the deliberate Restore /
  Reset-and-restore actions, where staff explicitly choose to clear engagement
  via `ENGAGEMENT_STAMP_RESET`. **No other path may write `selected=true` onto
  a row carrying live engagement or decline state** — neither by leaving the
  engagement stamps in place (door B, `promoteApplicantReviewer`) nor by
  silently resetting them (door A, `ensureStaffManualCandidate` via
  referral/manual add). Enforce at a chokepoint that sees every `selected`
  writer, since the two doors fail in opposite directions.
- **I-2a (provenance merge is not promotion).** Re-adding an existing
  applicant-recommended person as a manual or referred candidate may union
  `sources` and record the referral, but must not by itself set
  `selected=true`; promotion of an applicant-recommended row goes through the
  applicant promotion contract and its gates. Preserving dual origin is a
  legitimate goal and should be kept — as a provenance write only.
- **I-3 (staff decisions are terminal against automation).** Already largely
  enforced (concurrency snapshots, confirmed-row preservation, authority
  stripping); assert with race tests rather than rebuilding.
- **I-4 (identity keys are server-derived and always emitted).** Every
  applicant candidate DTO the server hands the browser carries the canonical
  `candidateKey`; the fail-closed stored-key binding stays as is.

Golden workflows (revised; each must fail against baseline before the fix):

1. **W1 — Reload without model work:** unchanged from the directive, with the
   baseline-failing variant pinned to the real defect: an *engaged*
   recommendation with a legacy saved twin must not invalidate the cache
   forever. (Un-engaged happy path already passes today — claim 4.)
2. **W2 — Engagement is monotonic:** enrichment server-side filters handled
   rows; client terminal set includes server-projected engagement. Test at the
   service level with rows carrying each engagement signal, incl.
   `selected=false, declined=true` (Sorek) and `selected=true, invited=true`
   (Isberg).
3. **W3 — Confirmation persists:** confirm-and-exclude succeed on a
   fresh-enrichment candidate (no reload), survive reload, and survive an
   overlapping enrichment run. Baseline-failing today by claim 3.
4. **W4 — Promotion exactly-once:** keep, as service-level tests over the
   existing guards (mostly passing today — document which assertions are
   already green so a false sense of "fixed by this slice" doesn't form).
5. **W5 — Proposal selection deterministic and reload-stable:** canonical
   auto-select; duplicate canonical still errors; deliberate override survives
   reload via validated navigation state and is revalidated server-side.
   (Legacy-filename fallback deferred — see §4.6.)
6. **W6 (new) — No ungated `selected=true` on an engaged row, through any
   door:** (a) promoting a declined/engaged suggestion via
   `promoteApplicantReviewer` is refused; (b) re-adding an applicant-recommended
   person through `manual-reviewer` (referral one-click or Add-or-Refer) records
   provenance **without** setting `selected=true` and **without** applying
   `ENGAGEMENT_STAMP_RESET`; (c) the explicit Restore path still works
   unchanged. Both (a) and (b) are baseline-failing today (§1 Findings A/B).
   Test (b) with the exact live shape: a person holding a
   `disposition=recommended, selected=false` row who is then referred by a
   decliner — the Wolberger→Lima scenario.
7. **W7 (new) — A referral is a suggestion, not a name.** Free-text referral
   input containing more than one person, or trailing prose, must not become a
   reviewer's name and must not silently create a person. Assert: (a) multi-name
   / prose referral text does not reach `manual-reviewer` as `name`; (b) a
   lookup returning `outcome:'none'` for input that fails a name-plausibility
   check requires explicit staff confirmation instead of auto
   `create_new`; (c) a clean diminutive ("Chris" for "Christopher") still
   resolves to the staff picker, not a new person. Baseline-failing today
   (§1 Finding C).

Complement coverage the directive asked about: all-failed enrichment batches
(hydration-failure path exists and is tested by shape — keep one assertion),
stale post-await writes (snapshot skip counters already exist — assert them),
missing anchors (orphan restore restriction), duplicate rows (twin shape from
claim 7).

---

## 6. Recommended first implementation slice

One session, branch + deliberate promotion per the campaign release strategy.

**Prerequisites: both are already satisfied.** The live probe ran 2026-08-01
(§3.1) and *agrees with* the July 31 baseline — Isberg still
`selected=true, invited=true`, Sorek still `invited=true`, both still carrying
active applicant roster rows, so the directive's "stop if live state
contradicts the baseline" rule is not triggered. Claim 8's git archaeology is
also done (zero commits ever touched engagement fields on the enrichment path).
**Implementation can begin without further investigation.** Re-probe once more
immediately before any Phase-3 Production write, per the standing rule.

**The slice (ordered; tests written first where marked ⊟):**

1. ⊟ Baseline-failing tests for W2, W3, W6 (service-level; no UI harness
   needed for the baseline).
2. **Server, engagement projection (no new queries):** in `enrichRecommended`,
   partition `recommendedRows` by an `isHandled(row)` predicate (selected ∨
   invited ∨ accepted ∨ declined ∨ responseReceivedAt ∨ reviewReceivedAt ∨
   completedAt); do not enrich handled rows; emit them in the completion
   payload as compact `{suggestionId, candidateKey, name, stage}` entries. In
   `ingestApplicantReviewers`, project the same engagement tuple per
   recommendation into the response DTO (not just `selected`).
3. **Server, key emission (one line × 2):** add
   `candidateKey: reviewerSuggestionCandidateKey(c.suggestionId)` to both
   enrichment DTO branches.
4. **Client, terminal + legibility:** fold server-projected handled entries
   into the terminal/visibility logic (they are never actionable prospects);
   render them as an "Already handled" summary with stage + navigation to
   Invite/Track or Removed; map `withReviewerCandidateKey` over
   `setRecCandidates` as defense in depth; restrict `displayRosterActive`
   applicant-origin restore to the current expected suggestion set (one
   predicate).
5. **Client, reload-stable override:** persist a deliberate fileKey override in
   validated navigation state (URL param), revalidated server-side by the
   existing `fileKey` path.
5. **Server, close both promotion doors (I-2/I-2a).** Refuse `selected=true` on
   a row carrying live engagement unless an explicit reset accompanies it.
   Placement matters: the two doors fail oppositely, so guard where both are
   visible — `updateLifecycle` sees door B but `ensureStaffManualCandidate`
   calls `updateRecord` directly `[VERIFIED via reviewer-suggestion.js:696-709]`,
   so an adapter-level `updateLifecycle` guard alone would miss door A. Either
   route door A through the guarded path, or extract a shared
   `assertSelectableTransition(existing, payload)` used by both. For door A
   specifically, the minimal behavior change is: drop `wmkf_selected: true` and
   the reset from the payload when `existing.wmkf_applicantdisposition ===
   recommended`, keeping the `sources`/label union so referral provenance still
   lands. Restore must keep working — its reset is staff-chosen.
6. Gates for touched surfaces + full suite; one adversarial review of the
   finished implementation (not another plan loop).

**Explicit non-goals for the slice:** no schema/migration; no Postgres
ownership changes; no `Project Narrative.pdf` fallback; no repair execution;
no changes to the fail-closed key binding, promotion lookup strictness, or
address-trust machinery; no `save-candidates` changes; no rework of the
referral capture/surface itself (only its `selected` side effect).

**Estimated shape:** server changes touch four files
(`enrich-recommended-service`, `applicant-reviewers-service`,
`reviewer-suggestion` adapter, and whichever chokepoint step 5 lands on); client
changes touch two components plus one logic module. **The riskiest item is step
5's guard placement**, and it is riskier than I judged before finding door A:
the two writers of `selected` disagree about resets, `ensureStaffManualCandidate`
bypasses `updateLifecycle` entirely, and the legitimate Restore path writes
`selected=true` on declined rows *by design*. Get that predicate wrong and you
either break Restore or leave a door open. Budget the review time there, and
write W6(c) — Restore still works — as a guard against over-correcting.

---

## 6a. Referral input design (owner question, 2026-08-01)

Owner proposal: replace the free-text referral with structured rows — name +
optional institution + email, up to 4 — and/or write a better parser.

**Recommendation: structured input is the fix; a parser is at most a
compatibility aid. Do not build the parser as the primary remedy.** Three
reasons, in order of weight:

1. **Structured fields don't just clean the input — they repair the dedupe.**
   This is the argument that matters and it is not a UX argument. Today the
   referral carries a name and nothing else, which forces
   `lookupReviewerIdentity` down its *weakest* branch: the name fallback, which
   by construction never returns a confident match — it returns candidates for
   a staff picker, or nothing `[VERIFIED via reviewer-identity-lookup.js:411-422]`.
   An **email** promotes the lookup to `findByEmailCandidates`, which can return
   a confident match and reuse the existing person
   `[VERIFIED via reviewer-identity-lookup.js:402-409]`. So capturing an email
   converts the duplicate problem from "detect and clean up afterwards" into
   "does not occur". Institution similarly feeds the resolver's affiliation
   anchor and the COI checks. A parser can only ever recover a *name* from
   prose; it cannot invent the anchors that make matching reliable.
2. **The same intake form already proves the approach — on its other reviewer
   field.** The applicant's *recommended* reviewers are not free text: they are
   `wmkf_potentialreviewer1..5` lookup slots holding **exact person GUIDs**,
   which ingestion consumes directly with no name matching at all
   `[VERIFIED via applicant-reviewers-service.js:43-55,100-105]`. That is
   precisely why the applicant-recommendation path has never had this class of
   bug — there is nothing to parse and no namesake to guess. The *excluded*
   reviewers field on the same form is free text and needs an LLM extractor
   `[VERIFIED via reviewer-exclusion-parser.js:123-171]`. **One form, two
   reviewer fields, structured and unstructured, and the bug lives entirely on
   the unstructured one.** That is the strongest available evidence for the
   proposal, and it is internal rather than theoretical.
3. **Fixing the input is cheaper than parsing the output — and this holds for
   both surfaces.** *(Corrected 2026-08-01 on owner input: I previously wrote
   that parsing was "the only option" for the intake field because we do not own
   that form. That was an organizational constraint stated as a technical one,
   and it was wrong — Connor can amend the intake format.)* The difference
   between the two surfaces is coordination cost, not possibility: the decline
   form is a plain `<textarea>` in our own
   `shared/components/external/DeclineFormView.js`
   `[VERIFIED via DeclineFormView.js:102-118]` and changes in one repo, while
   the intake field changes through Connor. Adding an LLM parse to an input that
   can be constrained at its source buys a new failure mode, new latency, and a
   new prompt surface to govern, in exchange for less information than the form
   could collect directly.
4. **The current placeholder actively teaches the failing shape.** It reads
   "e.g., Dr. Sarah Chen at Stanford works on similar problems and would be a
   great fit." `[VERIFIED via DeclineFormView.js:114]` — an honorific, an
   institution, and two clauses of prose, all of which land verbatim in
   `wmkf_name` if staff click Add. The form is not neutral about the bug; it
   induces it. Four labeled rows make the desired shape self-evident and need no
   instructions.

**Sequencing — keep this OUT of the stabilization slice.** Structured referrals
mean new durable storage, a change to the reviewer-facing external portal, and
a new staff-side consumer: that is a feature with its own build plan, schema
review, and release, and folding it into §6 would blow the slice's boundary and
delay the engagement fix. Instead split it:

- **In the stabilization slice (cheap, stops the bleeding):** W7(b) — refuse to
  auto-`create_new` when the submitted name fails a plausibility check (multiple
  connectors, commas, an `@`, prose markers, or an implausible token count).
  Route those to the existing staff picker/confirm affordance, which is already
  built and already handles the ambiguous case. This is a guard in
  `addManualReviewer`, needs no schema and no portal change, and closes the
  silent-create path for legacy free-text rows *permanently* — including for
  referrals already stored.
- **As a follow-on feature:** the structured input. Notes for that build plan:
  - **Storage:** 4 rows × 3 fields is 12 columns — do not add them. This repo
    already stores bounded structured state as JSON on the parent
    (`wmkf_addresstruststatejson`) and uses child rows for genuinely open-ended
    sets (`wmkf_appreviewanswer`). For a hard cap of 4, a single JSON memo column
    on the suggestion is the proportionate choice; revisit child rows only if the
    cap is ever lifted.
  - **Compatibility:** keep reading legacy `wmkf_declinereferral` and keep
    rendering it, but never let a legacy free-text value take the auto-create
    branch — that is exactly what W7(b) enforces, which is why the guard belongs
    in the slice regardless of when the form changes.
  - **Keep it optional and low-friction.** This field is answered by a reviewer
    who has just declined; every required field costs referrals. Name required
    per row, institution and email optional, all four rows optional.
  - **Don't trust it more because it is structured.** A reviewer-typed email is
    still an untrusted claim: it may resolve to a namesake or be stale. It should
    feed *identity lookup* and dedupe, and must not bypass the address-trust
    machinery or land as a verified address.

**Excluded reviewers wants the same treatment — and the reason is a fail-open
risk, not ergonomics.** *(Corrected 2026-08-01 on owner input. I previously
argued for a hybrid form here, on the premise that structuring into name rows
would "discard a class of exclusion the foundation honors." That premise was
false, and the owner's objection is right: category exclusions are not
actionable, because we cannot know who "direct competitors" are — we need
names.)*

Checking what the system actually does with category text settles it:

- Enforcement is **exact normalized-name set membership** —
  `partitionByExcluded` drops a candidate only when their normalized name is in
  the excluded set `[VERIFIED via lib/utils/reviewer-name-match.js:54-65]`.
- A category phrase yields **zero** parsed names, so `buildExcludedSet` is
  empty and **nothing is filtered at all** `[VERIFIED via reviewer-exclusion-parser.js:167-171
  + reviewer-name-match.js:56-57]`.
- Exclusions write no durable rows either — the S210 decision keeps them a
  search soft-block only `[VERIFIED via applicant-reviewers-service.js:20-27,157-199]`.
- The sole handling is display: the raw text renders as a `<pre>` disclosure
  under an editable exclusion box `[VERIFIED via ReviewerSearchSection.js:2531-2534]`,
  from which staff *may* hand-type names.

So the foundation does not honor a category exclusion; it shows it to a human
and hopes. **That makes the current field fail-open in a way that is worse than
a rejected input: the applicant believes they have excluded someone, and the
system silently never blocks anyone.** The bridge from vague answer to
enforceable name is a manual, undocumented step that no gate requires and any
busy PD can skip. An unenforceable exclusion is not a softer exclusion — it is
the appearance of one.

That reframed the recommendation toward "both fields want structured person
rows". **The measurement then undercut the intake half of it** (§3.2.1):
category exclusions — the failure this would prevent — occur in about 1% of
substantive answers, and the dominant real pattern is applicants writing "none"
in a sentence, which the system already handles correctly by doing nothing.

Revised position:

- **Referrals: structure them.** Unchanged and well-supported — Finding C is a
  verified mechanism with a real duplicate behind it, and the email/institution
  anchors materially improve dedupe (reason 1 above).
- **Excluded reviewers: no schema change; a prompt-copy change is worth it, but
  for a different reason than the one proposed.** *(Owner, 2026-08-01: Connor
  can add a phrase requesting names only, blank otherwise.)* Endorsed — but the
  noise it removes is trivial (~8 per 200 applicants writing a polite "none",
  which the system already handles correctly). **The real value is match
  reliability**, per the constraint below. A full restructure of the field
  remains unjustified: the safety argument for it died with Finding D.

  **Why the copy change earns its keep — exclusion matching is exact and
  order-sensitive.** `normalizeReviewerName` folds diacritics, strips honorifics
  and punctuation, and lowercases — and nothing else
  `[VERIFIED via lib/utils/reviewer-name-match.js:26-36]`; matching is then
  exact set membership `[VERIFIED via reviewer-name-match.js:39-65]`. So each of
  these **silently fails to exclude anyone**:
  - `"Lima, Christopher"` → normalizes to `lima christopher`, which never equals
    the surfaced `christopher lima`. Last-name-first is a common way people
    write name lists, and it does not match.
  - `"Chris Lima"` vs a surfaced `"Christopher Lima"` — no diminutive handling
    (the same variant class as Finding C).
  - `"C. Lima"` → `c lima` — initials do not match either.

  A prompt asking for **first name then last name, one per line, spelled as the
  person publishes** raises the hit rate against all three at the cost of one
  sentence. That is a better argument for the change than tidiness.

  **`[UNMEASURED]` — and deliberately labeled so.** I have not measured how
  often a stored exclusion fails to match a surfaced candidate; the mechanism is
  verified, the incidence is not. Given that Finding D was withdrawn for exactly
  this kind of over-reading, treat it as a plausible reason to prefer good
  wording, **not** as a claimed defect. It is measurable: for each request,
  re-parse the exclusion names and compare them against
  `reviewer_find_roster.display_name` for near-misses (same normalized surname,
  different forename token). Worth doing only if the copy change is deferred.

  **Two constraints on the wording:**
  - **Do not ask for institution.** The parser already extracts an optional
    affiliation, but the API drops it — `excludedNames: excluded.map((e) => e.name)`
    `[VERIFIED via applicant-reviewers-service.js:196]` — and matching is
    name-only. Collecting a field nothing consumes invites the belief that it
    narrows the exclusion when it does not.
  - **Optionally, give a non-name concern somewhere to go** — pointing it at the
    program officer costs half a sentence. **Downgraded from a requirement to a
    judgment call (§3.2.2):** the only instance that motivated it turned out to
    be a test record, so there is no observed case of a real applicant needing
    that route. Include it if the phrasing stays short; drop it rather than
    complicate the field.
- `extractExcludedReviewers` **stays** and is doing its job correctly: 0 parse
  failures and 0 wrong extractions across every answer examined.
- Keep the staff-editable exclusion box regardless — it is how staff add names
  they learn by any route, and it is the standing remedy for the rare inverted
  or category request.

**Sequencing, with a new reason:** referrals first (ours, one repo, live defect
with observed consequences); intake **deprioritized outright** rather than
merely second, because the measurement found no failure there to fix.

**One read still worth doing:** how many stored referrals actually name more
than one person. If the answer is "most", the structured form is clearly worth
it; if it is "two ever", W7(b) alone may be the whole fix. One field read across
declined suggestions. *(The companion excluded-reviewers read was done — §3.2.1
— and is what deprioritized the intake half of this section.)*

---

## 7. Stop doing

- **Stop investigating "what regressed".** Nothing did (claim 8); redirect that
  time to the slice.
- **Stop planning a new Phase-0 diagnostic harness.** Extend
  `probe-roster-dump.mjs`; it already does ~70% of the spec.
- **Stop advancing the `Project Narrative.pdf` fallback** until a one-query
  demand measurement justifies re-widening the filename trust surface.
- **Stop treating Production roster cleanup as a correctness precondition.**
  After the runtime slice, twins/orphans are hygiene; run the repair on the
  existing dry-run/backup pattern at leisure, gated by a fresh probe.
- **Stop opening further review loops on this incident** (this session is the
  directive's Phase -1; the next session should implement). One adversarial
  review of the finished implementation, per the directive's own Phase 4 rule.
- **Do not treat re-enrichment cost as a driver.** I initially expected affected
  requests to re-enrich on every Find open; on closer reading
  `identityStatus='unresolved'` satisfies the cache gate, so that may not happen
  at all (§2 hop 9, now `[UNKNOWN]` for `1002912`). Correctness, not spend, is
  the reason to ship the slice.

---

## 8. Remaining unknowns and the exact probes/tests to resolve them

*Resolved this session by the 2026-08-01 probe: Isberg/Sorek engagement, the
roster census, the twin/orphan shapes, and Lima's uncommitted confirmation (§3.1).*

Still open:

| Unknown | Resolver | Bounded? |
|---|---|---|
| Sorek's `declined` flag (probe prints `selected`/`invited` only) | Add `wmkf_declined`/`wmkf_responsetype` to the probe's suggestion projection, or read suggestion `522d186b-…` directly | Yes — one row |
| Which of Sorek's two active rows is the 404 orphan, and its exact key | Extend the probe to print `candidate_key` + `candidate->>'suggestionId'` per row (it prints neither today) — **the single highest-value probe improvement** | Yes |
| Whether `1002912`'s applicant cache is currently valid (§2 hop 9) | Same extension: print `applicantEnrichmentCacheVersion` + `applicantKnownReviewer.status` | Yes |
| **Whether door A (§1 Finding A) has already fired on any request** — an ungated referral/manual promotion of an applicant-recommended person | Query `wmkf_appreviewersuggestion` for `wmkf_applicantdisposition eq recommended and wmkf_selected eq true`, then split by whether `wmkf_sources` contains `staff_manual`/`referred` vs only search/applicant tokens. Rows with a manual/referred token are candidates for an ungated promotion; rows whose engagement stamps are empty despite prior invitation are candidates for a silent reset. **Worth running before the next campaign** — it is read-only and bounds the exposure repo-wide, not just for `1002912`. | Yes — one filtered query |
| Whether Wolberger's referral text actually names Lima, and whether it names **more than one** person (Finding C's trigger) | Read `wmkf_declinereferral` on her suggestion, or open the Track-tab referral callout | Yes — one field |
| **Whether Findings A and C have already damaged data** | **Written this session:** `scripts/probe-referral-path-exposure.mjs` (read-only; Dataverse GETs only). §1 flags person names that cannot denote one person (Finding C's fingerprint — the shape §3.1's probe structurally cannot see); §2 counts applicant-recommended rows that are `selected=true`, split by whether they carry a `staff_manual`/`referred` token (Finding A); §3 lists invited rows holding no response state (possible silent reset — a lead only, since a pending invitee looks identical). Run: `DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/probe-referral-path-exposure.mjs`. Names are redacted unless `--show-names`. **Not yet run.** | Yes — read-only, prints denominators |
| How many stored referrals name more than one person (decides whether §6a's structured form is worth building) | Read `wmkf_declinereferral` across declined suggestions and count multi-name answers | Yes — one field, one filter |
| ~~Finding D exposure size~~ | **ANSWERED 2026-08-01 — see §3.2.** 13 of 171 substantive exclusions (7.6%) unenforceable; 0 affected requests ever selected a reviewer. | — |
| ~~Whether the fail-open answers are category text or missed names~~ | **ANSWERED 2026-08-01 (§3.2.1): neither, mostly.** 8 of 10 are prose for "none", 1 junk, 1 genuine inverted request, 0 missed names → Finding D withdrawn as a safety concern. | — |
| ~~Whether the zero-impact reading is meaningful~~ | **ANSWERED: base rate 25%** (5 of 20 enforceable-exclusion requests have selected reviewers), so the zero-impact column is informative, not vacuous. | — |
| The 3 oldest fail-open answers (`1001500`, `1000972`, `1000916`) are still unread | Re-run with `--limit 300`. Low value — the pattern across the other 10 is uniform and all three predate the current reviewer workflow | Yes — same probe |
| Demand for the legacy-filename fallback (§4.6) | Count active-cycle requests with no canonical proposal file but a `Project Narrative.pdf` (SharePoint listing over the current cycle's requests; read-only Graph) | Yes — bounded to one cycle |
| Whether the two July 31 Lima 409s were fresh-enrichment confirms (claim 3 causation) | Vercel request logs for the two PATCHes (payload presence of `candidateKey`), if retained | Maybe — log retention dependent |
| How many other requests currently have engaged-but-unterminal applicant recommendations (blast radius of the perpetual re-enrich loop) | One roster/Dataverse join query — natural extension of the probe script | Yes — read-only |

**Denominators for the clean/complete claims made here:** the four test suites
greped for engagement terms are the four suites named in §2.11 (4/4 zero
matches); the whole-flow trace covered 11/11 hops of the brief's required list
(none N/A — all were implicated or explicitly cleared); the claim matrix covers
10/10 rows (8 inherited + 2 added). Live denominators are in §3.1 (19 roster
rows; 5 applicant people / 6 applicant rows; 2 of 5 wrongly actionable).
Everything labeled `[VERIFIED via file:line]` cites source I read this session
on `main`@`ca9e9c5`; everything labeled `[VERIFIED via probe 2026-08-01]` cites
the owner-run read-only probe output. No `[VERIFIED]` label in this document
rests on the July 31 table or on any plan document.

---

## Verdict

**PLAN SOUND WITH NAMED CHANGES** — the directive's posture (stabilize, test
first, repair last) survives challenge, but: reframe regression→latent gap;
narrow Contract 1 to I-1/I-2/I-2a; shrink Phases 0/2 to the slice in §6; defer
the filename fallback; treat data repair as post-fix hygiene rather than a
correctness gate; and add W6 covering **both** ungated `selected=true` doors —
`promoteApplicantReviewer` (leaves a contradictory hybrid) and
`ensureStaffManualCandidate` via referral/manual add (silently resets a
decline). The second door was found only because the owner supplied the
Wolberger→Lima referral context, and it is the strongest argument for shipping
the slice before the next campaign: it converts a display defect into a
silent-data-loss risk on a workflow staff are actively encouraged to use.

Owner context supplied during review also produced **Finding C** (free-text
referral becomes a reviewer's name; a malformed name defeats dedupe and
auto-creates a selected duplicate person) and **W7**. Findings A and C are the
two halves of the referral path — a clean name promotes the wrong way, a
malformed one duplicates — and neither was in the inherited diagnosis.

**Finding D was raised and then withdrawn during this review** (§3.2.1). It is
recorded rather than deleted because the correction is the useful part: the
code reading was sound, the projected consequence was not, and only reading the
production text distinguished them. Two probes were written to settle it; both
are committed and re-runnable.

They do not change the verdict on the directive, but they do change what
"campaign safe" means. The common thread across C and D is that **free-text
reviewer input is treated as though it were structured data**: a referral
sentence becomes a person's name, and an exclusion category becomes an empty
filter. In both cases the system's behavior diverges silently from what the
person typing believed. The applicant's *recommended* reviewers avoid this
entirely by being exact person GUIDs — the fix pattern is already in the
building, just not applied to the free-text fields.

**Finding D was raised, measured, read, and withdrawn** across this review
(§3.2.1–3.2.2): of the affected answers, 8 of 10 are prose for "none" where a
no-op is correct, 1 is junk, 0 are missed names, and the single apparently
genuine case is an AkoyaGO **test record**. Real-world incidence of the scenario
is **zero** in the examined window. It is not a campaign blocker, does not
displace the §6 slice, and does not support restructuring the intake exclusion
field.
