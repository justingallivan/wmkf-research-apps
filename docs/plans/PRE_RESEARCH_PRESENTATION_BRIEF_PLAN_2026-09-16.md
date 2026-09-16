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
| B8 | Share gate | Share needs the brief only; a Pre-Site Word draft is no longer a prerequisite. |
| B9 | Editability | Staff edit the brief in Word as needed, including Issues. → the brief is a governed SharePoint document with a registry row (§3). |
| B10 | Zero reviews | Share is blocked until at least one review is received. |

### B11 — Share and the Site Visit transition (owner, 2026-09-16)

`[VERIFIED]` Today the Share button's pre-prepare hook calls
`POST /api/workbench/pre-site-visit/start-site-visit`, which moves the Pre-Site writeup from
Draft to Review lifecycle (`StaffDeliberationsTab.js:427-460`,
`site-visit-transition-service.js`). The owner's position: that share gate existed so the
shared version could be recorded in the writeup before the post-visit edits; it no longer makes
sense and should be **deprecated later**, not in this pass.

Constraint that keeps it alive for now `[VERIFIED via lib/services/final-writeup/transition-service.js:197]`:
Final Writeup creation requires the Pre-Site source row to be in **Review** lifecycle, and
the Share hook is the only caller that puts it there (`[VERIFIED]` the only other
`start-site-visit` callers are the route and the transition service itself). Dropping the
hook now would make Final Writeup creation unreachable.

This pass therefore: Share **requires** only a Ready brief and at least one received review
(B8, B10), locks the brief into Review, and **still fires** the existing Pre-Site transition
when a Ready Pre-Site draft exists, skipping it silently otherwise. Deprecating that coupling
is a follow-up with its own trigger design for the Final lineage; tracked in
`docs/CURRENT_WORK_QUEUE.md` when this plan ships.

### B12 — Regenerate after staff edits (owner, 2026-09-16)

Same rule as the Pre-Site writeup: Regenerate, behind the existing confirm dialog, creates a
fresh brief row and file and supersedes the prior row; staff edits are not merged and the
prior file remains in SharePoint.

## 2. Document contract

Template source: the owner's `Staff Briefing Template.docx` (Letter, 0.75" margins, Times New
Roman, no header/footer). `[VERIFIED]` by unzipping the file this session. Structure, in order:

| # | Block | Source | Token |
|---|---|---|---|
| 1 | Institution (centered, bold, 14 pt) | request `_akoya_applicantid_value_formatted`, Account name when resolvable | `[[DV:InstitutionName]]` |
| 2 | Title (centered) | `akoya_title` | `[[DV:ProjectTitle]]` |
| 3 | PI (centered) | `_wmkf_projectleader_value_formatted` (`[VERIFIED via proposal-core-service.js:288]`, the same source the Pre-Site writeup uses for the PI) | `[[DV:PrincipalInvestigator]]` |
| 4 | PD (centered) | `_wmkf_programdirector_value_formatted` | `[[DV:ProgramDirector]]` |
| 5 | Rule | template | — |
| 6 | **Abstract:** inline paragraph | `wmkf_abstract` (written in-app by the Reviews-tab abstract editor and the grantee abstract service) | `[[DV:Abstract]]` |
| 7 | **Referee Comments:** (Heading 1) + paragraph | `composeScoreSentence` + `composeReviewerSentence` over `getWriteupRoster(requestId)` reviewers with `reviewReceivedAt` | `[[STAFF:RefereeSentences]]` |
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

**No new request pointer.** `[VERIFIED]` The Pre-Site lineage relies on
`_wmkf_currentpresitevisit_value`; Consultant Feedback rows resolve by request + type with no
pointer. The brief follows the Consultant Feedback model: "current brief" = the newest
Ready row of type 100000009 for the request whose lifecycle is Draft or Review. Regenerate
supersedes the prior row (B12). This avoids a second Dataverse change.

**Registry row shape.** Same producer/operation-status/lifecycle vocabulary as Pre-Site:
`GENERATING → READY`, lifecycle `DRAFT` on generation, `REVIEW` once locked by Share.
Filename `Pre-RP-Brief_{Request#}_{generationKey8}.docx` in the request's active SharePoint
bucket via the existing upload path.

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

## 4. Surfaces

| Layer | Change |
|---|---|
| `shared/config/requestDocument.js` | new artifact type + label; brief contract constants (content type, template id/version, producer). |
| `lib/services/pre-rp-brief/` (new) | `input-service.js` (request header + abstract + roster → snapshot), `docx-renderer.js` (template fill), `artifact-service.js` (claim/generate/upload/commit, mirroring the Pre-Site lineage but without prompt/AI steps), `status` projection. |
| `pages/api/workbench/pre-rp-brief.js` (new) | GET status, POST generate/regenerate. Guards mirror `pages/api/workbench/pre-site-visit.js`; added to `docs/API_ROUTE_SECURITY_MATRIX.md` and the route-lifecycle map. |
| `lib/services/pre-site-visit/distribution-service.js` | `resolveSource`, `assertAttemptSourceCurrent`, history freshness, and the snapshot spec all read the current brief (§7); error copy says "brief". |
| `shared/components/workbench/StaffDeliberationsTab.js` + `shared/utils/deliberation-stage.js` | Stage derives from the brief's lifecycle (§7). Brief card: Generate / Regenerate / Download / Open in SharePoint; Share gated on a Ready brief and ≥1 received review; Site Visit transition per B11 (unchanged coupling when a Ready Pre-Site draft exists). The Pre-Site writeup card stays for staff. |
| `shared/components/workbench/PreSiteDistributionPanel.js` | `sourceArtifact` = brief; copy. |
| `lib/services/deliberation-briefing/briefing-page-service.js` | header comment and member label ("Staff brief" already; content now the brief). No route change. |
| Email copy | `shared/config/deliberationShareEmail.js` seed body/briefing copy reviewed for "writeup" wording; admin-editable values untouched. |

## 5. Slices

1. **Plumbing + config.** Option value script (owner runs `--execute`), config mirrors, schema
   record, Atlas page, writers-gate entry. Verify by re-read.
2. **Renderer + template.** Tracked `brief-v1.docx`, renderer, unit tests with the discriminating
   fixture (one reviewer / three reviewers / a reviewer without rank / abstract with line breaks).
3. **Artifact service + route.** Generate, regenerate-supersede, status projection, download URL.
   Tests mirror `pre-site-visit-artifact-service.test.js` minus prompt/AI paths.
4. **Distribution source swap.** `resolveSource` + snapshot type; `pre-site-distribution-service.test.js`
   and `deliberation-briefing-page-service.test.js` updated; briefing page proves it serves the brief.
5. **Staff Deliberations UI.** Brief card, share gate, B11 transition affordance;
   `pre-site-distribution-panel.test.js` and tab tests.
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
- The Pre-Site writeup, Site Visit transition, and Final Writeup lineage are untouched except
  for the Share coupling in B11.

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
- **LOW — "current brief" resolver must be an allowlist.** The distribution snapshot row will
  also carry type 100000009 (lifecycle `BOARD_READY`, producer
  `request-workbench-distribution-docx`). The resolver selects
  `operationstatus = READY AND lifecycle IN (DRAFT, REVIEW) AND !isPreSiteDistributionSnapshot(row)`
  and orders by `createdon desc`; anything else is not current. Test with a fixture that
  contains a snapshot row newer than the editable row.
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
