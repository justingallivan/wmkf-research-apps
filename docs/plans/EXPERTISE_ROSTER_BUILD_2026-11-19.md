# Roster migration and Admin editor — build evidence

Status: implementation and focused verification completed; Opus correction verification returned code ready. Production import, migrations 103/104 and the Dataverse-backed Admin editor are complete. Amy ID 40 remains active and lead-PD eligible with her existing profile and future email preserved; no app access was granted and nothing was sent. See [production execution report](EXPERTISE_ROSTER_PRODUCTION_EXECUTION_2026-11-19.md). Backend automation and app retirement remain separate.

The verification sections below record the pre-deployment build/review snapshot.

| Invariant | Surface | Verification |
|---|---|---|
| Exact Contact GUID preservation, including Consultant→Staff | Import planner, DTO, editor | Mapping mismatch/exclusion tests; category-edit test |
| Admin-only writes with authenticated Dataverse actor | Admin/legacy routes, service, adapter | Denied caller, missing actor, no fallback tests |
| Preserve numeric IDs and inactive historical names | Bridge, feedback, recipients | Consumer fixtures; SQL bridge tests |
| Failed imports/saves remain retryable without duplicate people | Import/store, creation key | Partial failure and retry tests |
| Dataverse outage is not empty roster or excluded author | Consumer service, briefing | Error-path tests |
| Postgres default and rollback editor remain available | Mode, legacy route, UI | Default/invalid mode tests |
| Single matching establishes trusted DAL context | Match route | Real-context route test with mocked transports |

Entry points: Admin roster API/editor, legacy Expertise Finder routes, import CLI.
Persistence: Expertise Profiles in Dataverse; numeric bridge and existing feedback/history in Postgres.
Consumers: matching, feedback/attachments/briefing, Site Visit/meeting recipients, proposal lists.
Concurrency/draining/sandbox subsystems: N/A by owner direction.

## Verification and scope

[VERIFIED via local commands, November 19] 365 tests across 32 focused suites pass.
Includes Admin authorization/identity, create retry/prebinding failure, null User
bind omission and atomic clear, Contact preservation across category changes,
import field/key conflicts and health acknowledgement, historical/excluded author
hydration/outages, existing feedback/recipient/proposal-list flows, and matching
with real DAL context and mocked HTTP/model transports. No paid model matching.

Scoped gates passed, each self-test sequential: migrations manifest, agent
invariants, API matrix, Atlas, doc currency, canonical facts/pointers, docs catalog,
doc symbols/build-claim freshness, prompt-injection tagging, GUID boundaries,
Dataverse/context/service boundaries, route lifecycle auth, secret scan, types.
Production-mode Next.js webpack compile passed from an env-file-free source copy;
existing dependency/dynamic-import warnings remain. The compile after the major review
corrections also passed. Final bounded feedback/diagnostic refinements passed their
focused suites and scoped gates; they introduced no new imports or build configuration. No application credentials or external data calls in that build.

Desktop (1280px) and mobile (390px) fixture screenshots inspected: list/editor,
category change, text fields, identity controls, active state and Save/Cancel;
no mobile horizontal overflow. Actual component and shared Button compiled with
synthetic responses. This is not signed-in production acceptance.

## Independent review

Opus 5.5 via host OAuth found two blockers in the initial implementation: null
lookup bind and post-create binding window. Both corrected, along with save
recovery/Contact-health/diagnostic issues; see
[verbatim report and dispositions](EXPERTISE_ROSTER_BUILD_OPUS_REVIEW_2026-11-19.md).
Follow-up verified the corrections and returned code ready with no new blockers.
Nonblocking summary/one-off feedback outage refinements were then tested; see the
saved review dispositions. No Ultrareview or agent API-key session.

## Contract and sweep evidence

Historical build-stage sweep Mode A: the changed fact at that checkpoint was branch implementation, not deployed storage. New
Atlas page describes Expertise Profiles plus the two numeric bridge tables;
Postgres Atlas explicitly retains the default production baseline, and feedback
eligibility describes the selected backend. API matrix, service catalog,
credential selector, canonical route count (336), plan and session pointers updated.
Historical planning reviews/parked-branch evidence remain dated. No automation,
retirement or production-readiness claim is introduced.

Whole-flow: Admin UI → superuser route/session actor → DTO/service → adapter and
preallocated numeric binding → returned member → list/form. Consumers project IDs
without copying roster content. Import is source export → strict plan → sequential
keyed write/readback → binding/per-ID private receipt → separate verification →
operator-only FK/backend switch. Exclusions preserve identity but no selectable row.

Complements: invalid mode/target/DTO/identity/role fails closed; omitted mode remains
Postgres; inactive rows remain historical; unbound non-Admin profiles fail rather
than receive invented IDs; absent authors differ from transport failures; new
creates cannot publish without prebinding; old scripts/routes refuse after marker;
unknown save outcomes remain retryable with the same key or explicit saved-version
reload. No silent fallback, API hard-delete, mirror, synchronization or worker.

At the pre-deployment build checkpoint, production prerequisites were: live schema and Active keys (including multiple
null identity values), effective editor/application/Connor permissions, exact private
owner mappings, pending migration ledger/FK name, reference repairs, and signed-in
acceptance. No production action was executed during that build/review checkpoint; subsequent production actions are recorded in the execution report.
Use [the cutover runbook](EXPERTISE_ROSTER_CUTOVER_RUNBOOK_2026-11-19.md).

Implementation commit: `40588fca3` on `codex/expertise-roster-admin-2026-11-19`.

Reproduce focused tests with:

```bash
npx jest --runInBand --silent --testPathPatterns='(admin-expertise-roster|expertise-roster|expertise-finder-match-route|expertise-finder-batch|consultant-feedback|site-visit-recipient-directory|proposal-list|dynamics-service-changeset|link-roster-contacts|roster-contact)'
```
