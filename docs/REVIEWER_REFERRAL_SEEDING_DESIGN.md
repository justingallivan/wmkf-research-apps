---
title: "Reviewer Referral Seeding & Provenance Plan"
domain: reviewers
kind: plan
status: active
summary: "Implemented build plan: guarantee externally-referred seed names into the reviewer pool (seed-only, folded-in); relabel two existing kinds, no new enum."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - shared/components/reviewers/ReviewerSearchSection.js
  - lib/utils/reviewer-provenance.js
  - pages/api/reviewer-finder/analyze.js
  - pages/api/reviewer-finder/discover.js
  - pages/api/reviewer-finder/save-candidates.js
  - shared/config/prompts/reviewer-finder.js
---

# Reviewer Referral Seeding & Provenance Plan

**Status: IMPLEMENTED (Codex build on `codex/referral-seeding-build`; S319 safety
review folded in).** All design questions resolved (see §Locked decisions);
Codex-reviewed, then re-reviewed against live filter/save contracts. Written in response
to a PD report on req 1002926 (see §Origin). **Codex plan review incorporated (S318):** 6 claims
CONFIRMED, 1 REFUTED (no post-discovery count cap), 3 RISKs folded in. **S319 correction:**
the originally proposed post-filter `verifiedWithCOI` seam was unsafe because it bypassed
proposal-author / institution-COI / coauthor filters; §C now requires a seed safety pass
before ranking plus an explicit materialization contract for person reuse.

## Locked decisions

1. **Two referral lanes on two EXISTING provenance kinds — no new enum.**
   - **Externally-Referred** = the `referred` kind — names from consultants/colleagues
     (and contacted-reviewer referrals). This is what the new seed field feeds. Already
     grounded and ranking-bonused. The UI must never silently omit a seed: policy-clean
     seeds surface as selectable referred rows; proposal-author / institution-COI seeds
     surface as blocked-with-reason, not savable. The referrer ("Doug N") rides along via
     `referredBy` and the durable `wmkf_matchreason` prefix.
   - **Applicant-Referred** = the existing `applicant_suggested` kind — names the
     *applicant* put forward. Already end-to-end; deliberately **not auto-selected**
     (defaults to needing PD promotion) — the right posture for a possibly-biased pick.
2. **Folded-in layout.** Externally-Referred rows render **inside** the top grounded
   group (retitled "Cited, named & referred"), not a separate section. This is the
   existing routing (`referred` already groups there) — so it needs only the badge
   relabel, no `provenanceSections` split. Applicant-Referred keeps its own section.
3. **Seed-only discovery.** Seeds are injected directly into the candidate pool; they are
   **NOT** added to Claude's analyze prompt. Discovery stays an independent second
   opinion. (A future "also use these to find related reviewers" checkbox is possible but
   out of scope.)
4. **Bare names: surface-with-verify unless a policy conflict blocks them.** A seed with
   no email / unresolved identity still appears (selectable) in the grounded group with
   the existing "verify identity" affordance; the save path force-nulls its contact until
   identity is confirmed/probable, so it can never carry a wrong email (see §C for the
   mechanism). A seed matching the PI/co-PI or current PI institution is not dropped
   silently, but it is not selectable/savable.
5. **Bulk paste format:** tolerant freeform lines (`Name`, optional email, optional
   affiliation/URL). Names-only is the common case.

## Origin (the report)

A PD pasted a consultant-supplied list of names into the reviewer-finder **notes**
field, expecting the tool to (a) definitely surface those people and (b) mark them as
recommended. Observed: only *some* came back, no assurance they were used vs.
independently re-found; even editing the underlying prompt to "use these with high
confidence" did not force them in. She then added one (Mohammad Hafezi) via the manual
**Add or Refer** panel.

## Root cause (verified in code, S318)

The notes field **is** sent to Claude — injected as `ADDITIONAL CONTEXT FROM USER` near
the top of the analyze prompt (`shared/config/prompts/reviewer-finder.js:71`,
`lib/services/reviewer-prompt-composer.js:27`). But nothing **guarantees** those names
survive, and three code-owned mechanisms *downstream of the prompt* defeat a prompt-only
guarantee:

1. **Fixed target count** (`DEFAULT_REVIEWER_COUNT`, default 15) — Claude returns a
   capped best-fit set mixing the PD's names with its own; extras get crowded out.
