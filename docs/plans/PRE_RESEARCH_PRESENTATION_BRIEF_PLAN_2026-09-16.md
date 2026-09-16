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
| B10 | Zero reviews | Share is blocked until at least one review is received (enforced at prepare, §3.4b). |
| B13 | Content validation (2026-09-16, after Codex round 3) | **Trust staff edits.** The app never parses the brief for required headings or prose. The gate proves the generated document had at least one received review and reports input drift; staff own what they share, as with the Pre-Site writeup today. |

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
changeset. **Canonical-document** readers — distribution source, history freshness, the
editable-current card, the cycle list's current row — resolve the brief **through the pointer**
and fail closed when it is absent or does not resolve to a same-request, Ready, Draft/Review,
non-snapshot row. **Operation-attempt** readers are separate (Codex round 3, finding 3):
`[VERIFIED via lib/services/pre-site-visit/artifact-service.js:553-640]` the Pre-Site status
service returns the newest non-Ready, non-superseded row as `pendingArtifact` so polling and
retry can observe a Generating or Failed first attempt before any pointer exists, and
`[VERIFIED via cycle-list-service.js:172-190]` the cycle list has the same fallback for
generating/failed rows. The brief status service and cycle list keep exactly that split:
pointer for current, newest non-Ready for pending. Distribution never reads pending rows.

Plumbing total for this pass, both owner-run against Production: one picklist value and one
lookup field.

**Registry row shape.** Same producer/operation-status/lifecycle vocabulary as Pre-Site:
`GENERATING → READY`, lifecycle `DRAFT` on generation, `REVIEW` once locked by Share.
Filename `Pre-RP-Brief_{Request#}_{generationKey8}.docx` in the request's active SharePoint
bucket via the existing upload path.

**§3.4 Share lock (revised after Codex round 3).** Lock is a **one-time** lifecycle
transition, shaped exactly like the Pre-Site handoff
(`[VERIFIED via lib/services/pre-site-visit/site-visit-transition-service.js:249-278]` download
current bytes, governed hash, single ETag-fenced PATCH Draft → Review recording
`wmkf_milestoneversionid` / `wmkf_milestonecontenthash` / `wmkf_milestonecreatedat`).
`[VERIFIED via lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:215-235]`
those milestone fields are defined immutable, so lock never rewrites them; a second call on an
already-Review row is idempotent. New service + route
`POST /api/workbench/pre-rp-brief/lock-for-share` resolves the brief through the pointer
(fail closed otherwise). The lock carries **no** review gate: `[VERIFIED via
pages/api/workbench/pre-site-visit/distribution/prepare.js:31-47]` prepare is directly
callable after auth, so the gate must live where the shared artifact is created (§3.4b).

**§3.4a Input snapshot and fingerprint.** Generation stores a frozen input snapshot on the
brief row in the registry's write-once `wmkf_presiteinputsnapshotjson`
(`[VERIFIED via lib/services/pre-site-visit/artifact-service.js:1267]` that is where the
Pre-Site generator persists `inputSnapshotJson`; the field name is Pre-Site-specific but the
column is a generic JSON memo on the row — reusing it on type-100000009 rows avoids a third
Dataverse write. `[ASSUMED acceptable; owner may prefer a neutral field]`). The snapshot
carries every composer input (`[VERIFIED via reviewers-service.js:597-622` and
`review-writeup-paragraphs.js:222-240,322-342]`): request header fields, abstract, and per
received review the suggestion id, received state, name, academic rank, overall rating,
`reviewerAffiliation`, `mainInstitution`, and `affiliation`. A canonical fingerprint
(sorted, sha256) of that snapshot is derived at generation and recomputed from live data at
prepare.

**§3.4b Review gate, drift, and byte binding at prepare (replaces the round-2 lock design).**
`[VERIFIED via lib/db/migrations/034_pre_site_distribution_attempts.sql:9-13,185,199]` the
Postgres ledger already records `source_document_id`, `source_version_id`, and
`source_content_hash` per attempt; `[VERIFIED via distribution-service.js:697-730]` prepare
captures the exact current SharePoint version and hash; and `[VERIFIED via
distribution-service.js:1587-1607]` send re-reads metadata under the lease and refuses
`distribution_stale_source` unless `versionId` still equals the attempt's
`source_version_id`. So prepare → send is already bound to exact bytes; the briefing page
serves those bytes by the ledger's drive/item ids and re-hashes against `docx_byte_hash`
(`[VERIFIED via briefing-page-service.js:236-250,334-352]`). No re-lock is needed: sharing an
edited brief is simply a new prepare, whose preview is what staff confirm.

