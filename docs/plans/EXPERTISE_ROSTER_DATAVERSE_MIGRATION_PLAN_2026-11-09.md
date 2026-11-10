---
title: Expertise roster Dataverse migration implementation plan
domain: expertise-finder
kind: plan
status: planned
summary: "Owner-approved roster shape and staged migration mechanics; expertise wording and lead-PD recommendation policy remain deferred."
owner: product-engineering
related:
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/plans/ROSTER_CONTACT_LINK_PLAN_2026-09-14.md
  - docs/atlas/postgres-infra-tables.md
---

# Expertise roster migration to Dataverse

## Status and authority

**PLANNED — no schema provisioned, import performed, or runtime change made by this work.**
Owner decisions below were settled with Justin on November 9, 2026. Justin developed the recovered design with Codex and sent it to Connor; Justin confirms Connor supports it. Connor's previous matcher embedded expertise in a Claude prompt executed by Power Automate. It is not evidence of an existing Expertise Profile table.

This plan replaces the recovered email's proposed Short ID, program partition, Match Type and roster dates. It also supersedes the roster comparison/selection task in J27 alignment log D15/X1/T8: the destination is a shared Dataverse roster, not an unresolved choice between two verified roster tables. Scoring, lead assignment, load balancing, and expertise prose are separate future work.

The target logical name `wmkf_expertiseprofile` below is a **proposed implementation name**, subject to metadata collision checks and normal schema review. Do not repurpose `systemuser.wmkf_expertise`: Connor confirmed it was created but never used.

## 1. Settled owner decisions

| Topic | Decision |
|---|---|
| Identity | One profile per person, one role category; title is separate. |
| Scope | Research only. SoCal will not use this roster. No Grant Program field or MR/S&E partition. |
| Categories | Preserve Research Program Staff, Consultant, Board. Do not turn every staff member into a PD. |
| Lead PD | Separate explicit eligibility setting, independent of category/title. User link required before eligibility can be enabled. Inactive profiles are never eligible. |
| Identifiers | Dataverse GUID is the canonical identity. No Short ID; names are for display, not joins. |
| Person links | Staff use a Dataverse User link. Consultants/Board may have a Contact link. Unlinked external profiles are a permanent supported state. Never auto-create Contacts. |
| Privacy | Board names and expertise may be stored in this table without creating Contact records. |
| Email | Optional. Preserve existing recipient behavior for dependent features; do not add invitations to expertise matching. Linked external profiles resolve current Contact email; unlinked ones may have maintained preferred email. |
| Lifecycle | Active/Inactive only; no start/end dates. Preserve historical identities. |
| Expertise | Preserve current structured fields as optional text. Wording/granularity and scoring remain deferred. No Match Type. |
| Editing | Preserve current access: anyone with Expertise Finder access can edit profiles, links, status and eligibility. |

**Import confirmations, not schema blockers:** Kevin Moses is retired and must be imported inactive. Beth Pruitt remains a roster member; her lead eligibility is unconfirmed, not inferred from CSO title or the old fallback rule. Identify the two new PDs and their User GUIDs with Justin. Do not infer their expertise. Until confirmed, lead eligibility defaults false; record the pending decision in the import report so false is not mistaken for a final owner decision.

## 2. Current contract and evidence

Source baseline: `f03936e3e`; recheck affected source before implementation.

| Entry / consumer | Current persistence and behavior | Evidence |
|---|---|---|
| Roster editor → roster API | Postgres CRUD; numeric ID; app-access authorization | `pages/expertise-finder.js` RosterTab/RosterForm; `pages/api/expertise-finder/roster.js` |
| Single / batch matching | Active roster read from Postgres; shared prompt-variable builder; result JSON stored in Postgres | `pages/api/expertise-finder/match.js`; `lib/services/expertise-finder/batch-match-service.js`; `shared/config/prompts/expertise-finder-dynamics.js` |
| Site Visit directory / attendee resolution | External references are `{kind:'roster', rosterId:number}`; active Board/Consultant rows; optional Contact email lookup | `lib/services/site-visit/recipient-directory-service.js`; `lib/services/site-visit/logistics-service.js` `normalizeRef` |
| Consultant feedback | Numeric FK; SQL joins supply current name/affiliation; active Consultant validation on create or changed author | `lib/db/migrations/048_consultant_feedback.sql`; `lib/services/consultant-feedback-service.js` |
| Contact links | One active roster row per Contact enforced by a partial unique index; linked unavailable/email-less Contact never falls back to manual email | `lib/db/migrations/050_expertise_roster_contact_link.sql`; recipient directory above |
| Other writers | Seed/backfill tools can write the old roster | `scripts/seed-expertise-roster.js`; `scripts/link-roster-contacts.js` |