2. **Code-owned anti-fabrication block** (`ANALYZE_INTEGRITY_BLOCK`) tells the model to
   return **FEWER** real reviewers rather than include a name it can't confidently
   identify — a bare name + webpage is exactly what it will drop.
3. **Discover-stage verification** (`discover.js`) re-checks each name against real
   publication profiles and ranks it; unresolved names rank low or fall away.

**Conclusion: the guarantee must live in code, not prompt wording.** The finder is a
discovery + verification engine; referred names are *already known* and should not be
subject to discovery economics. The guarantee is visibility, not policy bypass: every
seed must either surface as a selectable referred row or surface as blocked with a named
policy reason.

## Build (seams + sequence)

### A. Relabel two existing provenance kinds — `lib/utils/reviewer-provenance.js`
No enum change. In `provenanceLabelForCandidate` (the **display** surface):
- `REFERRED`: `Referred by ${referredBy}` / `Referred` → **`Externally-Referred ·
  ${referredBy}`** / `Externally-Referred`. Relabels ALL referred rows (contacted-reviewer
  referrals too) — intentional umbrella.
- `APPLICANT_SUGGESTED`: `Applicant-suggested` → **`Applicant-Referred`**.

**CRITICAL — display label ≠ durable string (Codex risk).** The relabel touches the
**display** only. The persisted `wmkf_matchreason` prefix **must stay `Referred by …`**:
`my-candidates.js` reparses `^Referred by …` on reload to reconstruct `referredBy` when
`wmkf_sources` includes `referred` [Codex: my-candidates.js:199,203]. Do NOT change the
persisted prefix or the reload parser — only the badge/label the UI renders.

**Consumer fan-out to update in the same change (Codex):** these assert/emit the old
label strings and must move with the relabel —
- `tests/unit/reviewer-provenance.test.js:137` (exact label assertion),
- `tests/unit/reviewer-candidate-export.test.js:63` (export string),
- `ReviewerSearchSection.js:1260` (UI/export fallback string).
No behavior change beyond the label; both kinds keep their existing grouping/selection/
ranking.

### B. Structured input — `shared/components/reviewers/ReviewerSearchSection.js`
- New "Externally-referred reviewers" textarea (consultants/colleagues — **not** the
  applicant), **separate** from `additionalNotes` (notes stays for instructions). Add a
  companion optional "Referred by" field that applies to the pasted batch. One entry per
  line, tolerant parse to `referredSeeds: [{ name, email?, affiliation?, url?, referredBy? }]`.
- POST `referredSeeds` to the find flow alongside `additionalNotes`. Applicant picks need
  no input here — they arrive through the existing applicant-referred pipeline.

### C. Guaranteed seed injection — `pages/api/reviewer-finder/discover.js`
- **Injection seam (corrected — Codex REFUTED the count-cap framing).** There is **no
  post-discovery `DEFAULT_REVIEWER_COUNT` pool cap** to inject before — the count is a
  Stage-1 prompt/validation input and `rankAllCandidates` combines/ranks without slicing
  [Codex: discovery-service.js:2309]. The guarantee comes from injecting seeds into the
  **ranked** set, not from beating a cap. **S319 correction:** do **not** simply merge
  seeds into `verifiedWithCOI` after the existing filter block. In live `discover.js`, the
  proposal-author filter, institution-COI hard drop, and coauthor check have already run
  before `combinedResults` / `rankAllCandidates` (`discover.js:273`, `:308`, `:334`,
  `:436`). A post-filter merge would bypass safety checks.
  - Build `seedCandidates` after `proposalAuthors` / `piIdentity` / `piInsts` are known.
  - Run the same proposal-author fuzzy filter and institution-COI policy against seeds
    before ranking. Policy-conflict seeds go to a `blockedReferredSeeds` response list
    with `{ name, reason }`; they do not enter `ranked` or `save-candidates`.
  - Run coauthor checking for policy-clean seeds when the PubMed coauthor contract is
    enabled, or mark the same coauthor fields the normal verified path uses so the row is
    visible with the existing warning rather than silently bypassing it.
  - Only after that safety pass, merge **policy-clean** seeds into `verifiedWithCOI`
    immediately before `combinedResults` / `rankAllCandidates` so they reach `data.ranked`
    → enrichment → `setCandidates` → `save-candidates`.
  **Do NOT put seeds into `analysisResult.reviewerSuggestions`** — unresolved Track-A
  items land in `unverified`, which `rankAllCandidates` excludes, so they'd never reach
  `displayCandidates` [Codex: discovery-service.js:478, 2310].
