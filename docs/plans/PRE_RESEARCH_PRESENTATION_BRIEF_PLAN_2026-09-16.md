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
| B14 | Drift acknowledgement display (2026-09-16, after Codex round 4) | **Staff history and a Board-visible summary.** The Workbench distribution history shows the bounded delta, actor, and time; the external briefing page also shows a non-sensitive notice that staff acknowledged newer inputs at share time (no names, prose, or counts beyond the bounded delta summary). |

### B11 — Share and the Site Visit transition (owner 2026-09-16; revised after Codex round 1)

`[VERIFIED via shared/components/workbench/StaffDeliberationsTab.js:423-459]` Today the Share button's pre-prepare hook calls
`POST /api/workbench/pre-site-visit/start-site-visit`, which moves the Pre-Site writeup from
Draft to Review lifecycle (`[VERIFIED via lib/services/pre-site-visit/site-visit-transition-service.js:173-201,249-299]`). The owner's position: that share gate existed so the
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
| 3 | PI (centered) | `_wmkf_projectleader_value_formatted` (`[VERIFIED via lib/services/pre-site-visit/proposal-core-service.js:138-145,288]`, the same source the Pre-Site writeup uses for the PI) | `[[DV:PrincipalInvestigator]]` |
| 4 | PD (centered) | `_wmkf_programdirector_value_formatted` | `[[DV:ProgramDirector]]` |
| 5 | Rule | template | — |
| 6 | **Abstract:** inline paragraph | `wmkf_abstract` (written in-app by the Reviews-tab abstract editor and the grantee abstract service) | `[[DV:Abstract]]` |
| 7 | **Referee Comments:** (Heading 1) + paragraph | `composeScoreSentence` + `composeReviewerSentence` over `getWriteupRoster({ requestId })` reviewers with `reviewReceivedAt` (`[VERIFIED via lib/services/review-manager/reviewers-service.js:577-590]` object parameter; the Pre-Site caller adapts it at `lib/services/pre-site-visit/proposal-core-service.js:93-98`) | `[[STAFF:RefereeSentences]]` |
| 8 | **Issues to be Addressed at the Research Presentation:** | empty | — |

`[VERIFIED via shared/utils/review-writeup-paragraphs.js:253-357]` `composeReviewerSentence` already renders "Name, a professor at Institution;
…; and …" from `academicRank`, and returns underline runs for the name; `composeScoreSentence`
renders "We received three reviews with scores of one Excellent and two Very Good."
The brief uses those two sentences only,
not the expertise sentence, themes, or quotations.

Rendering is deterministic: no model call, no prompt registry entry. The renderer is a
template-preserving OOXML placeholder fill in the same style as
`lib/services/pre-site-visit/docx-renderer.js` (`[VERIFIED via lib/services/pre-site-visit/docx-renderer.js:362-371]` replacement-map pattern), against a tracked template
`shared/templates/pre-research-presentation-brief/brief-v1.docx` derived from the owner's file
with the sample text replaced by tokens and the header parts removed.

## 3. Persistence and Dataverse plumbing

**New artifact type.** `wmkf_requestdocument.wmkf_artifacttype` gains
`Pre-Research Presentation Brief = 100000009`. `[VERIFIED via scripts/extend-requestdocument-artifacttype.mjs:1-16,30-67; shared/config/requestDocument.js:10-32; lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:23-33]` Precedent: Consultant Feedback
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
`zz_akoya_request_initial_assessment_pointer.json` (`[VERIFIED via lib/dataverse/schema/wave16-request-document-registry/zz_akoya_request_initial_assessment_pointer.json:1-14]` kind `extensions-on-existing`, lookup `wmkf_CurrentInitialAssessment`). Activation reuses the Pre-Site pattern
(`[VERIFIED via lib/services/pre-site-visit/artifact-service.js:945-1009]`): supersede every
other active row, ready the target, and move the pointer, each under its own ETag, in one
changeset. **Canonical-document** readers — distribution source, history freshness, the
editable-current card, the cycle list's current row — resolve the brief **through the pointer**
and fail closed when it is absent or does not resolve to a same-request, Ready, Draft/Review,
non-snapshot row. **Operation-attempt** readers are separate (Codex round 3, finding 3):
`[VERIFIED via lib/services/pre-site-visit/artifact-service.js:553-640]` the Pre-Site status
service returns the newest non-Ready, non-superseded row as `pendingArtifact` so polling and
retry can observe a Generating or Failed first attempt before any pointer exists (when a current
pointer exists, the pending row must also postdate it). The cycle list is not an exact precedent:
`[VERIFIED via lib/services/pre-site-visit/cycle-list-service.js:172-190]` it currently falls
back to `rows[0]` without excluding Ready rows when the pointer is absent. The brief status
service and revised cycle list enforce the intended split: pointer for current, newest non-Ready
for pending, and a Ready row with no valid pointer is a reconciliation error: the status route
returns it as `brief_pointer_invalid` and the cycle list renders that request as an explicit
"needs reconciliation" row rather than omitting it (a dashboard that silently drops a request is
the wrong failure mode). Distribution never reads pending rows.

Plumbing total for this pass, both owner-run against Production: one picklist value and one
lookup field.

**Registry row shape.** Same producer/operation-status/lifecycle vocabulary as Pre-Site:
`GENERATING → READY`, lifecycle `DRAFT` on generation, `REVIEW` once locked by Share.
Filename `Pre-RP-Brief_{Request#}_{generationKey8}.docx` in the request's active SharePoint
bucket via the existing upload path.

**§3.4 Share lock (revised after Codex round 3).** Lock is a **one-time** lifecycle
transition, shaped exactly like the Pre-Site handoff
(`[VERIFIED via lib/services/pre-site-visit/site-visit-transition-service.js:192-201,249-299]`:
an already-Review row returns before any write; otherwise the service downloads current bytes,
computes the governed hash, and performs one ETag-fenced PATCH from Draft to Review recording
`wmkf_milestoneversionid` / `wmkf_milestonecontenthash` / `wmkf_milestonecreatedat`). The schema
descriptions call those milestone values immutable (`[VERIFIED via
lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:215-235]`), but
the enforcing mechanism is the lifecycle early return, not a Dataverse immutability constraint.
The brief lock must preserve that same guard, require a complete milestone on the idempotent
Review path, and never rewrite the milestone fields. New service + route
`POST /api/workbench/pre-rp-brief/lock-for-share` resolves the brief through the pointer
(fail closed otherwise). The lock carries **no** review gate: `[VERIFIED via
pages/api/workbench/pre-site-visit/distribution/prepare.js:31-47]` prepare is directly
callable after auth, so the gate must live where the shared artifact is created (§3.4b).

