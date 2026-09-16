---
title: Pre-Research Presentation Brief — build plan
status: draft
owner_decisions_pending: false
created: 2026-09-16
session: 515
---

# Pre-Research Presentation Brief — build plan (2026-09-16, S515)

User feedback: the document shared with the Board through the Pre-Site distribution is the
wrong one. Today the briefing page serves the frozen Pre-Site Visit writeup. The owner wants a
new, shorter staff document — the **Pre-Research Presentation Brief** — generated from the
Staff Deliberations tab, editable by staff in Word, and distributed by the existing
briefing-page link.

Every state claim below is labelled. `[VERIFIED]` means read in source this session.

## 1. Owner decisions (2026-09-16)

| # | Decision | Answer |
|---|---|---|
| B1 | Field sources | Institution, title, PI, PD from the request; abstract from the request's `wmkf_abstract`. |
| B2 | Referee sentences | Reuse the deterministic Reviews-tab composers (score tally + reviewer roster sentence). No new prompt. |
| B3 | Issues section | Staff-written; heading only on generation. |
| B4 | Where generated | Staff Deliberations tab. Name: **Pre-Research Presentation Brief**. |
| B5 | Distribution | Briefing-page link email as today. Download stays as a backup. No email attachments (2026-09-10 decision stands). |
| B6 | Header | None. |
| B7 | Briefing page | The brief **replaces** the Pre-Site writeup in the staff-brief slot. |
| B8 | Share gate | Share needs the brief only; a Pre-Site Word draft is no longer a prerequisite. The gate is enforced server-side (§3.4). |
| B9 | Editability | Staff edit the brief in Word as needed, including Issues. → the brief is a governed SharePoint document with a registry row (§3). |
| B10 | Zero reviews | Share is blocked until at least one review is received. |

### B11 — Share and the Site Visit transition (owner 2026-09-16; revised after Codex round 1)

`[VERIFIED]` Today the Share button's pre-prepare hook calls
`POST /api/workbench/pre-site-visit/start-site-visit`, which moves the Pre-Site writeup from
Draft to Review lifecycle (`StaffDeliberationsTab.js:427-460`,
`site-visit-transition-service.js`). The owner's position: that share gate existed so the
shared version could be recorded in the writeup before the post-visit edits; it no longer makes
sense and should be deprecated. Deciding what Final Writeup should derive from instead is a
later decision.

Constraint `[VERIFIED via lib/services/final-writeup/transition-service.js:170-202]`: Final
Writeup creation throws `final_writeup_source_missing` without
`_wmkf_currentpresitevisit_value` and requires that row to be `PRE_SITE_VISIT` / Ready /
Review. `[VERIFIED via rg start-site-visit]` the Share hook is the only caller that puts a
Pre-Site row into Review. A silent skip (the first draft of this plan) would therefore leave a
brief-only request with no reachable Final path — Codex round 1, finding 2.

**Decision for this pass:** decouple, and keep Final reachable.

1. Share locks **only the brief** (§3.4) and never calls `start-site-visit`.
2. The Pre-Site → Site Visit transition becomes an explicit **Start Site Visit** action on the
   Pre-Site writeup card, calling the existing route unchanged. It is available whenever a
   Ready/Draft Pre-Site row exists, independent of Share.
3. Final Writeup keeps its current prerequisite (Pre-Site row in Review). The Final Writeup
   card's copy names the missing step ("Start the Site Visit on the Pre-Site writeup first")
   instead of a generic failure.
4. Deprecating the Pre-Site prerequisite for Final is a **separate follow-up** in
   `docs/CURRENT_WORK_QUEUE.md`; nothing in this pass removes it.

### B12 — Regenerate after staff edits (owner, 2026-09-16)

Same rule as the Pre-Site writeup: Regenerate, behind the existing confirm dialog, creates a
fresh brief row and file and supersedes the prior row; staff edits are not merged and the
prior file remains in SharePoint.

## 2. Document contract