Prepare adds, for a brief source:

1. `resolveSource` requires the pointer target to be type 100000009, Ready, lifecycle Review,
   DOCX, with drive/item/folder identity (the same shape it already requires for Pre-Site,
   `[VERIFIED via distribution-service.js:641-654]`).
2. **Review gate (B10):** the row's snapshot must record at least one received review; else
   409 `brief_reviews_required` before any ledger write.
3. **Drift check:** recompute the live fingerprint. If it differs from the generated one,
   respond 409 `brief_inputs_stale` with `{ generatedFingerprint, liveFingerprint, delta }`
   and write nothing. A retry must carry `acknowledgeStaleInputs: <liveFingerprint>`; prepare
   recomputes the live fingerprint again and refuses 409 `brief_inputs_stale` with the new
   value if it no longer matches — acknowledgement is bound to the exact delta staff saw, never
   a bare `true`.
4. **Durable record:** new Postgres migration `052_pre_site_distribution_brief_inputs.sql`
   adds to `pre_site_distribution_attempts`: `input_fingerprint_generated TEXT`,
   `input_fingerprint_live TEXT`, `stale_inputs_delta JSONB`,
   `stale_inputs_acknowledged_at TIMESTAMPTZ`, `stale_inputs_acknowledged_by UUID`.
   Written on the attempt at prepare; surfaced in history and on the briefing-page staff
   surface as "shared with N newer review(s) acknowledged by …".

Tests: zero-review snapshot → 409, no row; one review → prepare succeeds; drift D1 → 409 with
fingerprint; retry echoing D1 while inputs moved to D2 → 409 with D2; retry echoing D2 →
succeeds and the ledger row carries actor, time, both fingerprints, delta; edit after prepare →
send refuses (existing test extended to the brief source).

**Writer registration.** `scripts/check-request-document-writers.js` lists every
`createDocument(` site; the new service is added to `WRITERS` (`[VERIFIED]` gate shape at
`:16-24`). `check:request-document-writers` and `check:atlas` must stay green.

**Distribution snapshot.** `[VERIFIED]` `ensureSnapshot` writes the pinned copy as a
`wmkf_requestdocument` row with `wmkf_artifacttype = PRE_SITE_VISIT`, producer
`request-workbench-distribution-docx`, lifecycle `BOARD_READY`
(`distribution-service.js:930-1108`), and the briefing page serves it purely from the latest
sent attempt's ledger fields `docx_drive_id` / `docx_item_id`, re-hashed against
`docx_byte_hash` (`briefing-page-service.js:236-250,334-352`; corrected after Codex round 3 —
it does not read `docx_snapshot_document_id`). Change: the snapshot row carries artifact type
100000009 and the source resolution (`resolveSource`, `:622-657`) reads the current brief
instead of the Pre-Site pointer. `isPreSiteDistributionSnapshot` (producer-based) keeps
excluding snapshots from the materials list without change.

**§3.5 Composite stage projection (revised after Codex round 1, finding 4).**
`[VERIFIED via shared/utils/deliberation-stage.js:99-119]` the helper derives `final` only when
the supplied artifact's lifecycle is FINAL, `shared` from Review, `draft` from null/Draft, and
any other lifecycle to `beyond` (fail closed); and
`[VERIFIED via lib/services/final-writeup/transition-service.js:653-669]` Final activation sets
the **Pre-Site** source row to FINAL while the brief would stay in Review. A brief-only input
could therefore never show Final. The helper takes a composite input:

| Stage | Source of truth |
|---|---|
| final | Pre-Site/Final lineage: current Pre-Site row lifecycle FINAL, or a current Final row |
| visit | Site Visit schedule in the past (unchanged `deriveVisit`) with the brief in Review |
| shared | brief lifecycle Review; `everSent` from the ledger keyed to the brief's row id (`[VERIFIED via distribution-store.js:68-99]` sent-state queries are per `source_document_id`). Codex round 3 finding 4 (a re-locked version showing as sent) was predicated on the re-lock design, which §3.4 removed; with one lock per row, "sent" means a version of this brief reached the Board, and the existing history freshness marker (`distribution-service.js:1925-1945`) already flags "working source advanced since" for edits after a send. Keep row keying; add the V1-sent → edit → history-shows-stale regression. |
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
| `pages/api/workbench/pre-rp-brief.js` + `pages/api/workbench/pre-rp-brief/lock-for-share.js` (new) | GET status, POST generate/regenerate; POST lock-for-share (§3.4, lifecycle only). Guards mirror `pages/api/workbench/pre-site-visit.js` and `start-site-visit.js`; both added to `docs/API_ROUTE_SECURITY_MATRIX.md`; covered by the `/api/workbench` lifecycle namespace. |
| `lib/services/pre-site-visit/distribution-service.js` + `distribution-store.js` + migration `052` | `resolveSource`, `assertAttemptSourceCurrent`, history freshness, and the snapshot spec all read the current brief (§7); prepare enforces the review gate, drift fingerprint, and bound acknowledgement (§3.4b) and records them on the attempt row; error copy says "brief". |
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
   projection, download URL; lock-for-share service + route (§3.4, lifecycle only).
   Tests mirror `pre-site-visit-artifact-service.test.js` and `site-visit-transition-service` tests
   minus prompt/AI paths.
4. **Distribution source swap + prepare gate.** `resolveSource` + snapshot type; migration 052;
   review gate, drift fingerprint, bound acknowledgement (§3.4b) with the listed tests; `pre-site-distribution-service.test.js`
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
- Two owner-run Production Dataverse schema writes (picklist value, pointer lookup) gate every
  smoke; the Postgres migration 052 applies through `node scripts/apply-migrations.js` as usual.

## 7. Contract-reconcile review (Mode A, 2026-09-16, S515)

Surface: new governed artifact type + generate route; distribution source swap; briefing-page
consumer. Persistence: Dataverse `wmkf_requestdocument` + SharePoint file + Postgres
`pre_site_distribution_attempts`. Consumers: Staff Deliberations tab, Share composer, briefing
page, Final Writeup lineage, reopen service, gates.

### Findings

1. **CONFIRMED — briefing page needs no route change.** Evidence:
   `briefing-page-service.js:236-250` builds the writeup member from the ledger attempt's
   `docx_drive_id/docx_item_id` (not `docx_snapshot_document_id`); `:334-352` downloads by those ids and re-hashes against
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

### Codex adversarial review — round 3 (2026-09-16, gpt-5.6-sol, base `b36b101a`)

Verdict NO-SHIP, four findings and four wording qualifications. Owner decisions taken: B13
(trust staff edits) and the lock/prepare simplification.

| # | Finding | Disposition |
|---|---|---|
| 1 | Snapshot cannot prove the edited DOCX still contains Referee Comments; fingerprint omitted name/rank/rating/institutions | **Content check declined by owner (B13)**; **fingerprint completeness accepted** → §3.4a covers every composer input. |
| 2 | Bare `acknowledgeStaleInputs: true` is replayable; milestone fields are immutable so per-Share re-lock had nowhere durable to record it | **Accepted, and the design simplified** → lock is one-time lifecycle only (§3.4); gate, drift, and fingerprint-bound acknowledgement move to prepare and persist on the Postgres attempt row via migration 052 (§3.4b). |
| 3 | Pointer-only reads hide Generating/Failed first attempts | **Accepted** → canonical via pointer, pending via newest non-Ready row, as the Pre-Site status service does (§3). |
| 4 | Row-keyed `everSent` would show a re-locked version as sent | **Moot after #2** (no re-lock); row keying kept with the existing history freshness marker; regression added (§3.5). |
| — | Wording: snapshot persisted at `:1267`; briefing page reads drive/item/hash; `resolveSource` checks more than Ready/Review; unknown lifecycle → `beyond` | **Accepted** → corrected in place. |