**VERIFIED in this chat, November 9:** approved Production metadata search returned 2,189 entity definitions, no clearly named expertise/PD/consultant roster; User has unused `wmkf_expertise`. This is not proof that no differently named table exists. The approved non-null User-field query returned no rows. The Postgres staff query returned four profiles (Beth, Jean, Justin, Kevin), all active; new PDs were absent from that category. No full-roster/contact census or import parity was performed. Probe output was temporary; rerun appropriately authorized, committed probes before deployment. Do not treat these observations as schema provisioning evidence.

## 3. Proposed physical schema

All names/types in this section are implementation proposals, not live schema claims.

### Dataverse Expertise Profile

- Primary GUID; required display name (255 characters); standard state/status for Active/Inactive; standard created/modified metadata and auditing enabled.
- Required category Choice: Research Program Staff, Consultant, Board. Allocate actual numeric values during schema specification and use symmetric read/write mappings.
- `leadPdEligible`: Boolean, default false. Effective eligibility additionally requires active profile, staff category, and a valid enabled User link. This setting grants no app permissions and assigns no requests.
- Nullable User lookup for staff; nullable Contact GUID reference for external profiles (not a native relationship; see deletion semantics below). Enforce role/link compatibility server-side. Contact is never required for external profiles. A staff profile can be staged without a User but cannot become lead-eligible.
- Optional title, affiliation, ORCID, preferred email, primary fields, keywords, specialties, methods, distinctions, expertise summary, Keck affiliation and Keck-affiliation details. Preserve source values losslessly, including empty/null distinctions where behavior depends on them. Match or exceed existing field lengths; text sizing is verified from the full import dry run before schema application.
- No program, Short ID, Match Type, scheduled dates, or new Matching Guidance column in this slice. A future content decision may add guidance explicitly.
- Native optimistic concurrency/ETag required for edits. Disable/delete are different operations: app supports deactivate/reactivate; hard-delete is not exposed. Configure permissions and relationship behavior to protect referenced profiles from deletion.

**Duplicate enforcement:** each User/Contact may be linked to only one profile (including inactive profiles); reactivation reuses it. This strengthens today's active-only Contact uniqueness and requires an explicit duplicate reconciliation before import. Verify feasible Dataverse uniqueness enforcement in sandbox (alternate key on lookup or equivalent server-enforced mechanism); do not rely on an app preflight query alone. Unlinked profiles cannot be conclusively deduplicated by name: flag possible duplicates for human review; never merge automatically. If retained duplicates prevent these keys, resolve the data or return the design for review rather than inventing a merge policy.

**Contact deletion/merge semantics:** preserve the existing GUID-reference behavior rather than introduce a native Contact lookup with implicit cascade rules. A deleted/inactive/missing Contact leaves the stored GUID intact and yields no email; it must never silently revive preferred email. No roster relationship blocks CRM deletion. Contact merges do not auto-relink profiles: show the stale link for explicit staff repair to the survivor, with duplicate checks. Staff deliberately clearing a link explicitly reviews the manual address before using it. Sandbox tests cover delete, merge, inactive, missing email, and deliberate unlink. The Contact picker remains the UI. This is an engineering choice to preserve the existing link contract.

**Keys and permission enforcement:** prove multiple null values are permitted for optional unique references and creation keys in sandbox; verify every required alternate key is Active before import. If unsupported, stop and revise the schema (a separate non-null identity reservation table is the candidate fallback); do not deploy query-only uniqueness. Category changes atomically clear incompatible links and disable lead eligibility; require the editor to review that consequence. Readers fail closed on invalid direct-Dataverse edits. Preserve actor attribution through explicit acting-user context or a dedicated last-app-editor User field if native modifiedby remains the service principal; verify chosen behavior in sandbox and show native direct-edit attribution separately.