Template source: the owner's `Staff Briefing Template.docx` (Letter, 0.75" margins, Times New
Roman; the example file carries a page-2 header that B6 removes). `[OWNER FILE, not tracked]`
inspected by unzipping it this session; the tracked `brief-v1.docx` produced in slice 2 becomes
the reproducible evidence, with a renderer test asserting no header/footer parts. Structure, in order:

| # | Block | Source | Token |
|---|---|---|---|
| 1 | Institution (centered, bold, 14 pt) | request `_akoya_applicantid_value_formatted`, Account name when resolvable | `[[DV:InstitutionName]]` |
| 2 | Title (centered) | `akoya_title` | `[[DV:ProjectTitle]]` |
| 3 | PI (centered) | `_wmkf_projectleader_value_formatted` (`[VERIFIED via proposal-core-service.js:288]`, the same source the Pre-Site writeup uses for the PI) | `[[DV:PrincipalInvestigator]]` |
| 4 | PD (centered) | `_wmkf_programdirector_value_formatted` | `[[DV:ProgramDirector]]` |
| 5 | Rule | template | — |
| 6 | **Abstract:** inline paragraph | `wmkf_abstract` (written in-app by the Reviews-tab abstract editor and the grantee abstract service) | `[[DV:Abstract]]` |
| 7 | **Referee Comments:** (Heading 1) + paragraph | `composeScoreSentence` + `composeReviewerSentence` over `getWriteupRoster({ requestId })` reviewers with `reviewReceivedAt` (`[VERIFIED via reviewers-service.js:580]` object parameter; the Pre-Site caller adapts it the same way at `proposal-core-service.js:96`) | `[[STAFF:RefereeSentences]]` |
| 8 | **Issues to be Addressed at the Research Presentation:** | empty | — |

`[VERIFIED]` `composeReviewerSentence` already renders "Name, a professor at Institution;
…; and …" from `academicRank`, and returns underline runs for the name; `composeScoreSentence`
renders "We received three reviews with scores of one Excellent and two Very Good."
(`shared/utils/review-writeup-paragraphs.js:253-369`). The brief uses those two sentences only,
not the expertise sentence, themes, or quotations.

Rendering is deterministic: no model call, no prompt registry entry. The renderer is a
template-preserving OOXML placeholder fill in the same style as
`lib/services/pre-site-visit/docx-renderer.js` (`[VERIFIED]` replacement-map pattern at
`:362-372`), against a tracked template
`shared/templates/pre-research-presentation-brief/brief-v1.docx` derived from the owner's file
with the sample text replaced by tokens and the header parts removed.

## 3. Persistence and Dataverse plumbing

**New artifact type.** `wmkf_requestdocument.wmkf_artifacttype` gains
`Pre-Research Presentation Brief = 100000009`. `[VERIFIED]` Precedent: Consultant Feedback
`100000008` was added 2026-09-14 (S512) with `scripts/extend-requestdocument-artifacttype.mjs`
(owner-run, dry-run default, InsertOptionValue inside the app solution, re-read verify), and
mirrored in `shared/config/requestDocument.js` and
`lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json`. This pass
adds a sibling script or parameterises that one, plus the two mirrors and the Atlas page.

**Request pointer (revised after Codex round 1, finding 3).** "Newest Ready row" is a
read heuristic, not an invariant: `[VERIFIED via lib/dataverse/adapters/request-document.js:145-154]`
`findByRequest` only orders by `createdon desc`, and `[VERIFIED via
lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:325-330]` the
registry's only alternate key is `wmkf_generationkey`, so two first generations with different
keys could both become Ready/Draft. Consultant Feedback is not a singleton precedent: its rows
are addressed by exact id (`[VERIFIED via lib/services/consultant-feedback-service.js:192-223]`).

