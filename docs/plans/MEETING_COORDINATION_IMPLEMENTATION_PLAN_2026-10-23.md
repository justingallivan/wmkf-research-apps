---
title: Meeting Coordination Implementation Plan
domain: product
kind: plan
status: proposed
summary: Staged implementation of the Workbench-first meeting design, durable preparation and Program Coordinator approval of versioned Board materials; source-reviewed, not implemented.
canonical: false
owner: product-engineering
related:
  - docs/plans/review/MEETING_TRACKER_LANDING_STRUCTURE_2026-10-20.md
  - docs/plans/review/meeting-tracker-2026-10-20/workbench-audience-flow.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Meeting coordination implementation plan

## Purpose and boundary

[PLANNED] Finish the saved Meeting Tracker redesign as one coherent workflow: Program Coordinators prepare meetings and materials in Meeting coordination; PDs work from the request Workbench, with draft writeup/review first, supporting outputs second and meeting logistics behind a compact link. Reuse existing scheduling, collection, upload, transcription, document and email services.

[VERIFIED via owner instruction, 2026-10-23] This session authorizes preparing this implementation plan. No runtime code, schema, deployment, live records, mail, paid processing or environment settings are changed by this plan. The product decisions below are settled; the proposed technical design requires implementation verification. No live schema or production configuration was probed for this planning pass.

Scope includes cycle/session navigation, meeting setup and agenda controls, invitation continuity, materials collection, recording import/review, durable output preparation, summary editing, Board approval/withdrawal and Workbench consumption. Existing meeting/calendar automation is not expanded into a new calendar invitation service. Do not rename internal app keys, existing routes, entities or artifact enums merely to adopt approved display terminology.

## Settled product requirements