- Tag each injected seed `provenance.kind = 'referred'` (`seedRole: 'referred_by'`, carry
  `referredBy` if given). Also set a durable save reason string for seeds:
  `reasoning = "Referred by {referredBy}."` when a referrer is present, otherwise
  `"Externally referred by staff."`. This preserves the `my-candidates` reload parser
  contract for `referredBy` without relabeling `wmkf_matchreason`.
- **Bulk-dedup / materialization policy (corrected — Codex risk + S319).** The server-side identity lookup
  `lookupReviewerIdentity` exists but is **interactive**: it can return `candidates`
  requiring a staff choice, and the manual Add form stops for that confirmation
  [Codex: reviewer-identity-lookup.js:242, ReviewerFindPanel.js:288]. A bulk paste cannot
  stop per-name, so the policy is:
  - **Confident single match** → carry a server-derived `seedResolvedPotentialReviewerId`
    / `seedResolvedContactId` marker through the seed DTO. The later persistence step must
    reuse that anchored person (or a server re-lookup of the same confident identity)
    instead of falling through to `save-candidates`' existing name/email upsert. Without
    this explicit materialization path, name-only seeds can still duplicate because
    `save-candidates` currently calls `upsertByEmail`, which creates on missing email.
  - **Ambiguous (`candidates`) / conflict / no match** → inject as an **unresolved**
    `referred` row (do NOT auto-merge a guess). It surfaces selectable-with-verify (next
    bullet); the PD resolves identity in-panel with the existing affordance. This keeps
    the guarantee (never dropped) without risking a wrong-person merge.
- **Enrich, never drop.** Because `referred` is **identity-review-exempt** [VERIFIED via
  reviewer-provenance.js:212-218, 225-226; Codex-confirmed], a seed routes to
  `cited_or_proposal_named` (selectable-with-verify) **even when unresolved** — NOT to
  `needs_identity_review`. A bare/unresolved seed stays visible and selectable with the
  "verify identity" affordance; the SAVE path force-nulls its contact/bibliometrics until
  identity is confirmed/probable (`save-candidates` anchor-or-abstain), so it cannot carry
  a wrong email.
- **Seed-only.** Do NOT add seed names to the analyze prompt. (Codex confirmed Find
  currently sends only `blobUrl`/`excludedNames`/`reviewerCount`/`additionalNotes` to
  `/analyze` — keep it that way.)

### D. Display + persistence — mostly already exists
- **Folded-in section:** `provenanceGroupOf` already routes `referred` into
  `cited_or_proposal_named` [VERIFIED via reviewer-provenance.js:225-226 +
  isIdentityReviewExemptProvenance]. Only change: retitle that `provenanceSections` entry
  in `ReviewerSearchSection.js` from "Cited / proposal-named" to **"Cited, named &
  referred"**. No split. (The indigo "Externally-Referred" badge distinguishes rows.)
- **Applicant-Referred section already exists:** `provenanceGroupOf` routes
  `applicant_suggested` to its own group [VERIFIED via reviewer-provenance.js:231] which
  renders as its own section — only the label changes.
- **Persistence: existing source mapping, new seed materializer.** `save-candidates.js`
  writes the source list via `saveSourceListForCandidate(candidate)` and `referred`
  already flows through [VERIFIED via save-candidates.js:252,418 + the live req-1002926
  probe: the manual Hafezi row persisted `wmkf_sources = "staff_manual,referred"`].
  However, seed rows need an explicit materialization seam before Dataverse write:
  confident identity matches must reuse the server-anchored potential reviewer, while
  unresolved seeds may use the existing save path as name-only referred rows with contact
  force-nulled. Origin reaches Dataverse + the Invite tab + Excel export as-is only after
  this reuse path is implemented.

### Implementation sequence
1. **Labels (A)** — relabel both kinds in `provenanceLabelForCandidate` (DISPLAY only);
   leave the durable `wmkf_matchreason` "Referred by …" prefix and the `my-candidates`
   reload parser UNCHANGED. Update the three old-label consumers listed in §A (two tests +
   the `ReviewerSearchSection.js:1260` fallback string). Unit-test the label function for
   `referred` (with/without `referredBy`) and `applicant_suggested`.