The brief therefore gets its own request pointer, `akoya_request.wmkf_CurrentPreRPBrief`
(N:1 lookup to `wmkf_requestdocument`), added by a schema-as-code record shaped like
`zz_akoya_request_initial_assessment_pointer.json` (`[VERIFIED]` kind `extensions-on-existing`,
lookup `wmkf_CurrentInitialAssessment`). Activation reuses the Pre-Site pattern
(`[VERIFIED via lib/services/pre-site-visit/artifact-service.js:945-1009]`): supersede every
other active row, ready the target, and move the pointer, each under its own ETag, in one
changeset. Every reader — status, distribution source, history freshness, cycle list —
resolves the brief **through the pointer** and fails closed when the pointer is absent or
does not resolve to a same-request, Ready, Draft/Review, non-snapshot row. No reader picks
"newest".

Plumbing total for this pass, both owner-run against Production: one picklist value and one
lookup field.

**Registry row shape.** Same producer/operation-status/lifecycle vocabulary as Pre-Site:
`GENERATING → READY`, lifecycle `DRAFT` on generation, `REVIEW` once locked by Share.
Filename `Pre-RP-Brief_{Request#}_{generationKey8}.docx` in the request's active SharePoint
bucket via the existing upload path.

**§3.4 Share lock and review gate (revised after Codex round 1, finding 1).**
`[VERIFIED via pages/api/workbench/pre-site-visit/distribution/prepare.js:31-47]` the prepare
route calls `preparePreSiteDistribution` directly after `requireAppAccess`, and
`[VERIFIED via distribution-service.js:1217-1245]` preparation never reads the review roster,
so a tab-side "at least one review" check would be bypassable. New service + route
`POST /api/workbench/pre-rp-brief/lock-for-share` (`lib/services/pre-rp-brief/share-lock-service.js`):

1. resolves the current brief through the pointer (fail closed otherwise);
2. reads the brief row's **generation input snapshot** (§3.4a) and refuses 409
   `brief_reviews_required` when that snapshot recorded zero received reviews — the gate proves
   the *document* contains a Referee Comments section, not merely that reviews exist now;
   then reads the live roster via `getWriteupRoster({ requestId })`
   (`[VERIFIED via lib/services/review-manager/reviewers-service.js:580-623]`) and compares
   received-review ids and the abstract hash to the snapshot: a difference returns 409
   `brief_inputs_stale` with the delta, unless the body carries
   `acknowledgeStaleInputs: true`, which the tab sends only after showing staff the delta
   (regenerating would discard their Word edits, B9/B12, so the choice is theirs, but it is
   explicit and server-recorded on the lock milestone);
3. reads stable SharePoint drive/item/version before and after the byte read, as
   `site-visit-transition-service.js` does for Pre-Site, and hashes the bytes;
4. ETag-fences the brief row: lifecycle Draft → Review on first lock, and on **every** lock
   (including an already-Review row) records the milestone `wmkf_milestoneversionid`,
   `wmkf_milestonecontenthash`, `wmkf_milestonecreatedat`, plus the stale-input acknowledgement.
   Re-locking is how staff share an edited brief: Share's hook always locks first, so the
   milestone always names the version staff just looked at.

**§3.4a Input snapshot.** Generation stores, on the brief row, the same kind of frozen input
snapshot the Pre-Site generator stores (`[VERIFIED via lib/services/pre-site-visit/artifact-service.js:1136-1140]`
`buildPreSiteVisitInputSnapshot` → `inputSnapshotJson` on the row): request header fields,
abstract hash, and the received-review roster (suggestion ids, names, ranks, ratings) that the
Referee Comments sentences were composed from. It is the evidence the lock gate reads.

**§3.4b Milestone binding at prepare and send (Codex round 2, finding 2).**
`[VERIFIED via distribution-service.js:622-655, 697-730]` today `resolveSource` requires only
Ready/Review and `captureCurrentSource` downloads whatever SharePoint version is current, never
comparing it to the lifecycle milestone; the Pre-Site flow has the same gap. For the brief,
`resolveSource` additionally requires the current SharePoint `versionId` to equal
`wmkf_milestoneversionid` and the captured byte hash to equal `wmkf_milestonecontenthash`;
otherwise 409 `brief_edited_after_lock` ("Share again to lock the edited version") before any
ledger or snapshot write. `assertAttemptSourceCurrent` (send path) re-checks the same pair
under the lease. So the pinned Board snapshot is always the bytes the lock recorded. Tests:
lock V1 → edit to V2 → prepare fails closed; lock V1 → prepare → edit to V2 → send fails
closed; re-lock V2 → prepare succeeds with V2.