### Postgres identity bridge

The Atlas documents a shared Preview/Production Postgres database. Verify current bindings before rehearsal; never assume separate databases. Use a numeric identity table (proposed `expertise_roster_identity`, primary key `id`) as the feedback FK target, plus a binding table keyed by `(roster_id, target_host)` with unique `(target_host, dataverse_profile_guid)`. The server derives target_host from the trusted target registry/configuration, never request input. These tables hold no editable expertise, names, emails, or eligibility copies. Dataverse owns roster information.

Import existing numeric IDs unchanged into the identity table. Explicitly reconciled counterparts may bind the same numeric identity in sandbox and Production. A new sandbox-only person receives a new globally allocated number but no Production binding: Production must report that identity unavailable, never use the sandbox GUID or a name match. Never overwrite one environment's binding with another's. Advance the sequence past BOTH the largest ID and the old roster sequence high-water mark; sequence gaps are harmless.

Retarget `consultant_feedback.consultant_roster_id` FK to the numeric identity table after every referenced ID is present. Preserve existing numeric client DTOs and Site Visit/meeting JSON references. Return canonical GUID explicitly for integration. Resolve each numeric reference only within the current trusted Dataverse target. New identities remain globally distinct even with shared Postgres.

Dataverse create and Postgres mapping are not atomic. Use a client mutation UUID persisted as a unique Dataverse creation key to make replay find the same profile after a lost response, then idempotently ensure its numeric identity/binding in a local transaction. Unique `(target_host, profile_guid)` prevents concurrent replay creating two usable bindings; a losing transaction rolls back its unused identity. Report interrupted completion as retryable, not fully saved. For profiles created directly in Dataverse, provide explicit reconciliation before dependent app use. Never silently fall back to the old roster.

Unmapped profiles stay visible in roster administration with a reconciliation warning; edits address their GUID. Active selection for matching, new feedback and recipients fails with an actionable unavailable-roster error if needed profiles lack bindings. Historical lookup returns a visible unavailable-attribution state without dropping the feedback row. Delivery and attachment filename paths fail when required identity is unavailable. Tests must prove a sandbox-only identity cannot resolve in Production.

## 4. Runtime implementation