2. **Section title (D)** — retitle the grounded `provenanceSections` entry to
   "Cited, named & referred".
3. **Input (B)** — add the textarea + `referredSeeds` state + line parser; POST alongside
   `additionalNotes`. (Seed-only: do NOT add to the `/analyze` body.)
4. **Seed injection + safety pass (C)** — in `/discover`, parse/clean seeds, run
   `lookupReviewerIdentity`, then run proposal-author / institution-COI / coauthor safety
   checks before ranking. Return blocked policy-conflict seeds separately with names and
   reasons. Merge only policy-clean seeds into `verifiedWithCOI` **before**
   `rankAllCandidates` (NOT into `analysisResult.reviewerSuggestions`), tagged `referred`
   with the durable `reasoning` string above.
5. **Seed materializer (D)** — before saving, implement the anchored reuse path for
   confident matches. Either extend `save-candidates` to accept only server-derived seed
   anchors and re-validate them before write, or add a small server-side helper used by
   save that mirrors `manual-reviewer`'s `ensureStaffManualCandidate` behavior. This is
   required for the "confident match → no duplicate" claim.
6. **Docs/gates** — update `reviewer-workbench-lifecycle` + `reviewer-origination` wiki;
   run lint/build plus `check:api-routes && check:api-routes:self-test`,
   `check:docs-catalog`, and `check:agent-wiki && check:agent-wiki:self-test`. (No
   `status-enum-parity` change.)

### Test plan
- **Unit:** `provenanceLabelForCandidate` (both relabels); the seed line parser
  (name-only, name+email, name+email+url, junk line, batch-level `referredBy`); dedup /
  materialization — a seed with a confident match reuses the anchored person, an ambiguous
  match injects unresolved (no auto-merge).
- **Regression:** `my-candidates` reload still reconstructs `referredBy` from the
  unchanged `Referred by …` prefix (durable string not relabeled); a bulk seed with a
  batch referrer persists the same prefix.
- **Integration:** seed 3 names (2 resolvable, 1 bare) → all 3 surface in the grounded
  group, tagged Externally-Referred; the bare one is selectable-with-verify and NOT
  dropped; saving the bare one force-nulls contact until identity is confirmed; a seed
  matching the PI/co-PI or PI institution surfaces in the blocked list and is not savable;
  the Claude analyze prompt is byte-unchanged (seed-only).
- **Verify (drive it):** run a find with seeds; confirm the folded section, the badges,
  blocked-seed summary, save → `wmkf_sources` carries `referred`, Excel shows
  Externally-Referred.

## Interim path available today (no build)

For a single known name, the manual **Add or Refer a Reviewer** panel works now: enter
the person, put the referrer in **"Referred by"** (tags `referred`), webpage in the note.
No bulk paste, and pre-relabel it shows "Referred by X" not "Externally-Referred". (This
is what the PD did for Hafezi; dedup correctly reused the existing person — no duplicate.)

## Effort / risk

- **Effort:** medium-small. Two label changes + one section retitle + one UI input + a
  seed safety/materialization helper in the find/save flow. **No new provenance kind, no
  new table, no new route, no `provenanceSections` split.**
- **Risk:** moderate. The `referred` kind — its grounded ranking, exempt routing, save
  force-null, and persistence — already exists and is live (the manual Add-or-Refer path).
  Care points: (1) run seed safety checks before ranking; do not post-merge seeds after
  `/discover` has already filtered normal candidates; (2) the bulk **dedup** must handle
  `lookupReviewerIdentity`'s interactive ambiguous/conflict outcomes non-interactively
  (inject-unresolved, never auto-merge a guess) and must enforce anchored reuse for
  confident matches; (3) relabel the DISPLAY only — leave the durable `wmkf_matchreason`
  "Referred by …" prefix + reload parser intact; move the three old-label consumers (§A).
- **Gates:** lint/build, `check:api-routes && check:api-routes:self-test`,
  `check:docs-catalog`, and `check:agent-wiki && check:agent-wiki:self-test`. No
  `status-enum-parity` change.

## Build status

**State: implemented on `codex/referral-seeding-build`.** The build follows the
S319-corrected guardrails in §A/§C/§D: seed safety pass before ranking, anchored reuse
for confident identity matches, and display-vs-durable-string split.

