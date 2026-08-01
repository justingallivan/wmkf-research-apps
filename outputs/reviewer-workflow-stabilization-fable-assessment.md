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

**One finding beyond the inherited diagnosis (worst finding of the session).**
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
`ENGAGEMENT_STAMP_RESET` that the explicit Restore path uses. The directive's
golden workflows do not cover this case; the revised set in §5 does.

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
  roster row `[VERIFIED via probe 2026-08-01]`. She does not resurface only
  because her roster row is terminal — i.e. the search-origin path is protected
  by roster state alone, and would be exposed to the same class of bug if that
  row were ever keyed differently. The invariant in §5 (I-1) should be written
  over *all* candidates, not just applicant-origin ones.
- **Duplicate person rows exist upstream.** Schulman and Sorek each return 2
  active name-matching `wmkf_potentialreviewers` rows, one of them empty
  (no email, no suggestion) `[VERIFIED via probe 2026-08-01]`. Out of scope for
  this slice and NOT a blocker, but it is latent fuel for future
  identity-binding confusion and belongs on the hygiene list, not in the
  stabilization slice.

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
  Reset-and-restore actions, which clear engagement via
  `ENGAGEMENT_STAMP_RESET`. No Find-surface action may write `selected=true`
  onto a row carrying live engagement or decline state without that reset.
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
6. **W6 (new) — No backward lifecycle write from Find:** promoting a suggestion
   that is declined or already engaged is refused (or requires the explicit
   restore flow); asserted at `promoteApplicantReviewer` and/or
   `updateLifecycle`. Baseline-failing today (§1).

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
6. Gates for touched surfaces + full suite; one adversarial review of the
   finished implementation (not another plan loop).

**Explicit non-goals for the slice:** no schema/migration; no Postgres
ownership changes; no `Project Narrative.pdf` fallback; no repair execution;
no changes to the fail-closed key binding, promotion lookup strictness, or
address-trust machinery; no touching `save-candidates`/invite surfaces.

**Estimated shape:** the server changes are confined to two traced files plus
two DTO lines; the client changes to two components plus one logic module. The
riskiest item is the W6 guard placement (service vs adapter) — decide in
implementation review; the adapter is the safer chokepoint but touches more
callers (restore legitimately writes `selected` on declined rows, so the guard
must be predicate-scoped, e.g. refuse `selected:true` when declined/engaged
unless the reset stamp accompanies it).

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
narrow Contract 1 to I-1/I-2; shrink Phases 0/2 to the slice in §6; defer the
filename fallback; add W6 (the declined-promote write hazard, the one finding
here that goes beyond the inherited diagnosis); and treat data repair as
post-fix hygiene rather than a correctness gate.