**Writer registration.** `scripts/check-request-document-writers.js` lists every
`createDocument(` site; the new service is added to `WRITERS` (`[VERIFIED]` gate shape at
`:16-24`). `check:request-document-writers` and `check:atlas` must stay green.

**Distribution snapshot.** `[VERIFIED]` `ensureSnapshot` writes the pinned copy as a
`wmkf_requestdocument` row with `wmkf_artifacttype = PRE_SITE_VISIT`, producer
`request-workbench-distribution-docx`, lifecycle `BOARD_READY`
(`distribution-service.js:930-1108`), and the briefing page serves it purely by the ledger's
`docx_snapshot_document_id` through `getLatestSentAttempt`
(`briefing-page-service.js:52,99,245,336`). Change: the snapshot row carries artifact type
100000009 and the source resolution (`resolveSource`, `:622-657`) reads the current brief
instead of the Pre-Site pointer. `isPreSiteDistributionSnapshot` (producer-based) keeps
excluding snapshots from the materials list without change.

**§3.5 Composite stage projection (revised after Codex round 1, finding 4).**
`[VERIFIED via shared/utils/deliberation-stage.js:99-119]` the helper derives `final` only when
the supplied artifact's lifecycle is FINAL, `shared` from Review, `draft` otherwise; and
`[VERIFIED via lib/services/final-writeup/transition-service.js:653-669]` Final activation sets
the **Pre-Site** source row to FINAL while the brief would stay in Review. A brief-only input
could therefore never show Final. The helper takes a composite input:

| Stage | Source of truth |
|---|---|
| final | Pre-Site/Final lineage: current Pre-Site row lifecycle FINAL, or a current Final row |
| visit | Site Visit schedule in the past (unchanged `deriveVisit`) with the brief in Review |
| shared | brief lifecycle Review; `everSent` from the ledger keyed to the brief's row id |
| draft | brief absent or Draft; substate from the brief's operation status |
| beyond | any other lifecycle on the brief (fail closed, unchanged) |

Legacy requests with a Pre-Site row and no brief keep today's derivation from the Pre-Site row,
so historical rails do not change. Unit cases: brief-only Draft; brief-only Review sent; legacy
Pre-Site no brief; Final started while the brief stays Review; both rails (tab and cycle list).

## 4. Surfaces

| Layer | Change |
|---|---|
| `shared/config/requestDocument.js` | new artifact type + label; brief contract constants (content type, template id/version, producer). |
| `lib/services/pre-rp-brief/` (new) | `input-service.js` (request header + abstract + roster → snapshot), `docx-renderer.js` (template fill), `artifact-service.js` (claim/generate/upload/commit, mirroring the Pre-Site lineage but without prompt/AI steps), `status` projection. |
| `pages/api/workbench/pre-rp-brief.js` + `pages/api/workbench/pre-rp-brief/lock-for-share.js` (new) | GET status, POST generate/regenerate; POST lock-for-share (§3.4). Guards mirror `pages/api/workbench/pre-site-visit.js` and `start-site-visit.js`; both added to `docs/API_ROUTE_SECURITY_MATRIX.md`; covered by the `/api/workbench` lifecycle namespace. |
| `lib/services/pre-site-visit/distribution-service.js` | `resolveSource`, `assertAttemptSourceCurrent`, history freshness, and the snapshot spec all read the current brief (§7); error copy says "brief". |
| `shared/components/workbench/StaffDeliberationsTab.js` | Brief card: Generate / Regenerate / Download / Open in SharePoint; Share's pre-prepare hook calls `lock-for-share` (§3.4) and never `start-site-visit`. Pre-Site card gains an explicit **Start Site Visit** action (B11). Final Writeup card copy names the Site Visit prerequisite. |
| `shared/utils/deliberation-stage.js` + `lib/services/pre-site-visit/cycle-list-service.js` | Composite stage projection (§3.5) for both callers (`[VERIFIED via rg deriveDeliberationStage(]`: the tab at `StaffDeliberationsTab.js:405` and `cycle-list-service.js:92`). The cycle list queries brief rows as well as Pre-Site rows, includes brief-only requests, keeps legacy no-brief requests, and keys `everSent` to the brief source ids. |
| `shared/components/workbench/PreSiteDistributionPanel.js` | `sourceArtifact` = brief; copy. |
| `lib/services/deliberation-briefing/briefing-page-service.js` | header comment and member label ("Staff brief" already; content now the brief). No route change. |
| Email copy | `shared/config/deliberationShareEmail.js` seed body/briefing copy reviewed for "writeup" wording; admin-editable values untouched. |