Implemented surfaces:
- `ReviewerSearchSection` parses a separate externally-referred seed field and sends
  `referredSeeds` only to `/discover`, not `/analyze`.
- `/discover` sanitizes seeds, blocks exact excluded / already-surfaced seeds, runs the
  same proposal-author and institution-COI filters before ranking, and returns
  `blockedReferredSeeds` for non-silent omissions.
- `save-candidates` revalidates server-derived seed anchors with a fresh identity lookup
  before reusing an existing potential reviewer; name-only/unvalidated referred rows keep
  the existing contact-null safety behavior.
- Display labels now read `Externally-Referred` / `Applicant-Referred`; durable
  `wmkf_matchreason` still uses the `Referred by ...` prefix for reload parsing.

Verification run: focused Jest coverage for search parsing/provenance/export/save anchor
reuse, API route matrix + self-test, Atlas + self-test, doc catalog/symbol/freshness gates,
lint, and production build.

S320 pre-merge collision fix: `b997cf37` made candidate dedupe preserve `referred`
provenance and `referredBy` for seed/discovery same-name collisions in both relevance
orderings. Follow-up `ff54c60c` applies that same referral-preserving dedupe before the
background Find-roster write, so reloadable roster rows do not lose the
Externally-Referred badge/referrer either.

The S318 Codex plan review remains preserved verbatim in the appendix; the historical
post-filter seam there is superseded by §C.

## S320 pre-merge fix resolved — seed⇄discovery collision preserves referral attribution

**Status: RESOLVED before merge.** Found by a code audit of the built branch (S320). It
was not a data-corruption bug; it was a labeling/attribution defect. Closed by
`b997cf37` plus `ff54c60c`.

### The defect
When a seeded referral name **and** a candidate that discovery independently finds in the
same run **normalize to the same name**, the survivor shown to the user is chosen by
**relevance score, not by provenance**:
- Server (`/discover`) prepends seeds to `verifiedWithCOI` and does **not** dedup them
  against this run's own discovery output; `DiscoveryService.rankAllCandidates` →
  `rankByRelevance` only scores + sorts (no dedup). So the emitted `ranked` array can
  carry two rows for the same person [VERIFIED: `discover.js` seed-merge line
  `verifiedWithCOI = [...referredCandidates, ...verifiedWithCOI]`; `relevance-score.js`
  `rankByRelevance` sort-only].
- Client (`ReviewerSearchSection.js`) collapses them via `dedupeByName`
  (`normalizeReviewerName`, **first-occurrence wins**) when building `displayCandidates` —
  so there is **no duplicate card and no duplicate save** [VERIFIED: `dedupeByName` +
  `displayCandidates = dedupeByName([...recCandidates, ...candidates, ...displayRosterActive])`].
- **BUT** first-occurrence = highest relevance score, not the referred copy. `referred`
  gets a +25 grounded bonus (`GROUNDED_RANKING_BONUS_KINDS` includes `REFERRED`), so the
  seed *usually* wins — **not always**. If the discovery copy outranks it, the surviving
  row shows as an ordinary discovered candidate: **no "Externally-Referred" badge, no
  `referredBy` attribution**, even though staff explicitly referred that person. The
  surface promise ("clearly badged as externally-referred") silently fails for exactly the
  prominent names most likely to be found both ways.

### The fix
The collision now resolves by **provenance preference, not relevance order**. When two
candidates share a `normalizeReviewerName` key, `dedupeByName` delegates to
`dedupeByNamePreferReferred`, which grafts `referred` provenance, `referredBy`, and the
durable `Referred by ...` match-reason prefix onto the survivor. The helper deliberately
does not copy contact or identity fields across copies, preserving name-only referred-seed
contact-null safety. The deduped candidate list is also the list sent to
`/api/workbench/reviewer-roster`, so the active roster reload path keeps the same
Externally-Referred attribution.

### Acceptance criteria
- A seeded name that discovery also finds appears **once**, badged **Externally-Referred**
  with the referrer, regardless of relevance order.
- The roster persistence path uses the same deduped survivor, so reload does not drop the
  badge/referrer.
- No regression to the existing name-only unresolved-seed contact-null safety.
- Unit tests cover the collision in both orderings plus no false promotion of
  applicant-referred and non-referred candidates.