1. Add schema specs, DAL adapter/entity registration, and a shared roster service. Methods cover list/search, fetch by GUID/numeric bridge ID, create/update/deactivate/reactivate, historical identity resolution, and active selection. All Dataverse calls preserve trusted context and the target interlock.
2. Preserve list semantics with a complete bounded/paginated Dataverse read followed by deterministic in-memory search, sort, total count and offset paging; a cap or failed page is an error, never a partial roster. Preserve snake_case DTOs and `role_type, name` ordering at matching boundaries. Duplicate-link conflicts identify inactive holders too and offer reactivation. Route existing roster API through the service; keep access checks and existing list/edit UX. Add staff User picker and lead eligibility control; preserve optional Contact linking. Omit deferred fields. Name/affiliation stay explicitly maintained roster values; linking does not silently overwrite them. Contact email remains live authority. A broken linked Contact remains visible for repair but is ineligible for email delivery; no manual fallback.
3. Build single/batch service integration and prove DTO/roster-block parity with synthetic fixtures, without a model call. **Release gate discovered in Fable review:** the current APP prompt (not merely Connor's old prompt) recommends primary/secondary PDs, labels all staff assignable, and contains named expertise restrictions (`shared/config/prompts/expertise-finder-dynamics.js`). Therefore an unchanged prompt is not compatible with separate lead eligibility. Mechanics can be built now, but matching cutover must wait for an owner-reviewed minimal prompt/output integration contract: eligible lead candidates must be distinguished from active staff available for consultation; unconfirmed/noneligible staff cannot be returned as lead; empty candidate sets must have an explicit no-recommendation outcome; unknown or ambiguous returned identities must be rejected. Do not remove non-lead staff from advisory consultation. Compare roster-block hashes before intended eligibility changes and update golden fixtures for those explicit changes. No scoring, workload/fallback policy, expertise rewriting, or request writeback is authorized by this plan. The exact prompt/output adjustment remains a release prerequisite, not a silently settled schema decision.
4. Replace every feedback SQL join to the old roster with batched identity hydration, including list, create replay response, update, attachment filename generation, and shared briefing readers. New/changed author selection requires current active Consultant status; body/date/share edits with unchanged author remain possible after retirement. Preserve one-off authors and the existing exactly-one-author constraint, mutation replay, attachment authorization and interrupted-delete handling.
5. Feedback create first checks `(request_id, mutation_id)` for a completed prior operation, preserving authorization and attachment binding checks; return that operation before validating current roster eligibility. Only a new create remotely validates the selected active Consultant, then performs the local transaction/ON CONFLICT and rereads the winner. **This intentionally improves current behavior:** today eligibility runs before the conflict insert and can reject a replay after retirement. Test the concurrent winner as well as sequential replay.

   For update, perform an unlocked pre-read of the author/version, determine the resulting author and validate remotely only if it changes to a roster consultant. Then acquire the existing FOR UPDATE lock and recompute the patch against the actual row. If its author/version changed such that the validated result is no longer applicable, abort with a retryable conflict; do not save an unvalidated replacement or hold the lock across network I/O. Unchanged-author edits after retirement remain allowed. Remote validation is point-in-time: later deactivation does not invalidate previously saved feedback. Transient Dataverse failures return a distinct retryable 503 (`roster_identity_unavailable`), never attachment_conflict/attachment_target_gone; upload finalization must retain its Ready registry item/staging retry path rather than clean it up as a permanent loser. Preserve all existing attachment and replay authorization.
6. Historical read failures must be explicit: retain feedback rows and signal unavailable attribution; do not silently produce a blank consultant or treat the failure as no feedback. Attachment filename and delivery paths fail clearly when required identity cannot be established. Retired profiles resolve for attribution but not new attendee selections. Existing delivery snapshots are not rewritten.
7. Switch Site Visit/Meeting Tracker consumers that use this directory; preserve separate staff-profile identity and curated Contact-based distribution behavior. Recheck all callers rather than replacing similarly named but semantically different directories.
8. Update seed/link tools to use the new service or refuse execution after cutover; no remaining independent Postgres roster writer. Search raw table names, numeric roster fields, category literals, and cached roster DTOs across code/scripts/tests before release.

## 5. Import, cutover, and recovery

### A. Prepare and inventory

Commit a dry-run-first import/probe script. Read exact source columns, all active/inactive profiles, duplicate User/Contact links, existing feedback FKs and persisted attendee references, including `wmkf_attendeerefsjson` on Site Visit, deliberation sessions and deliberation slots. Trace readers in `lib/services/meeting-tracker/session-service.js`, `lib/dataverse/adapters/deliberation-slot.js`, `lib/services/pre-site-visit/distribution/context.js` and `lib/services/meeting-tracker-transcription/binding.js`. These Dataverse data reads need their own scoped authorization; metadata approval does not cover them. Export restricted, environment-labelled evidence outside tracked Git; no personal roster dumps in the repo. Capture source checksums and row-level proposed mappings, conflicts and explicit owner-confirmed overrides. Seed no guessed new-PD identities. Validate all unknown categories and oversized fields fail closed.

### B. Sandbox rehearsal

Provision the reviewed schema in sandbox with its own identity links; use synthetic identities where actual counterparts are unavailable. Apply additive bridge migration with `node scripts/apply-migrations.js`, never fresh-install setup on an existing database. Import into an empty or reconciled destination with stable migration provenance, recording exact per-row success/failure IDs. Retry only unresolved operations; prove no duplicate profiles/mappings on repeat and after interrupted responses. Preview must target sandbox and never reuse Production bridge mappings. Verify every field, not only row counts.

### C. Production switch (separate owner-authorized release)

Pin the release commit and verified rehearsal evidence. Coordinate a short freeze of all roster writers, including app routes, scripts, and any Connor/direct-Dataverse writes. Enforce the old-table freeze at Postgres with a narrowly scoped maintenance guard tested against both direct writer scripts and app writes; merely hiding the editor is insufficient. Release only the intended migration writer under explicit control. Define installation/removal and verify frozen writes fail before the final export. Take a final export and import delta; verify complete mappings and parity before changing the feedback FK and enabling new readers/writers. Deploy coupled consumers together; no mixed deployment with legacy writers still accepting edits. Preserve the frozen source table and match history. Verify current editor, matching, recipient lookup, and feedback in the approved venue. No invitations or model calls are needed for the migration's basic parity checks; any paid or live operation needs its own appropriate authorization.

### D. Rollback

Before accepting new Dataverse edits, rollback can restore old readers/writers and the original FK against preserved source rows. After accepting new edits/profiles, rollback is no longer a switch: pause writers, export/reconcile Dataverse changes into the old table with the same bridge IDs, ensure all feedback FKs are satisfiable, advance the restored old sequence beyond both ID high-water marks, remove the old-table freeze only when verification passes, then restore old behavior. Rehearse this with a new profile and changed/deactivated existing profile. If reconciliation is unsafe, keep editing paused and repair forward. Do not lose post-cutover changes. Dropping old tables, columns, or mappings is outside this plan and requires live-caller verification later.

## 6. Acceptance and gates

- Schema: nullable optional links, compatible categories, lead eligibility enforcement, unique creation keys/links, concurrency and no hard-delete UI. Raw/unrecognized category values fail closed.
- Identity: no duplicated person on retry; numeric references stable; bridge IDs allocated for new profiles; environment isolation; missing mappings produce actionable errors.
- UI: same list/search/edit/deactivate behavior; current access preserved; pending save and fetch generations cannot update a different selected person; conflict reload preserves unsaved edits for review.
- Feedback: historical inactive consultant still attributed; unchanged-author edit succeeds; new inactive/non-Consultant rejected; one-off unchanged; mutation replay after retirement; failure during hydration visible; attachment/shared views retain authorization.
- Directory: linked Contact email authority/no fallback, permanent unlinked Board with/without email, inactive/no-email excluded from delivery, legacy numeric refs and existing snapshots preserved.
- Matching: single/batch use same eligible roster source; inactive excluded; active non-lead staff retained; historical JSON unchanged; no new scoring or assignment behavior.
- Migration: per-field parity, duplicate conflicts, partial failures, retry after Dataverse-create/bridge failure, stale edits, concurrent reconciliation, sequence advancement, freeze and rollback after new writes.

Implementation adds meaningful unit, integration and browser contract tests. Run relevant gates and their self-tests sequentially: migrations-manifest, factory-ledger when configured, agent-invariants if applicable, API routes, Atlas, types, trust-boundary-guid, Dataverse access layer, route-service/lifecycle/context boundaries, prompt-injection tagging if prompt serialization changes, and document/fact/canonical-pointer gates. Check the actual package script list for current names. Update existing-DB manifest, fresh-install shape, Atlas, service catalog, route security matrix and affected tests alongside implementation. Add schema/destination permissions and column auditing verification to release evidence.

## 7. Work packages and review

1. Schema specification + import inventory (no Production mutation).
2. DAL/service + identity bridge + recovery tests.
3. Editor + every dependent read/write path.
4. Sandbox import, end-to-end regression, rollback rehearsal.
5. Separate approved Production release and readback.

Code work uses a fresh implementation branch under the release strategy. This document's existence authorizes neither schema deployment nor import. No feature work is included in this planning commit.

Review status: two Claude Fable 5.2 OAuth reviews completed November 9, 2026, both **READY WITH NAMED CHANGES**. First review and applied disposition: `docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_2026-11-09.md`. Second review of `acc1f7507`, session `21ea0ecc-c011-4f40-b0bf-6aa841d55662`: `docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_2_2026-11-09.md`. The second review confirms most earlier fixes but leaves B1–B5 OPEN: rehearsal database/dual allocator isolation; prompt gate tied to cutover and per-target prompt rollout; per-consumer handling of unmapped/invalid rows; Contact GUID uniqueness type; deterministic import idempotency. These qualify the proposed mechanics above; do not execute affected work packages until repaired. Additional rehearsal gates are recorded in the second review. No runtime or unconditional implementation readiness is claimed.

## 8. Durable context and limits

The historical contact-link plan and Atlas still accurately describe current Postgres behavior until cutover. Update them at implementation, not to falsely claim migration shipped. This plan is linked from the isolated branch's session handoff for discovery. The root checkout has concurrent owner/Claude WIP and is not edited. Any cross-branch reconciliation must preserve that work. Full live schema/roster census, actual flow integration and implementation tests remain pending; no completeness claim extends to those surfaces.