## 5. Slices

1. **Plumbing + config.** Parameterised picklist script and a pointer-field script (owner runs each
   `--execute`), config mirrors, two schema records, Atlas pages (request + requestdocument),
   writers-gate entry. Verify by re-read.
2. **Renderer + template.** Tracked `brief-v1.docx`, renderer, unit tests with the discriminating
   fixture (one reviewer / three reviewers / a reviewer without rank / abstract with line breaks).
3. **Artifact service + routes.** Generate, regenerate-supersede with pointer activation, status
   projection, download URL; share-lock service + route (§3.4) with direct-route bypass tests.
   Tests mirror `pre-site-visit-artifact-service.test.js` and `site-visit-transition-service` tests
   minus prompt/AI paths.
4. **Distribution source swap.** `resolveSource` + snapshot type; `pre-site-distribution-service.test.js`
   and `deliberation-briefing-page-service.test.js` updated; briefing page proves it serves the brief.
5. **Staff Deliberations UI + stage.** Brief card, Share → lock-for-share, explicit Start Site
   Visit action, composite stage projection in both callers, cycle-list brief sourcing;
   `pre-site-distribution-panel.test.js`, tab tests, stage tests, cycle-list tests.
6. **Docs reconcile.** `DATAVERSE_SHAREPOINT_FILE_MODEL.md` (three governed writeups → three
   writeups + the brief; lineage section), `DELIBERATION_BRIEFING_PAGE_PLAN.md` §2.1,
   `docs/atlas/dataverse-wmkf-requestdocument.md`, agent-wiki topic, `CURRENT_WORK_QUEUE.md`.

Release: Tier 1 runtime work → feature branch `claude/pre-rp-brief`, PR, Production smoke on a
ZZTEST request after the option value exists in Production.

## 6. Risks and constraints

- The option-value insert is a Production Dataverse schema write and is owner-run; nothing in
  slices 2-5 can be smoked in Production before it lands.
- `wmkf_abstract` may be empty on older requests; generation fails closed with a named
  message ("Add the abstract on the Reviews tab first") rather than rendering a blank.
- Reviewers without an academic rank render "Name of Institution" (existing composer rule).
- The Pre-Site writeup, Site Visit transition route, and Final Writeup lineage are untouched;
  only the trigger for the Site Visit transition moves from Share's hook to an explicit action (B11).
- Two owner-run Production schema writes (picklist value, pointer lookup) gate every smoke.

## 7. Contract-reconcile review (Mode A, 2026-09-16, S515)

Surface: new governed artifact type + generate route; distribution source swap; briefing-page
consumer. Persistence: Dataverse `wmkf_requestdocument` + SharePoint file + Postgres
`pre_site_distribution_attempts`. Consumers: Staff Deliberations tab, Share composer, briefing
page, Final Writeup lineage, reopen service, gates.

### Findings