[VERIFIED via the owner's decisions in this chat and the linked design record]

1. Research presentations require video. Missing video is incomplete preparation requiring recovery; no audio-only Board approval path. Do not assume audio and video failures are technically coupled.
2. After checked speaker names and presentation ending, **Save and prepare materials** saves the review and prepares presentation/internal transcripts, both summary drafts and the presentation video. Preparation alone never grants Board access.
3. Keep **Presentation** separate from **Staff discussion · Internal only**. Preserve the video-ending and summary-review confirmations for now. Presentation summary **Save draft** does not approve it.
4. The assigned **Program Coordinator** reviews the presentation summary and explicitly approves materials for the Board. No additional PD review is required. Existing superuser preparation access does not independently grant approval authority.
5. Approved materials stay available while corrections are drafted. Reviewed replacement approval switches the Board to the replacement. A separate **Withdraw from Board** action removes future application-mediated access immediately.
6. Persist checked speaker names, presentation ending and summary drafts; processing survives leaving the page. Return shows durable progress. Preserve successful work and retry only failed/unfinished work, with uncertain paid operations reconciled before retry.
7. Materials collection requests/reminders/confirmations use the assigned Program Coordinator. Resolve assignment through Admin configuration, never a hardcoded person or application permission.
8. Carry selected staff, Board and consultant attendees from setup to invitations for both meeting types; an intentionally empty group must stay empty. Preserve message/recipient review before send.
9. Use existing `@hello-pangea/dnd` integration patterns for agenda ordering, including keyboard support, a dedicated handle and protection against list changes during dragging. Keep allotted minutes, position changes, moving between sessions, removal and overrun feedback.
10. Remove the Meeting Tracker non-sensitive/provider/credit acknowledgement dependency as a coordinated UI/service/route change. Preserve historical acknowledgement records and the separate admin pilot contract. This is not permission to fabricate acknowledgement timestamps or silently remove other disclosures.

## Current implementation evidence and gaps

[VERIFIED via source inspection on branch codex/session-start-20261023, base b8c957076; source facts only]

| Existing surface | Evidence | Consequence for implementation |
|---|---|---|
| Saved designs and task workspace | Linked layout plan and standalone HTML | Layout and interaction examples exist; controls do not establish application persistence or permissions. Sessions/detail density and final role/lifecycle composition still need design validation in the build. |
| Separate transcript/save/publish/generate controls | `shared/components/meeting-tracker/RecordingAndTranscriptCard.js`: `saveNames`, `publishJob`, `publishCorrection`, `generatePresentationTranscript`, `SummaryBlock`, `TranscriptWorkflow` | Combined preparation changes behavior across services; a renamed button is insufficient. |
| Request/site-visit binding | `lib/services/meeting-tracker-transcription/binding.js`: `loadMeetingTranscriptionBinding` | Verifies eligible request and exactly one active visit, supports expected visit identity; reuse and retain these checks. |
| Durable transcription and dispatch | `docs/atlas/postgres-transcription-pilot.md`; `lib/services/transcription-pilot/store.js` | Existing leases, dispatch outbox and submission-uncertain handling are reuse seams, not permission to resubmit unknown provider work. Atlas deployment statements are dated evidence, not a fresh live probe. |
| Correction-triggered transcript queue | `presentation-transcript-regeneration-store.js`; migration 081; its Atlas page | Queue has pending/running uniqueness and lease-fenced transitions. It covers transcripts, not both summaries/video; enqueue failure is swallowed after publication, and reconciled publications do not automatically enqueue. New orchestration must close those gaps. |
| Durable summary editing | `summary-draft-store.js`: `updateSummaryDraftText`; summary draft Atlas | Version-fenced editing exists. Drafts currently expire after 14 days and may be cleared on terminal state; returning later must retain that explicit retention behavior unless separately changed. |
| Summary generation is synchronous | `transcript-summary-service.js`: `createSummaryDraft`; summary-draft API POST allows 300 seconds | Durable reservations exist, but prompt execution remains inside the request. Move execution behind a persisted preparation step; don't claim browser-independent recovery from the current handler. |
| Background video cut and distinct approval | `presentation-video-split-service.js`, `presentation-video-approval-service.js`; video-split Atlas | Reuse cut worker, output identity verification, leases and registration reconciliation. Existing approval registers one video; it is not whole-bundle approval. |
| Current Board artifact selection | `presentation-page-service.js`: `eligiblePresentationRows`, `resolvePresentationMember`; `presentation-video-binding.js`: `bindPresentationVideo` | Picks per-type winners bound to the current transcript/recording. A changed draft source can hide prior outputs. This conflicts with retaining an approved version during correction. |
| Second external consumer | `lib/services/deliberation-briefing/briefing-page-service.js`: `outsidePostPresentationRows`, `loadMaterialRows` | Both external listing and open paths must use the same approval decision; fixing only the presentation page leaves another exposure path. |
| Existing expiry/link lifecycle | `presentation-link-service.js`: ensure/reissue/get live link | Independent 60-day token lifecycle. Bundle withdrawal is a separate operation; don't reissue links or withdraw proposal/applicant material accidentally. |
| Media open returns a redirect | external presentation open route; `resolvePresentationMember` | Future requests can be denied, but a previously issued Microsoft URL, open stream or downloaded file cannot be recalled by an application pointer update. |
| Shared Admin coordinator role | `lib/services/board-writeups/model.js`: ROLE_KEYS; `config.js`: getRole/saveRole/eligibleStaff | Reuse `getRole('programCoordinator')` for assignment, verify current eligible linked actor and request/app access. Do not substitute Final Writeup personas or request `_wmkf_programcoordinator_value`. Live assignment remains unprobed. |
| Current access entry points | video-split route and summary-draft route use `requireAppAccess`, actor/profile checks and `withDalContext` | Add coordinator authorization for Board review/approval/withdrawal on the server; preserve existing restrictions and DAL target/write interlock. |

No new provider, storage platform or orchestration framework is proposed. Exact service extraction boundaries and deployment wiring are selected during the focused source pass for each slice.

## Proposed durable contract

[PLANNED — logical schema; reserve migration numbers only when implementing]

### Preparation revision

Use one content-free preparation record per request/visit/input identity, plus bounded step records. Proposed physical names: `meeting_material_preparations` and `meeting_material_preparation_steps`. Keep transcript text and summary text in existing authorized stores; don't duplicate content in the coordinator record.

Freeze request/visit, saved review version, source transcript revision/fingerprint, presentation end, recording/copy identity and relevant slides identity. Record initiating actor, optimistic version, dispatch/lease state, timestamps, per-step operation IDs, outputs and sanitized failure/recovery codes. Use a unique input identity so a repeated click returns the existing preparation. An explicit rerun has a new attempt identity and never silently replaces an edited ready summary draft.

Steps: save/publish reviewed source internally; generate presentation transcript; generate discussion transcript; draft presentation summary; draft discussion summary; cut presentation video. Represent missing discussion as an explicit no-discussion result using the existing semantics rather than an endless failed step. Video is required for approval. Internal summary work remains separately recoverable and cannot make internal output eligible for Board access.

Commit the preparation and dispatch intent together in Postgres. If the existing source save/publish must happen first in Dataverse/SharePoint, record an operation intent before it and recover by its publication receipt/generation identity. A crash between systems must leave a queryable operation, not a false completed receipt. Do not rely on the currently swallowed regeneration enqueue to deliver the combined action.

Queue workers claim with expiring leases and compare-and-swap writes, enforce expected revision/input identity before work and after long waits, and revalidate actor/request eligibility before side effects. Reuse existing child jobs rather than duplicate their work. Successful step output IDs are durable; retry never clears them. No worker may mutate a different request after a UI context switch or source revision change.

Persist provider submission intent and attempt identity before dispatch. A timeout after dispatch becomes **needs attention / outcome unknown**, not automatically retryable. Reconcile using Executor/provider receipts where supported; if an outcome cannot be proved, stop that step visibly rather than inventing exactly-once billing. Retry only confirmed failures/unfinished undispatched work. Parent leases alone cannot prevent duplicate paid calls across a crash.

[VERIFIED via focused independent source review] `summary-draft-store.js` currently treats a generating row older than 360 seconds as abandoned and replaceable; `transcript-summary-service.js` marks every Executor exception failed. Slice 2 must change these child-store/service contracts for orchestration-owned runs: an unknown submission remains protected until confirmed failure or reconciliation, regardless of age. Existing summary POST must respect that ownership and cannot bypass the parent ledger. Test a provider-outcome-unknown run older than 360 seconds with a concurrent legacy generation request; it must not dispatch another paid call. The proposed new protection is PLANNED, NOT TESTED.

### Approved presentation edition

Propose `meeting_presentation_editions` for immutable, content-free approved member identities, and one `meeting_presentation_visibility` row per request as the authoritative active-edition pointer plus monotonic version and withdrawal/audit metadata. These are operational publication receipts, not a replacement document registry. Dataverse Request Documents and SharePoint remain artifact/byte authorities.

An edition identifies the reviewed presentation transcript, reviewed summary and checked video, their source revision/boundary, exact document/file/version/hash identities and coordinator approval actor/time. Exclude the full recording, full transcript, staff transcript and staff summary through an allowlist. Existing Board presentation UI may continue to list only summary and video; hidden-but-openable presentation transcript must still pass the edition check.

Prepare and register all candidate artifacts under recoverable operation identities before switching visibility. Newly registered artifacts do not become externally eligible merely by being current per-type winners. After validation, insert the immutable edition and atomically change the visibility pointer in one Postgres transaction guarded by expected visibility version, preparation version and approved input fingerprint. Revalidate source/file identities before commit. A partially registered replacement leaves the old approved edition active and reports pending reconciliation.

Retain exact prior approved artifact/file versions while referenced. Existing `settleWinner`, superseding, split lookup and cleanup paths cannot be used unchanged if they hide or delete referenced artifacts. Resolve approved members by exact identity rather than current winners, and preserve byte-integrity and request-boundary checks. A superseded operational split must not erase evidence needed to serve an earlier approved edition. Never broaden all superseded-row reads globally.

Withdrawal clears the active pointer and records actor/time using expected version. Concurrent approval/withdrawal must conflict rather than revive a withdrawn edition. A later deliberate approval may publish a reviewed edition; retries of the old approval cannot undo a newer withdrawal. Keep proposal, slides and other applicant-material eligibility under their existing contracts; this action withdraws the approved presentation set.

Every external context/list/open/download/watch path checks current visibility with no positive authorization cache. Unknown storage/configuration state fails closed for presentation members, not back to current-winner selection. Returning staff see the draft preparation and separately labeled approved edition; the Board sees only the active edition. Workbench staff readers retain staff-only access and may show current drafts without implying Board approval.

**Revocation limit:** withdrawal blocks new application-mediated access after commit. Already delivered files, an open stream and previously issued Microsoft download URLs are outside that guarantee. Keep this limit explicit in operator copy and acceptance evidence. A stronger streaming-revocation guarantee would require a separately scoped delivery design; don't route large video bodies through ordinary Functions or claim instant recall.

### Retention and acknowledgement compatibility

Preserve the existing 14-day summary draft expiry in the first implementation; show expiry before it happens, surface expired work on return, and require explicit regeneration rather than silently charging again. Retain successful nonexpired outputs. Reference-aware cleanup must never delete active approved edition members. New ledgers contain no transcript text, credentials or media URLs; purge unreferenced terminal preparation detail after the existing relevant artifact retention period, with a concrete policy recorded before migration approval. Do not add a new indefinite content store.

Removing the Meeting Tracker input acknowledgement must cover UI conditions, Zoom import/start route validation, internal import-to-transcription callers, queue/runtime checks and database constraints. New jobs must truthfully record no human acknowledgement (nullable or an explicitly separate provenance field); preserve historical timestamps and the admin pilot's acknowledgement. Summary generation has a separate acknowledgment contract today: preserve it unless a traced compatibility change is needed for the combined action. Do not pass a fabricated browser acknowledgement from a worker. If that contract prevents the approved one-action flow, document the exact conflict before implementation and resolve its record semantics without silently deleting the disclosure.

## Delivery slices and acceptance

All slices stay on isolated feature branches and preserve Claude's Stage B surface. Runtime release is Tier 2 because it changes external visibility, jobs and persisted state. Do not merge or push main without deliberate owner promotion.

| Slice | Work and likely surfaces | Exit evidence |
|---|---|---|
| 0. Characterize and pin contracts | Existing route/service/store/Board consumer tests; shared coordinator assignment; exact current cleanup/winner behavior; schema/environment readback at the approved target | Reproducible baseline for both external pages, staff readers, current drafts and queues. Inventory every alternate writer and consumer. Record unknowns without broad remediation. |
| 1. Approved editions and visibility | New store/service seam in post-presentation-materials; additive migrations; exact-version artifact resolver; both external readers; approve/withdraw routes; reference-aware retention | Old approved set survives draft source changes; partial registration cannot switch visibility; withdrawal denies direct old-member access through both external routes; coordinator-only actions and stale-version conflicts proven. |
| 2. Durable preparation | Content-free preparation/step/dispatch records; orchestration near meeting-tracker-transcription; existing transcript/summary/video services and workers | Close/reopen, process death, duplicate click, partial success, uncertain submission, source replacement and failed enqueue recovery all exercise real persisted state. No duplicate child job for one step identity. |
| 3. Recording and preparation UI | Focused components extracted from RecordingAndTranscriptCard only where needed; Zoom/manual import, playback and boundary check, Save and prepare, summaries, progress, approval and withdrawal | One coherent flow; drafts reload; review confirmations reset on relevant edits; no stale post-await writes; failures remain actionable; video required; internal output excluded from Board. Remove Meeting Tracker acknowledgement dependencies together. |
| 4. Before-meeting workspace | MeetingTrackerList, SessionEditor, SessionAgendaPanel, SiteVisitEditor, materials components and existing services | Setup/agenda/invitations/collection form the four-task workspace with transcript preparation. Attendee selections and empty groups persist correctly; keyboard reordering and concurrent edits work; send uncertainty and upload recovery preserved. Resolve session-list density and role/lifecycle variants in browser review. |
| 5. Workbench and release | StaffDeliberationsTab, site-visit/logistics-service, staff text/video readers, approved display names and links | Writeup/review remains first; staff-only discussion stays internal; PDs access authorized outputs without processing controls. Integrated rehearsal, build, scoped gates and owner promotion completed. |

Slices 1–3 are an integrated dependency chain and stay disabled for ordinary traffic until verified together. Independently useful layout work may land earlier only if it preserves the existing behavior. Approval/withdrawal requires a consistent reader/writer release, never an old external reader silently serving newly registered candidates.

## Proposed API and authorization shape

[PLANNED] Add request/visit-scoped preparation GET/POST plus retry, and edition approval/withdrawal commands only where existing routes cannot express the contract safely. Exact filenames are finalized in Slice 0, registered in the API security matrix and route lifecycle registry before creation. Use strict body allowlists, GUID/version validation, authenticated profile/system identity, request restriction context and `withDalContext`. Never accept actor identity, arbitrary file paths, hashes or a client approval flag as authority.

GET returns preparation ID/version, input revision, saved review, per-step state/output identifiers, durable recovery options, active approved edition and actor-derived capabilities. POST returns the persisted operation even if dispatch delivery is pending; it never says materials are ready merely because source save succeeded. Retry names preparation, step and expected version. Approval names the exact reviewed preparation/draft versions and expected visibility version; server validates all members and coordinator assignment. Withdrawal names expected active edition and visibility version. Repeat delivery of a completed command returns its prior receipt only if it cannot overwrite a newer visibility transition.

Coordinator configuration missing/unreadable, inactive staff, identity mismatch or missing app/request access denies approval and withdrawal with an actionable configuration error. Do not use `eligibleStaff`'s default reviewers-app requirement to accidentally exclude a coordinator who has only Meeting Tracker access; select its existing appropriate option and retain the actual app guard. Existing broader staff preparation access is retained; it does not authorize Board publication through legacy summary/video approval endpoints. Migrate or gate those alternate writers so they cannot bypass edition approval.

## Transition and rollback

[PLANNED] Use additive migrations through `scripts/apply-migrations.js`; update manifest, fresh-install replay, Atlas, service catalogue and route/security registries. Do not choose a migration number now or collide with concurrent agents. No entity deletion, table drop or automatic historical-data rewrite is part of this plan.

Existing presentation sets have individually published members and video approvals, not proof of whole-edition coordinator approval. Do not silently manufacture new approval receipts. Initially leave non-enrolled requests on the existing contract; enroll one approved rehearsal request only after an explicit coordinator review creates its first edition. Before changing its writers or registering candidates, activate its new visibility reader in a blocked/no-edition state and validate old links; switch all readers together. Ordinary existing requests keep their current read behavior until deliberate migration. Inventory and reconcile existing in-flight jobs before enrollment.

Enrollment is sticky once new artifacts or withdrawals exist: a global flag-off or deployment rollback must not expose current winners again. Keep the edition-aware deny/read seam in the rollback floor, stop new preparation dispatches, retain reference protections and preserve withdrawal tombstones. Do not roll back to a pre-edition external reader for enrolled requests. Record a compatible last-known-good deployment and staff recovery path before release. Code rollback cannot undo external writes or paid processing.

## Verification matrix

[PLANNED — tests below have not been run for the new contract]

- Real PostgreSQL integration: input-identity uniqueness; two workers and lease takeover; lost/stale worker completion; atomic dispatch; optimistic edits; approve/withdraw race; rollback on failed visibility switch; a repeated old approval after withdrawal; clean install and existing-database migration.
- Services: unchanged input reuses completed outputs; edited summary is not overwritten; expired draft produces a visible recovery state; no discussion is explicit; missing video blocks approval; registering one member does not expose it; old approved bytes remain usable during correction; corrupt/missing pinned bytes fail closed.
- Provider boundary: failure before dispatch may retry; timeout after intent does not automatically submit again; crash after accepted result reconciles or pauses; no test calls real paid services. Existing Executor budget/model-loading/audit contracts remain intact.
- Security: assigned coordinator allowed; other staff/lead PD/superuser without that assignment denied for approval/withdrawal; missing role/config read fails closed; legacy publish endpoints cannot bypass; cross-request IDs and forged actor data rejected.
- External consumers: populate full recording, internal transcript/summary, draft replacement and approved members in the same fixture, then prove only active approved presentation members are listed/openable. Test both presentation and briefing routes, direct member URLs, expired tokens, withdrawals, cached page refresh and unknown store state. An absent sensitive artifact is not an exclusion test.
- Browser: Zoom/manual entry; video playback and boundary correction; save draft/reload; leave while preparing; mixed success and retry; older tab/source change; correction while Board reads old edition; approve replacement; withdraw; all relevant role/lifecycle, loading, empty and error views; keyboard agenda ordering and narrow-screen controls. Synthetic media only by default.
- Existing contracts: meeting sessions/slots, invitation recipient selection, preview/send outcome, upload recovery, request restrictions, staff text/video and writeup/review flows remain covered.

Relevant gate families for runtime slices: migrations-manifest, Atlas, API routes, route lifecycle/auth, route/service boundary, request-document writers, Dataverse DAL, trust-boundary GUID, dynamics-context boundary, status-enum parity, prompt-injection tagging/model override warming for changed prompt seams, types, lint and production build. Add focused existing and new Jest/PostgreSQL/browser suites by touched surface. Run each gate and its self-test sequentially. Documentation-only planning checks are recorded separately below; they prove neither runtime behavior nor live readiness.

## Contract-reconcile planning review

| Audit | Planning result |
|---|---|
| Whole flow | Entry is Save and prepare → server-bound request/visit → durable operation/dispatch → existing child services → verified files/registry → coordinator approval pointer → external and staff consumers. Every hop needs implementation evidence before completion. |
| Partial success | Per-step IDs/states survive; uncertainty is distinct from failure; registration and visibility switch have separate receipts; no all-or-nothing success inferred from source save. |
| Async/stale state | Input revision and optimistic versions fence server writes; request/preparation generation guards or aborts cover every post-await UI success/error write and poll. Leaving the browser cannot be the job scheduler. |
| Helper semantics | New edition selection is external publication policy, not a global replacement for staff current-artifact binding; retain staff/internal differences and shared pilot behavior. |
| Durable surfaces | Additive schema/manifest/Atlas/API/catalogue work is required at implementation, not represented as provisioned now. Retention for new terminal ledgers remains a Slice 0 technical specification. |
| Documentation | This plan and the controlling design record distinguish owner decisions, inspected current source and proposed mechanisms. Historical handoff snapshots remain historical. |
| Symbol fan-out | Trace raw source revision, artifact type, lifecycle, split approval and visibility fields through external presentation/briefing, staff logistics/text/video, background writers and cleanup. New states require total maps/filters and explicit safe default branches. |

Recommendation evidence: approved-edition design addresses the current-winner and current-source checks inspected in the external resolvers; durable preparation addresses synchronous summary execution and non-atomic enqueue. These designs are **PLANNED, NOT TESTED**. Disconfirm them in Slice 0 by showing an existing shared mechanism already supplies the complete frozen-edition or browser-independent recovery contract; reuse it if proven. No claim of implementation readiness or live-state parity is made.

## Planning evidence and remaining work

[VERIFIED via this session] Product decisions came directly from the owner. Source and Atlas inspection identified reuse seams and concrete incompatibilities. No production data or credential values were read, no schema was applied, and no metered operation was invoked.

[UNKNOWN — implementation prerequisites] Current target schema/permissions and coordinator assignment; full cleanup/reference fan-out; exact legacy-reader enrollment seam; concrete bounded retention for new metadata; summary acknowledgement compatibility with the one-action flow; current background runner configuration and end-to-end delivery. Resolve these in the bounded Slice 0 pass before schema/runtime edits. They are technical verification tasks, not a request to reopen settled product choices.

## Review and planning checks

[VERIFIED via fresh-agent read-only technical review, 2026-10-23] Focused review returned READY WITH NAMED CHANGES: protect orchestration-owned summary runs from the existing 360-second abandonment rule and generic failed/retry transition. That requirement and the legacy-endpoint interleaving test are now explicit above and belong to Slice 2. The reviewed external reader, approved-reference retention, withdrawal race, rollback-floor and shared-role contracts had no additional blocking findings. This is a focused review, not exhaustive source/cleanup fan-out acceptance.

[VERIFIED via local planning checks] Documentation currency, symbol references, build-claim freshness (each followed sequentially by its self-test), docs catalogue and diff whitespace checks passed. These are documentation checks only; no new runtime tests or live-state probes ran.

Changed-fact reconciliation: owner instruction → linked design decisions → this proposed build contract. Product intent is VERIFIED; runtime mechanisms are PLANNED; deployment/configuration and remaining technical prerequisites above are UNKNOWN. Historical handoff snapshots are excluded because they preserve dated decisions. The controlling design links this plan; no current task priority or unrelated roadmap is changed.

Plan verdict: **staged implementation plan prepared; focused review change incorporated**. Slice 0 verifies the named technical prerequisites before runtime/schema work; no claim that the proposed implementation is already built or production-ready.