**§3.4a Input snapshot and fingerprint.** Generation stores a frozen input snapshot on the
brief row in the registry's write-once `wmkf_presiteinputsnapshotjson`
(`[VERIFIED via lib/services/pre-site-visit/artifact-service.js:1267]` that is where the
Pre-Site generator persists `inputSnapshotJson`). The field is explicitly named and described
as a Pre-Site snapshot, not a generic memo (`[VERIFIED via
lib/dataverse/schema/wave19-pre-site-draft/01_wmkf_requestdocument_pre_site_draft.json:70-76]`).
Reuse on type-100000009 rows is nevertheless safe from current shape-assuming readers:
`[VERIFIED via lib/services/pre-site-visit/artifact-service.js:290-305,448-459,565-581]` the
projection path asserts/filters `PRE_SITE_VISIT` before parsing, and `[VERIFIED via
lib/services/pre-site-visit/artifact-service.js:365-389,782-807]` the only runtime parsers live
behind that path or the Pre-Site generator. Keep the reuse and give the brief snapshot its own
envelope, for example `{ schemaVersion: 1, artifactType: 'pre-rp-brief', request, reviews }`, so
its shape is self-describing; no neutral field is added
in this pass, preserving the settled two-write Dataverse plumbing. The snapshot carries every
composer input (`[VERIFIED via lib/services/review-manager/reviewers-service.js:597-622;
shared/utils/review-writeup-paragraphs.js:182-184,222-240,322-342]`): request header fields,
abstract, and, for each received review, the suggestion id, received state, name, academic rank,
overall rating,
`reviewerAffiliation`, `mainInstitution`, and `affiliation`. A canonical fingerprint
(stable object keys; reviews in the roster's `compareReviewersByName` order; sha256) of that
snapshot is written to `wmkf_inputfingerprint` with the JSON (`[VERIFIED via
lib/services/pre-site-visit/artifact-service.js:1136-1143,1193-1200]` Pre-Site persists the same
snapshot/fingerprint pairing; `[VERIFIED via
lib/services/review-manager/reviewers-service.js:640-650]` the writeup roster already matches the
Reviews-tab tie order). Prepare first re-hashes the stored snapshot and requires it to equal the
row fingerprint, then recomputes the live snapshot/fingerprint; a malformed envelope
or mismatch fails closed as `brief_snapshot_invalid` before the review/drift decision.

**§3.4b Review gate, drift, and byte binding at prepare (replaces the round-2 lock design).**
`[VERIFIED via lib/db/migrations/034_pre_site_distribution_attempts.sql:9-13,185,198-199]` the
Postgres ledger already records `source_document_id`, `source_version_id`, and
`source_content_hash` per attempt; `[VERIFIED via lib/services/pre-site-visit/distribution-service.js:697-730]` prepare
captures the exact current SharePoint version and hash; and `[VERIFIED via
lib/services/pre-site-visit/distribution-service.js:1587-1607]` send re-reads metadata under the lease and refuses
`distribution_stale_source` unless `versionId` still equals the attempt's
`source_version_id`. So prepare → send is already bound to exact bytes; the briefing page
serves those bytes by the ledger's drive/item ids and re-hashes against `docx_byte_hash`
(`[VERIFIED via lib/services/deliberation-briefing/briefing-page-service.js:240-250,330-352]`). No re-lock is needed: sharing an
edited brief is simply a new prepare, whose preview is what staff confirm.

Prepare adds, for a brief source. The gate runs immediately after `resolveSource` and the
read-only live-input load, before material/calendar resolution, briefing-link minting,
`createOrGetAttempt`, snapshot creation, or any other write (`[VERIFIED via
lib/services/pre-site-visit/distribution-service.js:1235-1249,1283-1315]` those side effects and
the operation-id reuse point currently follow source resolution):

1. `resolveSource` requires the pointer target to be type 100000009, Ready, lifecycle Review,
   DOCX, with drive/item/folder identity (the same shape it already requires for Pre-Site,
   `[VERIFIED via lib/services/pre-site-visit/distribution-service.js:639-654]`).
2. **Review gate (B10):** the row's snapshot must record at least one received review; else
   409 `brief_reviews_required` before any ledger write.
3. **Drift check:** recompute the live fingerprint. If it differs from the generated one,
   respond 409 `brief_inputs_stale` with `{ generatedFingerprint, liveFingerprint, delta }`
   and write nothing. A retry must carry `acknowledgeStaleInputs: <liveFingerprint>`; prepare
   recomputes the live fingerprint again and refuses 409 `brief_inputs_stale` with the new
   value if it no longer matches — acknowledgement is bound to the exact delta staff saw, never
   a bare `true`.
4. **Bound exact-preview identity:** `pages/api/workbench/pre-site-visit/distribution/prepare.js`
   adds `acknowledgeStaleInputs` to its body allowlist (`[VERIFIED via
   pages/api/workbench/pre-site-visit/distribution/prepare.js:12-16]` it would otherwise reject
   the retry). Add generated/live fingerprints, the canonical bounded delta, and the acknowledged
   live fingerprint to `draftHash` and `previewHash` (`[VERIFIED via
   lib/services/pre-site-visit/distribution-service.js:1262-1314,1403-1446]` these are the
   operation-id conflict and exact-preview identities). A lost-response retry with the same
   operation id and acknowledgement therefore reuses the same attempt; a changed acknowledgement
   conflicts, and a newly changed live fingerprint returns a fresh 409 before reuse. Keep
   `ensureSnapshot` keyed only to exact source bytes (`[VERIFIED via
   lib/services/pre-site-visit/distribution-service.js:930-948]`): acknowledgement changes do not
   create duplicate frozen files. `assertAttemptSourceCurrent` remains the send-time source-byte
   guard; per B13, send does not add a second live-input gate.
5. **Durable record:** new Postgres migration `052_pre_site_distribution_brief_inputs.sql`
   adds to `pre_site_distribution_attempts`: `input_fingerprint_generated CHAR(64)`,
   `input_fingerprint_live CHAR(64)`, `stale_inputs_delta JSONB`,
   `stale_inputs_acknowledged_at TIMESTAMPTZ`, `stale_inputs_acknowledged_by UUID`.
   The migration adds a lowercase-hex fingerprint CHECK and a coherence CHECK: legacy rows may
   leave all five columns null; a brief attempt has both fingerprints; no-drift rows have equal
   fingerprints with null delta/acknowledgement; acknowledged drift has unequal fingerprints,
   an object delta, and both acknowledgement fields. `[VERIFIED via
   lib/db/migrations/034_pre_site_distribution_attempts.sql:79-119;
   lib/db/migrations/035_site_visit_logistics.sql:20-37]` the current hash/prepared constraints
   neither cover nor conflict with these nullable columns. `createOrGetDistributionAttempt`
   inserts the five values atomically with the attempt (`[VERIFIED via
   lib/services/pre-site-visit/distribution-store.js:12-46]` current insert/reuse seam). The
   delta is a bounded audit DTO (changed request-field names, `abstractChanged`, and reviewer
   suggestion IDs/counts only), never copied abstract/reviewer prose or names. Project the audit
   fields through the service boundary needed by the owner-selected display option; the render
   scope (staff history, external briefing, or ledger only) is open in §7.

Tests: malformed snapshot or stored-fingerprint mismatch → 409 before side effects; zero-review
snapshot → 409 before link mint/ledger/snapshot writes; one review → prepare
succeeds; drift D1 → 409 with fingerprint and bounded delta; retry echoing D1 while inputs moved
to D2 → 409 with D2; retry echoing D2 → succeeds and the ledger row carries actor, time, both
fingerprints, delta; same operation id + same D2 recovers the prepared attempt; same operation id
with a different acknowledgement conflicts; `draftHash` and `previewHash` change when the acknowledged
fingerprint changes; edit after prepare → send refuses (existing test extended to the brief
source). Migration tests cover legacy-all-null, equal/no-ack, valid acknowledged drift, malformed
hash, half-acknowledged, and delta-without-drift rows.

**Writer registration.** `scripts/check-request-document-writers.js` lists every
`createDocument(` site; the new service is added to `WRITERS` (`[VERIFIED via
scripts/check-request-document-writers.js:16-24]` gate shape). `check:request-document-writers`
and `check:atlas` must stay green.

**Distribution snapshot.** `[VERIFIED via lib/services/pre-site-visit/distribution-service.js:930-1107]` `ensureSnapshot` writes the pinned copy as a
`wmkf_requestdocument` row with `wmkf_artifacttype = PRE_SITE_VISIT`, producer
`request-workbench-distribution-docx`, lifecycle `BOARD_READY`
(`[VERIFIED via lib/services/pre-site-visit/distribution-service.js:930-1107]`), and the briefing page serves it purely from the latest
sent attempt's ledger fields `docx_drive_id` / `docx_item_id`, re-hashed against
`docx_byte_hash` (`[VERIFIED via lib/services/deliberation-briefing/briefing-page-service.js:240-250,330-352]`; corrected after Codex round 3 —
it does not read `docx_snapshot_document_id`). Change: the snapshot row carries artifact type
100000009 and the source resolution (`[VERIFIED via
lib/services/pre-site-visit/distribution-service.js:622-656]`) reads the current brief instead
of the Pre-Site pointer. The snapshot basename changes from `PreSite_…` to `PreRPBrief_…`
(`[VERIFIED via lib/services/pre-site-visit/distribution-service.js:1333-1370]` current naming),
while the producer stays stable so `isPreSiteDistributionSnapshot` continues to exclude both
DOCX and PDF snapshots without an artifact-type assumption (`[VERIFIED via
shared/config/requestDocument.js:95-104]`).

**§3.5 Composite stage projection (revised after Codex round 1, finding 4).**
`[VERIFIED via shared/utils/deliberation-stage.js:93-123]` the helper derives `final` only when
the supplied artifact's lifecycle is FINAL, `shared` from Review, `draft` from null/Draft, and
any other lifecycle to `beyond` (fail closed); and
`[VERIFIED via lib/services/final-writeup/transition-service.js:653-669]` Final activation sets
the **Pre-Site** source row to FINAL while the brief would stay in Review. A brief-only input
could therefore never show Final. Change the helper contract to take
`{ stageArtifact, finalReached, siteVisitStartIso, everSent }`: `finalReached` has first
precedence; otherwise the existing Review/Draft/unknown-lifecycle logic applies to
`stageArtifact`. Both callers derive `finalReached` from the canonical Pre-Site row lifecycle
being FINAL. Under B11 every reachable Final has that Pre-Site source, so do not add a separate
Final-row query.

| Stage | Source of truth |
|---|---|
| final | Canonical Pre-Site row lifecycle FINAL (`finalReached = true`) |
| visit | Site Visit schedule in the past (unchanged `deriveVisit`) with the brief in Review |
| shared | brief lifecycle Review; `everSent` from the ledger keyed to the brief's row id (`[VERIFIED via lib/services/pre-site-visit/distribution-store.js:68-99]` sent-state queries are per `source_document_id`). Codex round 3 finding 4 (a re-locked version showing as sent) was predicated on the re-lock design, which §3.4 removed; with one lock per row, "sent" means a version of this brief reached the Board, and the existing history freshness marker (`[VERIFIED via lib/services/pre-site-visit/distribution-service.js:1925-1976]`) already flags "working source advanced since" for edits after a send. Keep row keying; add the V1-sent → edit → history-shows-stale regression. |
| draft | brief absent or Draft; substate from the brief's operation status |
| beyond | any other lifecycle on the brief (fail closed, unchanged) |

For each request, `stageArtifact` is the canonical brief pointer target, else the newest
non-Ready/non-superseded brief pending attempt, else (legacy only) the canonical/pending Pre-Site
artifact. A missing/invalid brief pointer never falls back to a Ready row chosen by recency.
Legacy requests with a Pre-Site row and no brief keep today's derivation from the Pre-Site row,
so historical rails do not change. The Staff Deliberations tab maintains separate brief and
Pre-Site status state; the cycle list unions both artifact-type queries, validates both request
pointers, includes the union of their request ids, and keys `everSent` to the chosen brief id (or
the legacy Pre-Site id). Unit cases: brief-only Draft; brief-only Review sent; generating/failed
brief before any pointer; invalid/missing brief pointer with a Ready brief (status 409, cycle list shows a reconciliation row); legacy
Pre-Site no brief; Final started while the brief stays Review; both rails (tab and cycle list).

## 4. Surfaces

[RECHECKED after lib/services/pre-rp-brief/input-service.js change: slices 1-3 built on claude/pre-rp-brief through commit 4bc38700; the §2-§4 rows naming this file describe built code under Opus review, not plan intent]
[RECHECKED after lib/services/pre-rp-brief/artifact-service.js change: slices 1-3 built on claude/pre-rp-brief through commit 4bc38700; the §2-§4 rows naming this file describe built code under Opus review, not plan intent]
[RECHECKED after lib/services/pre-rp-brief/share-lock-service.js change: slices 1-3 built on claude/pre-rp-brief through commit 4bc38700; the §2-§4 rows naming this file describe built code under Opus review, not plan intent]
[RECHECKED after lib/services/pre-rp-brief/docx-renderer.js change: slices 1-3 built on claude/pre-rp-brief through commit 4bc38700; the §2-§4 rows naming this file describe built code under Opus review, not plan intent]
[RECHECKED after pages/api/workbench/pre-rp-brief.js change: slices 1-3 built on claude/pre-rp-brief through commit 4bc38700; the §2-§4 rows naming this file describe built code under Opus review, not plan intent]
[RECHECKED after pages/api/workbench/pre-rp-brief/lock-for-share.js change: slices 1-3 built on claude/pre-rp-brief through commit 4bc38700; the §2-§4 rows naming this file describe built code under Opus review, not plan intent]
[RECHECKED after scripts/check-request-document-writers.js change: slices 1-3 built on claude/pre-rp-brief through commit 4bc38700; the §2-§4 rows naming this file describe built code under Opus review, not plan intent]
[RECHECKED after scripts/setup-database.js change: slice 4 in progress on claude/pre-rp-brief (distribution source swap, prepare gate, migration 052); the §3.4b/§4 rows naming this file describe code being built, pending Opus review]
[RECHECKED after lib/services/pre-site-visit/distribution-store.js change: slice 4 in progress on claude/pre-rp-brief (distribution source swap, prepare gate, migration 052); the §3.4b/§4 rows naming this file describe code being built, pending Opus review]
[RECHECKED after lib/services/pre-site-visit/distribution-service.js change: slice 4 in progress on claude/pre-rp-brief (distribution source swap, prepare gate, migration 052); the §3.4b/§4 rows naming this file describe code being built, pending Opus review]
[RECHECKED after lib/db/migrations-manifest.json change: slice 4 in progress on claude/pre-rp-brief (distribution source swap, prepare gate, migration 052); the §3.4b/§4 rows naming this file describe code being built, pending Opus review]
[RECHECKED after pages/api/workbench/pre-site-visit/distribution/prepare.js change: slice 4 in progress on claude/pre-rp-brief (distribution source swap, prepare gate, migration 052); the §3.4b/§4 rows naming this file describe code being built, pending Opus review]
[RECHECKED after lib/services/deliberation-briefing/briefing-page-service.js change: slice 4 in progress on claude/pre-rp-brief (distribution source swap, prepare gate, migration 052); the §3.4b/§4 rows naming this file describe code being built, pending Opus review]

| Layer | Change |
|---|---|
| `shared/config/requestDocument.js` | new artifact type + label; brief contract constants (content type, template id/version, producer). |
| `lib/services/pre-rp-brief/` (new) | `input-service.js` (request header + abstract + roster → snapshot), `docx-renderer.js` (template fill), `artifact-service.js` (claim/generate/upload/commit, mirroring the Pre-Site lineage but without prompt/AI steps), `status` projection. |
| `pages/api/workbench/pre-rp-brief.js` + `pages/api/workbench/pre-rp-brief/lock-for-share.js` (new) | GET status, POST generate/regenerate; POST lock-for-share (§3.4, lifecycle only). Guards mirror `pages/api/workbench/pre-site-visit.js` and `start-site-visit.js`; both added to `docs/API_ROUTE_SECURITY_MATRIX.md`; covered by the `/api/workbench` lifecycle namespace. |
| `lib/services/pre-site-visit/distribution-service.js` + `distribution-store.js` + `pages/api/workbench/pre-site-visit/distribution/prepare.js` | `resolveSource`, `assertAttemptSourceCurrent`, history freshness, and the snapshot spec all read the current brief (§7); prepare runs the read-only gate before side effects, binds the audit tuple into both exact-preview hashes, accepts only fingerprint-valued acknowledgement, records it on the attempt row, and exposes only the projection selected in §7; error copy says "brief". |
| `lib/db/migrations/052_pre_site_distribution_brief_inputs.sql` + `lib/db/migrations-manifest.json` + `scripts/setup-database.js` | Add the five nullable audit columns and coherence/hash constraints to existing databases and the identical fresh-install shape. `[VERIFIED via lib/db/migrations-manifest.json:25-53; scripts/setup-database.js:729-881]` both durable schema surfaces exist today and must move together. |
| `shared/components/workbench/StaffDeliberationsTab.js` | Maintain separate brief and Pre-Site status. Brief card: Generate / Regenerate / Download / Open in SharePoint; Share's pre-prepare hook calls `lock-for-share` (§3.4) and never `start-site-visit`. Pre-Site card gains an explicit **Start Site Visit** action (B11). Final Writeup card copy names the Site Visit prerequisite. |
| `shared/utils/deliberation-stage.js` + `lib/services/pre-site-visit/cycle-list-service.js` | Composite stage projection (§3.5) for both callers (`[VERIFIED via shared/components/workbench/StaffDeliberationsTab.js:405-409; lib/services/pre-site-visit/cycle-list-service.js:92-96]`). The cycle list unions brief and Pre-Site rows, validates their pointers, includes brief-only requests, keeps legacy no-brief requests, supplies `finalReached` from the Pre-Site row, and keys `everSent` to the selected stage source id. |
| `shared/components/workbench/PreSiteDistributionPanel.js` | `sourceArtifact` = brief; copy; handle `brief_inputs_stale` as a dedicated confirmation state that renders the bounded delta and retries only with `acknowledgeStaleInputs: liveFingerprint`. Clear the acknowledgement whenever request, source id, form, or returned live fingerprint changes. `[VERIFIED via shared/components/workbench/PreSiteDistributionPanel.js:433-475]` the current prepare path treats every non-OK response as a generic error and cannot perform this retry. |
| `lib/services/deliberation-briefing/briefing-page-service.js` | header comment and member label ("Staff brief" already; content now the brief). No route change. |
| Email copy | `shared/config/deliberationShareEmail.js` seed body/briefing copy reviewed for "writeup" wording; admin-editable values untouched. |

## 5. Slices

1. **Plumbing + config.** Parameterised picklist script and a pointer-field script (owner runs each
   `--execute`), config mirrors, two schema records, Atlas pages (request + requestdocument),
   writers-gate entry. Verify by re-read. The brief row persists `wmkf_cyclecode`, required for
   the cycle list's `findByCycle` union (`[VERIFIED via
   lib/dataverse/adapters/request-document.js:180-189]` the query filters on that field).
2. **Renderer + template.** Tracked `brief-v1.docx`, renderer, unit tests with the discriminating
   fixture (one reviewer / three reviewers / a reviewer without rank / abstract with line breaks).
3. **Artifact service + routes.** Generate, regenerate-supersede with pointer activation, status
   projection, download URL; lock-for-share service + route (§3.4, lifecycle only).
   Tests mirror `pre-site-visit-artifact-service.test.js` and `site-visit-transition-service` tests
   minus prompt/AI paths.
4. **Distribution source swap + prepare gate.** `resolveSource` + snapshot type/name; migration
   052 + manifest + fresh-install schema; route allowlist; early review/drift gate; both hash
   bindings; store insert and owner-selected projection; bounded delta and bound acknowledgement (§3.4b) with the
   listed tests; `pre-site-distribution-service.test.js` and
   `deliberation-briefing-page-service.test.js` updated; briefing page proves it serves the brief.
5. **Staff Deliberations UI + stage.** Brief card, Share → lock-for-share, explicit Start Site
   Visit action, dedicated drift-confirmation/retry UI, composite stage projection in both callers,
   separate brief/Pre-Site state, cycle-list union and pointer validation, and the owner-selected
   post-send audit display (if any);
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
- **LOW — two new API route files shift counted surfaces.** `check:api-routes` needs both matrix rows;
  `check:fact-consistency` may pin the route count in `CANONICAL_COUNTS` — run both after
  adding the routes. `/api/workbench` is already a `ROUTE_NAMESPACE_LIFECYCLE` namespace
  (`shared/config/appRegistry.js:350`), so `check:route-lifecycle-auth` covers the new files once their guards
  match the namespace's `guardAppKeys`.
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
| 2 | Lock milestone not bound to distributed bytes; prepare captures whatever version is current | **Superseded by round 3 and B13** → the lock is one-time; each prepare captures and previews the then-current edited bytes, and send stays bound to that attempt's source version (§3.4b). |
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

### Codex adversarial review — round 4 (rescue, gpt-5.6-sol)

Verdict **READY WITH ONE OWNER DISPLAY DECISION**. The executable contract defects found in this
pass are fixed in §§3.4-3.5 and §§4-5. The owner choice below does not change persistence, prepare,
or send semantics, but must be resolved before the history/briefing display portion of slice 5.

| # | Finding and live evidence | Disconfirming check | Affected `[VERIFIED]` claims | Disposition |
|---|---|---|---|---|
| 1 | **HIGH — fingerprint acknowledgement was outside the exact-preview identity and rejected at the route.** The route allowlist omits the field (`pages/api/workbench/pre-site-visit/distribution/prepare.js:12-16`); `draftHash` and operation-id reuse are fixed before source capture (`lib/services/pre-site-visit/distribution-service.js:1262-1315`); `previewHash` also omitted it (`lib/services/pre-site-visit/distribution-service.js:1403-1446`); the store insert had no audit tuple (`lib/services/pre-site-visit/distribution-store.js:12-46`). | Refuted if the current allowlist, both hashes, and insert already carried the fingerprint/delta/acknowledgement tuple, and a same-operation/different-ack test conflicted. They do not. | Exact source capture, send-time version refusal, and briefing-page byte re-hash **hold**. The proposed fingerprint-bound retry did not. | **Fixed in place** in §3.4b steps 4-5, §4, and slice 4; added lost-response, changed-ack, and hash-binding tests. |
| 2 | **HIGH — gate ordering could create side effects before returning the promised no-write 409.** Current prepare resolves materials/calendar and mints the briefing link after `resolveSource` but before `createOrGetAttempt` (`lib/services/pre-site-visit/distribution-service.js:1235-1249,1283-1304`). | Refuted if every write-capable dependency followed the review/drift decision. No such gate exists today. | The directly callable prepare-route claim **holds**; “write nothing” needed a stronger placement contract. | **Fixed in place** in §3.4b: read-only input load and gate now precede link mint, ledger, and snapshots, with negative side-effect tests. |
| 3 | **MEDIUM — migration 052 needed its own integrity checks and all durable schema surfaces.** Existing hash/prepared checks do not mention the new fields (`lib/db/migrations/034_pre_site_distribution_attempts.sql:79-119`; current hash replacement at `lib/db/migrations/035_site_visit_logistics.sql:20-37`); fresh installs define this table separately (`scripts/setup-database.js:729-881`); the manifest currently ends at 051 (`lib/db/migrations-manifest.json:25-53`). | Refuted if the proposed migration specified fingerprint/coherence checks and the fresh-install + manifest edits. It did not. | The claim that the five nullable columns do not conflict with existing checks **holds**; durability/completeness did not. | **Fixed in place** in §3.4b, §4, and slice 4: `CHAR(64)`, coherence checks, migration tests, manifest, and fresh-install shape. |
| 4 | **MEDIUM — the stale-input acknowledgement had no client flow.** The current panel turns every prepare failure into a generic error and generates the operation id inside that request (`shared/components/workbench/PreSiteDistributionPanel.js:433-475`). | Refuted if the panel handled `brief_inputs_stale`, rendered the returned delta, and retried with the returned fingerprint. It does not. | No cited present-state claim was refuted. | **Fixed in place** in §4 and slice 5 with dedicated confirmation state, invalidation rules, and UI tests. |
| 5 | **MEDIUM — the stage contract and cycle fallback were still unsafe/underspecified.** The helper accepts one artifact only (`shared/utils/deliberation-stage.js:93-123`); both callers pass one (`shared/components/workbench/StaffDeliberationsTab.js:405-409`; `lib/services/pre-site-visit/cycle-list-service.js:92-96`); the cycle list falls back to `rows[0]` without excluding Ready (`lib/services/pre-site-visit/cycle-list-service.js:172-190`). Final activation reliably marks the Pre-Site source FINAL (`lib/services/final-writeup/transition-service.js:653-669`). | Refuted if the helper already accepted a separate final signal and the cycle fallback excluded Ready rows. It does not. | Helper lifecycle behavior, both-caller count, and Final activation **hold**. The earlier “same pending fallback” claim **did not hold** and is corrected. | **Fixed in place** in §3 pointer wording, §3.5, §4, and slice 5: `stageArtifact` + `finalReached`, two-source caller state, cycle union/pointer validation, no separate Final query. |
| 6 | **LOW — the plan mistook descriptive immutability for enforcement.** The schema descriptions call milestone values immutable (`lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:215-235`), while the actual one-time guard is the Review early return (`lib/services/pre-site-visit/site-visit-transition-service.js:192-201`) before the ETag-fenced patch (`lib/services/pre-site-visit/site-visit-transition-service.js:249-299`). | Refuted by a Dataverse immutability constraint or adapter update guard on the milestone fields. Neither exists in the cited live path. | The one-time/idempotent transition **holds**; the claimed enforcement mechanism did not. | **Fixed in place** in §3.4 with the real guard and a complete-milestone requirement. |
| 7 | **LOW — the reused snapshot column is semantically Pre-Site-specific, but has no current reader collision.** Its schema label/description are explicit (`lib/dataverse/schema/wave19-pre-site-draft/01_wmkf_requestdocument_pre_site_draft.json:70-76`); projections assert/filter Pre-Site before parsing (`lib/services/pre-site-visit/artifact-service.js:290-305,448-459,565-581`), and the parsers are at `lib/services/pre-site-visit/artifact-service.js:365-389,782-807`. | Refuted by any raw-field reader that parses a type-100000009 row without an artifact gate. The raw-field fan-out found none. | The old “generic JSON memo” wording **did not hold**; safe reuse **does hold**. | **Fixed in place** in §3.4a: truthful schema wording and a self-describing brief envelope; no third Dataverse field. |
| 8 | **No defect — pointer activation transfers cleanly when specialized, and Download needs no new route.** The pointer schema record supports a sibling N:1 lookup (`lib/dataverse/schema/wave16-request-document-registry/zz_akoya_request_initial_assessment_pointer.json:1-14`); activation supersedes, readies, and moves the pointer under ETags in one changeset (`lib/services/pre-site-visit/artifact-service.js:932-1009`). Download is derived from the governed `webUrl` (`shared/components/workbench/StaffDeliberationsTab.js:95-104,383,579`). | Refuted if the changeset lacked a request-pointer PATCH/ETags, or Download crossed a type-bound API route. Neither is true. | Pointer-pattern and existing-download claims **hold**. | **No change needed**; retain specialized type/producer/pointer validation and the status-projected SharePoint URL. |

Round 4 audits: whole-flow traced tab → status/generate/lock → prepare → ledger/snapshots → send
→ staff history/external briefing. Partial-success is N/A for the single-source prepare, while
operation-id lost-response recovery is covered explicitly. Async/stale-state adds acknowledgement
invalidation on request/source/form/fingerprint change. Helper extraction preserves lifecycle
semantics while adding only `finalReached`. Durable-surface covers migration, manifest,
fresh-install schema, route matrix/count gates, Atlas, and writer registration. Doc-reconcile via
`/sweep` is N/A in this pass because the owner explicitly restricted edits to this plan; slice 6
retains the later reconcile. Symbol fan-out covered `wmkf_presiteinputsnapshotjson`, the two stage
callers, the pointer readers, and every distribution source seam named above.

### Open for owner (Codex round 4) — resolved 2026-09-16

**Decision B14: Board-visible summary too.** Staff history renders the bounded delta, actor, and
time; the external briefing context gains a non-sensitive `staffAcknowledgedNewerInputs`
notice (boolean plus acknowledged-at) projected through `buildBriefingContext`
(`[VERIFIED via lib/services/deliberation-briefing/briefing-page-service.js:280]`) and rendered
on the Board page. The delta itself, reviewer identities, and abstract text are never sent to
the external surface. Slice 5 carries both renderings; `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`
§2.1 gains the new member in slice 6.

### Codex adversarial review — follow-ups round 1 (2026-09-16, gpt-5.6-sol, base `de349928`, commit `a0056014`)

Verdict needs-attention, five findings, all accepted and fixed in the next commit on
`claude/pre-rp-brief-followups`:

1. **[high] Pre-Site replay guard bypassed by FAILED/expired claims and concurrent activation.**
   Fixed: `generatePreSiteVisitArtifact` captures the pointer observed before any claim
   (`expectedPointerId`); a non-Ready row under the recurring generation key is refused
   (`pre_site_visit_generation_replay_stale`) unless it was created after the current
   document (fail closed on unreadable creation times); `commitReadyLineage` refuses
   409 `pre_site_visit_pointer_changed` when the pointer no longer equals the observed one
   (and is not this row), on every activation path including upload recovery. Tests: FAILED
   and expired-GENERATING reclaim, and a rival activation during upload.
2. **[medium] Suggested-recipient seed bypassed `applyFormPatch`.** Fixed: the seed goes
   through `applyFormPatch` and only when it changes a blank field, so a late suggestion
   cannot leave a sendable preview for the old form. Test: prepare + confirm, late `suggestedCc`.
3. **[medium] Final Writeup initial-load path discarded `body.code`.** Fixed: `fetchStatus`
   preserves the code; load, retry, and transition errors all pass through
   `transitionErrorMessage`. Test: first GET returns `final_writeup_source_missing`.
4. **[medium] Tri-state count did not mirror every `brief_snapshot_invalid` path.** Fixed:
   `receivedReviewCountOf` also requires `reviews` to be an array and the stored envelope to
   re-hash (via `briefInputFingerprint`, which validates the request shape) to the row's
   `wmkf_inputfingerprint`; null otherwise. Tests: fingerprint mismatch, null request,
   non-array reviews.
5. **[medium] PI/PD render change absent from generation identity.** Fixed:
   `PRE_RP_BRIEF_CONTRACT.renderVersion = '2'` is bound into the generation key
   (`buildPreRpBriefGenerationKey`, exported and byte-pinned by test); the template bytes and
   `templateVersion` are unchanged. Consequence: a pre-deploy READY brief keeps its identity;
   any new generation after deploy is a new lineage.

### Codex adversarial review — follow-ups round 2 (2026-09-16, gpt-5.6-sol, commit `694863d5`)

Findings 3 and 4 of round 1 confirmed closed. Three new findings, all fixed in the next commit:

1. **[high] Brief activation was last-finisher-wins.** Fixed: `generatePreRpBrief` records the
   pointer observed before any claim and `commitReadyLineage` refuses 409
   `brief_pointer_changed` when the pointer no longer equals it (and is not this row); the
   refused upload is deleted best-effort. Test: rival activation during upload. The "staged
   rollout / drain interval" recommendation is not adopted: the fence itself makes a late
   pre-deploy invocation lose, which is the required outcome.
2. **[high] A second automatic recipient seed could not displace the first.** Fixed: the panel
   remembers its last automatic seed per field; a field is replaceable when blank or still equal
   to that seed, staff edits are preserved, and any change invalidates the prepared preview and
   confirmation. Test: fallback seed → prepared/confirmed → attendee seed replaces To, keeps
   the edited Cc, clears the preview.
3. **[medium] The Pre-Site fence stranded the refused upload.** Fixed: `pre_site_visit_pointer_changed`
   now takes the same cleanup path as `claim_lost` (delete, else record cleanup with reason
   `<code>_delete_failed`). Test asserts the delete with the uploaded drive/item ids.

### Codex adversarial review — follow-ups round 3 (2026-09-16, gpt-5.6-sol, commit `b55157f3`)

Pre-Site cleanup fix confirmed sound. Two findings, both fixed in the next commit:

1. **[high] Deterministic-path delete could remove a reclaiming winner's file.** Fixed: after an
   activation refusal the brief service re-reads its row and deletes the upload only while its own
   claim token still owns a GENERATING row; on `claim_lost` it never deletes (the next owner's
   upload replaces the file at the same path). The earlier item-id heuristic is removed; the
   claim-lost test now asserts no delete.
2. **[medium] Seed ownership inferred from value equality.** Fixed: explicit per-field
   auto-ownership set only when the component writes its seed and cleared by every staff edit of
   that field. Tests: A → staff B → seed B → seed C keeps B; a staff edit equal to the previous
   seed survives the next seed.

### Codex adversarial review — follow-ups round 4 (2026-09-16, gpt-5.6-sol, verification only)

**Verdict: approve, no material findings.** Codex confirmed: cleanup deletes only for an
observed same-token GENERATING claim (the 15-minute lease exceeds the route's 5-minute maximum,
so a same-row reclaimer cannot enter the deletion window); retained files are invisible until a
later upload replaces them; recipient ownership clears per field on every staff edit and
request-keyed remounts reset the ref.

## 8. Follow-ups (not required for this pass)

- **Pre-RP replay closed; Pre-Site parity ported (Session 516 follow-ups, 2026-09-16).**
  `generatePreRpBrief` refuses 409 `brief_generation_replay_stale` when
  the recomputed generation key resolves to a Superseded row or to a Ready
  row that is not the current request-pointer target; an exact retry of the
  current Ready row remains read-only/idempotent. Regeneration also enforces
  the shared-not-sent rule server-side: a sent or in-flight distribution row
  for the current brief refuses 409
  `brief_regeneration_distribution_started`, with the distribution state
  checked before generation side effects and again at pointer activation to
  cover a concurrent send. **Ported to Pre-Site** on branch
  `claude/pre-rp-brief-followups`: `generatePreSiteVisitArtifact` now refuses
  409 `pre_site_visit_generation_replay_stale` for a Superseded generation-key
  row or a Ready row that is not the current pointer target
  (`lib/services/pre-site-visit/artifact-service.js`, before the Ready-reuse
  path; covered by `tests/unit/pre-site-visit-artifact-service.test.js`).

- **Carried from the slice 4–5 Opus reviews (Session 516, 2026-09-16); items
  (ii)–(viii) closed on `claude/pre-rp-brief-followups` the same day:**
  (i) **Resolved 2026-09-16:** the delta and fingerprint now consume the same
  canonical received-only form. Non-received suggestions move neither; received
  reviews retain the raw fingerprint fields, so a `reviewReceivedAt` timestamp
  rewrite moves both the fingerprint and the changed-reviewer delta. The former
  asymmetry-based hash test now asserts equal delta/hash identity for a pending
  suggestion and a separate regression covers the raw timestamp change.
  (ii) **Closed:** the migration-052 test now pins the legacy all-NULL CHECK
  branch tokens as well as the acknowledged-drift branch.
  (iii) **Closed:** `getPreSiteDistributionHistory` resolves each distinct
  `stale_inputs_acknowledged_by` GUID once through the system-user adapter
  (`systemuserid,fullname`) and projects `acknowledgedByName`; the panel shows
  "by <name>" and never the GUID; send-time projections and the external
  briefing context carry no name. Lookup failures log and leave the name null.
  (iv) **Closed:** `FinalWriteupTab.js` maps `final_writeup_source_missing` to
  Site Visit prerequisite wording pointing at Staff Deliberations.
  (v) **Closed:** the `beyond` banner now names the brief and no longer claims
  editing is locked, since the Pre-Site card keeps its own actions.
  (vi) **Closed structurally:** the defaults seed and `edit()` share
  `applyFormPatch`, which clears preview/confirmation/`staleInputs`. The
  sequence is unreachable in practice (the seed requires an untouched composer;
  preparing requires a recipient edit), so there is no behavioral test for it.
  (vii) **Closed:** `receivedReviewCount` is tri-state (`null` = snapshot
  missing/malformed/foreign envelope, mirroring the server's malformed test);
  the tab and the panel show a distinct "stored input record could not be read"
  reason matching the server's `brief_snapshot_invalid`.
  (viii) **Closed:** the tab test is renamed to say it guards the remount, and
  a new case asserts unmount-mid-generate aborts the in-flight controller.
  (ix) **Closed 2026-09-16:** Regenerate on a brief already **sent** to the
  Board remains deliberately unavailable and is now enforced in the service,
  not only hidden in the UI. A send that is already in flight also blocks
  replacement. The owner has since asked for the guarded-reopen treatment
  (typed request number, reason, audit); see §10.

- **PI/PD role labels (owner request 2026-09-16, closed same day):** the
  renderer prefixes the two people tokens at fill time ("PI: <name>",
  "PD: <name>"); the canonical input state and fingerprint carry the raw names.

## 9. Build-loop handoff (paused 2026-09-16, Session 515; resumed and completed Session 516)

Owner-directed loop: Sonnet builds, Opus reviews (max 3 rounds per group, structured
APPROVE/CHANGES verdicts, mutation-checked), controller reviews at the end, then Codex
adversarial review. Paused at the owner's request after the slice-4 build report.

| Group | State | Commits on `claude/pre-rp-brief` |
|---|---|---|
| Slices 1–2 | APPROVED (3 rounds; template metadata scrubbed, slice-2 commit replaced before any push) | `66cd2eb2`, `538388f2`, `c6f4a95c`, `eec8311d` |
| Slice 3 | APPROVED (2 rounds) | `1b0eab56`, `8320d9ec`, `4bc38700` |
| Slice 4 | APPROVED (2 rounds; round 1 found no code defect, six test-teeth gaps and the missing delta hash binding) | `d08ae753` (code), `4dbef6d7` (docs), `6a03389d` |
| Slice 5 | APPROVED after 3 rounds (round 1: legacy-rail regression, missing Board notice, unmirrored B10 gate; round 2: Regenerate narrowed to shared-not-sent; round 3 verified by the controller with a mutation check) | `77e662b8`, `c3e8af10`, `89d92ccf` |
| Slice 6 | DONE (docs reconcile, this commit) | see `git log` |

Branch was pushed at the pause; the Session 516 commits are pushed with the PR.

**Production schema: DONE 2026-09-16 (owner-run).** Picklist value `100000009` inserted and
re-read; relationship `wmkf_request_currentprerpbrief` created under
`DATAVERSE_PROD_WRITE_ACK`; preflight `--target=prod` reports 43 exact / 0 absent / 0 divergent.
Atlas, matrix, file-model, briefing-plan, wiki, and work-queue restatements were reconciled
in slice 6. Migration 052 was applied to the shared Production/Preview database by the
owner on 2026-09-16 (readback exact) before merge, per the Codex adversarial finding that
merge auto-deploys code naming the new columns.

**Resume steps:**
1. `git checkout claude/pre-rp-brief`; confirm HEAD `4dbef6d7`.
2. Spawn an Opus reviewer for slice 4 (`git diff 4bc38700..HEAD`), with the self-trace: prepare
   gate ordering (resolveSource → live-input load → `assertBriefInputsReady` → any write),
   fingerprint provenance (stored snapshot re-hash equals `wmkf_inputfingerprint`), hash
   binding (`draftHash`/`previewHash` include both fingerprints, delta, acknowledgement),
   migration 052 CHECK coherence vs. legacy rows, `staffAcknowledgedNewerInputs` timestamp-only
   on the external context. Builder ran four hand mutations; a reviewer mutation pass is still due.
3. Items carried for slice 4 review / slice 5: (a) **resolved 2026-09-16** — keep raw
   `reviewReceivedAt` in `REVIEW_FINGERPRINT_FIELDS` and make the delta consume the same
   received-only canonical form and raw fields; a timestamp rewrite now appears in the
   changed-reviewer delta, while non-received suggestions affect neither representation;
   (b) no route test exists for
   `distribution/prepare.js`'s new `acknowledgeStaleInputs` validation; (c) slice-3 reviewer's
   queued fixture: claim-race guard should also prove the orphan IS deleted when the winner
   adopted a different item.
4. Then slices 5 (Staff Deliberations UI, Start Site Visit action, drift confirmation UI,
   composite stage projection in both callers, cycle-list union) and 6 (docs reconcile via
   `/sweep`, Atlas "applied 2026-09-16", `DATAVERSE_SHAREPOINT_FILE_MODEL.md`, wiki, work queue).
5. Controller review: `/contract-reconcile` Mode B invariant table, full `/start` gate list
   sequentially, full jest, lint, build; push; PR; then owner runs
   `/codex:adversarial-review --wait --base 236d9219 --model gpt-5.6-sol …` with the receipt marker.

## 10. Guarded regeneration of a sent brief (owner decision 2026-09-16)

Closes §8 item (ix): the owner asked that Regenerate on a brief already sent to
the Board, instead of staying permanently unavailable, become available only
through a guarded, superuser-only, audited path mirroring the Pre-Site guarded
reopen (`pages/api/workbench/pre-site-visit/reopen.js`,
`lib/services/pre-site-visit/reopen-service.js`). Built on
`claude/pre-rp-brief-guarded-regen` off `claude/pre-rp-brief-followups` @
`694863d5`; file:line below are from that branch.

**Design.** Unlike Pre-Site's reopen, the brief never copies bytes — it always
re-renders deterministically from the frozen input snapshot — so this feature
validates the guarded-reopen preconditions and then delegates to the ordinary
claim/render/upload/activate lineage in `generatePreRpBrief`
(`lib/services/pre-rp-brief/artifact-service.js:658`) via a new internal
`reopen` option, rather than re-implementing that lineage.

1. **Service** `lib/services/pre-rp-brief/reopen-service.js`, export
   `reopenSentPreRpBrief(input, { actingUserSystemId }, dependencies)`. All
   steps below are read-only; the only write is the delegated
   `generatePreRpBrief` call in the last step.
   a. `validateInput` (line 77) mirrors, rather than imports, Pre-Site's
      `validateInput` (`lib/services/pre-site-visit/reopen-service.js:532`,
      exported): the same six fields and the same reason/note rules
      (`PRE_SITE_REOPEN_REASON`, `PRE_SITE_REOPEN_CONTRACT` min/max, reused),
      but `brief_reopen_*` error codes instead of `pre_site_reopen_*`, since
      the two features validate different artifact identities and the
      acceptance contract wants brief-specific codes.
   b. 503 `brief_reopen_schema_not_ready` unless `isGuardedReopenSchemaReady()`.
   c. Resolves the current brief via `resolveCanonicalPreRpBriefRow`
      (artifact-service.js:299), fed a custom `{ getRequest, findByRequest }`
      pair (reopen-service.js:55-56) so the request select can add
      `akoya_requestnum`, which the artifact service's own lineage select
      omits (ordinary generation never needs it).
      **Deviation from the literal step order for idempotent retry
      (reopen-service.js:141):** before the stale/not-shared checks, if the
      current row's `wmkf_reopencycleid` already equals the typed
      `clientOperationId`, the call returns `{ artifact, reused: true }`
      immediately. Without this, an exact retry's `expectedArtifactId` names
      the pre-reopen row, which the first call already superseded, so every
      retry would be refused as stale instead of replaying — this mirrors
      Pre-Site's own audit-row replay (`findAuditRow`/`committedResult` in
      `lib/services/pre-site-visit/reopen-service.js`).
      Otherwise: 409 `brief_reopen_stale` if `expectedArtifactId` is not the
      current row; 409 `brief_reopen_not_shared` unless lifecycle is REVIEW
      and operation status is READY.
   d. 409 `brief_reopen_request_number_mismatch` unless the typed
      `requestNumber` exactly matches `akoya_requestnum`.
   e. 409 `brief_reopen_not_sent` unless `hasSentAttemptForSource` reports a
      sent attempt for the current row.
   f. 409 `brief_reopen_in_flight` (this feature's own pick — not named in
      the original design brief) if any distribution attempt is in flight for
      the source, using the exact same test as `attemptIsInFlight`
      (artifact-service.js:118, exported so this file reuses it exactly
      rather than risking a second copy drifting from the original); 503
      `brief_distribution_state_unavailable` on a reader failure, a
      non-array result, or a full (>=100-row) distribution page — same
      reasoning as `assertCurrentBriefReplaceable`.
   g. Calls `generatePreRpBrief({ requestId, clientOperationId,
      actingUserSystemId, reopen: { cycleId: clientOperationId, reasonCode,
      reasonNote } }, dependencies)`.
2. **Generate option** `reopen` on `generatePreRpBrief`
   (artifact-service.js:658) is internal-only; the public route
   (`pages/api/workbench/pre-rp-brief.js`) still rejects any body key other
   than `requestId`/`clientOperationId` (unchanged). `assertCurrentBriefReplaceable`
   (artifact-service.js:131) gained an `{ allowSent }` option: when `reopen`
   is present it skips only the "already sent" half of the gate — an
   in-flight attempt still blocks unconditionally, both before generation
   (line 699) and at the `commitReadyLineage` activation fence (line 557,
   threaded through a new `reopen` field on that function's options object).
   The new row's `createDocument` payload (line ~730) adds
   `wmkf_reopencycleid`/`wmkf_reopenreasoncode`/`wmkf_reopenreasonnote` only
   when `reopen` is present; the prior row is superseded and the pointer
   moves exactly as ordinary regeneration. An exact retry with the same
   `clientOperationId` reuses the row (`reused: true`) via the reopen-service
   replay above, without a second `generatePreRpBrief` call.
3. **Route** `pages/api/workbench/pre-rp-brief/reopen.js`, copied from
   `pages/api/workbench/pre-site-visit/reopen.js` line for line except: the
   service import (`reopenSentPreRpBrief`), the DAL context name
   (`workbench-pre-rp-brief-reopen`), the 503 code
   (`brief_reopen_schema_not_ready`), the 500 fallback code
   (`brief_reopen_failed`), and — beyond the brief's exception list — the
   `console.error` label and the 500 body message, reworded for the brief
   rather than left as Pre-Site's literal text. `BODY_KEYS` is identical
   (six fields).
4. **Tab** (`shared/components/workbench/StaffDeliberationsTab.js`):
   `briefMoreItems` (line ~958) adds `Regenerate sent brief…` when
   `briefReadyFile && briefShared && everSent && isSuperuser &&
   !beyondDeliberations`, calling `openBriefReopenDialog`. The dialog
   (mirrors the Pre-Site reopen dialog: reason select from
   `PRE_SITE_REOPEN_REASON_LABEL`, note, typed request number, submit
   disabled until valid) posts the six fields to the new route and, on
   success, re-fetches brief status (`readBriefStatus`) so `briefArtifact`
   moves to the new row. **Revised in round 2 below**: moving `briefArtifact`
   alone is not sufficient to refresh distribution history — the panel's
   `key` and an eager local reset now do that work.
5. **Docs**: this section; `docs/API_ROUTE_SECURITY_MATRIX.md` row for
   `/api/workbench/pre-rp-brief/reopen`; one sentence added to
   `docs/atlas/dataverse-wmkf-requestdocument.md`'s Pre-RP Brief section
   noting that a reopen-regenerated row carries the three reopen audit
   fields.

**Tests** (all green on `claude/pre-rp-brief-guarded-regen`):
`tests/unit/pre-rp-brief-reopen-service.test.js` (new, 16 tests: one
refusal per step a-f plus a success and an idempotent-retry test),
`tests/unit/pre-rp-brief-artifact-service.test.js` (4 tests added inside
`describe('generatePreRpBrief')`'s new `describe('the reopen option')`, no
removals), `tests/unit/workbench-reopen-pre-rp-brief-route.test.js` (new, 7
tests mirroring the Pre-Site route test one for one),
`tests/unit/workbench-pre-rp-brief-route.test.js` (one row added to the
existing `test.each` rejecting a `reopen` body key), and
`tests/unit/staff-deliberations-tab.test.js` (5 tests added, no removals).

### 10.1 Round 2: Codex adversarial review findings (2026-09-16), fixed on the same branch after merging `claude/pre-rp-brief-followups` (merge `da3955ae`, which added `expectedPointerId` to `commitReadyLineage` and own-claim-only upload cleanup)

**Finding 1 [high] — source identity not bound across the delegation.**
The reopen-service validated a specific current-row identity
(`currentRow.wmkf_requestdocumentid`, confirmed equal to
`input.expectedArtifactId`) before ever calling `generatePreRpBrief`, but
`generatePreRpBrief` then did its own independent pointer read — a rival
generation (another guarded reopen, or an ordinary regenerate) could move
the pointer in between, and `generatePreRpBrief` would supersede whatever it
found instead of what was authorized. Fix: `reopenSentPreRpBrief`
(reopen-service.js:242) now passes `reopen.sourceArtifactId =
currentRow.wmkf_requestdocumentid`. `generatePreRpBrief`
(artifact-service.js:774) re-checks, immediately after its own
`resolveCanonicalPreRpBriefRow` call and before any claim, that the row it
resolved equals `reopen.sourceArtifactId`; a mismatch throws 409
`brief_reopen_stale` (`reopenSourceStaleError`, artifact-service.js:120).
`expectedPointerId` (artifact-service.js:778, threaded into
`commitReadyLineage`'s activation fence, merged in from
`claude/pre-rp-brief-followups`) is set to `reopen.sourceArtifactId` when
`reopen` is present, rather than merely whatever the (now re-verified)
`currentRow` happens to be — defense in depth, since `commitReadyLineage`
already has its own `brief_pointer_changed` fence for a race that opens
later, during render/upload. Test:
`tests/unit/pre-rp-brief-reopen-service.test.js` "fails closed
(brief_reopen_stale) when a rival brief takes the pointer between
reopen-service validation and generatePreRpBrief's own pointer read" —
mutates the request pointer inside the `loadInputs` mock (which runs before
`generatePreRpBrief`'s own pointer read) to simulate the race, and asserts
`createDocument`/`uploadFile` were never called.

**Finding 2 [high] — idempotency not bound to the audit payload; generation
key collision with ordinary rows.**
(a) `buildPreRpBriefGenerationKey` (artifact-service.js:709) gained an
optional `reopen: { cycleId, sourceArtifactId, reasonCode, reasonNote }`
argument, bound into the hashed key only when present, so a guarded
generation's key can never collide with an ordinary row that happens to
share the same `clientOperationId` (asserted by a new key test in
`tests/unit/pre-rp-brief-artifact-service.test.js`: omitting `reopen`, or
passing it as `null`, produces the byte-identical key as before this option
existed). (b) `generatePreRpBrief` (artifact-service.js:763) fails closed
409 `brief_reopen_audit_mismatch` (`reopenAuditMismatchError`,
artifact-service.js:134) if the row resolved by the (now reopen-bound) key
carries different `wmkf_reopencycleid`/`reasoncode`/`reasonnote` than the
tuple — defense in depth, since (a) already makes this practically
unreachable. (c) The reopen-service's own idempotent-retry short-circuit
(reopen-service.js:148) previously matched on `wmkf_reopencycleid` alone;
it now also requires the reason code, reason note, and the superseded
source to match exactly, else 409 `brief_reopen_audit_mismatch`. The
superseded source is now recorded: `wmkf_SourceDocument` — the same
generic lookup Pre-Site's own reopen (`'wmkf_SourceDocument@odata.bind'`,
`lib/services/pre-site-visit/reopen-service.js:690`) and the distribution
snapshots (`lib/services/pre-site-visit/distribution-service.js:968`)
already use on this entity — is available and is now written on the
brief's successor row too (artifact-service.js:830), and the replay
compares it against `input.expectedArtifactId`
(`currentRow._wmkf_sourcedocument_value`, reopen-service.js:151). Tests:
"refuses (brief_reopen_audit_mismatch) a retry whose reason/note differ
from the first, sharing the same clientOperationId"; "does not claim a
pre-existing ordinary FAILED row that shares the same clientOperationId
(guarded and ordinary keys differ)" (asserts the ordinary row is never
touched); "is idempotent: an exact retry…" (pre-existing, still green) and
the new key test above cover the exact-replay and key-collision cases.

**Finding 3 [medium] — successful regeneration left distribution history
keyed to the superseded source.**
`PreSiteDistributionPanel`'s own history-load effect
(`shared/components/workbench/PreSiteDistributionPanel.js:409-426`) only
re-runs on a `requestId` change (`loadHistory`'s deps are `requestId`,
`requestNumber`, `onHistory` — never `sourceArtifact`), so moving
`briefArtifact` to the successor row alone left the panel showing the
predecessor's cached "already sent" history until an unrelated remount.
Fix, in `StaffDeliberationsTab.js`: (i) the panel's `key` (line ~1266) is
now `` `distribution-${requestId}:${briefArtifact?.artifactId || ''}` ``
(picked over adding the artifact id to the panel's own effect deps, to
avoid touching `PreSiteDistributionPanel.js`, which is outside this
feature's file list, and because a full remount also clears the panel's
own composer-touched/seeded-defaults state, which should not survive onto
an unrelated new document either); (ii) `submitBriefReopen` now also calls
`setCurrentSourceEverSent(false)` and `setLatestSendFailure(null)`
eagerly, right when `briefArtifact` moves to the successor, so there is no
render in between where the UI could show the brand-new (never sent) row
as already sent while the remounted panel's own history fetch is still in
flight. Test (replacing the prior mock-only assertion): the mock panel in
`tests/unit/staff-deliberations-tab.test.js` now records
`sourceArtifact.artifactId` on every genuine mount (an effect with empty
deps, mirroring the real effect's `requestId`-only trigger) into
`mountedSourceArtifactIds`; the new test proves a second, distinct-artifact
mount happened (not just a re-render with updated props), then shares the
new Draft again and asserts `Regenerate Brief` is offered and `Send the
deliberation email again…` is not — the exact menu state a stale "already
sent" signal would have gotten wrong.

### 10.2 Round 3: Codex adversarial review finding (2026-09-17), fixed on the same branch on top of `7ef55e67`

**Finding [high] — the round-2 eager sent-state reset ran unconditionally,
including on a 202 replay.** `submitBriefReopen`'s reset of
`currentSourceEverSent`/`latestSendFailure` (round 2, §10.1) ran regardless
of what the refreshed status actually reported. On a 202 reply (the
operation still `GENERATING`, e.g. a concurrent claim elsewhere), the
refreshed status's `currentArtifact` is still the PREDECESSOR — the pointer
has not moved yet, so that row is still READY/REVIEW and fully live, its own
composer/Share binding intact. Resetting `currentSourceEverSent` to `false`
regardless meant the UI could momentarily treat that still-current,
already-sent predecessor as never-sent, exposing a `Share…` control (and
misrepresenting the overflow menu's Regenerate/Send-again state) for a
document that had, in fact, already gone to the Board — a duplicate-send
risk.

Fix (`shared/components/workbench/StaffDeliberationsTab.js:858-876`):
the reset now runs only when the refreshed status's current artifact id
differs from `expectedArtifactId` (the pre-reopen row) —
`successorActivated = Boolean(nextArtifact) && nextArtifact.artifactId !==
expectedArtifactId`. On a 202/still-GENERATING reply (or any reply where
the current artifact id is unchanged), the predecessor's sent state is left
untouched; the dialog stays open with its existing "already in progress,
retry" message (unchanged UX, matching Pre-Site's own reopen, which also
does not auto-poll on 202), and the SAME `clientOperationId` on a later
manual retry re-checks status and only resets once the successor is
actually confirmed current.

Test: `tests/unit/staff-deliberations-tab.test.js` "a 202 (still-generating)
guarded regeneration reply never resets the still-current predecessor's
sent state; only the completed successor does" (new). It nulls
`distributionHistoryFeed` before the in-progress submit — the mocked
panel's `onHistory` effect otherwise fires on every re-render (an
intentional simplification for other tests exercising a genuine data
change, unlike the real panel, which only refires on a `requestId`
change) and would keep re-asserting the pre-reopen "sent" feed regardless
of what the tab's own state did, masking the bug either way; nulling it
isolates the assertions to the tab's own `currentSourceEverSent` state.
Phase 1 (202): asserts no `Share…` button, `Send the deliberation email
again…` still offered, `Regenerate Brief` not offered, and no panel
remount (`mountedSourceArtifactIds` unchanged) — the exact predecessor
state as before the reopen attempt. Phase 2 (successor activates on
retry): asserts the panel remounts for the new artifact id and the menu
flips to ordinary `Regenerate Brief` / no `Send again`, matching §10.1's
existing success-path test. Mutation check: reverting `successorActivated`
to an unconditional `true` makes phase 1 fail on the `Share…` assertion
(the exact bug) — pasted in the build report.

### 10.3 Round 4: Codex adversarial review finding (2026-09-17), fixed on the same branch on top of `4da99916`

**Finding [high] — round 3 only protected `everSent`, not the Share/send-again/
resend affordances themselves.** After a 202, the predecessor correctly stays
current with `everSent: true` (round 3), so `briefMoreItems`
(`StaffDeliberationsTab.js:1001-1011`, pre-fix) still offered "Send the
deliberation email again…" for it. Once the guarded-reopen dialog was
cancelled (nothing else re-checks status), staff could resend the
predecessor while `briefPendingArtifact` was still `GENERATING`; a resend
completing before the successor activated would send a duplicate Board
email once the successor itself eventually sent.

**Fix.** A new derived flag, `briefRegenerationPending` (line 585,
`briefPendingArtifact?.operationStatus === GENERATING`), is sourced from
`briefPendingArtifact` — not from any one action's own local flag (like
`briefGenerating`, which only ever reflects THIS session's own ordinary
Generate/Regenerate call) — so it is true regardless of which action
started the pending regeneration (ordinary Regenerate, this session's own
guarded reopen, or another staff member's concurrent action discovered via
the periodic/mount status fetch). Every Share/send-again/resend surface is
now gated on `!briefRegenerationPending`:
- the Draft-brief "Share…" button (line 1165) and its blocked-reason note
  (line 1176);
- the shared-not-sent "Share…"/"Resend" button (line 1183) and its
  blocked-reason note (line 1194);
- the shared-sent "Resend" button (line 1207);
- the overflow menu's "Send the deliberation email again…" (line 1002) and
  "Regenerate sent brief…" (line 1010) items.

The composer itself is force-closed if it was already open when a
regeneration is discovered pending: a `useEffect` (line 597) watching
`briefRegenerationPending`/`composerOpen` calls `setComposerOpen(false)`.
This is a genuine one-way "close and stay closed" transition (not a pure
render-time derivation, since `composerOpen` must not silently reopen once
the pending regeneration finishes), so it legitimately needs an effect
despite eslint's generic `react-hooks/set-state-in-effect` warning
(0 errors either way — `npx eslint` still exits 0). The existing "A new
brief is being generated…" note (line ~1116, shown whenever
`briefRegenerationPending && briefReadyFile`) now leads with "sharing is
paused until it is ready" — it already occupies the exact place the
suppressed actions would otherwise be.

Suppression is scoped to `GENERATING` only: a `FAILED` pending attempt
(the regeneration did not succeed, so the predecessor was never actually at
risk) leaves Share/send-again available, matching the pre-existing failure
UX (`briefUnchangedRetryBlocked`, unaffected by this change).

**Tests** (`tests/unit/staff-deliberations-tab.test.js`): the round-3 202
regression test is replaced by "a 202 (still-generating) guarded
regeneration suppresses every Share/send-again/resend path and closes the
composer; both lift once the successor activates" — opens the composer via
"Send the deliberation email again…" first (to exercise the force-close),
then starts the guarded reopen, asserts the 202 reply force-closes the
composer and hides all three actions (asserted with the overflow menu
opened, after cancelling the dialog — not merely retrying it), then
remounts the tab (`rerender` with a new `key`, simulating a later revisit)
to observe the successor activate, history remount for the new artifact
id, and ordinary `Regenerate Brief` return. A second, new test — "suppression
lifts once a pending regeneration attempt FAILS, not just once it
activates" — proves the `FAILED` case is unaffected. Mutation check:
setting `briefRegenerationPending` to a hardcoded `false` makes the 202
test fail on the composer-force-close assertion (the exact bug) — pasted in
the build report.

### 10.4 Round 5: Codex adversarial review findings (2026-09-17), fixed on the same branch on top of `04db470d`

Two server-side findings: the UI-only suppressions in §10.3 protected the
tab, but nothing on the server stopped the predecessor from actually being
distributed while its successor was generating, and an abandoned (expired
claim lease) regeneration could permanently strand the current brief's own
Share/send affordances.

**Finding 1 [high] — server still permitted predecessor distribution while
its successor is generating.** `resolveCurrentPreRpBriefForDistribution`
(`lib/services/pre-rp-brief/artifact-service.js:447`) resolves the pointer
row and checks its own eligibility, but a guarded regeneration's successor
claims a brand-new row under a *different* generation key while the
pointer still names the predecessor — so those checks alone never see it.
Both `pages/api/workbench/pre-site-visit/distribution/prepare.js` and the
send-time freshness recheck (`assertAttemptSourceCurrent` in
`lib/services/pre-site-visit/distribution-service.js`, called from
`pages/api/workbench/pre-site-visit/distribution/send.js`) call this same
resolver via `resolveSource`, so fixing it here closes both ends. Fix: after
resolving the pointer row, look across `briefRows` (already returned by
`resolveCanonicalPreRpBriefRow`) for any other non-superseded row that is
GENERATING with an active claim lease — `generatingLeaseActive` (line 505),
the exact same 15-minute `GENERATING_LEASE_MS` window `claimExisting`
uses — and refuse 409 `brief_regeneration_in_progress` ("A replacement
brief is being generated; sharing is paused until it is ready.") (line
480-489). An ordinary request with no other brief row, or only an
abandoned (expired-lease) one, is unaffected. Combined with the existing
in-flight-attempt refusal at reopen claim time
(`assertCurrentBriefReplaceable`), a predecessor send cannot start or
complete while a guarded regeneration is live, and a guarded regeneration
cannot claim while a predecessor send is in flight — **except for a
residual sub-second window between the send's freshness recheck and the
reopen's claim `createDocument` insert**, where both could observe "clear"
before the other's write lands. Recorded here rather than closed with a
new lock: both operations write through Dataverse ETags/alternate keys
that fail closed on a genuine conflict (the reopen's generation-key insert,
the send's own row ETags), so the realistic failure mode of this window is
one side's write being rejected and needing a retry, not silent data
corruption; a dedicated cross-resource lock was judged disproportionate to
a sub-second, self-correcting race. The panel maps the new code to named
copy in both `prepare()` and `send()`
(`shared/components/workbench/PreSiteDistributionPanel.js`), mirroring the
existing `brief_reviews_required` branch: "A replacement brief is being
generated; sharing is paused until it is ready." — `send()`'s branch keeps
the existing (still valid) prepared preview rather than discarding it, since
nothing about the preview itself is stale.

Tests: `tests/unit/pre-rp-brief-artifact-service.test.js` (resolver-level:
refuses with an active-leased other row, proceeds with an expired-leased
one, proceeds with no other row at all); `tests/unit/pre-site-distribution-service.test.js`
(`preparePreSiteDistribution`/`sendPreSiteDistribution`-level: same
refuse/proceed pair, wired through the real call sites — `createOrGetAttempt`/
`createEmailActivity` are asserted not called on refusal); `tests/unit/pre-site-distribution-panel.test.js`
(named copy for both `prepare` and `send`, mirroring the existing
`brief_reviews_required` test).

**Finding 2 [high] — an expired GENERATING lease stranded the sent
brief.** The tab's `briefRegenerationPending` (round 4, §10.3) suppressed
Share/send-again for ANY `GENERATING` pending artifact, with no way to
recover if that attempt's claim lease had actually expired (an abandoned
attempt — the claiming session crashed, lost network, or was otherwise
never going to finish) short of a page reload racing the exact right
status payload. Fix: the pending-artifact projection is now lease-aware.
`projectPreRpBriefArtifact` (`artifact-service.js:327`) adds
`leaseActive: generatingLeaseActive(row)` — `false` for any non-GENERATING
row (the concept doesn't apply) or a GENERATING row whose lease has
expired, `true` only for an actively-claimed one — using the exact same
window as finding 1's server-side refusal, so the UI signal and the
server's own refusal agree. The tab
(`shared/components/workbench/StaffDeliberationsTab.js:590-596`) now
computes `briefRegenerationPending = pending?.operationStatus === GENERATING
&& pending.leaseActive !== false` (`!== false` rather than `=== true`, so
an older status payload without the field, or any other non-`false` value,
still fails safe as "still pending" rather than silently un-suppressing).
Once the lease expires, suppression lifts — the guarded-reopen item and
Share/resend return — and a retry of the guarded-reopen dialog reclaims the
abandoned row via the existing expired-lease path in `claimExisting`
(unchanged).

Tests: `tests/unit/pre-rp-brief-artifact-service.test.js` (a
clock-controlled status test: a GENERATING row with `modifiedon` 1 minute
old projects `leaseActive: true`; 16 minutes old projects `leaseActive:
false`); `tests/unit/staff-deliberations-tab.test.js` ("suppression lifts
once the pending artifact reports leaseActive: false, even while still
GENERATING" — Share/send-again return with a GENERATING pending artifact
whose `leaseActive` is `false`).

Mutation checks (both restored after, pasted in the build report): (i)
dropping the GENERATING/lease check in the resolver (replacing the
`regenerating` condition with `false`) made the new prepare-refusal test
fail; (ii) hardcoding `leaseActive: true` in the projector made the new
clock-controlled status test fail.

### 10.5 Codex round 5 (2026-09-17, gpt-5.6-sol, verification only)

**Verdict: approve, no material findings.** Codex confirmed prepare and both send-time
checks use the lease-aware resolver, the pending projection and tab suppression share the same
15-minute lease semantics, and expired claims remain reclaimable through the guarded dialog.

## 11. Review bundle PDF (owner request 2026-09-16; Step C on `claude/pre-rp-brief-review-bundle`)

**Ask.** A Board member asked to download every review shown inline on the deliberation
briefing page as one PDF. Owner decision 2026-09-16 (option 2): assemble the bundle when staff
Share (prepare) so the latency lands on staff, retain it as a governed request document beside
the brief distribution snapshot, pin its identity on the attempt, serve it as a token-verified
briefing-page member and as a link in the briefing email, and rebuild it once on demand when the
live review set differs from the pinned set. Board-facing filename is institution-led with no
request number.

### Contract-reconcile (Mode A, 2026-09-16, S516; evidence from the Explore pass on `694863d5`)

| Layer | Fact | Evidence |
|---|---|---|
| Caller | Prepare already loads live brief inputs (received reviews with `reviewSharePointFolder`/`reviewFilename`) for the drift gate, then creates the DOCX and PDF snapshots through `ensureSnapshot` before `previewHash` and `recordPrepared`. | `[VERIFIED via lib/services/pre-site-visit/distribution-service.js:1305-1336,1506-1555,1570-1615]` |
| Conversion | DOCX→PDF is `GraphService.downloadFileAsPdf(driveId, itemId)`; review files are path-addressed, so drive/item ids come from `getFileMetadataByPath` (the `locateProposal` pattern). | `[VERIFIED via lib/services/graph-service.js:903-916,921,950; lib/services/deliberation-briefing/briefing-page-service.js:259-279]` |
| Review identity | `wmkf_appreviewersuggestion.wmkf_reviewsharepointfolder` + `wmkf_reviewfilename`; no drive/item/version/hash exists, so the pinned "review set" is path-keyed and byte identity is known only after download. | `[VERIFIED via lib/services/review-upload.js:267-268; lib/services/review-manager/download-review-service.js:56-82]` |
| Persistence | `pre_site_distribution_attempts` `pdf_*` family is the column template; migration 053 adds a `review_bundle_*` family (ten columns, two CHECKs) mirrored in `scripts/setup-database.js` `v54Statements` and pinned by the parity test. | `[VERIFIED via lib/services/pre-site-visit/distribution-store.js:12-52,131-165; scripts/setup-database.js:1176-1237,2310-2325; tests/unit/pre-site-distribution-schema-parity.test.js:27-79]` |
| Registry | Snapshot rows reuse the brief artifact type with producer `request-workbench-distribution-<format>`; `isPreSiteDistributionSnapshot` matches only `-docx`/`-pdf`, so a third suffix must be added or the bundle row leaks into the materials lists. | `[VERIFIED via shared/config/requestDocument.js:97-106; lib/services/deliberation-briefing/briefing-page-service.js:192-200; lib/services/pre-site-visit/distribution-service.js:518]` |
| Consumer (page) | Members are bounded ids resolved by `resolveBriefingMember`; `writeup-docx` re-reads the latest sent attempt, downloads by pinned drive/item, and re-hashes against `docx_byte_hash` (409 on drift). Reviews render live; non-PDF review files are hidden today (`isPdfFilename`). | `[VERIFIED via lib/services/deliberation-briefing/briefing-page-service.js:67-73,239-252,327-352,128,186; pages/external/briefing/[token].js:85,200-230]` |
| Consumer (email) | The briefing link is a placeholder href substituted at send time; copy comes from `email.deliberation_share.*` settings registered in three places and pinned by three tests. | `[VERIFIED via lib/services/pre-site-visit/distribution-service.js:351-356,419-450; shared/config/deliberationShareEmail.js:7-15; shared/config/editableTextDefaults.js:295-315]` |
| Library | `pdf-lib` ^1.17.1 is already a dependency (split direction only today). No new dependency. | `[VERIFIED via package.json:141-142; lib/utils/pdf-page-splitter.js:27]` |
| Partial success | Prepare fails closed if any part cannot be fetched or converted; no attempt reaches `prepared` without a bundle. The on-demand rebuild is idempotent through the registry generation key (review-set fingerprint) so two concurrent Board reads converge on one row/file. | design |
| Stale async | Send-time checks (`assertAttemptSourceCurrent`, `assertAttemptExtensionsCurrent`) do not recheck the review set; drift after prepare is handled by the on-demand rebuild on read, not at send. | `[VERIFIED via lib/services/pre-site-visit/distribution-service.js:1752-1800]` |

### Design

- **C1 (server):** `lib/services/pre-site-visit/review-bundle-service.js` (`reviewSetFingerprint`, `assembleReviewBundle` with pdf-lib separator pages), retention through `ensureSnapshot` format `review-bundle` (producer suffix added to `isPreSiteDistributionSnapshot`), migration 053 + fresh-install mirror + parity/mirror tests, `draftHash` binds the review-set fingerprint, `previewHash` binds the bundle identity, `recordPrepared` persists the family, `projectDistributionAttempt` exposes `reviewBundle` (no drive/item ids).
- **C2 (consumers):** `review-bundle` member in `resolveBriefingMember` (latest sent attempt; re-hash; inline PDF; institution-led filename); on read, if `reviewSetFingerprint(live received reviews)` differs from the pinned set fingerprint, rebuild through the same assembly + `ensureSnapshot`, update the attempt's family and `review_bundle_rebuilt_at`, then serve; `buildBriefingContext` gains `reviewBundle { member, filename, size, reviewCount, rebuiltAt }`; the page renders "Download all reviews (PDF)" in the Reviews section; the email body gains a second placeholder href resolved at send time to the document route with `member=review-bundle`, with copy key `email.deliberation_share.review_bundle_link_text` registered alongside the existing keys.
- **Behavior change to note:** DOCX-origin reviews, hidden on the page today, appear in the bundle as converted PDF pages.

**Deployment protocol (same as migration 052) — done: 053 applied 2026-09-17T13:57:15Z, readback exact (ten columns, two CHECKs, 17 legacy rows pass), before PR #312 merged.** merge auto-deploys code that names the new `review_bundle_*` columns, so migration 053 must be applied to the shared Production/Preview database (`node scripts/apply-migrations.js`) before this branch merges — prepare must not run in an environment where migration 053 is absent.

### Codex adversarial review round 2 (Step C) — disposition 2026-09-17

1. **[high — production breaker, fixed]** `getWriteupRoster` (`lib/services/review-manager/reviewers-service.js`) never projected `reviewSharePointFolder`/`reviewFilename` into its output, even though the shared entity-registry `$select` for `wmkf_appreviewersuggestions` already fetched both fields (`lib/dataverse/core/entity-registry.js`) — a missing projection, not a missing fetch. Since `loadPreRpBriefInputs` passes this roster's `reviews` straight into `envelope.reviews` (`lib/services/pre-rp-brief/input-service.js:110-112`), every received review looked incomplete to `assembleReviewBundle`'s round-1 fail-closed check, so every Share would 409 `review_bundle_incomplete`. Fixed by adding both fields to the roster projection literal; `REVIEW_FINGERPRINT_FIELDS` untouched. A producer-to-prepare contract test (`tests/unit/pre-site-distribution-service.test.js`, "producer-to-prepare contract" describe block) now calls the REAL `getWriteupRoster` → `loadPreRpBriefInputs` → `preparePreSiteDistribution` end to end (only the roster's own adapter I/O mocked) and would have caught this regression.
2. **[medium, fixed]** Prepare and the on-demand rebuild derived a reviewer's name/affiliation from two different reductions — prepare via the Potential-Reviewer-hydrated `getWriteupRoster`, rebuild via an ad-hoc `personName`/`personAffiliation` reduction of the raw suggestion row only — so a Potential Reviewer rename could be visible to one and not the other. Fixed by making `loadLiveReviewsForBundle` (`briefing-page-service.js`) call the SAME `getWriteupRoster` producer; the ad-hoc suggestion mapping is gone. `personName`/`personAffiliation` remain in use for the (unrelated) reviews list in `buildBriefingContext`.
3. **[medium, fixed]** TOCTOU after the CAS: the live set could drift again between selecting a bundle to serve (fresh rebuild winner, or unchanged pinned) and downloading/serving its bytes. Fixed with a bounded (2-attempt) retry in `resolveBriefingMember`: after downloading and byte-hash-verifying the selected bundle, the live fingerprint is recomputed one final time and compared to the fingerprint that bundle was built for; a mismatch retries the whole selection once more, and a second miss serves 503 `review_bundle_unavailable` rather than stale bytes. Applies on both the rebuild branch and the unchanged-pinned branch.

Side effect of (2)/(3): the review-bundle document route now reads `getWriteupRoster` twice on the unchanged-fast-path (was once) and up to three times per rebuild attempt (up to six across a full 2-attempt retry) — each read is `findByRequest` + a chunked `queryReviewers` + `fetchAnswersBySuggestion` (Dataverse only, no Graph). Acceptable added latency for a page-view-triggered read; flag if it becomes measurable.

### Codex adversarial review round 3 (Step C) — disposition 2026-09-17

Codex confirmed the roster projection, the shared producer, the DAL context, and the documented
read bound. One finding remains and is **dispositioned as a contract statement, not a code
change**: the final post-download recheck compares the selected bundle against one roster
snapshot, and that snapshot is assembled across sequential Dataverse reads, so a mutation landing
between the suggestion read and the response is invisible to it. A return-time fence would need a
request-scoped revision/lease held through response completion across Dataverse, which no read
path in this application has; the briefing page's own inline reviews are served with the same
last-observed-snapshot semantics (`loadReviews` reads suggestions then hydrates). **Contract:**
the review bundle is consistent with the review set *as last observed during delivery*
(pinned-set comparison before selection, one final recheck after download, at most two attempts);
it is not a linearizable guarantee against concurrent Dataverse edits. A review deselected during
the delivery window can appear in that one response exactly as it can in the inline list served
by the same request; the next read repairs it. Recorded in the security matrix row.

### Open for owner (2026-09-16)

1. A review file that cannot be converted blocks Share (fail closed) rather than being skipped with a placeholder page. Conservative default chosen; say if a placeholder page is preferred.
1a. Codex adversarial review (Step C): a review missing its retained file also fails closed now (`review_bundle_incomplete`, 409, names the reviewer), matching (1) — no silent per-review skip.
1b. Separator-page text uses the standard WinAnsi (Helvetica) font, which cannot encode non-Latin reviewer names/affiliations (e.g. CJK); unencodable characters are replaced with `?` so assembly never throws. A Unicode-capable font requires adding the `@pdf-lib/fontkit` dependency plus a bundled Unicode TTF — neither exists in the repo today; owner call on whether to add them.
2. The bundle includes reviewer names and affiliations on separator pages, matching what the page already shows to the Board.
3. The bundle bounds (`MAX_REVIEW_COUNT` 25, `MAX_SOURCE_BYTES` 100 MB, `MAX_OUTPUT_BYTES` 50 MB in `lib/services/pre-site-visit/review-bundle-service.js`) are code literals. The owner rule of 2026-08-28 (mutable parameters live in admin-editable settings, code holds bounds and fallbacks) may apply if staff ever need to raise them. They are safety ceilings, not workload tunables, so they were left in code for this build; say if they should move behind `wmkf_appsystemsettings`.