1. **CONFIRMED — briefing page needs no route change.** Evidence:
   `briefing-page-service.js:236-250` builds the writeup member from the ledger attempt's
   `docx_drive_id/docx_item_id`; `:334-352` downloads by those ids and re-hashes against
   `docx_byte_hash`. No artifact-type check on the read side. Residual risk: none.
2. **CONFIRMED — material allowlists cannot leak the brief.** Evidence: `MATERIAL_TYPES.has(...)`
   allowlists at `distribution-service.js:500`, `briefing-page-service.js:203`,
   `site-visit/logistics-service.js:344`; `summary-reader.js:18-19` and
   `collection-service.js:147-181` enumerate specific types. A new value falls out of every
   bucket, which is the safe direction here.
3. **CONFIRMED — reopen, Site Visit transition, and Final lineage are untouched.** Evidence:
   `reopen-service.js:153,188,269,471,691` filter on `PRE_SITE_VISIT` + producer;
   `site-visit-transition-service.js` and `final-writeup/transition-service.js:185,197` check
   `PRE_SITE_VISIT` + Review. Brief rows (type 100000009) are invisible to all three.
4. **CONFIRMED — the "no pointer" precedent holds.** Evidence: `rg "_wmkf_current"` over
   `grant-request.js`, `consultant-feedback-attachment-service.js`, and the request Atlas returns
   no consultant pointer; `request-document.js:148,183,195` filter generically by numeric type.
5. **CONFIRMED — B11 constraint.** `final-writeup/transition-service.js:197` requires the
   source row in Review; `rg start-site-visit` finds only the tab hook, the route, and the
   transition service.

### New issues (required changes to §4/§5)

- **MEDIUM — stage derivation still keys on the Pre-Site lifecycle.** Evidence:
  `shared/utils/deliberation-stage.js:99-119` derives `shared` only from the current Pre-Site
  artifact's Review state. After B8, a request with no Pre-Site draft would stay at `draft`
  after the brief is shared. Required: the tab passes the **brief** as `currentArtifact` for
  stage purposes (Draft → draft, Review → shared/visit), with `everSent` from the ledger as
  today; the Pre-Site card reads its own lifecycle for its own affordances. Add a unit case
  "brief shared, no Pre-Site draft → stage shared".
- **MEDIUM — three distribution sites read the Pre-Site source, not one.** Evidence:
  `resolveSource` `:622-657`; `assertAttemptSourceCurrent` `:1587-1607` (calls it);
  history freshness `:1925-1945` reads `_wmkf_currentpresitevisit_value` +
  `PRE_SITE_VISIT` directly; snapshot type at `:957`. All four move to the brief resolver.
  Consequence to state explicitly: a **pre-existing unsent attempt** whose
  `source_document_id` is a Pre-Site row will fail closed with `distribution_stale_source`
  after deploy ("prepare a new exact preview"); sent attempts are unaffected (the briefing
  page reads ledger ids only). Add a test for that fall-through.
- **LOW — "current brief" resolver validates the pointer target, never picks newest**
  (superseded wording removed after Codex round 2, finding 3). The distribution snapshot row
  will also carry type 100000009 (lifecycle `BOARD_READY`, producer
  `request-workbench-distribution-docx`). Every reader loads the row named by
  `wmkf_CurrentPreRPBrief` and requires same request, type 100000009, `operationstatus =
  READY`, lifecycle in (DRAFT, REVIEW), and `!isPreSiteDistributionSnapshot(row)`; anything
  else fails closed. Fixtures: pointer to the older of two editable rows (must resolve the
  older one), pointer missing, pointer to a snapshot row, pointer to another request's row.
- **LOW — new API route shifts counted surfaces.** `check:api-routes` needs the matrix row;
  `check:fact-consistency` may pin the route count in `CANONICAL_COUNTS` — run both after
  adding the route. `/api/workbench` is already a `ROUTE_NAMESPACE_LIFECYCLE` namespace
  (`appRegistry.js:350`), so `check:route-lifecycle-auth` covers the new file once its guard
  matches the namespace's `guardAppKeys`.