### Known limitation (NOT a blocker — note only)
`dedupeByName` is exact-normalized-name. If the referrer hand-types a variant the system
normalizes differently ("R. Smith" vs "Robert Smith"), the two won't collapse → two rows
for one human. Pre-existing, system-wide limitation of name-key dedup; seeding is a new way
to trigger it. Do not expand scope to fix name-fuzzing here.

## Appendix: Codex plan-review findings (verbatim, S318) — RESCUED / PARTLY SUPERSEDED

Preserved so a future session doesn't re-run the review. S319 re-review supersedes the
`verifiedWithCOI` post-filter seam below: use §C, not the historical appendix line, for
implementation. Codex read the committed plan against live source and returned:

- CONFIRMED — Provenance relabel is enum-neutral: `referred` and `applicant_suggested` already exist in `PROVENANCE_KINDS`, while `provenanceLabelForCandidate` is the string-only display surface. `lib/utils/reviewer-provenance.js:9`, `:249`.
- CONFIRMED — `referred` behavior is already grounded/exempt: it gets ranking bonus, routes through `isIdentityReviewExemptProvenance`, and groups as `cited_or_proposal_named` before unresolved identity gates run. `reviewer-provenance.js:34`, `:212`, `:221`.
- CONFIRMED — Unresolved `referred` rows are selectable-with-verify and save-time contact-null: UI selectability is group-based, save skips hard reject for exempt kinds and blocks contact fields unless identity is resolved. `ReviewerSearchSection.js:837`, `save-candidates.js:60`, `:83`.
- CONFIRMED — `save-candidates` persists `referred` with no new mapping: `saveSourceListForCandidate` includes `provenance.kind`, save joins it into `sources`, adapter writes `wmkf_sources`. `reviewer-provenance.js:191`, `save-candidates.js:252`, `reviewer-suggestion.js:421`.
- CONFIRMED — Folded-in layout holds: `referred` maps to `cited_or_proposal_named`, rendered as one section; applicant-suggested remains separate. `reviewer-provenance.js:225`, `ReviewerSearchSection.js:1247`.
- REFUTED — There is NO post-discovery `DEFAULT_REVIEWER_COUNT` pool cap to merge before; the count is Stage-1 prompt/validation, and `rankAllCandidates` combines/ranks without slicing. `reviewerFinderPreferences.js:20`, `analyze.js:184`, `discovery-service.js:2309`.
- RISK — Seed injection must NOT go into `analysisResult.reviewerSuggestions`: unresolved Track-A items land in `unverified`, which `rankAllCandidates` excludes; client `displayCandidates` comes from `ranked`. `discovery-service.js:478`, `:2310`, `ReviewerSearchSection.js:643`.
- CONFIRMED — Exact viable seam is `/discover` after verification/filtering, before the `ranked` frame: merge seeds into `verifiedWithCOI` before `combinedResults`/`rankAllCandidates` so they reach `data.ranked`, enrichment, `setCandidates`, `save-candidates`. `discover.js:436`, `:491`, `ReviewerSearchSection.js:669`, `:1025`.
- RISK — The manual-Add lookup exists server-side but is an interactive identity preflight: `lookupReviewerIdentity` can return `candidates` needing staff choice; the manual form stops for confirmation. Bulk seed flow needs an explicit policy for ambiguous/conflict outcomes. `reviewer-identity-lookup.js:242`, `ReviewerFindPanel.js:288`.
- RISK — Relabel fan-out is broader than `provenanceLabelForCandidate`: exact tests + a UI/export fallback string still assert/display `Referred`/`Applicant-suggested`. `tests/unit/reviewer-provenance.test.js:137`, `tests/unit/reviewer-candidate-export.test.js:63`, `ReviewerSearchSection.js:1260`.
- RISK — Do not relabel the durable `wmkf_matchreason` prefix without changing reload parsing: `my-candidates` reconstructs `referredBy` by matching `^Referred by …` when `wmkf_sources` includes `referred`. `my-candidates.js:199`, `:203`.
- CONFIRMED — Seed-only is not currently wired into the analyze prompt path: Find sends only `blobUrl`/`excludedNames`/`reviewerCount`/`additionalNotes` to `/analyze`; the composer only interpolates those. `ReviewerSearchSection.js:592`, `analyze.js:87`, `reviewer-prompt-composer.js:25`.