- **LOW — extend script is single-purpose.** `scripts/extend-requestdocument-artifacttype.mjs:30-31`
  hard-codes `NEW_VALUE`/`NEW_LABEL`. Parameterise by `--value`/`--label` with the same
  dry-run default, or add a sibling; do not edit the S512 constants in place (it is the
  record of that insert).

### Audits

Whole-flow: traced tab → route → artifact service → registry/SharePoint → distribution →
ledger → briefing page. Partial-success: generation is single-row claim/lease, mirrored from
Pre-Site; distribution unchanged. Async/stale: the tab's sequence/abort polling pattern
(`StaffDeliberationsTab.js`) is reused for the brief card; no new streaming. Helper-extraction:
none proposed. Durable-surface: Atlas `dataverse-wmkf-requestdocument.md`, schema JSON,
security matrix, writers gate, `DATAVERSE_SHAREPOINT_FILE_MODEL.md` (three governed writeups
→ three writeups plus the brief), `DELIBERATION_BRIEFING_PAGE_PLAN.md` §2.1, agent-wiki
topic, work queue. Doc-reconcile: via `/sweep` in slice 6. Symbol fan-out: all 18 files that
read `wmkf_artifacttype` were enumerated (`rg -c`), and every branch is either an allowlist,
a `PRE_SITE_VISIT`/`FINAL_WRITEUP`/`CONSULTANT_FEEDBACK` equality check, or a generic numeric
filter.

### Verdict

**READY WITH NAMED CHANGES** — the five items above are folded into slices 3–5 before code.

### Codex adversarial review — round 1 (2026-09-16, gpt-5.6-sol, base `b36b101a`)

Verdict NO-SHIP, four findings. Each was re-verified in source before folding in:

| # | Finding | Disposition |
|---|---|---|
| 1 | Share had no server-side brief lock or zero-review gate; prepare route bypasses the tab | **Accepted** → §3.4 lock-for-share service/route; prepare requires Review. |
| 2 | B11 silent skip stranded Final Writeup for brief-only requests | **Accepted** → B11 rewritten: explicit Start Site Visit action; Final prerequisite kept; deprecation deferred as its own item. |
| 3 | "Newest Ready row" is no singleton invariant; Consultant Feedback is not a precedent | **Accepted** → request pointer `wmkf_CurrentPreRPBrief`, Pre-Site activation pattern, fail-closed readers. |
| 4 | Stage helper has two callers; cycle list omits brief-only requests; Final unreachable from a brief-only projection | **Accepted** → §3.5 composite projection in both callers; cycle list sources briefs. |

Confirmed-holding claims from round 1: briefing page serves by ledger ids only; deterministic
OOXML precedent; B11 constraint facts.

### Codex adversarial review — round 2 (2026-09-16, gpt-5.6-sol, base `b36b101a`)

Verdict NO-SHIP, four findings plus one unknown. Re-verified before folding in:

| # | Finding | Disposition |
|---|---|---|
| 1 | Lock-time roster check does not prove the generated document contains a review; inputs (roster, abstract) are mutable after generation | **Accepted with a product adjustment** → §3.4 step 2 + §3.4a: gate on the generation input snapshot (fail closed at zero), and treat later drift as an explicit, server-recorded staff acknowledgement rather than a forced regeneration, because regeneration discards Word edits (B9/B12). |
| 2 | Lock milestone not bound to distributed bytes; prepare captures whatever version is current | **Accepted** → §3.4b: prepare and send require version + hash equality with the milestone; Share always re-locks first. |
| 3 | §7 still carried a "newest by createdon" resolver instruction contradicting the pointer invariant | **Accepted** → wording replaced with pointer-target validation and fixtures. |
| 4 | `getWriteupRoster(requestId)` is the wrong argument shape | **Accepted** → `getWriteupRoster({ requestId })` at both references; positive lock test uses the real signature. |
| — | Owner template inspection not reproducible from the repo | **Accepted** → labelled `[OWNER FILE, not tracked]`; the tracked template plus a no-header renderer test become the evidence in slice 2. |
