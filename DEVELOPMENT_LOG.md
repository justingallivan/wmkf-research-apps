# Development Log

This file is a **milestone log**, not a per-session log. An entry exists when a session shipped something a future Justin would search for: a production cutover, a new architecture, a strategic pivot, a deprecated capability removed, an incident. Most sessions are prep, exploration, refactors, or doc work — those live in commit messages and `SESSION_PROMPT.md`, not here.

For current project documentation see [CLAUDE.md](./CLAUDE.md). For the most recent session hand-off see [SESSION_PROMPT.md](./SESSION_PROMPT.md).

**Format reminder for future sessions:** Add an entry only at a real milestone. Tight: ~8 lines, with **Milestone**, **Sessions**, **Ship state**, **Why it matters**, **Pointers**. Skipping is the right answer most weeks.

The chronological archive after the `Legacy chronological session log` divider contains the original log through Session 84 plus three later append-at-tail entries (Sessions 137, 139, and 149). It is not a complete record of Sessions 85–149; the older format is preserved for archaeology and is not maintained going forward.

---

## August 2026 — Institutional Funding History filled from Dataverse; Executor budgets made visible (Session 467)

**Milestone:** The Pre-Site writeup's `[[AI:InstitutionalFundingHistory]]`
section is now filled deterministically from the AkoyaGO account rollups
(count/sum, cross-checked fail-closed against live program-grant rows) with
the newest **Research** grant cited — replacing the Power Automate template
and the manual Word step. **Sessions:** 467 (two Codex review rounds; owner
recency decision; production-proven on 1002379).
**Ship state:** funding history live (schemaVersion 3; older docs carry a
durable edit-check warning); pre-site call runs with a 32 768 output budget
after Sonnet 5 adaptive thinking exhausted 16 384; Admin Prompt templates
show each prompt's effective budget, model ceiling, and Anthropic docs link
from a single tracked registry both callers import.
**Why it matters:** the last hand-filled section of the first draft is gone,
and budget drift against Anthropic's per-model limits is now visible rather
than silent. Owner directive recorded: mutable parameters must move out of
code into admin-editable settings (queued).
**Pointers:** `lib/services/pre-site-visit/funding-history.js`;
`shared/config/executorBudgets.js`; `docs/EXECUTOR_CONTRACT.md`; commits
`a7eb79be`, `c99d1fd8`, `6313db3b`, `6915c2c6`.

## August 2026 — Staff Deliberations workspace ships; write-attribution state resolved (Session 466)

**Milestone:** The Workbench's Pre Site Visit Writeup + Site Visit tabs were
merged into one owner-designed, stage-aware **Staff Deliberations** tab
(rail Draft → Share → Wrap Up) across six production releases in one day;
the two-tab UI and the in-app logistics editor/calendar UI are retired
(legacy tab keys alias in; document-lifecycle contracts unchanged).
**Sessions:** 466 (design proposal → build → Codex reviews → prod).
**Ship state:** merged tab + display labels + plain-language send history
live; Wrap Up derives from a per-source-document server flag; Executor
gained `timeoutMsOverride` (pre-site 240s) after a production timeout.
**Why it matters:** also resolved a standing doc/state contradiction —
`DYNAMICS_IMPERSONATION_ENABLED` has been `true` in prod since ~S271 and
works, but `wmkf_requestdocument` writes fall back to the service principal
(missing role privilege, inferred); the one remaining fix is a CRM grant
(brief prepared for Connor, back ~09-10).
**Pointers:** `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` merge note;
`docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` §Status; commits
`6a26b560`, `1e477d54`, `65e11975`, `db7be718`.

## August 2026 — Pre-Site generation resilience production-proved by signed-in smoke (Session 465)

**Milestone:** The Pre-Site writeup resilience contract (deployed 08-18,
commit `46903bc4`) passed its owner-approved signed-in Production smoke on
Request `1002852`: over-target narrative now ships as Ready with durable
editorial warnings instead of hard-failing, an unchanged retry is exactly
deduplicated, and a gateway-503 lost POST recovered durably via status
polling.
**Sessions:** 465 (deploy + prompt v4: pre-464 sessions).
**Ship state:** generation + no-duplicate + lost-POST recovery proven live;
hard-failure smoke skipped by owner decision (test-proven); prompt now
sole-current v5 (unattributed content-identical republish, runtime-verified).
**Why it matters:** closes the 08-16 Request 1002852 incident class — layout
targets are editorial guidance, not availability gates.
**Pointers:** `docs/PRE_SITE_VISIT_GENERATION_RESILIENCE_PLAN.md` §Status;
commits `b1e89edc`, `85bfa403`.

## August 2026 — Personalized scheduled email + reviewer invitation VIP preview reached Production (Session 462)

**Milestone:** Automated grantee abstract reminders now send automatically
per-PD with a VIP-flag review-by-exception layer, digest, and durable Postgres
ledger; reviewer invitations gained per-candidate VIP stars — flagged people
open as full editable previews, everyone else batch-sends behind a collapsible
summary, with one shared invitation-link validator across preview, send
withholding, and template save.
**Sessions:** 461–462 (P0 build, owner redesign to VIP/digest, two Codex
adversarial rounds per slice + rescue with Claude review pass, migrations
036/037 applied + live-probed, owner-run capture-mode smoke, merges).
**Ship state:** merges `4a743d63` (decision layer) and `dc46fa18` (reviewer
slice) live; PD digest onboarding still required before first meaningful
sends (~2026-09-07); post-cycle link-strictness decision parked in the work
queue.
**Why it matters:** first review-by-exception email automation — PDs stop
click-through-approving routine mail without losing eyes on the recipients
that matter; the send pipeline itself was left byte-identical mid-cycle.
**Pointers:** `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md`,
`docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md`,
`lib/utils/invitation-link-validator.js`.

## August 2026 — Site Visit logistics and informational calendar distribution reached Production (Sessions 459–460)

**Milestone:** Workbench now manages request-bound Site Visit schedule,
time zone, format, location/link, organizer/attendees, governed material links,
and an optional informational calendar attachment.
**Sessions:** 459–460 (live schema mapping, bounded Opus plan/code reviews,
implementation, migration/schema apply, reversible sandbox proof, Production
promotion, signed-in business proof, and owner-guided UX correction).
**Ship state:** Wave 21 is exact in sandbox and Production; migration 035 is
applied/read back; Preview/Production readiness is literal `on`; main commit
`ffaa293b` reached Production and subsequent UX/freshness fixes through
`f8037230` are Ready in deployment `dpl_28bcFzCpxbwSVf8z5apvNrt1apDV`. The
sandbox proved nested ActivityParty create and atomic same-ID replacement with
exact cleanup. Signed-in Request `1002379` then created/read back one active Site
Visit with five parties; operation `f497643a-2e9e-4032-a323-1e40874d16f1`
reached `sent` with a calendar and one governed material. Dynamics transport
acceptance is proved; independent inbox/calendar-client delivery is not.
**Why it matters:** staff can populate recipients from reconciled WMKF staff and
Board/Consultant roster identities, enter the event once, link governed
materials, and send an exact-preview `METHOD:PUBLISH` attachment without
claiming RSVP or update/cancel semantics.
**Pointers:** `docs/atlas/dataverse-wmkf-sitevisit.md`;
`docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`; commits `ffaa293b`–`f8037230`.

## August 2026 — Frozen Pre-Site distribution reached Production and passed its first live send (Sessions 457–458)

**Milestone:** Exact DOCX/PDF/both snapshot preview, recovery-safe Dynamics
distribution, and history routes are Production-deployed and live-proved.
**Sessions:** 454–458 (implementation, bounded Opus plan/code review, migration,
metadata/sandbox transport probes, Preview auth rehearsal, promotion, and first
approved Production send).
**Ship state:** Migration 034 is live with one `sent` proof row. Request
`1002379` operation `85f52fc5-fb48-4ceb-84d6-0f246af0b6fb` retained exact
DOCX/PDF snapshots and sent the selected PDF to `jgallivan@wmkeck.org`.
Dynamics activity `33ce6346-d89f-f111-b8db-6045bd07a06d` read back Sent with
actor attribution and one hash-matching attachment; Workbench history was
visible and the bounded Production error-log scan was clean. Inbox delivery is
not independently verified.
**Why it matters:** staff now have the reviewed, durable exact-materials sharing
path in Production without coupling send to lifecycle promotion or weakening
guarded-reopen evidence.
**Pointers:** `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`;
`docs/atlas/postgres-infra-tables.md`; merge `76a93a41`.

## August 2026 — Frozen Pre-Site distribution architecture became source-built (Session 454)

**Milestone:** Workbench can prepare an exact retained Pre-Site Word snapshot,
derive PDF from that immutable item, and send DOCX, PDF, or both through one
confirmed, recovery-safe Dynamics email activity.
**Sessions:** 454 (implementation, focused verification, and independent Claude
Fable review).
**Ship state:** Architecture and first implementation are committed on
`codex/frozen-pdf-distribution`; independent review found nine confirmed
hardening items that block promotion. Migration 034, deployment, authenticated
smoke, and any controlled send remain pending. No Production snapshot, attempt,
activity, or email was created.
**Why it matters:** staff can share exactly what they reviewed while retries
resume each durable file/activity/attachment/send-intent step without duplicate
email, while retained snapshots preserve what earlier recipients saw across a
guarded reopen. Review closure is required before relying on that contract.
**Pointers:** `lib/services/pre-site-visit/distribution-service.js`;
`docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`; commit `8a240e77`.

## August 2026 — Guarded Pre-Site reopen passed durable Production proof (Session 454)

**Milestone:** The superuser correction path now has end-to-end Production
evidence for preserve-and-succeed behavior and exact retry reuse.
**Sessions:** 453–454 (schema-first release, Opus hardening, signed-in mutation,
authoritative readback, and same-operation retry).
**Ship state:** Wave 20 is 3 exact/0 divergent with literal-on readiness;
deployment `dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp` is Ready. Approved Request
`1002379` created one Ready/Draft successor and distinct SharePoint copy,
preserved the prior Review row as Superseded, moved the request pointer, and
reused the same row/item on exact retry.
**Why it matters:** accidental handoffs can be corrected without destroying the
recorded milestone, duplicating a retry, or creating unexplained Final lineage.
**Pointers:** `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`;
`docs/atlas/dataverse-wmkf-requestdocument.md`; merge `af986d92`.

## August 2026 — Memory hygiene gained enforceable early warnings and a canonical runbook (Session 452)

**Milestone:** Repository memory now has one canonical routine/deep-audit and
router-diet procedure plus mechanical early warnings before `MEMORY.md` becomes
load-bearing and bloated.
**Sessions:** 452 (best-practices review, adversarial plan revisions, Fable build,
Codex merge verification, first routine audit, and router diet).
**Ship state:** Fable head `800eb8e4` merged at `00139331`; single-sourced
thresholds, the 8 KiB notice, SessionStart/Stop advisories, and mutation-backed
hook tests are active. The first audit closed 3/3 findings and reduced the router
from 9,040 B to 5,911 B without deleting leaf content (`fb8dfab2`).
**Why it matters:** memory growth now produces a bounded maintenance signal and
has a repeatable evidence-first cleanup path instead of relying on ad hoc pruning.
**Pointers:** `docs/MEMORY_HYGIENE_RUNBOOK.md`;
`docs/audits/memory-routine-audit-2026-08-21.md`; commits `800eb8e4`, `00139331`,
`fb8dfab2`.

## August 2026 — Dynamics Explorer request telemetry is Production-live (Session 451)

**Milestone:** Explorer now records one durable lifecycle row per authenticated,
body-valid request and correlates its query, usage, and optional feedback evidence.
**Sessions:** 451 (Phase A model posture and stop reasons; Phase B lifecycle,
correlation, retention, analysis probe, Fable review, and signed-in proof).
**Ship state:** `main` reached `ea125997`; migrations 032–033 were applied and
exact-read back; deployment `dpl_4gAA5BU626uGeDBTzF9fSTHYD7Z3` is Ready. A
signed-in two-round query persisted completed/end-turn lifecycle evidence with
complete observed query/usage correlation. Organic observation remains open.
**Why it matters:** Explorer quality decisions can now use request outcomes,
rounds, latency, truncation, abandonment, and correlation instead of anecdotes.
**Pointers:** `docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md`; commits
`9a54620d`, `1b552cae`, `ea125997`, `dfc3e2a4`.

## August 2026 — Reviewer identity conflicts became staff self-service (Session 451)

**Milestone:** Routine stored-versus-found email conflicts no longer require an
Admin round trip, and existing-person cards now explain their prior request context.
**Sessions:** 450–451 (repair baseline, self-service resolution, card simplification,
prior-request context, production smoke, and follow-up bounds fix).
**Ship state:** staff make an explicit ETag-guarded Keep stored / Replace with
found choice; combined identity/email cases expose one Review and confirm action;
structural failures retain safe retry. Production Neville Sanjana evidence showed
one actionable card and the bounded 2022 request context after `8c2fa489`.
**Why it matters:** staff can resolve normal CRM ambiguity where they encounter it,
with enough provenance to understand why the person already exists.
**Pointers:** `docs/REVIEWER_EMAIL_CONFLICT_SELF_SERVICE_PLAN.md`;
`docs/REVIEWER_EXISTING_RECORD_CONTEXT_PLAN.md`; commits `e8c90f5f`, `5c9c399d`,
`e15846c1`, `8c2fa489`.

## August 2026 — Large grantee images now use durable direct Blob staging (Session 447)

**Milestone:** The grantee submission and staff replacement flows no longer send large image
bytes through the Function request-body seam that rejected the reporter's valid 9.12 MiB PNG.
**Sessions:** 447 (incident reconstruction, cross-layer design/build, Opus adversarial iterations,
exact-payload proof, Preview evidence, and deliberate Production promotion).
**Ship state:** `main` reached `1f31afdf`; migration 031 and `portal_upload_staging` are live;
initial runtime deployment `dpl_AKWrYmBjCaPy8LCuiwKRzdKoFz9d` reached Ready and acquired all
aliases. Actor-bound private Blob tokens, JSON finalizers, crash reconciliation, exact-path
cleanup, and sanitized client-failure events cover external grantee and staff replacement images.
The owner-approved Request `1002788` staff smoke passed on 2026-08-20, including
clean scan, SharePoint/Dataverse commit, exact temporary-Blob cleanup, and
production image display; the affected grantee must not be asked to retry.
**Why it matters:** Valid near-limit scientific figures can now cross the transport boundary
without weakening authorization, private storage, scanning, or cross-system commit semantics.
**Pointers:** `docs/LARGE_UPLOAD_DIRECT_BLOB_REMEDIATION_PLAN.md`; commits `b73dddb8`, `0dd3d808`, `1f31afdf`, `68979db3`.

## August 2026 — Stage II institution presentation is Production-live (Session 446)

**Milestone:** Source-aware institution notifications and reviewer-card explanations moved from
synthetic Preview acceptance into Production without expanding identity or write authority.
**Sessions:** 445-446 (typed contract, adversarial review, Preview acceptance, merge, enablement).
**Ship state:** PR #126 merged at `8c64ec76`; exact-on Production configuration was independently
re-probed; deployment `dpl_HXZrU8Y4wyEW4BbQiJ974byqGryh` is Ready; all CI/review/security gates
passed. Candidate selectability, person identity, COI, and Dataverse writes remain unchanged.
**Why it matters:** Staff now receive honest current/historical/additional/unresolved institution
context and executable remedies, while exact unset/`off` remains the rollback. Organic outcome and
alert-volume observation runs through 2026-09-02 before deciding whether to remove the rollout flag.
**Pointers:** `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`; PR #126; `1173d086`.

## August 2026 — Stage 2 institution presentation passed synthetic signed-in Preview acceptance

**Milestone:** Source-aware institution explanations and remedies now have a safe, repeatable
signed-in Preview acceptance surface that renders the production reviewer card without touching
the shared roster.
**Sessions:** 445–446 (typed policy/projection build, Fable adversarial review, Preview harness,
signed-in owner acceptance, and cleanup).
**Ship state:** Branch `codex/institution-decision-harness` reached `80f2d739`; the owner confirmed
six projector-pinned cases and completed the local action check in flag-on Preview, while automated
coverage exercised all eight local-only notice actions with no network call. Production remains
default off. The temporary flag/callback were removed and clean Preview
`dpl_5c2Cj98zUGybjjT5TdcvPuRFUL88` is Ready.
**Why it matters:** UI correctness, remedy availability, unresolved/provider-failure honesty, and
rollback are now verified without inventing Production data. Organic false-clear, alert-volume,
and review-reduction evidence remains open because 952 audited roster rows contained zero Stage 2
DTOs.
**Pointers:** `pages/workbench/institution-stage2-smoke.js`;
`docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`; commit `80f2d739`.

## August 2026 — Durable operational observability is Production-live (operational_events + Log Drain endpoint)

**Milestone:** Application failures now persist as structured, sanitized `operational_events` rows
that outlive Vercel's log-retention window, with recovery tracking that distinguishes
transient/recovered failures from unresolved ones.
**Sessions:** one worktree session on `codex/operational-observability` (2026-08-19), merged via
PR #123; Production drain activation and durable-state reconciliation in Session 450 (2026-08-20).
**Ship state:** `main` at `9de8b348`, deployment READY, migration 030 applied and probe-verified
(23 cols / 8 idx / tracker 29). LIVE: notify() error/critical mirror, reviewer-acceptance
honorarium failure enrichment + recovered/superseded settling, superuser admin surface, daily
retention, and HMAC-authenticated Vercel Log Drain ingestion. A read-only 2026-08-20 aggregate
found 45 `vercel-drain` rows spanning `2026-08-19T21:21:58.177Z` through
`2026-08-20T20:33:58.144Z`; this proves signed ingestion, not Track A whole-stream acceptance.
**Why it matters:** operators can open `/admin` after an alert, find the durable event by request
number or entity id, and see whether it recovered — the honorarium-alert incident class is closed.
Hardened by six Codex adversarial cycles (nine findings fixed) ending READY TO MERGE.
Track A's safety watch closed on 2026-08-21 with bounded platform configuration,
cost, cap-complete sample, and durable-failure evidence; it deliberately does not
claim an exact historical daily line count or zero platform throttling.
**Pointers:** `docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md`;
`docs/OPERATIONAL_OBSERVABILITY_HANDOFF_2026-08-19.md`; commits `ad9f1d79`…`2b1f59a2`,
merge `9de8b348`, Track A closeout `561ec242`.

## August 2026 — Reviewer identity remediation shipped; affiliation policy proven in shadow (Session 445)

**Milestone:** Reviewer Finder identity failures now present durable, actionable repair paths in
Production, and institution comparison has moved from string heuristics to a source-aware typed
relationship/policy contract in a non-authoritative branch.
**Sessions:** 445 (production incident remediation and UI consolidation; 25-case re-adjudication,
Fable strategy review, source-aware implementation, and frozen ROR evaluation).
**Ship state:** `origin/main` reached `5fcd913c` with compare-and-swap contact drafts, safe profile-URL
validation, stale-authority invalidation, and card-level remedies. Branch
`codex/institution-decision-harness` reached `23a40e89`; its shadow gate passes 25/25 relationship and
action decisions with zero sibling collapses or unsafe clears, but no runtime consumer calls it.
**Why it matters:** Staff can resolve real reviewer blocks without deciphering contradictory badges,
while future institution UI/authority changes now have explicit source, time, relationship, remedy,
and independent-identity boundaries instead of another string-matching exception.
**Pointers:** `docs/REVIEWER_CONTACT_LEADS_SPEC.md`;
`docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`; commits `d9c29c7d`, `5fcd913c`, `23a40e89`.

## August 2026 — Pre-Site-to-Site-Visit handoff and Phase II proposal access are Production-live (Sessions 443–444, 452)

**Milestone:** The Workbench now carries one governed Pre-Site Word workspace into the Site Visit
stage and displays the final two-phase cycle's Phase II proposal files alongside Phase I.
**Sessions:** 443–444 and 452 (schema/prompt/template production proof, guarded lifecycle build,
document-listing expansion, owner-directed promotion, and promoted-state receipt hardening).
**Ship state:** The handoff records an exact SharePoint version/hash/time,
changes Draft→Review under ETag, locks regeneration, and keeps the same Word item. The Proposal tab
lists exact `Phase II` folder files with scoped View/Download; deployment
`dpl_BiottKiZuBra2xpfv8quSaZ8jjVM` is READY. The signed-in Request `1002379`
live-folder View/Download smoke passed on 2026-08-20. After exact owner approval,
the controlled Draft→Review handoff passed on 2026-08-21: the same SharePoint
Edit/Download identity remained current, a fresh authenticated load returned the
handoff timestamp, and Pre-Site regeneration was locked. Commit `b3bb0ef6`
then made Pre-Site a read-only receipt after promotion; signed-in Production
showed zero Pre-Site work controls and one continuation action into the same
Site Visit Word item.
**Why it matters:** PDs can continue editing one Word workspace through the visit without a parallel
Site Visit memo, while staff can finally read both Phase I and Phase II submissions in one request.
**Pointers:** `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`; `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`;
commits `32b16f5f`, `5f316a29`, `83b9c68a`, `b3bb0ef6`, `43c8eab1`.

## August 2026 — Workbench duplicate Dataverse reads coalesced in Production (Session 440)

**Milestone:** Three source-certain sibling `wmkf_potentialreviewerses` read pairs now execute as
one union-projection chunked read per independent id set, preserving response and failure contracts.
**Sessions:** 438–440 (Sonnet builders, two Opus adversarial passes, Codex independent review and
bounded corrections, owner promotion).
**Ship state:** `main` advanced `ab4a87b8 → 06a615fc`; deployment
`dpl_8wHbRErjdbaaqLtKNSfqHo8TUV3B` reached READY. Focused merged-main tests passed 115/115 and the
Dataverse access-layer gate, types, and clean-output Production build passed. A subsequent
GET-only Production after-baseline on `dpl_3BU1Zstkn1ZhEhabfvNE5MFNpdpq` matched the formula across
the available structural strata (44/44 target events successful); no organic-latency claim was made.
**Why it matters:** Reviewer Find/Track removes one redundant Dataverse round trip per populated
reviewer, active-candidate, and removed-candidate chunk without adding caching or invalidation risk.
**Pointers:** `docs/audits/claude-workbench-read-coalescing-stage2-implementation-record-2026-08-15.md`;
`docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`; merge `06a615fc`.

## August 2026 — Workbench dependency observability is Production-live (Sessions 434–436)

**Milestone:** Shared Dataverse, Azure AD, and Graph transports now emit PII-safe dependency timing
events, with pre-auth request correlation on the three Workbench measurement routes.
**Sessions:** 434–436 (Sonnet implementation, Opus adversarial review, Codex review/remediation,
owner promotion, signed-in GET-only Production baseline).
**Ship state:** `main` advanced `31041461 → 30ed5fe0`; deployment
`dpl_AEHShYKKSb4WxeuxkUZgMRbLp3kB` reached READY. Production preflight corrected the Vercel export
contract from incomplete top-level `.message` parsing to fail-closed `.logs[]` extraction; 293
unique events validated and all 39 correlated target-route baseline events succeeded.
**Why it matters:** Stage 2's source-certain duplicate reads now have a measurable before-baseline
without waiting months for organic campaign traffic, while the 48-hour whole-app safety watch can
stop excessive logging before further optimization.
**Pointers:** `docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md`;
`docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`; merge `30ed5fe0`.

## August 2026 — Disabled-account revocation is production-enforced (Sessions 431–433)

**Milestone:** Staff-account disablement now fails closed across fresh sign-in, rolling JWT/session
refresh, bare and profile-aware API guards, and both first-login profile-linking branches.
**Sessions:** 431–433 (Sonnet implementation, Opus reviews, Codex concurrency remediation,
Claude delta re-review, owner promotion, signed-in production-safe smoke).
**Ship state:** `main` advanced `d32e2d56 → 486fd490`; profile linking now locks caller/target rows,
finalizes create-new identities in place, and commits claim DELETE+UPDATE atomically; archive reports
zero-row failure truthfully. The focused 93-test set, route gate, types, and production build passed;
an already-linked production account received the expected pre-write 403.
**Why it matters:** Disabling a staff identity now stops current and subsequent access without a
linking race silently minting or transferring an active replacement identity.
**Pointers:** `docs/audits/claude-revocation-hardening-implementation-2026-08-15.md`;
`docs/AUTHENTICATION_SETUP.md`; commits `b85a84f9`, `486fd490`.

## August 2026 — Fable production audit, two security/reliability fixes shipped (Session 428)

**Milestone:** A full Fable-led production audit set the refactor direction (measure/observability
first, not a Workbench Data Plane rewrite), closed two standing security questions by owner decision,
and shipped two Tier-2 fixes to production — one an incident outcome.
**Sessions:** 428 (audit Phases 0–7, Opus + Codex adversarial reviews, owner decisions, promotion).
**Ship state:** `main` advanced `f8a606e6 → e802412c`. (1) Reviewer-reminder crons now filter to
selected/not-revoked reviewers and write marker+token in one ETag-guarded PATCH, so an automatic
reminder can no longer reactivate a staff-revoked link (Codex caught the clobber race). (2) Slow
abstract saves reconcile a committed-but-timed-out Dataverse PATCH to success instead of a false
failure. Owner decisions: reviewer merge (T1) and staff-wide document reads (D4) are org-open
by-design — no Dataverse request/data ownership to scope against.
**Why it matters:** A revoked reviewer link stays revoked; a slow-but-committed abstract edit is not
lost; and the next refactor is evidence-gated on observability rather than a speculative rewrite.
**Pointers:** `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`,
`docs/audits/fable-audit-final-handoff-2026-08-14.md`,
`.claude-memory/project-reviewer-org-open-access-by-design.md`; commits `42f190e0`, `aaf92cf5`, `171c46a9`.

## August 2026 — Grantee rich text and reviewer workflow controls are production-live (Session 426)

**Milestone:** Staff and grantees can preserve scientific formatting in abstracts and captions;
reviewer outreach gained reviewed-before-send respond nudges and dismissible stale decline referrals.
**Sessions:** 426 (design, Opus review, implementation, adversarial review, promotion, owner use).
**Ship state:** `main` advanced `8529d4a5 → baa8285a`; the nudge preview is editable but keeps
identity and secure-link injection server-controlled; abstract/caption editors persist canonical
Markdown and render sanitized HTML; decline referrals can be dispositioned without creating a
candidate, with content-version and ETag race guards. Reviews export is now Word-only; canonical
DOCX-to-PDF conversion remains a documented future option.
**Why it matters:** Scientific names retain their intended typography, staff can clear unusable
referrals without polluting the candidate roster, and outbound nudges are visible before sending.
**Pointers:** `docs/GRANTEE_ABSTRACT_RICH_TEXT_EDITOR_PLAN.md`;
`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`; commits `251814df`, `b0ada8ba`, `baa8285a`.

## August 2026 — Development-agent authentication standardized on OAuth (Session 426)

**Milestone:** Claude Code and Codex agent sessions must use interactive subscription OAuth, never
project/provider API keys; delegated Claude checks run outside the Codex sandbox so macOS Keychain
state is visible.
**Sessions:** 426 (owner decision, instruction enforcement, multi-account operating brief).
**Ship state:** the rule is canonical in `CLAUDE.md`; the commercial/personal Claude profile-alias
configuration is documented but intentionally not installed or added to the shell profile yet.
**Why it matters:** Agent collaboration cannot silently consume API credits or misdiagnose a valid
Claude login from sandbox-isolated Keychain state.
**Pointers:** `CLAUDE.md`; `docs/CLAUDE_INSTRUCTION_AUTHORITY.md`;
`outputs/claude-code-multi-account-oauth-brief-2026-08-13.md`; commit `b3bd5986`.

## August 2026 - Manual respond-by reviewer nudges are production-live (Session 425)

**Milestone:** Program Directors can send an on-demand reminder to an active invited
reviewer who has not answered, with a fresh secure response link and a visible last-nudged date.
**Sessions:** 424-425 (gate diagnosis, Phase A implementation, adversarial review, promotion).
**Ship state:** `main` at `8529d4a5`; Vercel deployment and all five GitHub workflows passed.
Both manual reminder paths freshly authorize lifecycle state and persist marker + token in one
ETag-bound PATCH; removed/revoked reviewers fail closed. No real-email production smoke was run.
The automatic respond cron remains disabled and unsafe pending separate hardening.
**Why it matters:** PDs can follow up with stragglers when needed without enabling a broad
automatic campaign or restoring access for a reviewer whose invitation was withdrawn.
**Pointers:** `docs/REVIEWER_MANUAL_RESPOND_NUDGE_BUILD_PLAN.md`;
`shared/components/reviewers/ReviewerInvitePanel.js`; commits `5891c65e`, `8529d4a5`.

## August 2026 — A grantee saw a stranger listed as co-PI on their award (Session 421)

**Milestone:** Incident. The grantee portal for request `1002132` rendered "Heinrich Jaeger and
Yvonne Mariajimenez"; Yvonne is unrelated to the proposal. Diagnosed to bad source data, not
application code.
**Sessions:** 421 (diagnosis, scoping, remediation script — remediation **not** executed).
**Ship state:** No application bug — the participant adapter is read-only, nothing in the repo
writes co-PI/PI fields, and the abstract-request flow touches only the abstract, deliverable
status, and an email activity. One duplicate contact carrying the placeholder email `_@_._`
sits in a co-PI slot on **seven** requests (a floor — verified only for that exact literal),
copied into the `wmkf_apprequestperson` junction by the 2026-05-07 backfill. Exposure: 1 of 14
generated grantee packages; the awardee replied, so he saw it. `scripts/remediate-placeholder-copi.js`
is written and rehearsed dry-run only — **zero production writes; all 14 rows still live.**
**Why it matters:** the grantee portal is the first surface that ever displayed co-PIs to an
external party, so a decade of unreviewed import data now has an audience. Root cause is the
akoyaGO import (Connor's), and until it changes new requests keep acquiring the phantom.
**Pointers:** `outputs/phantom-copi-incident-2026-08-12.md`; `docs/CURRENT_WORK_QUEUE.md` audit
follow-ups; commits `64dd4bf4`, `f9defa6d`, `e6d5b54e`.

## August 2026 - Reviewer activity history is production-live (Session 419)

**Milestone:** Track Reviewers now shows the chronologically newest derived lifecycle event
and an accessible per-reviewer History drawer, replacing the old fixed-priority Last Action
fallback.
**Sessions:** 418-419 (Phase 1 build, five review rounds, CI repair, production promotion and
authenticated smoke).
**Ship state:** PR #120 merged and deployed; eight required checks passed; Request `1002959`
verified the drawer, evidence caveat, and neutral invitation wording in Production; no schema,
route, or backfill was added.
**Why it matters:** staff can inspect the useful lifecycle evidence already present without
mistaking column precedence for recency, while the UI remains explicit about evidence limits.
**Pointers:** `outputs/reviewer-activity-history-phase1-status-brief-2026-08-12.md`;
`shared/components/reviewers/reviewer-activity-history.js`; commits `ae337125`, `7ebadbfe`,
`058e45f2`, `2e7af630`.

## August 2026 — Per-reviewer deadline extensions are production-live (Session 417)

**Milestone:** Program Directors can grant or change an accepted reviewer's deadline from
Track Reviewers; saving automatically sends the reviewer a personalized deadline notice and
updated calendar invitation, with an explicit retry/resend fallback.
**Sessions:** 417 (owner design decisions, implementation, two Opus reviews, Wave 18 schema
provisioning/promotion, signed-in production test, legacy-identity and honorific corrections).
**Ship state:** main `ed8b7a3d → d4cd8061`; Wave 18 suggestion-level DateOnly field live;
portal, reminders, acceptance/calendar, and token calculations use the effective reviewer date;
Request `1002788` owner smoke passed; 610 suites / 7,717 tests and production build passed.
**Why it matters:** individual reviewer commitments no longer require an inaccurate request-wide
deadline or manual off-system workaround, and the reviewer is notified in the same save flow.
**Pointers:** `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md`;
`shared/components/reviewers/ReviewerDueDateEditor.js`;
`lib/services/reviewer-due-extension.js`; commits `ed8b7a3d`, `d6864897`, `19982cfd`, `d4cd8061`.

## August 2026 — Matching roadmap unblocked: owner answers, falsification suite, incumbent baseline (Session 405)

**Milestone:** the reviewer-matching track went from "waiting on owner" to benchmarked in one
session — all six consensus questions answered (owner-verbatim record), the 166-case
falsification suite built, and the incumbent baseline frozen against live keyed OpenAlex.
**Sessions:** 405 (answers → suite build → owner-authorized execution → adjudications →
two agent builds merged → invite-panel discoverability fix from a live owner report).
**Ship state:** main `e323ee5f → 787e973f` (7 pushes, all deployed); suite 6,910 → 7,079;
baseline 89/64/12 — incumbent "safe but blind" (zero wrong-entity resolutions, 36/47
positives abstain); normalizer inventory falsified the memo's institution count (9, not 11);
"Search Google ↗" adjudication link + always-visible release-pending button live.
**Why it matters:** the whole consolidation→scorer→card-redesign sequence now has its
decision inputs, its regression asset, and the bar a successor must beat; the owner's
risk frame (ambiguity widens checks; recall of the right person is the objective) is durable.
**Pointers:** `outputs/fuzzy-matching-owner-answers-2026-08-06.md`;
`benchmarks/fuzzy-matching-falsification/baseline/incumbent-2026-08-06.md`;
`docs/NORMALIZER_CONSOLIDATION_INVENTORY.md`; commits `21264463`, `5098aa7a`, `787e973f`.

## August 2026 — Reviewer tokens mint at send time; invite-pipeline error UX (Session 404)

**Milestone:** reviewer portal tokens are no longer minted by preview rendering — previews are
read-only (JWT-shaped non-live placeholder) and `send-emails` mints/substitutes the
authoritative token immediately before dispatch, with per-recipient fail-closed verification.
Plus the invite-failure UX overhaul that started it: retryable failure banners with
owner-verbatim copy, and the fuzzy-matching Claude×Codex consensus recorded.
**Sessions:** 404 (owner-reported 503 incident → 4 adversarial Codex rounds → pipeline
hardening; confirm-reviewer modal coherence; fuzzy-matching consensus with six owner
questions pending).
**Ship state:** main `bc03c688 → b5aaa5e2` via merges `a9d4e3dd` + `ff06fbb8`, both deployed
READY; suite 6,860 → 6,910; accepted residual (latest-link-wins mint→dispatch window) and the
token-lifecycle redesign follow-up recorded in the plan's adjudication entry.
**Why it matters:** kills the preview-rotation race class outright (any preview used to
invalidate every previously issued link for that recipient); establishes the error-copy voice
rule (system blames itself, plain words, retry→admin ladder); the consensus doc now gates the
whole reviewer-matching roadmap.
**Pointers:** `outputs/plan-manage-panel-preview-retry-2026-08-06.md` (v1→v4 + adjudication);
`outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md`;
`.claude-memory/feedback-user-facing-error-copy-voice.md`; commits `d040a7a3`, `8b66beb3`,
`ffd19eca`.

## August 2026 — Increment C: auth-gate render race fixed app-wide (Session 398)

**Milestone:** the client auth gate stopped unmounting/remounting the provider subtree on every
page load — the data burst now waits on ONE `app-access` round-trip instead of 2–3 stacked
gating rounds, on every page of the suite.
**Sessions:** 398 (also: client-side measurement pass resolving both S397 [ASSUMED]
attributions; 3-agent dig; excluded-reviewers structured-intake plan for the Connor handshake;
the vacuous "~90d observation window" gate voided — reviewer search runs ~twice/year).
**Ship state:** main ff `912ab995 → 27aba5be`; `RequireAuth` keeps children mounted through
session resolution; `shared/utils/auth-enabled.js` dedupes `/api/auth/status` (3 fetchers → 1,
never caches non-2xx — Codex adversarial finding fixed pre-ship); owner Preview smoke + post-
promotion production waterfalls verified; Entra callbacks restored to the four permanent URIs.
**Why it matters:** second consecutive increment shipped under the post-S395 measure-first,
one-change, tier-gated discipline; the render-race pattern (permissive-then-clamp gate
discarding in-flight fetches) is now a documented anti-pattern in the security-auth wiki topic.
**Pointers:** `docs/agent-wiki/topics/security-auth.md` "Client auth-gate render contract";
`docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md`; commits `8a338d9d`, `27aba5be`, `766b6cd2`.

## August 2026 — First tier-gated latency increment ships: warm-revisit proposal blob cache (Session 397)

**Milestone:** The post-incident incremental latency plan went from approval to a measured
production win in one session: warm-revisit ≈5.9s → ≈3.1s on Request `1002903` (~47%).
**Sessions:** 397 (Step 0 measurement, Step 1 build/review/ship, cleanup; also cleared the
`brace-expansion` high advisory via a vendored-shim pin bump, `3130733e`).
**Ship state:** `main` ff `1d1753f7 → c4e08fcc`; `load-proposal` now `head()`-checks a
deterministic version-keyed Blob path before SharePoint (size-validated hit, race-guarded miss,
fail-open). Review chain: sonnet build → opus (3 hardenings) → Codex adversarial (1 hardening;
1 pre-existing enrichment-staleness finding deferred to backlog). Owner-smoked MISS→HIT in
production; all temporary smoke scaffolding removed and verified.
**Why it matters:** first proof the measure-first, one-cache-per-increment discipline works where
the S394 big-bang failed. (The "~90d observation window gates Candidate B" sequencing recorded
here was **voided by the owner 2026-08-04**: reviewer search runs ~twice per year, so an
organic-traffic window collects no data — follow-on increments are decided on deliberate smokes.)
**Pointers:** `SESSION_PROMPT.md` "incremental plan ACTIVE";
`docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` blob-cache subsection;
commits `efa6aa5e`, `bc3a8739`, `122e6661`, `c4e08fcc`.

## August 2026 — Warm-reconciliation incident closed by baseline revert (Sessions 395–396)

**Milestone:** The Session-394 rollout was reverted wholesale; production runs the pre-rollout
baseline again and the incident is closed.
**Sessions:** 395 (post-mortem + revert construction), 396 (preview smoke, promotion, closeout).
**Ship state:** `main` fast-forwarded to `2fc29b82` — runtime tree restored to `94c5b9d9` plus the
`edbe6931` `isGuid` fix; production deployment `dpl_EbFDP4PpPa9K91bs9CnuH2yUviW1` Ready and
owner-smoked (Request `1002903` warm roster correct, no reconcile/evidence-refresh UI). Zero data
migration; forward-fix branch `reviewer-find-outcome-contract` abandoned. Revert side effect: two
high-severity transitive lockfile advisories reintroduced (`ip-address`, `brace-expansion`) — open.
**Why it matters:** revert-first beat forward-fixing a 76-commit untier-gated rollout; latency work
restarts only under a new owner-approved, tier-gated plan.
**Pointers:** `docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md` (resolution section);
`.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md`; `SESSION_PROMPT.md`.

## August 2026 — Reviewer Find warm-reconciliation rollout remains an open production incident (Session 394)

**Milestone:** A 50-commit warm-revisit/reconciliation release reached Production, repaired several
legacy-authority blockers, but failed the staff-facing no-loop contract and is handed off as open.
**Sessions:** 394 (`5b6757df..7072d52a`; incident documentation follows).
**Ship state:** cached roster reads, stage receipts/producers, promotion preflight, request-level
reconciliation, and no-send test tooling are live. Five follow-up hotfixes restored the
Katherine-Ferrara-shaped row on Request `1002903`; the Kanaka-Rajan-shaped row remains incorrectly
retryable/queued and still exposes **Refresh contact evidence** even though only staff identity/
institution action can resolve it. No reviewer was promoted, invited, or emailed during verification.
**Why it matters:** green local contracts and a narrow final review did not prove the production
outcome taxonomy; staff can still enter a no-progress reconciliation loop on an existing roster.
**Pointers:** `docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md`;
`SESSION_PROMPT.md`; `docs/REVIEWER_FIND_PERFORMANCE_PLAN.md`; head `7072d52a`.

## July 2026 — Reviewer address/identity gates repaired; four roster data sweeps (Session 387)

**Milestone:** Reviewers who could not be invited at all became invitable, and the roster
key/provenance corruption behind it was remediated in production.

**Sessions:** 387 (`3f56bb7d..c688aa0c`, 15 commits, auto-deployed).

**Ship state:**
- Two dead-ends closed: an applicant card selectable while the promote route refused it
  (client tested 3 of the server's 4 identity clauses), and one person rendering twice
  because `stampSuggestionAnchor` stamps an anchor without re-keying the row.
- `wmkf_emailsource` stopped being fill-if-empty: a strictly stronger tier now supersedes a
  weaker one for the same address. Human assertions (`manual`/`staff_verified`) are terminal
  against machine evidence — an automatic promotion to `ready` would delete a send-time
  acknowledgement across every request sharing the person row.
- Address and provenance are written in one Dataverse payload by all four writers, enforced
  by a repo-walking scanner that found seven call sites three adversarial reviews missed.
- New staff attestation (`verifyEmailAddress`) for a web-search-only address, whose prior
  escape hatch was a no-op when the verified address was the one already stored.
- Four production sweeps: 28 duplicate roster rows deleted (17 emails preserved as
  quarantined leads), 156 rows re-canonicalized with 50 stamped fail-closed, 35 ungated
  applicant rows stamped, 6 pinned person rows upgraded.

**Why it matters:** the failures were silent and structural — a checkbox that lied, and a
provenance field that pinned a reviewer's address tier permanently on first write. Both
produced "this reviewer cannot be contacted" with no path forward in the UI.

**Pointers:** `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` (send gate + precedence),
`docs/atlas/postgres-reviewer-find-roster.md` (key hazards, sweep results),
`docs/agent-wiki/topics/dataverse-dynamics.md` (the paginated-read trap that made a broken
sweep look clean), `SESSION_PROMPT.md` (S388 handoff).

## July 2026 — Dependabot security backlog eliminated (Session 382)

**Milestone:** The public repository's 49-alert dependency-security backlog was
consolidated into one reviewed release and reduced to zero open alerts.
**Sessions:** 382.
**Ship state:**
- PR #93 updated or removed all 13 affected package families, added focused
  compatibility tests, and preserved a bounded legacy brace-expansion API while
  delegating the modern API to patched upstream 5.0.8.
- Node 20/npm 10, Jest, Playwright, builds, lint, types, Trivy, Semgrep,
  Gitleaks, Vercel Preview, and independent reviews passed.
- Merge `c325afd5` deployed Ready as `dpl_4LBja725wdLHsATtLhLVZkCMSso3`;
  post-merge CI passed and GitHub reported zero open Dependabot alerts.
**Why it matters:** the security backlog is closed without breaking older
minimatch consumers, and the repository now has regression coverage for the
highest-risk forced dependency boundaries.
**Pointers:** `SESSION_PROMPT.md`; `package.json`;
`vendor/brace-expansion-compat/`; PR #93; merge `c325afd5`.

## July 2026 — Reviewer email release contracts and live copy shipped (Session 381)

**Milestone:** Reviewer release emails gained staff review-before-send with
fail-closed recipient/sender binding, corrected greeting/copy, and explicit
signature-closing preferences.
**Sessions:** 380–381.
**Ship state:**
- PR #92 merged as `ab1d2943`; production deployment
  `dpl_FUkr89hrrMCL59wkTkG2FtkRXxhb` reached Ready with all PR and main CI green.
- The post-deploy Dataverse migration updated the four global reviewer bodies
  (`updated=4 failed=0`); the verification dry run returned `no-change=4`.
- Production sign-in and public reviewer error surfaces rendered; a full staff
  login was not initiated because the existing browser session had expired.
**Why it matters:** staff can edit each no-longer-needed message while the send
remains bound to the reviewed reviewer and Program Director identities, and the
corrected templates are live rather than only present in seed code.
**Pointers:** `SESSION_PROMPT.md`;
`docs/CLAUDE_TO_CODEX_HANDOFF_2026-07-27.md`; PR #92; merge `ab1d2943`.

## July 2026 — Ignored operational source disposal completed (Session 379)

**Milestone:** The owner-approved local-retention review closed with a
fail-closed disposal of the exact reviewed repository-side source scope.
**Sessions:** 379.
**Ship state:**
- Removed 139 ignored, untracked regular files (15,287,781 bytes), with zero
  failures and zero residual scoped regular files.
- Preflight verified every source hash, all 82 archive-backed copies, all 20
  separately preserved unique-source files, and strict source/archive
  separation; five excluded dependency symlinks were not touched.
- The owner-only organizational archive remains retained; reachable public Git
  history remains an explicit unresolved privacy workstream.
**Why it matters:** deleted ignored artifacts no longer masquerade as durable
project memory, while preservation evidence and the unresolved public-history
boundary remain retrievable from tracked, privacy-safe records.
**Pointers:** `docs/audits/local-operational-data-retention-audit-2026-07-27.md`;
`docs/audits/local-operational-source-disposal-receipt-2026-07-27.md`;
`docs/audits/public-repository-pii-history-audit-2026-07-27.md`.

## July 2026 — Multiselect production smoke passes form pipeline, exposes synthesis defect (Session 376)

**Milestone:** The first controlled production smoke of the published multiselect
review form passed external authoring through cleanup but reproducibly failed AI
synthesis.
**Sessions:** 376.
**Ship state:**
- Request #1002788 passed materials exposure, sanitized draft reload, atomic
  11-answer submit, categorical workbench/report/courtesy consumers, and finality.
- No email route ran; the request synthesis and email markers were preserved.
- Two current-v2 `review-synthesis.generate` calls failed on incomplete JSON and
  produced failed append-only AI audit rows; the pre-exposure gate remains red.
- A 12-operation cleanup atomically removed the smoke answers and reset the test
  suggestion to `materials_sent`.
**Why it matters:** the form/storage/report contract is production-proven, while
the release remains safely closed on a real synthesis-runtime defect rather than
being declared green from unit coverage.
**Pointers:** `docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md` §7/§9;
`docs/audits/local-operational-data-retention-audit-2026-07-27.md`;
`docs/audits/local-operational-source-disposal-receipt-2026-07-27.md`.

## July 2026 — Dataverse target/write interlock enforced in production (Session 368)

**Milestone:** The deployment × target-hostname × operation interlock moved from observed warn mode
to explicit fail-closed enforcement in local, Preview, and Production.
**Sessions:** 355 (architecture/warn rollout), 368 (positive observation and enforcement).
**Ship state:**
- PR #73 added positive activation logs; production showed the expected production target and no would-deny outcomes.
- Owner-approved `DATAVERSE_TARGET_INTERLOCK=on` was applied in all environments.
- A signed-in Workbench smoke logged `mode=on deployment=production target=production` without denial.
- PR #74 merged as `a3ae8d31`; the enforced contract is reconciled in `CLAUDE.md` and the rollout plan.
**Why it matters:** a mis-targeted Dataverse write now fails at the shared transport boundary instead of relying on operator vigilance.
**Pointers:** `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`; merges `2585f980`, `a3ae8d31`.

## July 2026 — Full structured staff review rescue shipped (Session 368)

**Milestone:** Staff can record a complete review from the Reviews tab when the external portal cannot be used.
**Sessions:** 368.
**Ship state:**
- PR #75 added the live-question form, rich-text answers, full validation, and canonical answer snapshots.
- The dedicated staff path commits parent + child rows atomically with question-version and ETag guards.
- Legacy file/partial receipt paths remain unchanged; stale portal-draft cleanup occurs only after commit.
- Merge `0226f7eb` reached Ready as production deployment `dpl_BjkM3tjopMpRWPMwn3NRgtB4CHSU` with all checks green.
**Why it matters:** portal breakage no longer forces staff into incomplete PDF-era representations or manual database repair.
**Pointers:** `.claude-memory/project-staff-review-rescue-tool.md`; `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`; commit `050fb397`.

## July 2026 — Wave 13 reviewer identity binding proven in production (Sessions 362–363)

**Milestone:** The first controlled positive test of the deployed acceptance-drain → self-report capture → Wave 13 binding-writer chain passed in production after four adversarial review rounds.
**Sessions:** 362–363 (design/review/hardening, PR #60 merge, owner-authorized production execution).
**Ship state:**
- PR #60 merged at `5bb6a8b8`; exact deployment `dpl_BqCBSFWoRto2noQdrovHG7fBsA6X` processed completed queue job `25` (`attempts=0`) under maintenance run `15060`.
- Exact `self_reported` binding assertions passed; no contact link or system alert was created.
- Synthetic Dataverse rows were deleted and absence-verified; the Wave 13 population returned to its pre-smoke baseline (person 1 / suggestion 0).
- The completed Postgres queue row remains as the audit record by explicit owner decision.
**Why it matters:** the first promoted Wave 13 writer path is now production-proven end to end, including deployment attribution and fail-closed recovery/cleanup, rather than only unit- and preflight-proven.
**Pointers:** `docs/REVIEWER_BINDING_SMOKE_CODEX_HANDOFF.md`; commits `de60fb96`,
`a872fbcf`, merge `5bb6a8b8`;
`docs/audits/local-operational-data-retention-audit-2026-07-27.md`;
`docs/audits/local-operational-source-disposal-receipt-2026-07-27.md`.

## July 2026 — BILL API integration tabled; address-based reviewer onboarding instead (Session 357)

**Milestone:** Owner tabled the BILL.com API integration for several months, possibly permanently —
reviewers will be onboarded via their address plus existing foundation systems.
**Sessions:** 357 (decision recorded + reconciled; same session fixed the daily-maintenance BILL
subtask crash that had been emailing errors every day).
**Ship state:**
- Nothing live disabled: `BILL_ENABLED` unset in every Vercel env; `onboardReviewer()` already degrades to alert_only.
- BILL code stays dormant, not deleted; known-red bill test suites stay red indefinitely.
- Stage 2a required address+phone collection is now load-bearing (the "relax next cycle" question closed as moot).
- Maintenance ESM-interop fix: BILL sweeps now `await import()` the ESM bill modules (`bd5df78e`).
**Why it matters:** redirects the reviewer-payment roadmap — no BILL pipeline work without a new owner
decision, and the portal's captured address is the substrate for the replacement flow.
**Pointers:** `.claude-memory/project-honorarium-payment-landscape.md`; `docs/agent-wiki/topics/finance-honoraria.md`; commits `9f4dbac3`, `bd5df78e`.

## July 2026 — Fail-closed Dataverse target/write interlock ships, live in warn mode (Session 355)

**Milestone:** The strategy-§6 "highest-priority enabling control" went from planned to live in one
session: a deployment-class × Dataverse-target × operation-class policy interlock at every runtime
Dataverse HTTP seam, hostname-classified against a tracked registry, fail-closed on anything unknown.
**Sessions:** 355 (design → Stage 1 → 4 Codex adversarial rounds/8 findings fixed → Stage 2 wiring → warn rollout).
**Ship state:**
- `DATAVERSE_TARGET_INTERLOCK=warn` live in `.env.local` + Vercel Production/Preview; observe-only, never blocks; flip to `on` awaits log review (plan §5 Stage 3).
- Three hook families wired: `dynamics/http.js#fetchWithTimeout`, `dataverse/client.js#call()`, dataverse-export reads; 112 tests pin the policy + denial contracts.
- Exceptions narrow and audited: date-bounded operator ack; GUID-only Mode-D rehearsal grants; `$batch`/alt-key writes never coverable.
- Settled empirically: `akoyago.crm.dynamics.com` never existed (display-name conflation); sandbox is `orgd9e66399.crm.dynamics.com` (runbook corrected).
**Why it matters:** preview/local pointed at prod Dataverse is no longer one env-var away from silent prod writes — the strategy's precondition for safe campaign-era refactoring.
**Pointers:** `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`; merges `e113b4bf` (Stage 1), `8067de3a` (Stage 2); rollout `87da872e`.

## July 2026 — Grantee publication waiver becomes versioned + consent-captured (Session 350)

**Milestone:** The grantee publication-consent waiver moves from a hardcoded frontend constant (never
persisted) to a **versioned policy** in the reviewer COI/AI-use policy machinery, and the acknowledged
version is now **persisted per submission** — the first grantee-side consent-of-record. Reverses the
original S268 `GRANTEE_PORTAL_SPEC` "no consent fields persisted" decision, at owner request.

**Sessions:** 350 (design + 3 adversarial Codex passes — 2 on the plan, 1 on the code).

**Ship state:**
- New `grantee-waiver` slot (staff-editable in admin → Policies, same `PoliciesSection` UI). Prod
  Dataverse schema wave12 applied + slot seeded + probe green (2026-07-09).
- Records "what the grantee saw" via a signed render token (version+bodyHash bound); submit persists
  `wmkf_WaiverPolicyVersion`/`wmkf_waiverackedat`/`wmkf_waiverbodyhash` on `wmkf_granteedeliverable`.
- Submit's two Dataverse writes are now ONE atomic changeset (per-op If-Match), closing a pre-existing
  partial-success hole; SharePoint reconciled by re-read-before-delete. Fail-closed on the slot.

**Why it matters:** consent to a specific published wording is now auditable and version-pinned rather
than "a submission exists"; and the fix hardened the grantee submit write to be genuinely atomic.

**Pointers:** `docs/GRANTEE_WAIVER_VERSIONING_PLAN.md`, `project-grantee-waiver-versioning.md`; commits
`9b327651`(A) `ec46676e`(B) `e0cbbb56`(C) `ebbe0e4c`(D) `552a8574`(E).

## July 2026 — First compile-time trust boundary: branded-type `check:types` gate ships to prod (Session 342)

**Milestone:** The JS codebase gains its first *compile-time* trust-boundary enforcement — a
standalone `tsc --noEmit` gate (`check:types`) using JSDoc branded types on `.js` files (no `.ts`
renames), the structural follow-through on S341's runtime requestId fix.

**Sessions:** 342 (built on the S340/S341 Fable TS Phase 0/1 branch, merged + hardened over three
Codex adversarial rounds).

**Ship state:**
- `Guid`/`ActorRef` brands enforce through the PUBLIC `DynamicsService.*` facade + the 2 routes that
  pass a *client* id into a selector; deleting an `isGuid` guard turns `check:types` red (ratchet proven).
- Also shipped this session: all 4 S341 backlog branches to prod (auth fail-closed, Dynamics
  Checkpoint-B decomposition, prompt-cache nonce, the TS gate) — each deployed Ready, one-at-a-time.
- Killed recurring Dependabot CI-failure emails (skip Gitleaks/claude-review on bot PRs; ignore majors).

**Why it matters:** Regex/AST gates detect *patterns* and can be evaded; a branded type is un-gameable
within a checked file. The whack-a-mole illusion came from the wrong denominator — the untrusted
surface is 2 routes, not every selector caller, and it is now structurally closed. Caught the
`any`-poisoning trap (`req.body: any` silently satisfies `Guid`) that would have made it theater.

**Pointers:** `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`, `tsconfig.check.json`; commits `3f40047`
(facade), `c27fbac` (trust routes), `1f2860d` (BILL guard regression), `b9a349d` (Fable merge).

## July 2026 — Live requestId injection/IDOR surface closed in prod; trust-boundary gate learns the executePrompt indirection (Session 341)

**Milestone:** A Codex review of the Fable TypeScript Phase-0 branch surfaced (and tracing confirmed) a live authenticated over-fetch/IDOR/OData-injection surface on `main`: `summarize-v2` forwarded `req.body.requestGuid` with only a presence check through `executePrompt` → `grantRequestAdapter` → the raw `akoya_requests(${id})` key predicate, and `check-trust-boundary-guid` was green because it never traced the `executePrompt` indirection. Fixed defense-in-depth (route-edge `isGuid`, an `executePrompt` chokepoint, and teaching the gate to model `executePrompt({ requestId })` as an object-arg sink — surviving two adversarial re-reviews that caught a gate false-positive), then shipped to prod.
**Sessions:** 341.
**Ship state:**
- Merged + deployed `main` (`26402548`, prod Ready); fan-out confirmed `summarize-v2` was the only vulnerable caller of the six.
- Gate now resolves import/value aliases, prebuilt-args objects, spread/computed keys; residual limits documented + self-tested (28 cases); runtime chokepoint is the backstop.
- Full suite 5133/5133 + build green. Same session: app-access cache-poisoning/superuser-lockout fixes + Fable TS Phase 0/1 built (both on branches, unmerged).
**Why it matters:** closes a real (authenticated-gated) live vuln, and the gate can now catch the "client id laundered through a service function" class that positional-sink scanning misses.
**Pointers:** `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`; `docs/agent-wiki/topics/prompt-executor.md`; commits `8a68dc39`, `a7d82dee`, `26402548`.

## July 2026 — Reviewer-finder save-time institution-COI enforced server-side; "close the class by construction" pattern + invariant-map charter (Session 339)

**Milestone:** The reviewer-finder save boundary moved from trusting client COI flags to authoritative server-side institution-COI enforcement, shipped to prod. After ~6 adversarial-review cycles each closing a real same-institution bypass, a Fable structural reframe ended the whack-a-mole: a *discovery recorder* makes the referenced-identity declaration a total function of every adapter row fetched (no lookup branch can drop a discovery) and the invariant test was inverted to assert against adapter *inputs* — closing the bypass class by construction. The pattern was codified into a Fable orchestration brief: produce a whole-system "closeable-class invariant map" (enforcement ladder: impossible-by-construction > fail-closed gate > advisory gate > review), ranked by blast radius.
**Sessions:** 339.
**Ship state:**
- Reviewer-finder COI arc merged `a1d3049f` (deploy READY); `codex/minor-fixes` merged `61fe97bc`; suite 5082 green, all relevant gates green.
- PI-resolver outage → retryable 503; request-context errors keep 400/404; contact + conflict-carried institutions now screened.
- Parallel stream (separate agent) landed DynamicsService Checkpoint A + the Q9 prefs/app-access DAL migration (PR #49) on the same `main`.
**Why it matters:** a security-critical gate is now correct by construction rather than defended review-by-review, and the reusable pattern + invariant-map brief redirect future hardening from bug-hunting toward closing whole classes.
**Pointers:** `docs/REVIEWER_FINDER_COI_SAVE_RECOMPUTE_PLAN.md` §§1-20; `docs/INVARIANT_MAP_ORCHESTRATION_BRIEF.md`; commits `f324a503`, `4070728`, `a1d3049f`.

## July 2026 — Three reviewed refactor consolidations closed + escape-law gate + bypass-strip campaign scoped (Sessions 331–332)

**Milestone:** Three full plan→adversarial-Codex-review→amend→execute→closing-review cycles completed in one run: OData escape consolidation (12 sites onto `odata.escape`, PASS-WITH-FINDINGS close), array-chunk consolidation (new `lib/utils/chunk.js`, 17 mechanical swaps, SATISFIED after a two-round converge), and gate-script scaffold consolidation (new `scripts/lib/selftest-fixture.js` disposer helper adopted by 18 self-tests + `scripts/lib/walk-files.js` adopted by the 6 byte-identical markdown gates, SATISFIED with zero findings under a byte-identical census+verdict bar). Owner rulings recorded: odata escape-law gate BUILT (`check:odata-escape`, 565 files green); chunk-loop and security-gate-walk gates DECLINED. The next campaign — stripping all 52 functional `bypassDynamicsRestrictions` scopes onto `withDalContext` — is scoped, adversarially reviewed, and folded (`docs/BYPASS_STRIP_PLAN.md`), including a review-caught P0: two default-parameter bypass aliases invisible to call-site greps.
**Sessions:** 331–332.
**Ship state:** suite 416→418 suites / 4707→4714 tests; all gates green incl. the new law gate; every exercise's plan doc doubles as its execution + review record.
**Why it matters:** the repo now has canonical helpers where five copy-paste families used to drift (odata escaping, array chunking, self-test fixtures, gate walks), each protected by pins or law gates; and the DAL campaign's final remainder has an execution-ready, review-hardened plan.
**Pointers:** `docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md`, `docs/CHUNK_CONSOLIDATION_PLAN.md`, `docs/GATE_SCRIPT_CONSOLIDATION_PLAN.md`, `docs/BYPASS_STRIP_PLAN.md` (all Stage Logs); `scripts/check-odata-escape.js`.

## July 2026 — Route→Service consolidation: all 49 routes shelled, gate promoted to law, drain prod defect fixed (Session 331)

**Milestone:** The Route→Service consolidation campaign (planned S330) executed end-to-end in one overnight autonomous session — Stages 0-7, census 49→0: every in-scope `pages/api` route became a thin shell over a new `lib/services/<domain>/` service, and `check:route-service-boundary` was promoted from ratchet to permanent law. Mid-campaign, the Stage 5 STOP-AND-ASK discipline surfaced a real latent production defect: the intake drain's Dataverse writes ran with no trusted DAL context — fail-closed broken since the S330 enforcement flip — fixed same session with a per-job `withDalContext` and a real-machinery regression test.
**Sessions:** 331 (plan authored + P0-approved S330).
**Ship state:**
- 51 files across 11 new domain-service directories; suite 4188→4670 (+482 characterization/service tests); build green; all gates green.
- Streaming template (P1s) and multi-verb template (P1m, with branch-scope caveat) ratified by fresh-context Codex checkpoints; `ServiceHttpError` base shapes every shell's error mapping; five stage reviews all cleared with same-session finding resolution.
- Boundary gate hardened through five adversarial rounds during Stage 0 (binding taint, fail-closed non-literal sources, late-assignment + alias-chain provenance) before any extraction began.
- **MORNING FLAG (RESOLVED S332):** owner-approved read-only prod audit found `submission_jobs` empty — zero jobs ever enqueued, so the defect never stranded a submission; no requeue. Drain cron healthy (2-min ticks, all 200s).
**Why it matters:** the layer above the DAL is now structurally clean and law-enforced (guard → validate → context → service call → map), business logic is unit-testable for the first time across 49 routes, and the in-campaign bypass strip converted every legacy route-level `bypassDynamicsRestrictions` it touched.
**Pointers:** `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md` Stage Log (execution + review record); `scripts/check-route-service-boundary.js` (law); `lib/services/cron/drain-submissions-service.js` (drain fix); commits `311f4879`…close-out.

## July 2026 — DAL security-complete: prod enforcement live, gate hardened to real law, harness enforcement hooks (Session 330)

**Milestone:** `DATAVERSE_DAL_ENFORCEMENT=on` shipped to production (Vercel env + redeploy, `reviews.wmkeck.org`) after the last security gaps closed the same session: the S329 email-write High (3 asserts + tests, Codex pass-with-findings), and a Codex adversarial review of the Stage 8 gate itself (verdict "not sound as load-bearing law yet" — 3 Highs: ordinary JS indirection escaped the census) fixed via a sanctioned-reference audit designed through a 5-round Codex iteration to SATISFIED.
**Sessions:** 330.
**Ship state:**
- Enforcement active in ALL environments; runtime logs clean post-flip; all 10 production email call sites caller-verified in trusted contexts before the flip.
- Gate outlaws indirection (re-exports, destructured/bound methods, client pass-through, inline/dynamic requires → `unattributable-use:*` law violations); 16 new red fixture classes; live burn-down zero.
- Plan/review enforcement hook layer (Codex-built from the S330 P0 coverage-miss post-mortem): assumption-count leakage, plan-names-unread-sources, same-session doc staleness (Stop-blocking), untraced discovery delegation — all blockers with visible in-artifact escapes; two live catches same day.
- Route→Service consolidation plan authored, P0-approved (3 Codex rounds, final zero live-state errors), `status: active`, unexecuted.
**Why it matters:** the DAL trust boundary is now enforced where it counts (prod) and the gate that guards it can no longer be evaded by accident; planning failures that caused the P0 misses are now mechanically blocked, not just remembered.
**Pointers:** `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` stage log; `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md`; `.claude/hooks/lib/document-guards.js`; commits `fff391bb`…`4ef83c77`.

## July 2026 — Dataverse data-access layer: all 9 migration stages executed in one session (Session 329)

**Milestone:** The entire staged Dataverse DAL migration — census, CI ratchet, core toolkit, ~80 caller-file conversions, restriction-context fold-in, and the gate becoming law — executed start-to-finish, one session, via parallel worktree agents (Codex + Opus + Sonnet) with serial Claude review/merge and Codex adversarial reviews at each phase boundary (plan NEEDS-REWORK → fixed; Stage 2, waves 3–6: not refuted).
**Sessions:** 329 (plan authored + approved S328).
**Ship state:**
- `lib/dataverse/core/` (odata/entity-registry/errors/changeset/context) + 18 per-entity adapters; zero raw entity Dataverse calls outside the DAL and exempt power tools (census 211 identities → 12, all non-entity-transport).
- `check:dataverse-access-layer` is LAW in CI: alias-aware, changeset-aware, unknown-method fail-closed; allowlist deleted.
- Entity writes fail closed outside a trusted post-auth context under `DATAVERSE_DAL_ENFORCEMENT` (on outside prod; **prod flip pending owner deploy decision** — flipped Session 330). CLAUDE.md invariant updated.
- Also: pricing-canary standing test red fixed (was masking CI `Tests` for 2+ sessions — the atlas red it hid is the cautionary tale).
**Why it matters:** entity-name guessing, per-route SELECT/filter drift, and unwrapped writes are now structurally unrepresentable, not just policed after the fact.
**Open:** post-impl Codex adversarial review of Stage 7 (completed 2026-07-05) found a High-severity gap — `createEmailActivity`/`addEmailAttachment`/`sendEmail` in `dynamics-service.js` reach the network with no `assertTrustedDalContext`, exempted by Stage 8's own gate as `non-entity-transport`. Fix before calling Stage 7/8 security-complete. (closed Session 330) Also open: mechanical strip of 79 legacy wrapper importers; prod enforcement flip (flipped Session 330 — strip is the sole remaining item).
**Pointers:** `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` (stage log = full audit trail); merges `6b9ddc83`…`3cf4a506`.

## July 2026 — Reviewer pipeline browser-proven end-to-end; release flow hardened; thank-you automation (Session 328)

**Milestone:** The first live review traveled the whole pipeline — invite → accept → drain-queue confirmation → portal submit → Compare/Export/AI synthesis — in an owner-driven staged rehearsal that surfaced and same-day-fixed two production blockers and four UX/correctness gaps.
**Sessions:** 328.
**Ship state:**
- Synthesis unblocked in prod: `claude-sonnet-5` registered in the model capability/pricing registry; prompt maxtokens 2000→8000 (Sonnet 5 thinking counts against the cap).
- Release flow: portal-link-only by default (attachment behind admin toggle — kills the public-Blob copy of proposals), selection-aware Release button, empty-materials preflight warning, token `ops` claim now enforced fail-closed on all portal routes.
- Submit now advances `wmkf_reviewstatus` → Review Received atomically; submitted view drops the stale "no materials" card.
- New daily thank-you sweep (claim-before-send, at-most-once) emailing the reviewer a server-rendered DOCX copy of their own review as real bytes.
- Dataverse data-access layer migration plan authored + adversarially verified (execution not started).
**Why it matters:** D26 reviewers can now be invited with confidence — every leg of the reviewer journey has been exercised against production, not just unit-proven.
**Pointers:** `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`; commits `23e65f71`…`a2131328`; rehearsal tooling `scripts/probe-review-rehearsal-state.mjs`, `scripts/reset-reviewer-for-testing.js --clear-synthesis`.

## July 2026 — Reviews-tab consumption suite live: outstanding/nudge, compare, export, AI synthesis (Session 326)

**Milestone:** The staff-facing side of the reviewer portal shipped to production in one session — all four planned phases — ahead of the first D26 review submissions.
**Sessions:** 326.
**Ship state:**
- Outstanding tracking + manual review-due nudge (shared fire-once marker with the cron; drive-verified against live acceptance data).
- Schema-free comparison matrix + client-side DOCX/PDF panel-prep export (pure derivation/composition modules = future Power Automate/server seam).
- AI synthesis via Tier-1 prompt `review-synthesis.generate` (seeded v1) → new prod Dataverse column `akoya_request.wmkf_reviewsynthesisjson` (wave11); untrusted-wrapped input, strict-JSON bounded output.
- Verification boundary: zero portal submissions exist yet — populated views are unit-proven, runtime debut at first (or staged) submission.
**Why it matters:** Staff/PDs now have the full receive-review workflow (monitor → nudge → compare → export → synthesize) waiting for the D26 cycle, and the deploy-order lesson (Dataverse column before code) plus the staff-host hazard are recorded.
**Pointers:** `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`; commits `b107b940`, `ceeac840`, `e6991f35`, `fc9ab2c7`, `cbc3f571`.

## July 2026 — Reviewer acceptance fast-response drain shipped (Session 325)

**Milestone:** External reviewer accept clicks now return after durable job staging + Dataverse accept commit, instead of waiting on honorarium/contact/email/quota side effects.

**Sessions:** 325. Codex designed/built the Postgres-backed drain, Claude reviewed twice, Codex fixed sibling-job dedupe/retry semantics, and migration `024` was applied to the configured Postgres database.

**Ship state:**
- New `reviewer_acceptance_jobs` ledger + `/api/cron/drain-reviewer-acceptances` move the formerly-inline accept tail into a retryable cron drain while keeping Dataverse `wmkf_appreviewersuggestion` authoritative.
- Fresh accept gates 200 on job staging + Dataverse PATCH; repeat accept requeues follow-up without restamping; stale sibling jobs cancel before duplicate confirmation email.
- `024_reviewer_acceptance_jobs.sql` applied and verified (`schema_migrations` row + `public.reviewer_acceptance_jobs` table).

**Why it matters:** reviewers should no longer sit through the 30-second slow tail after clicking accept, while staff-facing honorarium/contact side effects remain durable, retryable, and observable.

**Pointers:** `docs/atlas/postgres-infra-tables.md`, `docs/API_ROUTE_SECURITY_MATRIX.md`; commits `a3103b3c`, `1be33e0b`, `efe386ae`.

## July 2026 — Pricing-refresh build incident repaired after cleanup false-positive (Session 324)

**Milestone:** A production Vercel build failure from the S323 cleanup was traced to deleting the live Anthropic Admin API client used by the monthly pricing drift cron, then repaired and pushed.

**Sessions:** 324. Codex diagnosed from the Vercel build log, verified the live cron/documentation contract, restored the service, and corrected the deletion manifest.

**Ship state:**
- `lib/services/anthropic-admin.js` is restored as the `/v1/organizations/cost_report` client imported by `/api/cron/pricing-refresh`; `docs/DEAD_CODE_DELETION_MANIFEST.md` now records the false-positive deletion.
- `npm run build` passed after restore; `main` was pushed at `5f2c6807`.

**Why it matters:** the S322/S323 dead-code audit now has a concrete correction path documented, and the pricing drift guardrail deploys again instead of failing at module resolution.

**Pointers:** `lib/services/anthropic-admin.js`, `pages/api/cron/pricing-refresh.js`, `docs/DEAD_CODE_DELETION_MANIFEST.md`; commit `5f2c6807`.

## July 2026 — Reviewer gating redesign shipped: contested-email lane, COI precision + drop ledger, faculty-page tier live (Session 321)

**Milestone:** The reviewer-finder's silent-discard gates became visible, staff-adjudicable states — in production, with the faculty-page email fetch tier enabled — closing the Cause #2 email-coverage miss and the Contract 5 COI mis-drop exposure in one arc.

**Sessions:** 321 (S320 diagnosed Cause #2 and briefed the review). Claude led strategy + verification; Codex adversarially reviewed (2 blockers → rev 2) and built; Claude took over two stalled Codex runs.

**Ship state:**
- **Contested-email lane** — the domain guard and name-mismatch heuristic now contest (`search_contested`, LOW → per-recipient confirm) instead of nulling; identity-anchored ORCID/OpenAlex domain vindication auto-recovers; send/save gates unchanged or stronger (`29c6748c`).
- **Per-recipient invite confirm** — the batch LOW `window.confirm` became per-recipient checkboxes; only ticked ids reach `confirmedLowConfidenceIds`.
- **COI precision + observability** — `institutionsMatchForCOI` (ID-first; 7/10→0/10 curated false positives), durable `coi_dropped` roster ledger (migration 023), and owner-approved Phase C flag-not-drop for the narrow contradicted-single-source case (`2a244b9d`, `dae623c5`).
- **`REVIEWER_PAGE_EMAIL_TIER_ENABLED` enabled in prod** by the owner, now bound to the identity-anchored domain set (`f65123fb`).

**Why it matters:** measured recall losses (4/5 correct emails discarded by gates; leaky COI matcher with invisible drops) are converted into staff-visible one-click decisions without opening any wrong-person send path — the send-time confidence gate remains the fail-closed backstop.

**Pointers:** `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md`, `docs/REVIEWER_COI_PRECISION_PLAN.md`, `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`; commits `b6b23720`, `fe48ff0e`, `29c6748c`, `16441575`, `2a244b9d`, `dae623c5`, `f65123fb`.

## July 2026 - Reviewer finder referral seeding and Dataverse-grounded analyze shipped (Session 319)

**Milestone:** Reviewer Find now supports externally referred seed names and no longer asks Claude to infer request identity metadata that Dataverse already owns in normal request-backed analysis.

**Sessions:** 318-319 plus S320 reconciliation. Codex built/refined; Claude independently verified the merge state; final branch collision was reconciled on `main`.

**Ship state:**
- **Referral seeding** - PD-entered external referrals are guaranteed into the Find pool, labeled "Externally-Referred"; applicant referrals retain their separate label. Same-name seed/discovery collisions preserve referred provenance in display and reloadable roster persistence (`b997cf37`, `ff54c60c`).
- **Dataverse-grounded analyze** - `/api/reviewer-finder/analyze` requires `requestId`, loads trusted request metadata, slims prompt PART 1, and overlays Dataverse title/PI/Co-PI/institution/abstract/program context onto `proposalInfo` (`83b585b4`).
- **Merge state** - program-area and referral features landed through two-parent merges (`a4a47bc9`, `4f31f045`) and docs were reconciled at `a4668068`; live read-only probe confirmed context resolution for requests `1002916` and `1002926`; `npm run build` passed.

**Why it matters:** closes the program-area save-crash class caused by asking the LLM to infer known metadata, while giving PDs a deterministic way to include externally referred reviewers without losing provenance.

**Pointers:** `docs/REVIEWER_REFERRAL_SEEDING_DESIGN.md`, `docs/REVIEWER_ANALYZE_PROMPT_METADATA_ISSUE.md`, `docs/agent-wiki/topics/reviewer-origination.md`; commits `83b585b4`, `b997cf37`, `ff54c60c`, `a4a47bc9`, `4f31f045`, `a4668068`.

## July 2026 — Reviewer honorarium request creation went live in production, no-BILL (Session 316)

**Milestone:** The reviewer honorarium pipeline now **mints real honorarium `akoya_request` rows in production** when a non-opt-out reviewer accepts — the "no-BILL" cycle (request creation on, Bill.com payment still deferred). This flips on a pipeline that had been capture-only since 2026-06-22.

**Sessions:** 316. Field creation + env flip done live this session (Dataverse Web API / Vercel CLI); Codex-reviewed the backfill hardening (caught a P0).

**Ship state:**
- **Go-live** — set the 3 discriminator GUIDs on Production, removed `HONORARIUM_ONBOARDING_DEFERRED` from Production (kept `true` on Preview → preview stays capture-only), kept `BILL_ONBOARDING_DEFERRED=true`, redeployed prod (`dpl_CqnqfG6mp3U…`, aliased reviews/applications.wmkeck.org). New accepts mint; payment stays offline/by-check.
- **New schema** — created a self-referential lookup `wmkf_reviewedproposal` on `akoya_request` (honorarium → parent proposal) via the Web API; the create binds it (`wmkf_ReviewedProposal@odata.bind`) so app-created honoraria feed Connor's AkoyaGO dashboard. Meeting date + fiscal year cue from the parent proposal (`orchestrator:156/180/181`); no parent meeting date → create refused (accept still succeeds).
- **Backfill hardening** — extracted the accept-path address contract (presence **and** validity) into `lib/external/required-address.js`, shared by the fresh-accept guard and the capture-only backfill; added `akoya_title`. Codex P0: the backfill had enforced only presence, not country-ISO2 validity.
- **Backfill run: unneeded** — read-only sweep found only 4 capture-only-window candidates, all test rows; no real cohort.

**Why it matters:** reviewer honoraria are now first-class Dataverse records created at accept time, linked to and dated from their proposal — the substrate Ops needs, without turning on payment. Full BILL payment enablement stays a separate, leadership-gated step.

**Pointers:** `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` (§2 live, §6 backfill, §8/§9 self-lookup); `docs/CREDENTIALS_RUNBOOK.md` honorarium flags; commits `76a721a1`, `46575e8c`, `a3d83a8d`, `1291b0fb`, `f340e776`.

## June 2026 — Reviewer rating columns retired; ratings live solely in the answer snapshot (Session 305)

**Milestone:** The three legacy parent rating columns on `wmkf_appreviewersuggestion` (`wmkf_reviewerimpact` / `wmkf_reviewerrisk` / `wmkf_revieweroverallrating`) are **gone** — dropped from Dataverse. Review ratings now live in exactly one place, the `wmkf_appreviewanswer` snapshot. This closes the staff-editable-review-questions epic (Phases A–E).

**Sessions:** 305 (Phase D: migrate readers + writers to the snapshot, backfill; Phase E1: stop the dual-write; Phase E2: drop the columns). Two Codex design reviews, both caught load-bearing P0s.

**Ship state:**
- **Phase D** — DTO (`reviewers.js`), external prefill (`context.js`), and the merge engagement predicate all read ratings from the snapshot (`ratingsFromAnswers` / `readRatingsBySuggestion`); legacy staff writers (`review-upload.js`, `mark-received-no-file.js`) dual-write snapshot rows; one historical parent-only row backfilled. Shared `lib/external/review-answer-snapshot.js`.
- **Phase E1** — all 3 writers stopped PATCHing the parent columns; `validateReviewForm` returns a separate `ratings` bucket (strict parse); producer backstop re-anchored on `CORE_RATING_KEYS`; admin removal guard decoupled (`PARENT_BOUND_KEYS`) and retained.
- **Phase E2** — attrs retired from schema-as-code first (so the create-only applier can't resurrect them), then dropped via `scripts/drop-reviewer-rating-columns.mjs --execute`; verified gone.
- Codex caught: the writers-before-readers ordering (a readers-first order would have nulled historical staff reviews) and the schema-as-code resurrection trap + a producer-backstop no-op.

**Why it matters:** the denormalization is fully retired; the snapshot is the single system of record for ratings, so staff-edited question sets and historical reviews never drift against a parallel column store. **Forward constraint: never redeploy pre-E1 code** — it would PATCH the now-missing columns.

**Pointers:** `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md` §6/§8; `docs/atlas/dataverse-wmkf-appreviewanswer.md`; commits `ed9747d9`…`f08944d7` (Phase D `20ba8add`/`b8cc067a`/`ae6fac22`, E1 `cc0bce6b`, E2 `f08944d7`).

## June 2026 — Review-form question set became staff-editable live data (Sessions 303–304)

**Milestone:** The external-reviewer review-form question set is no longer a static code array — it's a Dataverse entity (`wmkf_reviewquestion`) read at runtime and edited live by staff in a `/admin` editor, without a deploy and without disturbing past reviews (the `wmkf_appreviewanswer` snapshot preserves history).

**Sessions:** 303 (Phase A: entity + `ReviewQuestionFetcher` fail-closed + seed, created+seeded in prod; Phase B server) → 304 (Phase B2 reviewer client cutover; Phase C superuser editor). Codex-reviewed each phase; findings folded.

**Ship state:**
- `lib/external/review-question-fetcher.js` — `getActiveQuestionSet()` (cached, single-flight, **fail-closed**) replaces the static `reviewFormSchema.fields` as the runtime source; `questionSetVersion()` optimistic-lock hash. Reviewer `context`/`submit`/`draft` + `ReviewAuthoringForm` all render from the fetched set.
- `/admin` → Review Questions editor (`pages/api/admin/review-questions.js` + pure `lib/admin/review-question-save.js` + `ReviewQuestionsSection.js`): one atomic `executeChangeset` (create/update/soft-delete by row-id + `If-Match`), key-immutability, parent-bound-row guard, 100-row cap, Postgres `review_question_audit` (migration 022, pending→final hard-abort). Prod-verified read + live save (200).
- Incident folded: first prod save 502'd on schema-name casing (`wmkf_Name` vs logical `wmkf_name`) — mocks couldn't catch a service contract (`2ea15905`); memory `feedback-verify-write-paths-against-live-service`.

**Why it matters:** staff change which questions reviewers answer (text/order/type/options/required) with no engineering involvement, and the answer-snapshot keeps every past review intact across edits. Phase D/E (retire the legacy `wmkf_reviewer{impact,risk,overallrating}` parent columns) remain.

**Pointers:** `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md`, `docs/atlas/dataverse-wmkf-reviewquestion.md`; commits `7ef56014`, `f0a65112`, `2ea15905`, `cfbad4a6`.

## June 2026 — Reviewer in-browser review-form authoring shipped end-to-end (Session 302)

**Milestone:** External reviewers now author AND submit their review in the browser — the file-upload review path is retired from the UI. A submitted review is captured as a point-in-time Dataverse answer-snapshot (`wmkf_appreviewanswer`) written atomically, then read back in the staff workbench.

**Sessions:** 300 (plan + data-model pivot) → 301 (Phases 0–2 + the `$batch` spike) → 302 (Phase 2.5 Part B through Phase 5). Codex-reviewed every phase; findings folded.

**Ship state:**
- `DynamicsService.executeChangeset` — atomic Dataverse `$batch` changeset helper (per-op `If-Match`, fail-closed multipart parse); refutes the old "no $batch transaction" belief. `_wmkf_appreviewersuggestion_value=<guid>` is the prod-verified alt-key upsert form (NOT the bare logical name) (`d3ed821b`, `cc787b4e`).
- `/submit` — finality precheck + sanitize/validate + atomic changeset (answer rows upserted by alt key + parent ratings/affiliation/receivedat, fail-closed `If-Match`) + draft-delete-post-commit; the wired Submit button locks the form read-only (`1bf0f317`, `ce6bbf99`, `73ac41b1`).
- Workbench read-back: `/api/review-manager/reviewers` attaches re-sanitized `answers[]`, rendered by `ReviewsTab` (`b08c7323`). Draft lifecycle: deleted on submit / token revoke+regenerate (not `mintAndStore`) + 90d cron GC (`c00c7e6f`).

**Why it matters:** reviewers no longer assemble a PDF — the narrative answers are structured, lossless across question-set changes, and machine-readable for the future review-document assembler/VRP. The file-upload route is hidden-not-deleted (finality-guarded). Net-new atomic-multi-row Dataverse write primitive is now available repo-wide.

**Pointers:** `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md` (Phases 0–5 done), `docs/atlas/dataverse-wmkf-appreviewanswer.md`, memory `reference-dataverse-altkey-lookup-upsert-url` + `project-dataverse-batch-changeset-available`. Commits `d3ed821b`…`84d00cdb`.

## June 2026 — Reviewer↔CRM-contact boundary reconciled (Session 294)

**Milestone:** The reviewer-pipeline → CRM-`contact` boundary is closed end to end: a reviewer's identity corrections now reliably reach (or are surfaced for) their CRM contact, where before they stranded on pipeline rows and could spawn duplicate/stale contacts on the payment-bearing accept path.

**Sessions:** 294 (single session; each increment owner-decision-gated, Codex-implements/Claude-reviews loop throughout, all prod-pushed).

**Ship state:**
- Origination-time contact match in `save-candidates` (unique ORCID/email auto-link, else staff alert) + honorarium split/duplicate guards (Increment 1, `35693cf2`).
- Reviewer self-reported name/title/nickname OVERWRITE the contact on accept (silent; identity-status gate dropped for a fail-closed `trusted:true` since the magic-link token already proves identity) (`027fe256`, `a073dd35`).
- Email + affiliation differences raise durable staff alerts (`reviewer_contact_email_mismatch`, `reviewer_contact_affiliation_mismatch`) — NO write. Affiliation was downgraded from account-resolution to alert-only after verification found no account name-search precedent and a COI-weighted, write-precedent-free `parentcustomerid` (`3ce2607c`, `fa15ee4b`).

**Why it matters:** reviewer-supplied corrections stop stranding on pipeline rows; staff get an /admin alert queue for the ambiguous cases instead of silent duplicate/stale contacts on the path that mints honorarium payments. Two build decisions were reversed by verifying before building (nickname target existed; affiliation account-resolution did not).

**Pointers:** `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` (full decision record), `docs/agent-wiki/topics/reviewer-identity.md`. Commits `35693cf2`, `027fe256`, `a073dd35`, `3ce2607c`, `fa15ee4b`.

## June 2026 — Reviewer-record merge shipped + prod-confirmed (Session 290)

**Milestone:** The duplicate-reviewer dead-end a colleague hit is fully closed: staff can now merge two duplicate `wmkf_potentialreviewers` rows from the candidate edit modal, and the whole path is empirically confirmed against production.

**Sessions:** 289 (backend chunks 1–3) → 290 (UI merge mode, non-mocked prod probe, conflictingRecordId fix). Codex pre/post-impl folded throughout.

**Ship state:**
- Chunk 4: `CandidateEditModal` flips into merge mode on a duplicate-key 409 (keeper swap, orientation-aware field picker, blocked-reasons explainer, orphan-recovery). 13 RTL tests.
- Chunk 5: `scripts/probe-merge-altkey-ordering.mjs` exercises both alt-keys + e2e merge against prod on throwaway rows; `--run` settled O8 (A/B/C pass, cleanup verified).
- The probe caught a real prod bug all mocked tests missed: the 409 derived `conflictingRecordId` from the 412 body (which carries the written record + its `modifiedby` systemuser, NOT the owner). Fixed by resolving the owner via `findByEmailCandidates` (fail-closed on statecode); `lib/dataverse/duplicate-key.js` extracted + pinned by a regression test.
- Also shipped the **Invite Reviewers** tab: explicit "✏️ Edit contact" button + no-email invite guard + local nomenclature cleanup.

**Why it matters:** a non-technical PD can now self-serve a duplicate-reviewer fix instead of hitting a 412 with no recourse; the non-mocked probe is the pattern that caught a bug green unit tests could not.

**Pointers:** `docs/REVIEWER_MERGE_DESIGN.md` (Chunk 5 prod-confirmed), `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md`, `docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md`. Commits `080e7069`, `10ab7d4a`, `39d44117`, `169d8454`, `a19b934f`, `5f8412de`.

## June 2026 — Claude model-change guardrails shipped (Session 287)

**Milestone:** The S286 model-change strategy became working architecture: Claude model capability/pricing drift now fails loud in gates/admin/runtime paths instead of waiting to 400 in front of reviewers.

**Sessions:** 287. Codex implemented the registry, transport wiring, admin validation/status, live discovery canary, deprecated-param safety net, and replay artifact workflow.

**Ship state:**
- `model-capabilities` + `resolveModelWithCapabilities()` now shape Claude request params after tier resolution; `LLMClient`, `multi-llm-service`, and Executor paths share the contract.
- `check:model-registry` blocks static capability/pricing/fallback drift; admin model overrides and prompt publish/runtime reject unreviewed concrete Claude ids before persistence/use.
- Pricing canary queries Anthropic `/v1/models` for newer uncovered ids; `LLMClient` has a narrow retry-once safety net for recognized deprecated optional params only.
- Admin Models shows read-only capability/pricing status; `validate-reviewer-analyze.mjs --json-out` plus `MODEL_PREFLIP_REPLAY_RUNBOOK` define repeatable reviewer-finder pre-flip evidence.

**Why it matters:** protects the colleague-facing reviewer Workbench from future Anthropic model releases/deprecations by turning model drift into reviewable CI/admin evidence rather than runtime surprise.

**Pointers:** `docs/MODEL_CHANGE_STRATEGY.md`, `docs/MODEL_PREFLIP_REPLAY_RUNBOOK.md`, `lib/services/model-capabilities.js`, `scripts/check-model-registry.js`. Commits `881f2555` through `d1c65eb5`.

## June 2026 — Reviewer acknowledgement policies live; jsdom purged from serverless (Session 284)

**Milestone:** Reviewer Confidentiality + Responsible-Use-of-AI acknowledgements went live (Stage 2a accept now requires both), and a latent prod-breaking jsdom/serverless incompatibility was fixed across all three markdown renderers.

**Sessions:** 284. Owner published the two policy versions; Claude fixed rendering + the jsdom bug (policy split delegated to Codex).

**Ship state:**
- Published versioned policies `reviewer-coi` ("Confidentiality Terms") + `reviewer-ai-use` ("Responsible Use of AI"), label `2026-06-24`. Rename is title-only; slot codes unchanged. Reviewer ack modal now renders markdown (`@tailwindcss/typography` enabled — `prose` had been a no-op everywhere).
- **Incident:** `POST /api/admin/policies` 500'd in prod — server DOMPurify loads jsdom via `eval('require')`, but jsdom's ESM-only deps can't be `require()`'d in the Vercel/Turbopack function runtime. Fix: stop externalizing a DOM lib; use a DOM-free sanitizer.
- `policy-markdown` split into `-client` (DOMPurify) / `-server` (`sanitize-html`); `grantee-markdown` (4 live routes) converted to `sanitize-html`; `app-markdown` made client-only. No `eval('require')('jsdom')` remains in `shared/utils`. Publish confirmed working in prod.

**Why it matters:** reviewers now attest confidentiality + AI-use before accepting; and the whole class of "jsdom server-side" bugs (grantee deliverable routes were next to break) is closed — sanitize-html is the standing rule for server-side HTML sanitization.

**Pointers:** `SESSION_PROMPT.md` (S285), `.claude-memory/project-jsdom-serverless-esm-incompat.md`. Commits `98bf2ce1`, `e597747e`, `77a003fb`, `d76af6ea`.

## June 2026 — Staff auth cut over to applications.wmkeck.org (Session 281)

**Milestone:** The staff-auth migration held at S280 completed — staff OAuth + the `lib/utils/auth.js` Origin/Referer CSRF check now run on the WMKF-branded `applications.wmkeck.org`, verified end-to-end. Completes the branded-domain trio (reviews./grantees./applications.).

**Sessions:** 281. Owner added the Azure redirect URI + set the env; Claude verified live and reconciled the docs.

**Ship state:**
- Azure staff app ("WMK: SSO Authentication", client `a652a292-…`) now allows `https://applications.wmkeck.org/api/auth/callback/azure-ad`; `NEXTAUTH_URL=https://applications.wmkeck.org` set in Production.
- VERIFIED via live `/api/health` + an authenticated POST/DELETE write probe on the branded host: sign-in + reads + writes all work; Origin CSRF check ON and pinned there.
- Legacy `wmkfresearch.vercel.app` 403s writes and funnels sign-in to the branded host (deprecation tail; old callback retained for now). Preview `NEXTAUTH_URL` removed (had been wrongly set to the prod host). *(S293 follow-up: the legacy host now also 307-redirects page navigations to the branded host via a `next.config.js` rule, so bookmarks land on the branded host before hitting the Origin-403; `/api/*` excluded.)*
- **Correction:** the months-long "NEXTAUTH_URL empty in prod" belief was a Sensitive-var `vercel env pull` artifact (reads back `""`); runtime was always non-empty — trust `/api/health`, not the pull.

**Why it matters:** staff now see a WMKF-owned domain (anti-phishing parity with the external portals), and state-changing staff API calls are host-locked by the CSRF check.

**Pointers:** `SESSION_PROMPT.md` (S282), `.claude-memory/project-branded-domains.md`, `docs/CREDENTIALS_RUNBOOK.md`, `docs/agent-wiki/topics/security-auth.md`. Commits `8776a32c`, `bd0f3764`, `3030ecfa`.

## June 2026 — Branded reviewer/grantee portal domains live (Session 280)

**Milestone:** External reviewer and grantee magic-link traffic moved from Vercel-branded URLs to WMKF-branded domains, with the staff `applications.wmkeck.org` auth migration deliberately held until Azure callback validation.

**Sessions:** 280. Codex split the portal-domain work off the accidental mixed branch, hardened public request-number exposure, smoke-tested reviewer/grantee links, and deployed to prod; Claude's unrelated workbench/email branch was parked separately.

**Ship state:**
- `REVIEWER_PORTAL_BASE_URL=https://reviews.wmkeck.org` and `GRANTEE_PORTAL_BASE_URL=https://grantees.wmkeck.org` active in Production; aliases also include `submissions.wmkeck.org` and `applications.wmkeck.org`.
- External reviewer/grantee context JSON no longer returns `requestNumber`; reviewer and grantee send paths fail before send if hydrated subject/body copy exposes the internal request number.
- Grantee portal copy now says "Graphical Abstract Request" and submitted copy says "your materials have..."; production grantee visual smoke reached submitted confirmation and test CRM/Dataverse/SharePoint residue was cleaned up.

**Why it matters:** external reviewers and grantees now see WMKF-owned domains in email links, reducing phishing confusion while keeping staff OAuth and Origin/Referer behavior stable until the app-registration work is ready.

**Pointers:** `SESSION_PROMPT.md` (S281), `.claude-memory/project-branded-domains.md`, `docs/CREDENTIALS_RUNBOOK.md`, `docs/agent-wiki/topics/security-auth.md`. Commits `6574f939`, `13757115`; deployments `dpl_8tmRkKX9mhEpL7uU6o1NKKpMQuMb`, `dpl_7Mvdv1juuDTRSJXeFQaatyqEyE7M`.

## June 2026 — Reviewer onboarding-at-accept + admin-editable email defaults (prod) (Session 279)

**Milestone:** Model B taken to its conclusion — the reviewer flow collapsed to ONE final Accept and the dormant hold/finalize scaffolding was retired — and email/text default copy became admin-editable (no hardcoded runtime copy). Both shipped to prod. Codex built each chunk; Claude reviewed every diff.

**Sessions:** 279. Per chunk: design → Codex intent/pre-impl review → Codex build → Claude review (contract + gates + full `npm test`) → commit → deploy.

**Ship state:**
- **Single Accept:** reviewer onboards up front (COI/AI acks + capture-only honorarium/address, NO Bill.com), gets an acceptance email + review-due `.ics`. PD-only exit (server guard rejecting accepted→decline + atomic Remove that clears engagement flags).
- **Hold/finalize path RETIRED** (templates, `HoldView`, `proposal-readiness`, the hold action) — `scripts/probe-held-reviewers.mjs` confirmed **0 held rows**; the `held` enum + `wmkf_heldat` column kept for read-safety.
- **Capture-only honorarium lock:** `HONORARIUM_ONBOARDING_DEFERRED=true` in prod + discriminator GUIDs unset → no Bill.com payment can fire this cycle.
- **Admin-editable email/text defaults:** catalog (`shared/config/editableTextDefaults.js`) → `wmkf_appsystemsettings` → `/admin → Email Defaults`; **no hidden hardcoded fallback** (blank = discoverable, outage = "unavailable"); seed/backup in `lib/seed/email-defaults/`. All six workbench emails migrated; cron blank-guards run **before** the fire-once claim so a misconfig never burns a reminder marker.
- **Copy fixes:** request number removed from ALL external surfaces (emails, `.ics`, reviewer + grantee portals); `[proposal title clause]` → `[proposal]`; grantee-reminder surname. Preview tool `scripts/preview-emails.mjs`.

**Why it matters:** one reviewer commitment instead of three, the dormant hold infrastructure gone, and a reusable admin-editable-copy pattern so non-coders own email/text defaults without a code change.

**Pointers:** `SESSION_PROMPT.md` (S280), `docs/REVIEWER_ENGAGEMENT_SPEC.md`, `docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md` (RETIRED banner), memory `project-reviewer-hold-step-decouple`, `docs/CREDENTIALS_RUNBOOK.md` (capture-only flag). Commits `30e54890` → `2c9d66dc` (all pushed + deployed this session).

## June 2026 — Reviewer-engagement build: Model B accept-now, shipped end-to-end (prod) (Session 275)

**Milestone:** The reviewer-engagement flow (Model B — accept + onboard at the offer stage, PD releases the proposal later) went from spec to fully built across four phases, each Codex-reviewed before merge. Provisions new per-request campaign config and changes LIVE external-reviewer link expiry.

**Sessions:** 275. Per phase: design → build → self-trace → Codex adversarial review → fix → Codex re-confirm → merge.

**Ship state:**
- **9 Dataverse columns provisioned in prod** (wave `7-reviewer-engagement`): per-request campaign config on `akoya_request` (offset, review-due date, two reminder enabled/lead pairs, desired count, quota-notified marker) + `wmkf_respondremindersentat` on the suggestion.
- **Phase 1 — campaign config + panel:** invite "respond-by" is now a *days-to-respond offset*; config written on first invite (`send-emails`) + edited via `/api/review-manager/campaign-config` ("Campaign settings").
- **Phase 2 — token TTL + Release (ship together):** per-recipient link expiry keyed on accepted status (`lib/external/reviewer-token-ttl.js` via `render-emails`) — invitee/non-responder caps at review-due+2d, accepted gets review-due+90d, `now+90` fallback; accepted-only "Release to reviewers" materials send (server-gated); `materials_sent` upload guard (403).
- **Phase 3 — reminders:** daily `/api/cron/reviewer-reminders` (respond-by + review-due), per-request opt-in, fire-once + claim-before-send (at-most-once).
- **Phase 4 — quota + selective decline:** PD notified once when accepted count first hits desired (conditional `wmkf_quotanotifiedat` If-Match + bounded retry); `/api/review-manager/withdraw-sufficient` writes `withdrawn_sufficient` on still-pending rows (the §2.9 missing writer), If-Match-guarded against a mid-action accept.
- **Off by default:** reminders + quota are per-request opt-in; nothing fires until a PD enables a request. ~55 new tests; ~5 real concurrency/logic bugs caught by Codex and fixed.

**Why it matters:** completes the reviewer side of the panel-assembly loop and establishes the per-request-config + If-Match-concurrency + cron-claim-before-send patterns; the first feature where link expiry is data-driven rather than a flat 90 days.

**Pointers:** `docs/REVIEWER_ENGAGEMENT_SPEC.md` (§3.A–§3.E), `docs/atlas/dataverse-akoya-request.md` + `dataverse-wmkf-appreviewersuggestion.md`, `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`. Schema `lib/dataverse/schema/wave7-reviewer-engagement/`. PRs #37, #40, #42, #43, #44, #45 (commits `18f3bd81` → `dcfcd3a6`). Known deferred residual: cron/manual-followup share `wmkf_remindersentat` (Codex P3, documented).

## June 2026 — Grantee deliverables: package-table migration + chunk-8 outputs + unified signatures (prod) (Session 271)

**Milestone:** The grantee deliverables portal went from "built" to operationally usable, plus a production schema cutover moving the deliverable package off `akoya_request` into its own related entity.

**Sessions:** 271. Design → Codex pre-impl review → implement → Claude post-impl review loop throughout (the package migration and the unified signature were each Codex-reviewed before build and Claude-reviewed after).

**Ship state:**
- **New Dataverse entity `wmkf_granteedeliverable` LIVE in prod** (1:1 with `akoya_request` via a `wmkf_request` lookup + alternate key): status/image/caption + invited/reminded dates moved off `akoya_request` (0 live rows → clean cutover; SP write smoke-verified). The 3 now-orphaned `akoya_request` fields await a manual Dataverse deletion.
- **Chunk 8 outputs:** (a) portal preview, (b) website HTML, (c) cycle export; **Awardees page now reachable** (dashboard nav link + your-PD default + "Show all" toggle); **automatic reminder cron** (14-day deadline, day-12, PI+liaison, sent as the assigned PD via impersonation, `noFallback`).
- **Unified per-user email signature:** one Dataverse pref edited in Profile Settings, server-resolved from the assigned PD, tolerant migration off the reviewer `SENDER_INFO`. Reviewer-flow unification (Phase 2) documented, not built.
- **Prod env:** `DYNAMICS_IMPERSONATION_ENABLED=true`; `GRANTEE_PORTAL_BASE_URL` set (fixed hostless grantee magic-links). New `design-doc-assertion-guard` hook (grounds storage claims in plan docs).

**Why it matters:** closes the cycle-end grantee loop end-to-end and establishes the per-PD-preference + branded-domain patterns; the package now has its own lifecycle entity instead of bloating the central request.

**Pointers:** `docs/GRANTEE_DELIVERABLE_PACKAGE_MIGRATION_PLAN.md`, `docs/UNIFIED_EMAIL_SIGNATURE_PLAN.md`, `docs/GRANTEE_PORTAL_BUILD_PLAN.md` chunk 8. Commits `0986c8fc` → `ed474d41`. Open (S272 first task): per-PD custom email body + edit affordance.

## June 2026 — Grantee Deliverables Portal, built end-to-end (prod) (Session 268)

**Milestone:** A new external-facing capability — at cycle close, staff invite research awardees to review a Foundation-style abstract of their proposal and return a graphical image + caption via a magic-link portal, captured to Dataverse + SharePoint. A parallel grantee variant of the reviewer external portal (shared primitives, forked surfaces), not a mutation of it.

**Sessions:** 268. Built chunk by chunk with the design→Codex-pre-impl→implement→Codex-post-impl loop (each post-impl caught real issues, all folded). Schema + prompt deployed/seeded to prod mid-session.

**Ship state:**
- **Schema wave LIVE in prod** — 5 fields on `akoya_request` (`wmkf_abstractformatted`/`abstractapproved`/`granteeimagecaption`/`granteeimagefileref`/`granteedeliverablestatus`); no consent field (waiver is a client-side submit gate). Abstract prompt **seeded** in `wmkf_ai_prompts`.
- **Flow:** Awardee tab → generate (Executor, ETag-conditional persist) → resolve recipients (PI `To` / liaison `Cc`) → M365 invite (server-injected stateless `aud:'grantee'` magic-link) → grantee portal (edit abstract + upload image/caption + publish-waiver) → submit (magic-byte + virus-scan + SharePoint + atomic ETag write, refuses once Complete).
- **Awardee discovery:** the reviewer-finding dashboard doesn't surface awardees; new `/workbench/awardees` + editable GUID-keyed eligibility config (`akoya_requeststatus=Active` + research program + PI; owner-validated J26 = 12). Fixed the long-running `invite-email-modal-capture` parallel-test flake.

**Why it matters:** First grantee-facing workflow; closes the cycle-end loop the Foundation does manually today. Eligibility/recipient definitions were reverse-engineered from live J26 data and owner-validated (status=Active + research GUID + PI; `wmkf_phaseistatus=Invited` ≠ awarded).

**Pointers:** `docs/GRANTEE_PORTAL_SPEC.md` + `docs/GRANTEE_PORTAL_BUILD_PLAN.md`. Commits `180200ec` → `494a1b22`. Open (S269): rich-text-in-abstract decision (native `FormatName=RichText` vs markdown), chunk 6 (reminders + waiver/email copy), optional PA-free auto-on-award cron.

## June 2026 — Reviewer contact-leads recall layer + on-card manual contact edit (prod) (Session 267)

**Milestone:** Delivers the S266 strategic pivot (contact **recall** over identity precision). A reviewer's email was often *found by the search but withheld by a safety gate* (domain/name/anchor contradiction); staff couldn't see or use it. Now they can — without weakening the wrong-person gates.

**Sessions:** 267. Pattern per slice: spec → measure → build → Codex review → deploy. Slice 1 audit ran in prod first to confirm the dominant bucket before building (it did: ~68% verified, 100% of misses were found-then-discarded — so the broad paid scout (2b) was measured **unjustified** and skipped).

**Ship state:**
- **Quarantined `contactEnrichment.contactLeads[]`** surfaces discarded contacts (verified-domain / name-mismatch / anchor-contradiction) + faculty pages found without an email. `_addContactLead` force-sets `persistable:false` — leads NEVER feed `email`/`website`/persist flags or an invite.
- **Card display** (`ContactLeads.js`): high/medium prominent, low/rejected behind a toggle with the not-auto-used reason; gated on `!identityUnverified` (not `!email`).
- **Staff promotion + on-card manual edit:** "Use this email" / "✏️ Edit contact" stamp `emailSource:'manual'` → `emailConfidence` LOW → still requires confirm-before-send. Roster-persisted (compact, bounded) so leads survive reload.
- Co-shipped (Codex): reviewer E2E rehearsal harness + email-capture mode (`tests/e2e/reviewer-*`, `docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md`).

**Why it matters:** The email IS the product goal — a found-but-withheld address that staff can't recover is a total loss. This restores recall while keeping the safety spine (Codex re-confirmed across 5 reviews: leads quarantined, manual = low-confidence invite).

**Pointers:** `docs/REVIEWER_CONTACT_LEADS_SPEC.md` (Slices 1–5 IMPLEMENTED), `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` + `reviewer-identity.md`. Commits `915265c2` → `33ca40c5` (+ Codex E2E `e6fdff4d` → `399310b7`). Open: branded subdomains added, awaiting IT DNS (`REVIEWER_PORTAL_BASE_URL` flip pending); grantee portal spec stub `835e3a29`.

## June 2026 — Reviewer email recovery (faculty-page fetch) + ORCID-name identity promotion (prod) (Session 265)

**Milestone:** Two reviewer-finder capabilities shipped to prod, one of which **reverses the documented S235 zero-SSRF decision** as an opt-in. Reviewers were surfacing with no email (e.g. Argenti, Dudovich, Pfeifer) and prominent ORCID'd reviewers (e.g. Bucksbaum) were being dropped to `unresolved` when Claude omitted the institution.

**Sessions:** 265. Each: design → Codex design review(s) → implement (Claude or Codex) → Codex/Claude review → deploy. 5 design docs, ~6 Codex passes.

**Ship state:**
- **Resolved-page email tier** (flag `REVIEWER_PAGE_EMAIL_TIER_ENABLED`, **set true in prod**): when a candidate has no email but a captured faculty/profile URL on their OpenAlex-verified institution domain, the server fetches + page-grounds the address (`safeFetchInstitutionPage` — host bound to `verifiedInstitutionDomain`, IPv6 private-IP block, **undici IP-pinning** for DNS-rebind, content-type/size/time caps; trust gate = page-grounding, not local-part name match; stamps HIGH-trust `emailSource='institution_page'`). **Reverses S235 "no server-side faculty-page fetch"** — now an opt-in; enforcement contract #7 + S235 design (superseded) + agent-wiki reconciled. Verified recovering correct emails in prod.
- **ORCID-name-confirmed promotion** (not flag-gated): a spine-verified candidate goes `unresolved→probable` when the selected OpenAlex record's ORCID cross-source-agrees AND the ORCID profile's full given name confirms the forename — recovering the ORCID'd-but-vague-institution class without weakening the namesake gates (probable ceiling).
- Confirmed (via temp instrumentation) that a missing known reviewer like Bucksbaum is **generation variance**, not verification — the real coverage lever is candidate count + multi-pass dedup, not the resolver.

**Why it matters:** Recovers sendable emails that were previously blank (the email IS the product goal for outreach), and stops the verifier silently dropping world-class reviewers over institution-string noise. Discovery is the value — an un-surfaced qualified reviewer is a total loss.

**Pointers:** `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md`, `docs/REVIEWER_ORCID_NAME_PROMOTION_DESIGN.md`, `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` (#7), `docs/agent-wiki/topics/reviewer-identity.md`. Commits `6826aba1` → `c0561f6d` (email tier `ca5e54f1`/`c8078bc7`; ORCID `8e54a488`). Open: data-quality fixes designed not built (`docs/REVIEWER_GENERATION_DATA_QUALITY_DESIGN.md`); temp debug log live (revert).

## June 2026 — Applicant-suggested reviewers require explicit PD promotion (prod cutover + data migration) (Session 264)

**Milestone:** Behavior cutover on live reviewer data. Applicant-named reviewers (the `wmkf_potentialreviewer1..5` slots) used to **auto-enter** the candidate pool on ingestion (`ensureApplicantRecommended` set `wmkf_selected=true`). They now require an explicit Program Director promotion, so "use applicant suggestions sparingly" is enforced by the tool, not by hand. Shipped alongside a cluster of Find-tab polish features.

**Sessions:** 264. Spec → 2 Codex review rounds → Codex build / Claude review → deploy → one-time data migration (Justin-triggered via local script).

**Ship state:**
- Ingestion lands `wmkf_selected=false`; new `POST /api/workbench/promote-applicant-reviewer` (GUID + ownership + disposition guarded) is the only path into the pool for applicant rows. UI `applicant_suggested` section is now selectable and routes to the promote endpoint by provenance KIND.
- **Migration ran in prod:** all 54 applicant-recommended rows demoted to `selected=false` (52 inert via `scripts/demote-applicant-suggested-reviewers.js --apply`; 2 live-token rows demoted **+ token-revoked** after probe confirmed the spec's "all inert" assumption was false). Idempotent; re-run shows 0.
- Four follow-on features, each Codex-reviewed + deployed: removed the temperature/"reviewer diversity" slider; **Excel export** of selected candidates (`/api/workbench/export-candidates`, two-sheet xlsx, 11 cols); **5-yr publication backfill** from OpenAlex (kills false "0 publications" next to a real h-index) + a "publication count unavailable" fallback; **applicant-enrichment caching** — enriched applicant rows persist to `reviewer_find_roster` keyed on the stable proposal file key (`doc.data.picked`, NOT the random-suffixed blob URL) so reloads restore instead of re-enriching.

**Why it matters:** Stops a known over-promotion of applicant-named reviewers, and turns the Find tab from a re-search-every-reload surface into a persistent, shareable (Excel) candidate workbench.

**Pointers:** `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` (S263/S264 flow + caching + export); `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`, `docs/atlas/postgres-reviewer-find-roster.md`. Commits `7aef1883` → `7ea7339f` (10).

## June 2026 — Workbench triage field replaces the D26 allowlist (prod cutover) (Session 261)

**Milestone:** Production cutover + deprecated-capability removal. The Workbench dashboard's "going-forward" subset was driven by a hand-maintained committed allowlist (`shared/config/d26Allowlist.js`, a D26-pilot throwaway). S261 replaced it with a real durable field — `wmkf_triagestatus` (Advancing / Set aside / null) on the **core `akoya_request`** entity — deployed to prod, backfilled, and wired through the dashboard read + a per-row write control. The allowlist is retired from live use.

**Sessions:** 261. Built the no-prod-write pieces (constants, isolated schema wave, 3-way metadata preflight, dry-run backfill, hard-gated write route) → 2 Codex rounds → Justin's triggers deployed the field + ran the backfill (205 rows: 35 Advancing / 170 Set aside) → §3 dashboard switch → per-row flip UI → §5 allowlist retirement. Each prod-facing step verified with a read-only live probe.

**Ship state:**
- `wmkf_triagestatus` LIVE on `akoya_request` (isolated wave `--wave=2-triagestatus`); D26 backfilled, idempotent.
- Dashboard reads it: default = `Phase II Pending OR Advancing`, Set aside hidden (toggle), untriaged/Concept rows never shown. A live probe caught that "show all non-set-aside" would have flooded it 35 → 285 (the meeting-date cycle filter also matches 250 Concept rows) — chose the faithful scope with Justin.
- `POST /api/workbench/triage` is the authoritative lead-PD/superuser write gate; the dashboard per-row flip control writes it (server-computed `canManage`). `d26Allowlist.js` retired-in-place (historical/backfill source, not deleted).
- Also cleared 3 stale jest suites from the S259 GUID guard (non-GUID fixtures), missed in S260 for lack of a full `npm test` → new `feedback-green-requires-full-test-suite`.

**Why it matters:** Gives staff a durable, reversible, per-proposal triage signal that declutters the dashboard without an early status flip — and seeds the J27 triage lens. Removes a hand-maintained committed config from the live path.

**Pointers:** `docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md` (plan + AS-BUILT notes); `docs/atlas/dataverse-akoya-request.md` (`wmkf_triagestatus`). Commits `ecdcaed2` → `832ed5c8` (8).

## June 2026 — Trust-boundary IDOR/injection class closed on the reviewer API + permanent blocking gate (Session 259)

**Milestone:** Security hardening + new enforcement infrastructure. An adversarial Codex review (the queued S258 self-review-hook review) found the S258 fan-out was incomplete: across the reviewer-finder / review-manager surface, client-supplied ids (`req.query`/`req.body`) reached Dataverse selectors with only a presence check. `DynamicsService.getRecord`/`updateRecord` interpolate the id raw into the request URL (`${entitySet}(${id})`) and the adapter `findByRequest` into an OData `$filter` — an over-fetch / IDOR / filter-injection class (authenticated-staff scope). Closed it at the edge across 12 routes via a new shared validator `lib/utils/guid.js`, then converted the failure mode into a **blocking CI gate + commit guard** so it can't regress.

**Sessions:** 259. Codex review (relayed verbatim) → verify against source → fix all flagged routes → independent fan-out found one more Codex missed (`phase-i-dynamics/summarize`) → build the gate → two more Codex rounds hardening the commit-hook trigger that enforces it.

**Ship state:**
- 12 reviewer-surface routes GUID-validate client ids at the edge; `reviewer-suggestion.findByRequest` throws on a non-GUID (filter-injection chokepoint).
- `check:trust-boundary-guid` (AST taint analysis, `scripts/check-trust-boundary-guid.js`) + 16-case self-test; runs at startup AND blocks commits (`.claude/hooks/trust-boundary-guid-commit-guard.js`).
- All three commit hooks unified on one shared trigger `.claude/hooks/lib/git-commit-detect.js` (liberal-match/never-miss, fail-open); 46-case test incl. fail-open regressions.

**Why it matters:** Removes a real injectable id surface on the live reviewer API and makes the omission structurally impossible to reintroduce (the gate fails CI / blocks the commit). Establishes the "turn a recurring self-catchable review finding into a precise blocking gate" pattern beyond `check:status-enum-parity`.

**Pointers:** `docs/agent-wiki/topics/security-auth.md` → "Trust-Boundary GUID Validation"; `docs/agent-wiki/topics/dev-environment.md` → "Commit Guards & Triggers"; `docs/CI_GATES_REFERENCE.md`. Commits `58d5fd35` → `0b63b145` (8).

## June 2026 — Request Workbench Proposal tab shipped; Field Primer becomes a self-serve persisted product (Session 258)

**Milestone:** First non-Reviewers Workbench tab goes live, and the Field Primer graduates from a CLI/route-only artifact (S248) to a staff self-serve, persisted product. The **Proposal tab** (`tab=proposal`, previously a placeholder) renders three sections — Dataverse info (PI/co-PIs/abstract/Requested Amount=`akoya_request`/Total Project Budget=`akoya_expenses`), Phase I documents (slot-matched SharePoint list + a request-folder-GUID + Phase-I-membership-scoped download/inline-View proxy), and AI content (existing `wmkf_ai_*` + the Field Primer). The **Field Primer** gained a `requestId` mode that pulls `ProjectDescription` from SharePoint, generates, grounds experts vs OpenAlex, and **persists** a JSON envelope to a new prod field `akoya_request.wmkf_ai_fieldprimer`, single-flighted by an ETag-conditional generation lease (no double paid call, nonce-verified final write).

**Sessions:** 258. Codex design loop (2 passes) → phased build (Phases 1–6) → per-phase Codex review (Field Primer took 3 review rounds to clean: lease holes, lost-update, null-safety). New prod field deployed via an isolated schema wave to avoid wave2 drift. Closed with a meta-remediation: a pre-commit self-review hook for the recurring review-churn failure modes.

**Ship state:**
- Proposal tab + 2 new routes (`/api/workbench/proposal-documents`, `/download-proposal-document`), per-cycle doc config (D26 interim filename-match bridge), shared SharePoint/Graph reuse.
- `wmkf_ai_fieldprimer` (Memo/JSON) live in prod; shared envelope/lease validator (`shared/utils/field-primer-envelope.js`) keeps route↔UI in sync.
- Advisory `.claude/hooks/pre-commit-self-review.js` + `feedback-self-review-before-delegating-review` memory; fan-out audit caught a missing requestId GUID-check in `resolve-request`.

**Why it matters:** PDs get an in-app proposal viewer (kills the SharePoint read-pain) and on-demand field orientation, persisted per request. Establishes the Workbench tab pattern beyond Reviewers. The D26 doc resolution is explicitly interim — J27 moves to Dataverse-table doc references (`project-j27-doc-capture-evolution`).

**Pointers:** `docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md` (spec + resolved design Qs); Atlas `docs/atlas/dataverse-akoya-request.md` (the new field); `docs/CODEX_REVIEW_PROMPT_hook-self-review.md` (queued hook review). Commits `bf3a87ec` → `c79fceb8` (19).

## June 2026 — Reviewer-finder academic data migrated off paid SerpAPI/Google Scholar → free OpenAlex (Session 251)

**Milestone:** Deprecated/costly capability removed. The two paid SerpAPI `google_scholar` paths were migrated to free OpenAlex: (1) **Slice 1b** — contact-enrichment bibliometrics (h-index/i10/citations) + the verified-email-domain guard; (2) **Slice 2** — Virtual-Review-Panel literature/PI-publication novelty search. These per-candidate / per-proposal calls drove the bulk of the ~$150/mo SerpAPI bill (the project's largest line item) and carried an unmonitored Google-Scholar login-wall degradation risk. SerpAPI is now a residual: contact lookup (#1) + PubPeer (#6) + news (#7) only.

**Sessions:** 251 (executing the S250 plan). Per slice: implement → Codex post-impl review → fold findings. Five Codex passes total + one `/sweep`.

**Ship state:**
- Slice 1b (`242d96c` + hardening `25d73a7`/`90d10e5`): `_attachOpenAlexMetrics` resolves the author by ORCID hard-key or carried discovery-spine id (never a bare name-search), writes the 1a-contract DTO the resolver re-proves (`isOpenAlexAuthorAccepted`); verified-domain guard re-sourced from the OpenAlex institution homepage via the `psl` Public Suffix List (eTLD+1).
- Slice 2 (`d90d4e0` + hardening `96c6e13`): `OpenAlexService.searchWorks` + inverted-index abstract reconstruction; honest `google_scholar`→`openalex` source-label rename through the collation prompt.
- PubPeer (was "Slice 3"): **not buildable** — no public PubPeer API exists (verified from primary sources); stays on SerpAPI. Slice label retired; parked as an agent-wiki future-item; access-request email sent to PubPeer.

**Why it matters:** Removes the largest driver of the project's biggest monthly expense, kills the login-wall degradation risk, and makes a SerpAPI Hobby-tier downgrade (~$100/mo) worth evaluating against real billing volume.

**Pointers:** `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md` (per-slice disposition + Codex logs); agent-wiki `integrity-screener.md` (PubPeer parked item) + `reviewer-identity.md` (1b). Commits `242d96c` → `8a5f667`.

## June 2026 — Field Primer shipped; Track B archived; reviewer-finder origination posture corrected (Session 248)

**Milestone:** A new capability shipped + a deprecated one removed + a strategic reframe. (1) **Field Primer** — a standalone, staff-facing overview of a proposal's research field (sub-areas, methods, frontiers, communities, venues, named experts), built end-to-end through the shared Executor (`field-primer.generate` live in prod Dataverse `wmkf_ai_prompts`, sonnet), with a route + CLI, decoupled from reviewer candidates. v2 grounds named experts against OpenAlex (confirmed/suggested-correction/unverified) — caught a live forename hallucination (Oksana→Olga Zhaxybayeva). (2) **Track B** (DB keyword→author origination) **archived off** (`DiscoveryService.TRACK_B_ENABLED=false`, dormant) after A/B-confirming it cost ~27s and contributed ~0 to saved panels. (3) The S231 retrieval-first redesign was reframed as an **overcorrection**: Claude is the origination engine; the weak link is downstream identity resolution.

**Sessions:** 248. Three Codex adversarial passes (HIGH→MEDIUM→LOW, converged) + a `/sweep`.

**Ship state:**
- Field primer: `lib/services/field-primer-service.js` (`generateFieldPrimer` + `groundPrimerExperts`), `POST /api/field-primer/generate`, `scripts/generate-field-primer.mjs` (`--request <id>` real PDF). Knowledge-only v1; web-grounded literature search deferred to next cycle.
- Track B code intact + dormant (flip one constant to re-enable); storage-shed record in agent-wiki reviewer-origination.
- Namesake-safety hardened: consensus field anchor + first-initial/affiliation corroboration on corrections; honest "name-plausibility, not identity-proof" labeling. Residual MEDIUM accepted (no save path).

**Why it matters:** First field-orientation deliverable for program directors (usable now via CLI); reclaims ~27s + removes noise from the reviewer-finder discovery path; and re-points reviewer-finder investment at recall + identity-resolution rather than a grounded-origination rebuild.

**Pointers:** `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md`; agent-wiki `reviewer-origination.md` (Genesis & corrected posture) + `reviewer-identity.md` (namesake worked example). Commits `1471fd1` (primer v1) → `86d58e7` (/sweep); Track B archive `31ad105`.

## June 2026 — Phase 1 private-blob: document uploads cut over to a private store in production (Session 243)

**Milestone:** Production cutover. The three server-read document-upload consumers — `expense-reporter`, `phase-i-dynamics`, `grant-reporting` — now upload sensitive documents to a **dedicated private Vercel Blob store** (`wmkf-uploads-private`, no auth-free URL) and read them server-side by `pathname`, instead of the public store. Closes the security audit's P2 "generic uploader creates public Blob artifacts" finding for the server-read cohort. Flag-gated per-app (default public); all three promoted, grant-reporting **prod-verified live** (upload → private store, blob URL HTTP 403, extraction ran).

**Sessions:** 243 (builds on S242's Phase-1 start). Each slice ran the Codex design→review loop.

**Ship state:**
- Smoked the shared `file-loader` private-read chokepoint (`scripts/smoke-private-file-loader.mjs`, covers both Dynamics consumers); promoted all three `NEXT_PUBLIC_*_PRIVATE_BLOB` flags + `UPLOADS_BLOB_RW_TOKEN` to prod and deployed.
- Built a record-scoped private-blob **download proxy** + cycle-materials migration (reviewer-finder grant-cycle email template/attachments), Codex-reviewed twice — then **PARKED** (low-risk, legacy-only consumer; reviewer-finder + review-manager are being replaced by the Workbench). Inert in prod (flag default-public).
- Slice-2 also fixed a *live* `maintenance-service` data-loss bug (public cycle attachments were reapable as orphans after retention).

**Why it matters:** new sensitive grant/expense document uploads no longer get auth-free public Blob URLs in production; and the codebase now has a reusable record-scoped private-download pattern for the expected future Postgres-backed storage.

**Pointers:** `docs/archive/PHASE_1_PRIVATE_BLOB_DESIGN_2026-06-11.md` (cohort, prod-promoted), `docs/security-audit/DOWNLOAD_PROXY_DESIGN_2026-06-11.md` (proxy, parked), memory `project-download-proxy-parked`. Commits `ac31c82`→`535260e` (S243).

## June 2026 — Reviewer manual-add cross-store dedup + a silent save-failure incident (Session 237)

**Milestone:** Two production reviewer-workbench changes. (1) Manual reviewer-add now de-duplicates across **both** identity stores (`wmkf_potentialreviewer` + CRM `contact`) before minting a person — incl. the former-PI case (contact-only → create reviewer + link). (2) A production **incident**: well-ranked candidates had been **silently failing to save since the S223 relevance-score scale change** — `wmkf_appreviewersuggestion.wmkf_relevancescore` is bounded `[0,1]` but the code writes a 0–100 score, so any candidate scoring >1 hit a Dataverse 400 that the per-row try/catch swallowed (orphan person row, no candidate, no error). Diagnosed live on Tanja Mittag / request 1002852.

**Sessions:** 237. Both arcs ran the Codex loop (design/diagnosis → review → implement → review): PR #21 had 2 Codex pre-impl design passes + a post-impl review; the incident root cause was Codex-confirmed before the fix.

**Ship state:**
- **Manual-add dedup** (PR #21, merge `9178fce`): new read-only `/api/workbench/reviewer-lookup` (tiered ORCID→email→name, ambiguity-aware `top:2`, cross-store conflict + reverse-link detection); `manual-reviewer` gains a `resolution` contract + create-and-link (link-last, hardened `setContactLink`); orchestration extracted to `lib/services/reviewer-identity-lookup.js`; 18/18 live read-only smoke. Plus S237 post-impl fixes to the S236 manual-add/ORCID work (`971ec97`).
- **relevancescore incident** (`dad3a26`, `9f4e378`): widened the Dataverse field `[0,1]→[0,100]` (PUT-full-definition + `PublishXml` via `scripts/widen-relevancescore-max.mjs` — **`PATCH` returns 405**; ran + verified against prod), a `[0,100]` clamp guard in the adapter, and stopped the silent failure (`save-candidates` returns 500+errors when nothing saved; both Find clients surface the failed name + error).

**Why it matters:** the dedup change stops fragmenting reviewer identity at manual entry; the incident fix stops silently dropping the *best-ranked* candidates (had been doing so for ~6 months) and makes future save failures loud instead of invisible.

**Pointers:** `docs/REVIEWER_MANUAL_ADD_DEDUP_DESIGN.md` (rev3); new memory gotcha — Dataverse attr-update = PUT+publish not PATCH (`project-dataverse-schema-deploy-gotchas` #5). Commits `971ec97`/`d611130`/`bac7818`/merge `9178fce` (dedup), `dad3a26`/`9f4e378` (incident). Forward design (NOT built): `docs/REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md` + memories `project-reviewer-finder-proposal-doc-context`, `project-applicant-exclusion-policy-pending`.

## June 2026 — Reviewer contact + invite safety: namesake-collapse closed end-to-end (Sessions 234–235)

**Milestone:** Production hardening that closes the namesake-collapse bug class at the contact + invite layer — the downstream half of the identity incident S232 began. A reviewer's identity could resolve correctly while *contact/bibliometric enrichment* attached a namesake's email/website/metrics (request 1002794: Smirnova got an ITMO namesake's email; Chen got a *pianist's* gmail + Van Cliburn page). Governing principle adopted: **identity-confirmed ≠ contact-validated — anchor every contact detail to the resolved identity or abstain.**

**Sessions:** 234 (anchor-or-abstain enrichment fix) + 235 (the E/G/F follow-on plan, shipped in full). Every slice ran the Codex loop (design → review → implement → post-impl review); Codex caught a real issue at nearly every stage (a roster reload-leak, a regression a first fix would have caused, a batch-confirmation hole, the SSRF mechanism).

**Ship state:**
- **S234 contact anchoring** (`6e7dcfb`, `da2451e`, `440bce9`, merge `9396658`): institution-anchored contact search (Fix A), abstain-when-unanchored (Fix B), per-field persist flags surviving roster reload (Fix C), and a Scholar-**verified-domain** email check (replaced a brittle institution-name guard that had rejected the real address).
- **S235 Slice E** (`59c945e`, `bac7bb8`, merge `39e82b9`): identity-unresolved candidates are non-selectable (UI read-only + select-all/save exclusion) and server-rejected (`save-candidates` 422); markers persist through the Find-roster (reload-safe).
- **S235 Slice G** (`8ce1957`, `0b8c8ca`, merge `4b57472`): an `emailConfidence` gate on the invite send — staff get a warning + one-click "confirm & send" for a low-confidence address, enforced server-side via a recipient-specific `confirmedLowConfidenceIds` allowlist, scoped to invitations.
- **S235 Slice F** (`f6b5bd4`, merge `c5a4a0a`): faculty-page email recovery via a **zero-SSRF** staff link (the Codex-reviewed automated server-fetch was deliberately not built). Build + reviewer/identity jest + `check:*` gates green throughout.
- **S235 post-plan identity/quality fixes** (live-test-driven): publication-list backfill for OpenAlex/ORCID-confirmed reviewers + shared preprint/published title-dedup (`6c8de43`); the resolver now trusts a forename-gated ORCID-employment anchor over OpenAlex `last_known_institution` drift, so a real reviewer (Smirnova @ MBI, OpenAlex drifted to a Technion sabbatical) resolves `probable` instead of being excluded (`4b96ec5`); PI-named/cited reviewers the spine can't auto-verify are now selectable-with-warning (not hard-blocked) with all contact/identity fields force-nulled at save until confirmed (`5086946`).

**Why it matters:** a system that *emails* reviewers cannot tolerate sending to a wrong/namesake address. These slices make the pipeline fail safe at every downstream stage — unresolved candidates can't be saved as vetted, unverified addresses can't be invited without a conscious confirm, and a confirmed reviewer with no address has a one-click path to recover it.

**Pointers:** `docs/REVIEWER_CONTACT_INVITE_FEATURES_AND_PROD_TESTS.md` (features + 19 prod tests), `docs/REVIEWER_CONTACT_INVITE_FOLLOWON_PLAN.md`, `docs/REVIEWER_INVITE_CONFIDENCE_DESIGN.md`, `docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md`, `docs/REVIEWER_IDENTITY_ORCID_EMPLOYMENT_PROMOTION_DESIGN.md`; `[[project-reviewer-contact-enrichment-anchoring]]`. Commits above + merges `6c8de43` / `4b96ec5` / `5086946`, docs `b0ebb77`. Open follow-ups (S236 prompt): sparse-affiliation selection collision; the automated-resolver-emits-`confirmed` vs sticky-sentinel discrepancy.

## June 2026 — Reviewer identity: provenance DTO + namesake-laundering hardening + OpenAlex/ORCID spine (Session 232)

**Milestone:** New verification architecture + a production incident fix. A namesake-laundering incident on request 1002794 (a Claude-suggested attosecond physicist, "Robert Sang", PubMed-matched to an unrelated Kenyan entomologist, stamped with the wrong affiliation + an unrelated LinkedIn) drove a hardening pass and the first slice of a field-agnostic OpenAlex+ORCID identity spine — atop a candidate-wire-shape migration to a groundedness-based provenance DTO.

**Sessions:** 232. Codex built each slice; Claude reviewed and caught a live-only bug (OpenAlex `last_known_institution` was deprecated singular→plural — every record returned null institution → spine over-abstained; tests mocked the wrong shape) and a fabricated polite-pool email (`apps@wmkeck.org`) that shipped before Justin caught it.

**Ship state:**
- **Provenance DTO** (`9882eec`): `provenance.{kind,sources,seedRole,groundingWorkIds}` across `/discover`, roster, save, UI. "Claude-suggested" demoted from a category to a seed role; a verified-Claude candidate is `literature_retrieved`. Ranking shifts Track-A −30 (the +25 grounded bonus is now cited/proposal-named-only); ordering preserved.
- **§5.1 hardening** (`53206b7`): Track-A PubMed verification now honors the source toggle; profile/website-URL name-gate (kills the wrong LinkedIn); `proposal_named` source preserved; coarse cross-field namesake guard; verification-incoherence ranking down-weight.
- **OpenAlex+ORCID spine** (`0ac4728`, `60e0ef2`): constrained-select-or-abstain verifier on the PubMed-skip path (NEW `openalex-service.js` + `reviewer-identity-evidence.js` + resolver anchor rules). confirmed/probable → selectable; ambiguous/abstain → needs-review; plain-language identity note per candidate. Shadow-eval: confident-wrong 29%→0 (Robert Sang recovers to the real Griffith physicist). OpenAlex polite-pool contact is env-only (`OPENALEX_POLITE_MAILTO`).
- Build + 498 reviewer/identity tests + `check:*` gates green throughout.

**Why it matters:** PubMed-only verification laundered fabrications/namesakes for non-biomedical fields — the retrieval-redesign's root liability. The spine adds a field-agnostic identity check that **fails safe (abstains, never mis-verifies)**, the first real piece of the cross-field OpenAlex+ORCID spine. Scoped to PubMed-off only; biomedical path + stratum-3 (early-career/no-ORCID) shadow-run still pending before broader cutover.

**Pointers:** `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` (§4.2/§4.5/§5.1/§7), `docs/REVIEWER_PROVENANCE_MODEL.md`, `docs/REVIEWER_ORCID_SPINE_SPEC.md`; `[[project-reviewer-verify-fail-dangerous]]`, `[[feedback-no-fabricated-placeholder-values]]`. Commits `9882eec`, `53206b7`, `0ac4728`, `60e0ef2`, `b00986e`.

## June 2026 — Web-grounded reviewer discovery EVALUATED → ABANDONED & removed (Session 230)

**Milestone:** Deprecated capability removed. The Perplexity web-discovery feature shipped S227 (entry below) was evaluated on real proposals and pulled. Supersedes the S227 milestone.

**Sessions:** 230 (live eval on 1002794 / 1002238 / 1002204, PubMed/ORCID verification of every suggested name, then full removal). Also S230: shipped `check:model-override-warming` (AST CI gate preventing the recurring "forgot `loadModelOverrides()` → Anthropic 404 on tier alias" class) + fixed that bug in `applicant-reviewers` and `integrity-screener/screen`.

**Ship state:**
- Both the shipped `/search`→extract leads path AND a probed `sonar` reviewer-agent hallucinated: invented people, invented institutional emails (inconsistent), and — worst — **real researchers given fabricated affiliations/expertise** (passes a naive existence check). Self-reported confidence unreliable; fabrication scales with topic obscurity.
- Removed the route, service, A7 extraction prompt, capability flag, UI panel/toggle, and tests (−1,194 lines). `PERPLEXITY_API_KEY` kept (Virtual Review Panel sonar still uses it). Eval probes (`scripts/probe-perplexity-*.mjs`) kept as evidence.
- Build + all `check:*` gates green; route counts reconciled (api-route-file-count 106→105, requireappaccess 58→57).

**Why it matters:** Ungrounded LLM web discovery is unsafe for reviewer selection — a foundation that emails reviewers can't tolerate fabricated people/addresses. A safe v2 (NOT built) would require PubMed/ORCID grounding of every name. The existing Claude + PubMed candidate pipeline stands alone.

**Pointers:** `docs/REVIEWER_WEB_DISCOVERY_PLAN.md` (OUTCOME banner) + `[[project-reviewer-web-discovery-abandoned]]`. Commits `202bcfc` (record), `502154d` (removal); gate `dbc5060`→`d560a0d`.

## June 2026 — Web-grounded reviewer discovery (Perplexity Search) live in prod (Session 227)

**Milestone:** Reviewer-finder now surfaces currently-active, mid-career researchers from the live web (Perplexity Search → A7-wrapped Claude name-extraction → a read-only "Web suggestions" panel) to counter Claude's training-cutoff + fame bias. Track C v1 — **leads-only / display-only**: never enters candidates, ranking, COI, roster, or save. `PERPLEXITY_API_KEY` is now live in prod, so the capability activates on deploy.

**Sessions:** 225 (backend `WebDiscoveryService` + A7 extraction prompt, inert); 227 (route + capability-gated UI + live Perplexity Search contract verified + extraction-budget tuning; `/contract-reconcile` pass; pushed to prod).

**Ship state:**
- Route `/api/reviewer-finder/web-suggestions` (key-gated, fail-soft, server-derived ≤3 queries); read-only panel + default-on `searchWeb` toggle in the SHARED `ReviewerSearchSection` (one integration covers standalone + Workbench Find tab).
- The web call runs as a genRef-guarded fire-and-forget IIFE OFF `/discover`'s abort boundary — a web outage yields an empty panel, never a search error.
- Live contract VERIFIED via `scripts/probe-perplexity-search.mjs`: HTTP 200 Search-API entitlement (key was bought for VRP sonar chat), M/D/YYYY date filter accepted + honored, §5 result shape confirmed.
- Extraction budget tuned (`WEB_RESULTS_MAX_CHARS` 20K→100K, output 1024→4096, new 6K per-snippet guard) after the probe showed ~8KB faculty-page snippets truncated all but ~2-3 of up to 24 results.

**Why it matters:** First web-grounded discovery source in prod — closes the recall/freshness gap (Claude can't name post-cutoff researchers and over-surfaces famous ones). Read-only v1 IS the monitoring phase before any pipeline integration (deferred v2).

**Pointers:** plan `docs/REVIEWER_WEB_DISCOVERY_PLAN.md`; memory `project-reviewer-finder-next-topics` §3; VRP-coupling of the now-permanent key parked in `project-virtual-review-panel`. Commits `693be96`, `f52e633`, `e827780`, `274baca`.

## June 2026 — Reviewer-finder prompts migrated to Dataverse; admin + per-user editable (Session 222)

**Milestone:** The reviewer-finder analysis + candidate-scoring prompts now resolve from the Dataverse `wmkf_ai_prompt` store at runtime (per-user override → Dataverse `iscurrent` → code fallback), so reword no longer needs a deploy. Shipped a superuser `/admin` versioned-publish editor and an in-app per-user override editor. Prod cutover run + live-verified (analyze resolves `source=dataverse`).

**Sessions:** 222 (10-commit branch; 4-round Codex design review pre-build + a post-impl Codex pass; built "on auto" via remote control; three prod steps — Dataverse re-seed, migration 019, deploy — executed + smoke-verified; a self-inflicted memory-frontmatter gate-red caught + fixed same session).

**Ship state:**
- Path A seam: streaming routes resolve the body + compose the code-owned A7 preamble (`reviewer-prompt-resolver.js` + `reviewer-prompt-composer.js`); `executePrompt` untouched (non-streaming). Byte-parity with the old code prompt proven.
- Admin: `/api/admin/prompts/*` versioned publish adapting the `policies.js` protocol (`prompt_publish_audit`, If-Match, exactly-one-current invariant); panel lists ALL prompts incl. drafts.
- Per-user: grant-gated `/api/reviewer-finder/prompt-override` + reserved-key block on the generic prefs endpoint; "✎ Edit prompts" panel.
- A7 P0 folded in: `proposal_summary` now wrapped (was interpolated raw). 1924 tests + 10 gates green.

**Why it matters:** Justin iterates on reviewer prompts often (same session: the bioRxiv per-database query fix); `/admin` + per-user editing removes the deploy round-trip, and the shared `wmkf_ai_prompt` store is the one model PA + Vercel both read.

**Pointers:** plan `~/.claude/plans/distributed-cuddling-gizmo.md`; memory `project-reviewer-prompt-dataverse-migration`; atlas `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md`. Commits `118d64f`…`c5337da`; deploy `7dfd827`.

## June 2026 — Reviewer Postgres→Dataverse migration CLOSED + lone-ORCID backfill (Session 219)

**Milestone:** The W3–W6 reviewer Postgres→Dataverse migration is closed — the 5 drained reviewer-finder tables were physically dropped from prod (migration 018), leaving Dataverse (`wmkf_potentialreviewer` / `wmkf_appreviewersuggestion`) as the sole store. Same session closed the S215 ORCID residual: 240 more reviewers gained an authoritative ORCID via Scholar corroboration. Two prod data/schema cutovers; a long doc/memory-reconciliation + guardrails tail followed.

**Sessions:** 219 (table drop done early at Justin's direction; ORCID backfill + reconciliation each Codex-reviewed — the reconciliation took 3 verification rounds; the ~6h cleanup tail was flagged as over-long → time-box guardrail added).

**Ship state:**
- **5 tables dropped** (`e6a339d`, migration 018, guarded + tracked, Wave-1 precedent): researchers, researcher_keywords, publications, proposal_searches, reviewer_suggestions. Verified gone, no dangling FKs. `search_cache` KEPT (live callers). Backups → JSONL + Blob `cleanup-backup/2026-06-04/`; Neon PITR 7-day.
- **Lone-ORCID Scholar backfill** (`c734356`, `scripts/backfill-lone-orcid-scholar.js`): 240 written / 144 correctly gated / 70 no-Scholar; pool ORCID 1,533→1,773, probable 1,532→1,772. Scholar = corroboration only, not persisted. $0.
- **Process guardrails** (`1385a65`): doc-edit reconcile PreToolUse hook + time-box meta-work rule; `/start` now runs all 11 gates (`4fc5194`) after `prompt-storage-mentions` was found red & unnoticed.

**Why it matters:** Reviewer state now lives in exactly one store (Dataverse), ending the Postgres drain era; ORCID — the cross-system join key — covers 1,773 of the pool. The guardrails target a recurring "patch the flagged line, leave residuals elsewhere" failure that cost this session 3 review rounds.

**Pointers:** `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`, `docs/atlas/` (reconciled), `.claude-memory/project-w6-table-drop-closed.md`; commits `c734356` `e6a339d` `4fc5194` `1385a65`.

---

## June 2026 — Reviewer ORCID back-propagation shipped + de-fragmentation flow live (Session 217)

**Milestone:** S215 captured authoritative ORCIDs on 1,533 reviewers but they sat inert — each cross-store join's far side was ORCID-sparse. S217 made them *flow*: the reviewer-pool ORCID now propagates onto the matched CRM `contact.wmkf_orcid` (the durable cross-system join key) both forward (on every outreach/accept) and historically (one-shot backfill). De-fragmentation went from a measurement to a running production flow. A prod cutover + new architecture.

**Sessions:** 217 (PR1 runtime + PR2 backfill + S213 follow-ons + SOLR fix; each Codex-reviewed incl. adversarial passes; live-smoked then bulk-applied).

**Ship state:**
- **PR1 runtime forward-flow** (`a25bda2`): `orcid-normalize` (ISO-7064 checksum) + `contactAdapter.setOrcidIfAbsent` (fill-only, conflict-surfacing, conditional If-Match) + shared `backPropReviewerOrcidToContact`, wired into send-emails + honorarium + enrich-recommended (each hydrates `wmkf_orcid`/`wmkf_identitystatus`/`_wmkf_contact_value` first). Gate: valid iD + `confirmed`/`probable`.
- **PR2 historical backfill RAN** (`0c75ec9`, `scripts/backfill-contact-orcid.js`): live `--resolve` matched the S216 projection exactly — **162 write / 0 conflict / 0 malformed / 7 ambiguous / 14 noop / 1 status_null / 1,349 nocontact** of 1,533; all 162 `contact.wmkf_orcid` fills verified by `(contactId, reviewerId)`, 0 failures. Contact ORCID population ~423 → ~585. Native Dataverse audit = provenance (reversible).
- **S213 reviewer follow-ons** (`ee689e8`): co-PI COI parity in `discover.js` (shared `deriveProposalAuthorNames`) + per-user Workbench invite signature. **ORCID SOLR-injection fix** (`87a84ad`): special-char reviewer names no longer 500 `searchByName`.
- **PR4 built, e2e pending** (branch `feature/reviewer-self-reported-orcid`, `c5e0ec0`): capture the reviewer's self-confirmed ORCID at Stage 2a → person + contact, protected by a sticky-`confirmed` resolver invariant. Handed to Codex for e2e (`docs/REVIEWER_SELF_REPORT_ORCID_E2E_HANDOFF.md`).

**Why it matters:** ORCID — the authoritative researcher ID — now actively de-fragments the disjoint reviewer stores (contact / GOapply / honorarium / pool) instead of dead-ending on the pool. The join key grows on its own going forward and was back-filled across history.

**Pointers:** `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` (§12 PR1/PR2, §14 PR4); memory [[reviewer-identity-fragmentation]]; commits `a25bda2` `0c75ec9` `ee689e8` `87a84ad` `cfc7c04`.

---

## June 2026 — ORCID capture restored + authoritative-ID backfill (Session 215)

**Milestone:** A manual Workbench smoke of the S214 resolver uncovered that ORCID had been silently dead: `searchByName` read `family-name`, but ORCID's expanded-search returns `family-names` (plural), so every record's familyName was undefined → the name-match gate rejected all records → `findContact` always returned null → ORCID never contributed an anchor → the resolver's `probable` status was unreachable. (ORCID creds were also unset in prod, masking it.) Fixed the parser, added the corroborated-ORCID strong-anchor rule, and backfilled authoritative ORCIDs across the reviewer pool. A latent-bug incident + a new resolver capability + a prod data cutover.

**Sessions:** 215 (smoke → fix → measure → rule → 3 Codex rounds → deploy → backfill; 6 commits, all via the `codex:codex-rescue` agent).

**Ship state:**
- **Parser fix** (`9e14291`): `family-name`→`family-names`; regression test exercises the raw-response mapping the prior tests mocked *above*.
- **Corroborated-ORCID strong anchor** (`5693a80`, design §3.1): an ORCID matched on name AND institution → STRONG anchor → `probable` on its own (the design's "one strong anchor" rung, previously unimplemented). Bare name-match stays weak → unresolved. Auditable anchor `orcid_public_institution_corroborated` + matched institution logged. `RESOLVER_VERSION` 1.0.0→1.1.0-pr1.
- **Data measurement:** sampled 250 of 4,269 reviewers → ~42% resolve to an unambiguous ORCID (~33% institution-corroborated); an ORCID×Scholar cross-tab (15% new-unlock, ~4.4% kept-gated) drove the gate decision.
- **Prod backfill** (`scripts/backfill-orcid-identity.js`, resumable two-phase): wrote **1,532** corroborated ORCIDs to `wmkf_potentialreviewers` — pool went **1 → 1,533** rows with an ORCID, 0 failed, independently re-counted.
- 1781 tests; Codex round-3 **SHIP-READY**; route-handler clear-on-downgrade coverage added (`59465bb`).

**Why it matters:** ORCID — the authoritative, increasingly-mandated unique researcher ID — is now actually captured (it never was, despite two phases of code assuming it worked). 1,533 reviewers now carry a stable cross-system join key, the foundation for de-fragmenting the disjoint reviewer stores (contact / GOapply / honorarium / researchers).

**Pointers:** `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md` §3.1; memory [[project-vercel-sensitive-env-pull-empty]]; commits `9e14291`→`84e4d06`.

---

## June 2026 — Reviewer identity resolution: false-match safety + deterministic resolver (Session 214)

**Milestone:** Built the reviewer-identity safety layer the S213 collapse surfaced — the recurring false-match where a search for a PI attached a *lab member's / homonym's* Scholar/ORCID metrics (the institution-only guard can't tell same-institution people apart). Shipped a hard Scholar displayed-name guard + ORCID name-scoring (Phase 1), audited + remediated the already-wrong prod data, then landed a deterministic identity **resolver** (Phase 2 PR1) that gates whether bibliometrics/ORCID may persist or count toward ranking. New architecture + a prod Dataverse schema deploy + a quiet data-correction incident.

**Sessions:** 214 (single long session; 13 commits; full design→Codex pre-impl ×2→impl→Codex post-impl loop, all via the `codex:codex-rescue` agent).

**Ship state:**
- **Phase 1** (`40d7327`): `SerpContactService.scholarNameMismatch` (hard displayed-name floor — kills the Tsai→lab-member-Nakano class) + `ORCIDService.findContact` name-scoring/abstain + persistence gates.
- **Prod data remediation** (`5bf8d3b`/`c836f4a`): a disconfirming probe found the persisted-Scholar footprint was **8 pinned profiles (not "~330"** — that was the affiliation backfill); 1 genuine wrong match (Frank Noe's row carried Cecilia Clementi's Scholar profile) cleared + 5 malformed/missing id fields fixed. Read-only audit + remediation scripts committed.
- **Phase 2 PR1** (`8350551`→`b6bfadc`): 6 `wmkf_identity*` decision fields **deployed to prod** on `wmkf_potentialreviewers`; `lib/services/reviewer-identity-resolver.js` deterministic classifier (weak-only PR1 rules — `confirmed` deferred to a later PR); verdict gates all **three** write paths (save-candidates, enrich-recommended, the email-keyed `saveToDatabase` — a Codex post-impl catch) + `relevance-score`; `clearIdentityFields` null-clears stale wrong values on downgrade. 1766 tests; all gates green.
- The prod schema deploy lost ~15 min to a Microsoft managed-solution import wave holding the org customization lock (diagnosed via an `importjobs` probe, not our error).

**Why it matters:** "unresolved is acceptable; wrong-and-confident is not" is now enforced in code, not just discipline — a wrong-but-rich profile can no longer persist or float to the top on borrowed metrics. The deterministic resolver is the contract that makes later web/LLM evidence sources (e.g. Perplexity Search API) safe to add as untrusted *leads*.

**Ship caveat:** PR1 is live but **manual Workbench smoke is still pending** (CI-green ≠ correct for this outward-facing class); `confirmed` status + faculty/PubMed-cluster verification + the Perplexity lead source are specced-but-unbuilt later PRs.

**Pointers:** `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md` (v3, approved), `lib/services/reviewer-identity-resolver.js`, `scripts/{audit,remediate}-scholar-identity.js`, `.claude-memory/project-reviewer-identity-resolution-phase1.md`. Commits `40d7327`→`9da5793`.

## June 2026 — Reviewer bibliometric sidecar collapse (Session 213)

**Milestone:** Collapsed the `wmkf_appresearcher` 1:1 bibliometric sidecar into the person entity `wmkf_potentialreviewers` and **dropped** it (+ the two empty `wmkf_apppublication`/`wmkf_apppublicationauthor` tables) — the reviewer domain goes from four Dataverse tables to two. Executed mid-pilot (the prior "post-pilot, don't act now" posture was reversed once the sidecar data proved disposable — near-zero cross-cycle reviewer overlap). Full prod cutover, each phase verified; live-smoke-verified on the Workbench; Codex ground-truth + structure review folded in.

**Sessions:** 213 (single session; ~20 commits; Codex plan-review + network-enabled ground-truth probe).

**Ship state:**
- 17 bibliometric fields (affiliation/h-index/citations/ORCID/Scholar/department/etc.) added to `wmkf_potentialreviewers`; all 339 sidecar rows backfilled onto their persons (verified exact); `wmkf_appresearcher` + both publication tables **DROPPED** (EntityDefinitions 404). Snapshot retained as rollback insurance; backfill + drop one-shot scripts committed.
- `adapters/researcher.js` repointed to write the person (no sidecar); affiliation canonical on `wmkf_primaryaffiliation` (500) per D-AFF, with `wmkf_organizationname` (100) kept as a clamped compat shadow; the 7 affiliation readers + 5 callers cut over; **zero runtime references to the dropped entity remain** (verified by grep).
- Phase 6 doc reconcile: Atlas index, `REVIEWER_DATA_MODEL`, `REVIEWER_ARCHITECTURE`, atlas pages, plans, CLAUDE.md, memory — all marked SHIPPED / corrected; dated/archive snapshots left as history. All doc/state CI gates green.
- Also this session: a Workbench "Remove from this request" reviewer action (atomic link-revoke + soft-delete, on Candidates + Invite/Track/Completed), the D26 smoke testbed swapped to a dedicated test request (1002788), and smoke-helper hardening.

**Why it matters:** removed a structural-redundancy join hop from every reviewer query; the disposable-data insight turned S196's ~8h careful "post-pilot" migration into a lighter clean cutover. The dig also surfaced — and tee'd up — the reviewer-identity false-match problem (a search for a PI attached a *lab member's* Scholar metrics because the institution-only guard can't tell them apart): Codex redesign plan saved, Phase 1 (a Scholar name-guard) not yet built.

**Pointers:** `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md`, `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`, `.claude-memory/project-appresearcher-collapse-post-pilot.md`. Commits `bfc903d`→`fb0a3f4` (collapse), `ca95de5`→`e9d5660` (remove-reviewer feature).

## May 2026 — Canonical system model + falsification guardrails + drift reconciliation (Session 197)

**Milestone:** Turned chronic doc/memory nomenclature drift into durable infrastructure. Named the recurring root failure — *searching to confirm, not to falsify* — and built a forcing function for it, plus the project's first canonical conceptual model. Two multi-agent evaluation workflows (drift audit, 10-front codebase eval), each independently Codex-reviewed.

**Sessions:** 197 (single session; 11 commits; 5 Codex review round-trips; 2 background workflows).

**Ship state:**
- `docs/SYSTEM_MODEL.md` — canonical conceptual model (rote/thinking principle, automation vs record-maturity axes, capabilities/trunk/substrate, Mode 1/2, doc-resolution provenance tiers). Codex-reviewed twice; built-vs-target honesty enforced.
- **Falsification guardrails (permanent):** PreToolUse hook `.claude/hooks/scope-claim-reminder.js` (wired in `.claude/settings.json`) nags on scope/quantity claims into durable artifacts; Codex stop-time review gate enabled project-wide; protocol in `.claude-memory/feedback-falsify-not-confirm.md`.
- **Drift reconciled:** the defunct "mid-June 2026 Phase II Research intake pilot" framing rewritten across 16 files (intake is a Phase I build for the next cycle); 142 live `Phase II Pending` status rows + form-module paths left untouched (dual-meaning hazard respected). No-judgment findings + Codex-caught siblings fixed.
- `docs/archive/CODEBASE_EVALUATION_2026-05-29.md` — read-only 10-front eval (36 agents, 94 retained findings), Codex-corrected; for triage, not applied.

**Why it matters:** S186 named the source-vs-live blind spot; S197 names the agent-vs-its-own-premise blind spot. Self-review can't catch errors baked into its own premise, so the fix is a forcing function (hook) + independent backstop (Codex gate), not willpower. The canonical model gives planning an anchor that prior sessions lacked, which is what let the drift be *reconciled* rather than re-litigated.

**Pointers:** `docs/SYSTEM_MODEL.md`, `docs/archive/CODEBASE_EVALUATION_2026-05-29.md`, `.claude-memory/{project-system-model,feedback-falsify-not-confirm}.md`. Commits `d4e61e9`→`7332da3`.

## May 2026 — Backend battle-readiness audit + Phase 0 migration tracker (Session 186)

**Milestone:** Audit uncovered three live P0 issues that source-side gates couldn't see — migrations 011 and 013 had never been applied to prod Postgres (drain silently erroring every 2 min since deploy; intake portal endpoints 500 on first call), and the daily maintenance cron's `cleanupExpiredCache` had been failing daily but masking as `status='completed'`. Phase 0 closed all three plus the structural cause (no migration tracker existed). Six-round Codex review iteration on the execution plan before any code ran; GREENLIT at v6.

**Sessions:** 186 (single session; 2 commits + 6 Codex plan-review rounds + 1 post-execution Codex review with 4 in-place fixes).

**Ship state:**
- Migration 011 (`submission_jobs.{locked_until, lease_token, akoya_requestnum}` + status CHECK + partial-unique index swap) applied to prod with `LOCK TABLE ACCESS EXCLUSIVE` + tracker write in single tx. Drain stops erroring.
- Migration 013 (`intake_drafts.pending_attachments JSONB`) applied same pattern. S184 three-call attach dance now functional in prod.
- `schema_migrations` tracker + `scripts/apply-migrations.js` (canonical forward path) + committed `lib/db/migrations-manifest.json` + `lib/utils/migration-drift.js` cold-start drift check (bidirectional, distinct `migration_tracker_missing` alert for SQLSTATE 42P01) + CI gate (`check:migrations-manifest` + `git diff --exit-code` post-build). Trusts tracker rather than IF-NOT-EXISTS guards (007 isn't re-runnable).
- `lib/services/maintenance-service.js:13` — CommonJS named-export destructure fix (was importing whole module). Daily `cleanupExpiredCache` failure root-caused. `pages/api/cron/maintenance.js` — `isFailedSubtaskResult` covers all error shapes; status='failed' + severity='error' on any subtask failure (was masking as `completed`/`info` for days).
- Three silent crons (`pricing-canary`, `spend-check`, `sweep-stale-invites`) gained `MaintenanceService.startRun/completeRun` placed AFTER auth guards — now write durable heartbeats; absence of a row henceforth is provably "Vercel didn't invoke," not "ran healthy."

**Why it matters:** First time a source-side CI sweep's blind spot was named structurally. The pre-S186 gates (`check:atlas`, `check:api-routes`, `check:fact-consistency`, etc.) all verify source-vs-source consistency; none verified source-vs-live-state. 13 commits + ~200 unit tests of S184 attach-dance work + 14 commits of S179 drain work were both non-functional in prod because no one noticed migrations didn't ship. The new tracker + manifest pipeline + cold-start drift check converts that class of drift into a `system_alerts` row at next cold start.

**Pointers:** `docs/archive/READINESS_AUDIT_2026-05-25.md`, `docs/archive/READINESS_AUDIT_2026-05-25_CODEX_REPORT.md`, `docs/archive/READINESS_AUDIT_PHASE0_PLAN.md` (plan v6 GREENLIT). Commits `ffe1dec` (Phase 0 main), `c35a4f2` (closeout: jose dep + CLAUDE.md schema text correction).

## May 2026 — Three-call browser-direct attachment dance shipped end-to-end (Session 184)

**Milestone:** Replaced the planned single-call attachment model (file passes through the Vercel function on upload) with a three-call browser-direct architecture: `/upload-token` pre-issues a path-scoped Vercel Blob client token, the browser PUTs bytes straight to the private intake Blob store, then `/attach` downloads-and-scans on the function. Reconciles the design tension between "bytes never traverse a function" (efficiency / cold-start) and "synchronous virus scan at attach time" (security). Cardinality enforcement moves from app-level TOCTOU to a SQL `UPDATE WHERE` clause that's atomic under Postgres EvalPlanQual.

**Sessions:** 184 (single session; 14 commits + 8 Codex review rounds — pre-impl AND post-impl per chunk).

**Ship state:**
- Migration 013: `intake_drafts.pending_attachments JSONB` column (server-managed, never overwritten by autosave).
- Two new endpoints: `POST /api/intake/draft/upload-token` (auth + ownership + cardinality + sanitizer + Blob token mint + pending append + audit) and `POST /api/intake/draft/attach` (A2 dual-lookup + Blob download + magic-byte + size + scan + 4-branch result mapping). Route count 91 → 93.
- `IntakeDraftService` pending helpers — `getById`, `appendPending`, `selectPendingForDraft`, `promoteToClean` (SQL-level cardinality gate via 3rd `UPDATE WHERE` clause), `removePending`, `listPendingOlderThan`. The race-safety property — `removePending` first, then del — is the concurrency gate against `/attach.promoteToClean`'s shared opaque pathname.
- `MaintenanceService.sweepIntakePending` (2h cutoff per A6) wired as task #6 in the daily maintenance cron — runs BEFORE `cleanupBlobs` so sweep-del failures feed into the next task's cleanup pass on the same tick. `/api/intake/submit` rejects 409 `pending_attachments_present` if pending non-empty (A1).
- Locked contract amendments A1-A7 documented in `INTAKE_ATTACH_BUILD_SCOPING.md`; per-chunk design docs (`INTAKE_ATTACH_CHUNK{3,4,5,6}_DESIGN.md`) capture every Codex pre-impl + post-impl finding. Unit suite 898 → ~1100.

**Why it matters:** First pilot-blocking applicant-facing build to ship end-to-end through the design → Codex pre-impl → implement → Codex post-impl loop. The loop's marquee catch was the chunk-5 cardinality race: post-impl Codex flagged a TOCTOU; original framing was "acceptable for pilot, last-writer-wins"; user pushed back; the SQL-level fix landed in two follow-up commits and is the only race-safe layer. Pattern captured in `.claude-memory/project-codex-design-pre-impl-iteration.md` and `feedback-real-fix-not-design-note.md`. Endpoints are LIVE but no UI calls them yet — applicant-form rewrite to the three-call pattern is the S185 build.

**Pointers:** `docs/INTAKE_ATTACH_BUILD_SCOPING.md`, `docs/INTAKE_ATTACH_CHUNK{3,4,5,6}_DESIGN.md`, `docs/INTAKE_PORTAL_DRAIN_PLAN.md` § "Attachment upload — three-call dance" (S184 amendments). Commits `1b88b21` → `975e589` on `main`.

## May 2026 — Spend-monitoring architecture rebuilt; per-category alert routing (Session 181)

**Milestone:** Pivoted off the locally-anchored low-balance estimator (the Apr-2026 mechanism that motivated `api_credit_monitoring`) onto an Anthropic-native posture: auto-reload + native spend-limit notifications cover the failure modes; a monthly `/cost_report`-driven drift cron reconciles our local pricing table against authoritative billing. Separately, alert recipients moved from a hardcoded superuser roster to a per-category routing config editable in `/admin`, so different audiences (grants, finance, ops, security) can subscribe to different alert classes.

**Sessions:** 181 (single session; 5 commits + 2 Codex review rounds).

**Ship state:**
- New `lib/utils/model-pricing.js` (extracted from `usage-logger.js`); longest-prefix-first matcher (was `.includes()`); `LAST_REVIEWED_AT` field; Haiku 4.5 and Opus 4.5/4.6/4.7 prices corrected (two material bugs); 1h cache write multiplier; unknown-model warning.
- Two new crons: `pricing-canary` (weekly, no new auth — unknown-model + table-age check); `pricing-refresh` (monthly, requires `ANTHROPIC_ADMIN_API_KEY` — derives per-model price from `/cost_report`, alerts on >5% drift). V032 `model_pricing_audit` table for history.
- Alert routing: `lib/services/alert-recipients.js` resolves category → emails via `wmkf_appsystemsettings`, fallback to superuser roster. Eight call sites tagged. Removed env vars `SPEND_ALERT_EMAIL_TO/_FROM`, `NOTIFICATION_EMAIL_TO`, `ANTHROPIC_BALANCE_ANCHOR_CENTS/_DATE`, `LOW_BALANCE_ALERT_CENTS`. Deleted `scripts/update-balance-anchor.sh`.
- Pricing source of truth stays in code (no auto-overwrite — guards against billing-glitch corruption). 815 ✓ tests / 0 failing.

**Why it matters:** Confirms production is correctly pointed at the WMKF work-org Anthropic account (the personal account from project start is dormant 30+ days). Replaces a load-bearing manual-maintenance vector (the pricing table) with self-monitoring. Decouples alert recipients from the superuser bit, enabling the grants admin to subscribe to intake-related alerts without seeing every cron failure.

**Pointers:** `lib/utils/model-pricing.js`, `lib/services/alert-recipients.js`, `pages/api/cron/pricing-{canary,refresh}.js`, `.claude-memory/project-api-credit-monitoring.md` (rewritten); commits `ac4a4a7`, `cd2abb1`, `81124ea`, `0eec283`, `98b2a9e`.

---

## May 2026 — Intake portal drain prereqs shipped (5 of 6); plan-to-code transition (Session 179)

**Milestone:** The drain plan v3 from S178 went through 5 more Codex review rounds (v4→v7, 18 findings folded) and then transitioned from plan-only into concrete code. Five of six prerequisites landed in one session: schema migrations for the queue (P0) and the draft uniqueness rekey (P3), the `contact.wmkf_portaloid` column + alternate key deployed to prod Dataverse (P2), the `wmkf_apprequestperson.wmkf_role` picklist verified fully expanded in prod (P5), and the structured-error shape rolled out across `dynamics-service.js` + `graph-service.js` with full test coverage (P1).

**Sessions:** 179 (single session; 14 commits across plan v4-v7 folds + P0/P1/P2/P3/P5 builds + their respective Codex-round folds).

**Ship state:**
- Postgres: migration `011_submission_jobs_states.sql` (status CHECK + `akoya_requestnum` / `locked_until` / `lease_token` columns, index rekey to support two-phase claim); migration `012_intake_drafts_uniqueness.sql` (requestless partial-unique rekeyed to `(contact_oid, account_id, form_key)`). Both idempotent, both dev-Neon-applied with smoke 23 ✓; prod-Neon apply per the documented runbook is pending.
- Dataverse prod: `contact.wmkf_portaloid` (String 50) + alternate key `wmkf_portaloid` deployed; alt-key `EntityKeyIndexStatus` was `Pending` immediately post-create (Active soon). `wmkf_apprequestperson.wmkf_role` picklist verified fully expanded (5 values present; extender re-run reported `0 inserted`).
- Structured error shape: `lib/utils/service-error.js` with `buildServiceError` + `buildNoResponseError`. Wired into every drain-dependent throw site (`getAccessToken`, `createRecord`, `updateRecord`, `getRecord`, `queryRecords`, `getSiteId`, `getDriveId`, `uploadFile`). `fetchWithTimeout` in both files wraps no-response throws automatically. 21 tests; full unit suite 612 ✓ / 0 failures. 412-aware callers preserved.
- Drain plan: v4 through v7 plus round-8/9 (P0 review) plus round-10 (P3+P2) plus round-11 (P1). Convergence trail across 9 review rounds on real artifacts: 21→11→4→stalled→2→4→5→3→2→3→4. Round 8 was the first against code (caught migration idempotency bug); round 11 was the largest code review (4 MOD refinements, no correctness bugs).

**Why it matters:** This is the inflection from "comprehensive plan with extensive review" to "shipping code." The plan was thoroughly stress-tested (32 findings in S178 + 18 in S179 = 50 review-driven changes before the first code commit) and the build phase began only when correctness questions stopped surfacing. Five of six prereqs done in one session demonstrates the build velocity the plan-heavy phase was paying for. Only manual P4 (private Blob store provisioning via Vercel CLI) remains before the drain endpoint code proper can be built.

**Pointers:** `docs/INTAKE_PORTAL_DRAIN_PLAN.md` (v7); `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` (S179 P2 entry); `lib/utils/service-error.js`; `tests/unit/error-shape.test.js`. Commits `b8c1a96` (v4) · `8fadfb8` (v5) · `ed32e94` (v6) · `f24cae4` (v7) · `050ab85` (P0) · `bfadb63` (P0 round-8 fold) · `8d3047d` (round-9 fold) · `ad6a511` (P3) · `4150a7e` (P5) · `9a49ce2` (P2) · `ac73abd` (P3+P2 round-10) · `bb29283` (P1) · `afa61fb` (P1 round-11).

---

## May 2026 — Intake portal slice-0 schema deployed; single-phase architecture pivot (Session 178)

**Milestone:** The intake-portal slice-0 Dataverse schema landed in prod, and the pilot architecture pivoted from "Phase II attaches to an existing `akoya_request`" to **single-phase submission** (drain creates a new request rather than updating one). Slice-0 had been gated for months on the Item-6 P1-Update verification; Connor's S169 maker-portal run closed it FAIL → Option A′ flow-body conditional fallback, with zero schema rework, unblocking the deploy.

**Sessions:** 178 (single session; 4 commits). Two pre-deploy schema edits, the prod deploy, the architecture pivot, and a Codex-reviewed drain plan covering the Postgres→Dataverse pipeline.

**Ship state:**
- Deployed to prod Dataverse: `wmkf_proposalbudgetline` (10-value `wmkf_category` incl. new `Tuition`); `wmkf_portalmembership` (renamed pre-deploy from `wmkf_portal_membership` to match sibling convention); 4 new fields on existing entities; `wmkf_role` picklist 2→5; Postgres `submission_jobs` (V30). Entity sets live (HTTP 200); `@odata.bind` keys confirmed from metadata.
- Live probe confirmed Dataverse accepts client-supplied GUIDs on `akoya_request` Create (HTTP 201, server returned identical GUID, against dummy account "New Cranberry Sauce"). Locks in "Option (ii)-refined" drain architecture: pre-generate UUIDv4 at submit, drain Creates with that GUID, retries naturally idempotent. No `submission_jobs` table changes needed; no sentinel field needed.
- Pivot to single-phase eliminates the original request-picker dashboard, eligibility OData filter, and institution-wide visibility of existing requests. Build now centers on `/api/intake/submit` + `/api/cron/drain-submissions` creating a fresh `akoya_request` from a frozen Postgres payload.
- `docs/INTAKE_PORTAL_DRAIN_PLAN.md` v3 written through two full Codex review rounds (32 findings folded: 7 BLOCKER / 17 MOD / 8 LOW). Round 3 inconclusive (Codex CLI exceeded agent response window); v3 treated as the working plan, first build step intentionally small for buildability sanity check.

**Why it matters:** Slice-0 is the schema foundation for the entire intake portal — months of pre-deploy gating around Connor's PA-flow Option-A vs. Option-B work converged on this deploy. The architecture pivot saved building Phase-II-attach infrastructure that would be stale forever after this cycle. The drain plan (v3) is the canonical build plan for the next several sessions.

**Pointers:** `docs/INTAKE_PORTAL_DRAIN_PLAN.md`; `docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`; `lib/dataverse/schema/wave4*`. Commits `279d556` (pre-deploy schema edits) · `7cec6da` (deploy) · `545aaed` (memory reconcile) · `1ee0fd3` (drain plan v3).

---

## May 2026 — Prompt-injection hardening (A7) shipped across all LLM surfaces (Sessions 173–176)

**Milestone:** A7 — the LLM01 prompt-injection hardening initiative — is complete. Every one of the 24 LLM-input surfaces in the codebase now wraps attacker/applicant-influenced text in nonce-bearing, forge-resistant sentinels (`wrapUntrustedContent`) with a system-prompt hardening preamble; high-consequence JSON sinks validate parsed model output against per-app schemas (`validateAiJson`). A registry CI gate (`check:prompt-injection-tagging`) makes the coverage durable. Origin: the 2026-05-21 Codex security audit, item A7.

**Sessions:** 173 (inventory + plan, two Codex plan reviews), 174 (Parts 0–4: primitives, gate, Dynamics-writeback + agentic + peer-review surfaces), 176 (Parts 5–6: the remaining 16 surfaces + the live Dataverse deploy + a full Codex re-audit of A1–A8 + follow-up remediation).

**Ship state:**
- `check:prompt-injection-tagging` reports 24 migrated / 0 pending; the gate gained a `multimodal` flag (preamble-only, for image/document content blocks) and 11 self-test cases.
- New primitives: `wrapUntrustedContent` (nonce-on-both-sentinels + sentinel scrubbing), `buildUntrustedContentPreamble`, `validateAiJson` — the latter gained a `record` node type for dynamic-keyed LLM-output maps (rejects prototype-pollution keys). Six per-app output-schema files added.
- Codex re-audit of A1–A8 confirmed all original audit findings closed or tracked; it caught a real residual — #8/#15 hardened only their entry points, re-feeding prior-stage LLM output and U-EXT results unwrapped. Follow-up steps 1/2a/2b closed that HIGH finding; steps 2c/3/4/5 (VRP output schemas, Executor output validation, call-site-granular gate, mop-up) carry to Session 177.
- Collateral: a systemic stale-model bug found and fixed — 6 prompt-seed scripts hard-coded `claude-sonnet-4-20250514`; all live `wmkf_ai_prompts` rows re-seeded to the `sonnet` tier key (auto-tracks the current model).

**Why it matters:** Untrusted document/form/external content reaching an LLM was previously interpolated raw — no delimiter, no instruction boundary. A7 establishes boundary-tagging as the standard and the registry gate prevents silent regression. The Codex re-audit also proved the gate's original file-granular design could false-green (one hardened call masking an unhardened sibling) — step 4 next session hardens that.

**Pointers:** `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md`; `docs/archive/SECURITY_AUDIT_2026-05-21.md`; `lib/utils/ai-payload-boundary.js`, `lib/utils/ai-output-schema.js`, `scripts/check-prompt-injection-tagging.js`. Commits `adf8df5`·`e79460a`·`0a80da5`·`bc51233`·`5bae845`·`aa0a16d`·`04979f2` (S173–174); `2ad5297`→`f0f3fbd` (S176, 18 commits).

---

## May 2026 — Structural drift-prevention gates shipped (Session 167)

**Milestone:** Two new CI gates close two long-standing recurring doc-drift families. `check:drain-table-mentions` (reviewer-domain Postgres-vs-Dataverse drift across all 6 drained tables) and `check:prompt-storage-mentions` (the `wmkf_prompt_template` rename — the table that never shipped under that name) now fail loud on any unannotated mention. Both have constrained file-purpose markers (visible in-doc, path-scoped — abuse-resistant) replacing the invisible-allowlist pattern that hid drift. Companion: `check:canonical-pointers` + generated `docs/CANONICAL_COUNTS.md` close the G normalization arc started against `check:fact-consistency`.

**Sessions:** 167 (single session; 17 commits; nine Codex-driven tightening cycles before both gates were Codex-confirmed SOUND).

**Ship state:**
- 3 new gates: `check:canonical-pointers`, `check:drain-table-mentions`, `check:prompt-storage-mentions`. Each has binding self-tests (17 + 17 + 22 fixtures); 13 gates total in the project.
- Two Codex-verified ground-truth claims established and frozen in code: (a) zero live SQL against the 6 reviewer-domain PG tables; (b) `wmkf_ai_prompt` is the live entity, `wmkf_prompt_template` never shipped.
- ~50 docs/memory entries reconciled to current state across multiple commits. New canonical pattern: `[N](docs/CANONICAL_COUNTS.md#<fact-id>)` keep-number-plus-pointer for code-derived scalars; `<!-- drain-table:file-purpose=atlas-state-page -->` etc. for whole-file declarations.
- Pointer-form regex escape (`[N](url) word` was bypassing `\d+\s+`) fixed in `check:fact-consistency`; multi-marker exemption support added.

**Why it matters:** Three iterative audit passes (8 + 8 + 9 findings) failed to converge because each pass found a new sub-cluster in the same drift family — case-by-case fixing was the wrong shape. Mechanical fan-in via gates is the lever. Future drift in either family fails CI rather than waiting for a periodic audit. The pattern (Codex-verified ground truth → constrained gate → narrow allowlist → binding self-test → Codex-verify gate soundness) is now a repeatable shape for similar problems.

**Pointers:** `CLAUDE.md` paragraphs documenting each gate; `scripts/check-{drain-table,prompt-storage,canonical-pointers}-mentions.js` + self-tests; `docs/CANONICAL_COUNTS.md`. Commits `fec3f2e`·`32e4e90`·`6b9166a`·`29b1481`·`52dc0b8`·`3674bc8`·`afe7244`·`1b81106`·`13c0392`·`fe42885`·`3dbc13c`·`ff9d943`·`77052bf`·`b5537cd`·`9f99868`·`5033bcc`·`9f0013e`.

---

## May 2026 — Power Tools Track B shipped to production (Session 161)

**Milestone:** Dataverse Bulk Export (Track B Power Tools) went from API-layer-only to **user-reachable and verified working end-to-end on production** — the first Power Tools app live. Built the forced-fan-out builder UI (`pages/dataverse-bulk-export.js`) over the stable S160 preview→run→download seam, then hardened it against real use.

**Sessions:** 161 (single session; UI build + two Codex review/confirm rounds + three live-data fixes + Blob infra + loud-disclosure round, all probe-driven).

**Ship state:**
- Builder UI live; nav/docs/guide added; CLAUDE.md Applications row de-caveated.
- Three live-Dataverse defects fixed (only surfaced on real data — tests mock the taxonomy): `akoya_program` primary-name field (`akoya_program`, not `akoya_name`); operational-exclusion label (`Phone Call`, not `Phone`); the `institution` axis was non-functional (bare condition on the `akoya_applicantid` lookup) → now an inner `account` link on name/AKA.
- New **dedicated private Vercel Blob store** (`dvx-export-private` / `DVX_BLOB_RW_TOKEN`), separate from the shared public store; `access:'private'` + gated `/download` proxy; pre-stream fail-loud guard. Shared `BLOB_READ_WRITE_TOKEN` verified untouched.
- Loud exclusion waterfall in `/preview` (matched → −operational → −test → exported) with a fail-loud count invariant — a surprising-but-correct number can no longer be misread.

**Why it matters:** Proves the QuerySpec→FetchXML spine + private-artifact delivery in production, and validated the tool's core promise (fail-loud, honestly-characterized) by surviving a real reconciliation against an AkoyaGO export. 74/74 tests, P0 gates green throughout.

**Pointers:** `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md` §6/§10, `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` (AUTHORITATIVE LIST), `docs/guides/DATAVERSE_BULK_EXPORT.md`. Commits `31f56c6`·`e4d49d3`·`83fc00e`·`a69fbe7`·`c11a27c`·`8ff9c5e`·`2c20e4d`.

---

## May 2026 — Wave 2 W5/W6 cutover + IRS BMF reference layer (Session 147)

**Milestone:** Closed Wave 2 W5 (reader cutover for `reviewer_suggestions` aggregation) and W6 step 1 (`pages/api/reviewer-finder/researchers.js` + Database tab UI retired, ~2,700 lines removed). Same session introduced a new product capability — IRS tax-exempt verification — that establishes Postgres as a durable **reference-data layer**, not just a Dynamics on-ramp. `irs_exempt_orgs` (V29) holds 1.26M rows from the 4 IRS BMF regional CSVs; quarterly cron does an atomic-swap refresh (stage → COPY FROM STDIN → dedupe by `(ein, region, ctid)` → ADD PK → rename); `/api/irs/verify-ein` is shared-secret-gated for PowerAutomate to call on `account` create/update. Threshold + dedupe + validation hardened across 5 Codex-driven iterations; not user-facing by design.

**Sessions:** 147 (2026-05-12)

**Ship state:**
- 24 commits on main. Three independent workstreams: Wave 2 W5/W6 (`29ae474` → `cea4c27`), IRS BMF (`2ad2528` → `3b2450e`), Gemini-suggestions refactor of `pages/phase-ii-writeup.js` (`fd07318` → `49d9905`, Claude-executed after Codex dispatch failed twice).
- W6 step 2 (cleanup cron + restore script) **deferred to post-pilot** per Codex's Wave 1 same-day DROP precedent. Trigger memory `project_w6_table_drop_pending.md` fires ≥ 2026-07-01.
- New shared utilities: `shared/utils/app-markdown.js` (marked v12 + DOMPurify with `uponSanitizeAttribute` hook for href scheme + class allowlist) and `shared/utils/sse-stream.js` (async-iterator parser with AbortSignal, CRLF-aware). 36 Jest cases. `phase-ii-writeup.js` 879 → 597 lines via modal extraction (`Phase2{QA,Feedback,WordExport}Modal.js`).
- CI gates green: `check:atlas`, `check:atlas:self-test`, `check:api-routes` (80 routes after IRS adds + `extract-summary.js` removal).
- **Known gap:** Gemini refactor not visually smoke-tested (CLI-agent limitation); flagged in `docs/archive/CODEX_HANDOFF_REPORT_2026-05-12.md`.

**Why it matters:** The IRS layer is the first non-migration use of Postgres after Wave 1 closeout — proves the architectural reframe (Postgres = reference data + per-user/per-session state; Dataverse = organizational ground truth). The capability is PA-callable so it slots into Connor's backend-automation flows without new Vercel UI. W6 step 1 finishes the reviewer-finder reads cutover; remaining Postgres reviewer tables are drain-only and dropped post-pilot. The Gemini refactor extracts two shared utilities (`app-markdown`, `sse-stream`) that 10+ other pages can adopt later (`pages/dynamics-explorer.js:95` is the first candidate).

**Pointers:**
- `lib/services/irs-bmf-service.js`, `pages/api/cron/refresh-irs-bmf.js`, `pages/api/irs/verify-ein.js`, `scripts/import-irs-bmf.js`, `docs/atlas/postgres-irs-exempt-orgs.md`
- `shared/utils/app-markdown.js`, `shared/utils/sse-stream.js`, `shared/components/Phase2{QA,Feedback,WordExport}Modal.js`
- `docs/archive/CODEX_HANDOFF_REPORT_2026-05-12.md` (Gemini refactor handoff + known-gap list)
- `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` (W6 step 2 deferred checklist)
- `.claude-memory/project_irs_exempt_verification.md` (planned → SHIPPED), `project_w6_table_drop_pending.md` (post-pilot trigger)

## May 2026 — Wave 1 prod retirement + thoroughness rule (Session 146)

**Milestone:** Wave 1 (Postgres → Dataverse migration for `system_settings`, `user_app_access`, `user_preferences`) closed out in production. The three Postgres tables were dropped via `lib/db/migrations/007_drop_wave1_tables.sql` at 2026-05-12T01:30:41Z after behavioral verification confirmed zero prod writes since the 2026-05-03 flag flip; Neon PITR was bumped from 6h → 7 days to make rollback viable. Dispatcher defaults in the three service modules flipped from `postgres` to `dataverse` — explicit `WAVE1_BACKEND_*=postgres` now fails loudly against the dropped tables, closing the silent-degradation footgun Codex flagged in `database-service.js` prefs paths. Five bypass scripts targeting the dropped tables archived to `scripts/archive/`. Setup-database.js Wave 1 create blocks (V10 user_preferences, V16, V17, V22) removed so re-running setup against prod is safe. A second outcome: encoded `feedback_thoroughness_default.md` — banner-edit-includes-body-audit, description-edit-includes-body-audit, antonym-grep-after-status-change — after the doc-currency sweep + Wave 2 plan rebuild surfaced ~44 distinct findings across multiple Codex review rounds. Rule applies to all future doc and memory work.

**Sessions:** 146 (2026-05-11 → 2026-05-12)

**Ship state:**
- 16 commits on main. Headliners: `dc8e745` (drop migration + preflight), `a612d00` (Codex Wave 1 review fixes — dispatcher flip), `7e53c02` (doc-currency 5-tier sweep, 32 files), `af40768` (Codex 19-finding consistency review), `9c99e65`+ (10 commits rebuilding `REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` across 9 Codex rounds).
- Wave 1 Postgres state: 3 tables dropped. Recovery via Neon PITR until 2026-05-19T01:30Z.
- Wave 2 plan: Codex-verified READY FOR BUILD. Drain-target endpoint inventory grew from 2 files (the plan's previous list) to 9 (verified via grep). Cardinality of `wmkf_potentialreviewer` locked as global-per-person across all passages. W3-W7 schedule with slip-eligibles moved to Post-pilot.
- CI gates green: `check:atlas` 26 PG / 27 DV, `check:atlas:self-test` 11/11, `check:api-routes` 80 routes.

**Why it matters:** Closes the migration the team has been carrying since Session 106. The dispatcher default-flip eliminates a class of bugs (missing env flag → routes silently to dropped table → returns empty data) that would have bitten a fresh dev environment or a typo in Vercel env. The thoroughness rule addresses the recurring pattern Justin called out explicitly: edits to a single section being declared "done" without auditing the rest of the doc, costing Codex tokens + review time on every iteration. The Wave 2 plan rebuild establishes the actual scope (9 files, not 2) and the realistic schedule for pilot-gating work.

**Pointers:**
- `lib/db/migrations/007_drop_wave1_tables.sql` (drop migration), `scripts/wave1-drop-preflight.js` (verification harness)
- `lib/services/{settings,app-access,database}-service.js` (dispatcher defaults flipped)
- `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` (Wave 2 build plan, READY FOR BUILD)
- `.claude-memory/feedback_thoroughness_default.md` (workflow-default rule)
- `.claude-memory/project-wave1-closeout-role-tail.md` (Wave 1 closeout plus app-user role-tail probe note)
- Codex review chains: Wave 1 drop preflight `a2e4e5b555a27c543`; Wave 1 doc consistency `a1479a23e17078149`; Wave 2 plan 9-pass `ab6caaf4234c8afd8` → `aecc59a2cd3e8f1a1`

## May 2026 — AI-config admin surface + policy editor (Session 145)

**Milestone:** Established the AI-config admin pattern (small, narrow, task-specific forms) as distinct from the deferred data-admin surface (general Dataverse CRUD, eventual AkoyaGo replacement). Shipped two instances of the pattern. Tier-keyed Claude model picker swaps stale dated ids for `opus`/`sonnet`/`haiku` tiers resolved against the live `/v1/models` list — defense against silent retirement of pinned snapshots; concrete-id escape hatch preserved. Policy editor (`/api/admin/policies` + `PoliciesSection`) lets superusers publish new `wmkf_policy` versions through a four-round Codex-reviewed flow: pre-flight validation, pending-audit-first, parent-ETag concurrency, alt-key uniqueness on `(parent, versionLabel)`, idempotent dispatch (already_published / label_conflict / resume / fresh-publish), strict markdown pipeline (marked + DOMPurify allowlist), best-effort retire of prior version with `parent.wmkf_activeversion` as sole truth. Audit lives in dedicated Postgres `policy_publish_audit` rather than overloading `wmkf_ai_run`. Admin UX overhaul: collapsible sections, soft-archive user button, 1-day usage period, three crons now record runs in `maintenance_runs`.
**Sessions:** 145 (2026-05-10)
**Ship state:**
- 4 commits on main: `bc8a389` (tier picker), `edcd6db` (24h TTL + Refresh button), `d0abcc6` (policy editor + admin UX), `61a46f9` (browser-smoke fixes).
- Dataverse alt key `wmkf_policyversion_parent_label_unique` deployed to prod. Postgres `policy_publish_audit` table (V28) live. New admin route `/api/admin/users` (DELETE soft-archive). Markdown pipeline at `shared/utils/policy-markdown.js` with 17 unit cases. Stage 2a slice 1 COI body unblock: editor is live; staff wording still pending.
**Why it matters:** The pattern decision keeps narrow AI-config (~10 entities, business-rule-heavy) separate from the open-ended data-admin space (hundreds of entities, AkoyaGo retirement scope) — preventing the policy editor from becoming an accidental wedge into a general Dataverse CRUD surface. Versioned-content abstraction deliberately deferred until `wmkf_ai_prompt` proves the second use case. Defense-against-silent-retirement on Claude models removes a recurring footgun.
**Pointers:**
- `docs/atlas/dataverse-wmkf-policy-and-policy-version.md` (write-paths + alt key + statecode invariant)
- `pages/api/admin/policies.js`, `shared/components/admin/PoliciesSection.js`, `shared/utils/policy-markdown.js`
- `lib/services/model-resolver.js`, `shared/config/baseConfig.js` (tier-keyed APP_MODELS)
- Codex review history: agents `a5af57bda83ef2741` → `a09e80e93fd9dd4c2` → `a86ae677c0b8e3d0d` → `a458909e1c39e2516` → `aff1757bad694dd69`

## May 2026 — AI security hardening tranche + operating plan (Session 130)

**Milestone:** Closed the P1 column of the AI security matrix end-to-end and stood up an ongoing operating cadence so future regressions are caught at PR time rather than in a quarterly audit. AI payload-boundary helper bounds every high-volume Anthropic call site at the route boundary; Prompt Executor enforces the same caps declaratively via `dataClass + maxChars` on prompt-row variable declarations. `wmkf_ai_promptoverride` redacts bounded values before audit-write so raw proposal text never lands in Dataverse. New `rawOutputRetention: 'full' | 'hash' | 'none'` modes cut audit duplication where the business output already lives elsewhere; `phase-i.summary` live row activated with `'hash'`. Dynamics Explorer model-context serializer redacts sensitive/loopback fields and caps long strings before CRM data re-enters the agent loop. API route security matrix + CI gate makes PR-time matrix updates enforceable.
**Sessions:** 130 (2026-05-05)
**Ship state:**
- 7 commits on main: `6af5614` (boundary helper), `ad8f4f3` (matrix + CI gate), `b057f7e` (override redaction), `39da64e` (retention modes + phase-i.summary hash), `06e682b` (Dynamics Explorer serializer), `1ffa15d` (operating plan).
- Live tenant: `phase-i.summary` row `d4201d8e-3840-f111-88b5-000d3a3065b8` carries `rawOutputRetention: 'hash'`. Verified zero drift via `scripts/diff-phase-i-summary-prompt.js` post-activation.
- 407/407 tests green (406 + 1 skipped). 76 API routes covered by `npm run check:api-routes`.
- VRP provider allowlist already in place from earlier in the session via the previous tranche.
**Why it matters:** The matrix CI gate eliminates the historical "matrix bit-rots between audits" failure mode. The Executor declarative caps mean future prompts get the same boundary protection without per-route work — a backend-automation flow added in PowerAutomate that runs the same prompt row through the same Executor inherits the cap by default. The serializer is reusable model-context minimization that can extend to other agent-loop tools as they're added.
**Pointers:** `docs/SECURITY_OPERATING_PLAN.md` (operating cadence + escalation thresholds), `docs/AI_DATA_FLOW_MATRIX.md` (P1 column closed), `docs/EXECUTOR_CONTRACT.md` (data-classification + payload-boundary section), `lib/utils/ai-payload-boundary.js`, `lib/utils/ai-run-retention.js`, `lib/utils/dynamics-explorer-serializer.js`, `scripts/check-api-route-security-matrix.js`.

---

## May 2026 — Applicant intake portal Entra External ID foundation (Session 129)

**Milestone:** First non-staff identity surface in the system. Wired the `entra-external` NextAuth provider against the new `wmkeckapply.ciamlogin.com` External ID tenant IT provisioned this session. Sessions now self-identify as `'staff' | 'applicant'`; middleware enforces non-crossing both directions. Smoke-test page at `/apply` rendered authenticated applicant identity (name/email/Object ID) end-to-end with an iCloud hide-my-email account. Also closed the second half of the Dynamics impersonation work — `actingUserSystemId` now plumbs through the entire Dataverse adapter chain + token lifecycle, so contact promotion and token writes attribute to the same staff user as the surrounding action instead of falling back to the service principal mid-flow.
**Sessions:** 129 (2026-05-04)
**Ship state:**
- Tenant `04a1406b-3878-4286-bd17-b8c8118886f7`, domain `wmkeckapply.onmicrosoft.com`. Custom OAuth provider via `wellKnown` discovery; env-gated, registers only when `EXTERNAL_AZURE_AD_*` vars are set.
- Dual-provider NextAuth in one instance — staff (`azure-ad`) and applicants (`entra-external`) share `/api/auth/*` routes; callbacks branch on `account.provider`. Applicant sessions hit no DB during signIn (contact↔OID lookup is lazy, on first authenticated `/apply` write).
- `pages/auth/signin.js` auto-dispatches to External ID OAuth when `callbackUrl` resolves to `/apply*` (handles relative + absolute URL shapes).
- `lib/dataverse/adapters/{contact,potential-reviewer,researcher,reviewer-suggestion}.js` + `lib/external/token-lifecycle.js` (mintAndStore/revoke/ensureToken/extendForPostSubmissionWindow) all forward `actingUserSystemId`. 8 endpoints plumbed. 20 new pass-through tests, suite 333/333.
- Security-matrix housekeeping bundled in: `requireSuperuser`/`getUserRole` helpers added to `lib/utils/auth.js`, 11 admin/role-checking routes migrated off per-file clones (net −89 lines). Standalone profile creation removed (POST `/api/user-profiles` + UI surface).

**Why it matters:** Unblocks the intake portal pilot (Phase II Research, mid-June 2026). The foundation is the load-bearing piece — once it's right, membership/forms/Dynamics writes are mechanical. The institution-as-identity model the design doc commits to (multiple collaborators per institution, transferable primary contact, self-service requests) requires per-person persistent identity with stable OIDs across email changes; OTP-only Entra External ID is the right primitive. Magic-link primitives we already have (`lib/services/external-token.js`) would have baked in person-centric identity instead. The impersonation completion closes the audit-trail mismatch that was visible during Session 128's flag-off rollout — code is now correct end-to-end; only the prod flag flip remains.

**Pointers:** `docs/INTAKE_PORTAL_DESIGN.md`, `docs/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md`, `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` § Step 5. Commits `87f07e2`, `7d0091e`, `ee2fb99`, `046835c`, `68e4c59`.

---

## May 2026 — Memory architecture into the repo + carryover-hygiene guardrail (Session 126)

**Milestone:** Two structural changes triggered by an audit that caught a near-miss production breakage. Memory was per-machine with silent multi-Mac divergence; now lives in the repo at `.claude-memory/`, symlinked back to Claude's expected path, version-controlled like any code. Separately, a three-layer rule (CLAUDE.md section + feedback memory + `/start` skill Step 4) flags any drop/remove/retire/archive/delete/deprecate carryover item as **unverified-until-checked** — the propagation pattern that nearly broke Reviewer Finder this session.
**Sessions:** 126 (2026-05-03)
**Ship state:**
- `.claude-memory/` in repo; symlink at `~/.claude/projects/-Users-gallivan-Programming-Phase-II-Summaries/memory/`. Office Mac NOT yet symlinked — one-shot reconciliation procedure documented at `docs/OFFICE_MAC_MEMORY_SYNC.md`.
- Audit caught 3 stale memory assertions (most serious: Postgres reviewer tables claimed dormant, actually load-bearing in 5 endpoints) plus 9 undocumented services + 6 undocumented endpoints + 2 wrong Apps-table mappings in CLAUDE.md.
- Carryover-hygiene rule live in CLAUDE.md, `feedback_verify_before_destructive_carryover.md`, and `~/.claude/skills/start/skill.md` Step 4. Future sessions are required to grep + verify before acting on destructive carryover.
- Five stale memory entries corrected to match live state.
- No product code touched. 7 commits, all process/infrastructure/docs.

**Why it matters:** The audit caught a Session 126 pivot-list item ("drop dormant Postgres reviewer tables") that would have broken the live Reviewer Finder app. Without the audit, the next session would have executed it because the carryover said to. Memory-in-repo prevents the silent multi-Mac divergence that contributed to the drift; the carryover-hygiene rule prevents stale beliefs from converting to action even when they do propagate.
**Pointers:** `docs/OFFICE_MAC_MEMORY_SYNC.md`, `docs/MULTI_MAC_SETUP.md` (new Step 4), `CLAUDE.md` Carryover Hygiene section. Commits `7f5de6d` → `789536d`.

---

## May 2026 — External Reviewer Intake live in production (Session 123)

**Milestone:** Phase 7 cutover. Invited reviewers now receive an HMAC-signed magic link granting unauthenticated access to a curated SharePoint folder for proposal materials, plus an upload form that writes reviews back into Dataverse + SharePoint. Eliminates the manual "email the proposal as an attachment, take the review back via email" loop staff have run for years and removes Vercel Blob from the review-storage path going forward.
**Sessions:** 121-123 (2026-05-01 → 2026-05-02)
**Ship state:**
- Phase 4-6 endpoints live in production: public landing page (`/external/review/[token]`), staff regenerate/revoke/mark-received endpoints, public proposal download + review upload. Auto-mint on Reviewer Finder accept-flip, per-recipient `{{externalLink}}` rendering in send-emails.
- `EXTERNAL_LINK_SECRET` set in Vercel preview + production (separate values per env). Production deploy `dpl_6GubU5ja8rgfsRXtYgA3PEosxGGs`.
- `Reviewer_Downloads/` (Connor populates) / `Reviewer_Uploads/{LastName_shortId}/` SharePoint folder convention agreed with Connor and documented (`docs/REVIEWER_MATERIALS_FOLDER_SPEC.md`) for the PA folder-creation flow he'll build.
- Files outside `Reviewer_Downloads/` are invisible to reviewers (segment-anchored regex enforced at both list and download endpoints).
- 295 tests passing, smoke-tested end-to-end against real Dynamics + SharePoint.

**Why it matters:** First end-to-end public-facing surface in the system. Proves the pattern for token-authenticated external access (secret separation between envs, hash-only token storage, segment-anchored file leakage protection) that subsequent external workflows will reuse. Connor's Power Automate flow to auto-create the two folders at request creation is the only remaining external dependency for new requests to be reviewer-ready out of the box.
**Pointers:** `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md`, `docs/REVIEWER_MATERIALS_FOLDER_SPEC.md`. Commits `de6e284` → `508f5ec`.

---

## May 2026 — Wave 2 architectural arc: ALS restrictions + canonical LLM client + shared auth policy (Session 120)

**Milestone:** Three platform-level refactors landed in one session. Per-request Dynamics restriction context replaces module-state globals (real concurrency-leak fix under Fluid Compute). One canonical `LLMClient` replaces `shared/api/handlers/claudeClient.js` plus 14 ad-hoc `fetch` sites — the first time the app's Anthropic call surface has a single, observable, abort-bound, redacted code path. Middleware fail-open auth gap closed via shared edge-compatible policy module.
**Sessions:** 120 (2026-05-01)
**Ship state:**
- `lib/services/dynamics-context.js`: `AsyncLocalStorage`-backed `withDynamicsContext` / `bypassDynamicsRestrictions`. 13 API entry points + 2 library callers wrapped. The static `setRestrictions`/`bypassRestrictions` on `DynamicsService` are deprecated shims with one-shot warnings; module globals stay as the script fallback during the long-tail migration. Regression test pins the fix with two interleaved tasks.
- `lib/services/llm-client.js`: `complete()` + `stream()` with `safeFetch` (SSRF allowlist), real `AbortController`-bound timeout (cancels the underlying socket, not just the Promise), retry on 429/529 with `retry-after` honoured, single fallback-model swap on 529, structured `logUsage` on success and failure (cache tokens preserved), API-key redaction in thrown errors, normalized response shape across unary and streaming. Streaming preserves the dynamics-explorer/chat semantic (text deltas suppressed once tool_use detected) and `onEvent` exposes raw SSE for web_search citations. 22 call sites migrated; `shared/api/handlers/claudeClient.js` deleted.
- `lib/utils/auth-policy.js`: edge-compatible `isAuthRequired()` shared between `middleware.js` and `lib/utils/auth.js`. Closes a real production gap — middleware previously used `process.env.AUTH_REQUIRED !== 'true'` (fails OPEN if missing in prod) while the API path's `isAuthRequired()` already failed CLOSED. Misconfig warnings memoized so middleware can't spam logs.
- Side-effect: structured-data extraction calls in `process.js`, `process-phase-i*.js`, `process-legacy.js` were silently un-logged before; routing them through LLMClient with `appName` closed an observability gap on per-app token spend.
- Deferred Wave 1 housekeeping: removed `pages/reviewer-finder.js` onboarding flow + `AddResearcherModal` (~613 lines net subtraction). Both Postgres-only legacy paths obsoleted by save-candidates Dataverse-only.
- 26 new tests (5 ALS + 11 LLMClient + 10 auth-policy). Full suite 189/190.

**Why it matters:** Closes the architectural debt Codex flagged in `CODE_REVIEW_RESPONSE_2026-04-30.md`. Before today, two requests on the same Fluid Compute instance could leak Dynamics restrictions into each other; the LLM call surface was four divergent patterns with no abort, no SSRF guard on most paths, and gaps in usage logging; middleware and API auth disagreed on misconfigured prod in the worst direction. All three are now framework-level invariants instead of per-route concerns. Sets the shape for any future architectural pieces that want a request-scoped context (the LLM wrapper inherits cleanly).

**Pointers:** `docs/CODE_REVIEW_RESPONSE_2026-04-30.md` (waves plan + addenda); commits `2140e86` (#5 ALS restrictions), `9f6844a` (#6 LLMClient), `3a1d463` (#7 auth-policy), `adbffe7` (housekeeping); `lib/services/dynamics-context.js`, `lib/services/llm-client.js`, `lib/utils/auth-policy.js`

---

## April 2026 — Review Manager fully on Dataverse + 333-row historical backfill (Session 118)

**Milestone:** Reviewer-lifecycle stack — the Reviewer Finder save path, My Candidates read/edit/delete, and now all four Review Manager endpoints — runs end-to-end on Dataverse. Postgres `reviewer_suggestions` is no longer in the read path of any user surface. 333 pre-picker historical rows were migrated through the same three-adapter chain `save-candidates` uses, with full lifecycle state preserved.
**Sessions:** 118 (2026-04-30)
**Ship state:**
- `scripts/backfill-postgres-to-dataverse.js`: idempotent dry-run-first migrator. 333/333 rows succeeded; 59 with lifecycle (timestamps, blob URLs, status) carried via `updateLifecycle`. 4 quantum-chimera test rows without `request_number` skipped (already dual-written via save-candidates)
- All four Review Manager endpoints rewritten: `reviewers` (PD-scoped accepted suggestions via new `findAcceptedByPD`); `send-emails` (Dataverse recipient pull + contact promotion via new `contact.js` adapter — find-or-create + `setContactLink`; cycle-level template/attachments still Postgres-by-shortCode); `upload-review` (blob upload unchanged, lifecycle to Dataverse); `render-emails` (Dataverse recipient + proposal data, cycle config from Postgres). UI sweep: `selectedCycleId` → `selectedCycleCode`, GUID-string `suggestionId` flows through cleanly
- Adapter additions: picklist optionset translation (`responseType`, `reviewStatus` strings → Edm.Int32) in `updateLifecycle`; `wmkf_areaofexpertise` added to 100-char clamp map; `findAcceptedByPD`; `reminderCount` mapping; `contact.js` (findByEmail, findOrCreateByEmail). Adapters now use explicit `.js` import for raw-Node ESM compatibility
- Validation pass against real auth uncovered + fixed 5 drive-by bugs: `saveProposalFields` missing `onRefresh`; per-templateType email attachments (materials PDF was bleeding into thank-you sends); `formatReviewDeadline` UTC-vs-local-day off-by-one for YYYY-MM-DD strings; `wmkf_organizationname` not projected into `proposal.institution`; trailing-space cleanup on the same field
- Two external dependencies surfaced and tracked, not blocked-on: `# WMK: Research Review App Suite` role lacks `AppendTo` on Contact at BU level (contact promotion creates orphan contacts but can't link them) — `docs/PENDING_ADMIN_REQUESTS.md` §4; external reviewer file access (proposal share URLs throw expired-link errors; review uploads still in Vercel Blob) — needs Connor consult on a staging/library permission model

**Why it matters:** First user-app surface where Postgres has no read consumers. The dual-write in `save-candidates` is now the only Postgres tether — its removal becomes a single-commit cleanup once another smoke session goes by. Five end-to-end phases (read / patch / send / upload / thank-you) validated against real auth on the J26 Quantum Chimera test set.

**Pointers:** `docs/archive/REVIEWER_FINDER_DATAVERSE_CUTOVER_PLAN.md`; commits `a4961db` (Workstream 3 backfill), `ef233a0` (Workstream 2 Review Manager migration), `ada645d` (validation fixes)

---

## April 2026 — Reviewer Finder save + read paths cut over to Dataverse (Session 117)

**Milestone:** First user-app surface running end-to-end on the Wave 2 schema. New saves dual-write to Dataverse via the three adapters; My Candidates reads/edits/deletes go through Dataverse only. Postgres still receives writes for safety but is functionally archive-only for Reviewer Finder display.
**Sessions:** 117 (2026-04-30)
**Ship state:**
- `save-candidates` dual-writes per-candidate via `potentialreviewer.upsertByEmail` → `researcher.upsertByPotentialReviewer` → `reviewerSuggestion.upsert`. Per-candidate failure isolation; Postgres still source of truth, Dataverse failures logged + surfaced under `response.dataverse`
- `my-candidates` GET/PATCH/DELETE fully Dataverse-backed. Default scope: requests where authenticated user is lead PD (resolved via `program-director-resolver`). Override knobs: `?requestId=<guid>` / `?requestNumber=<num>` for collaborator lookup, `?cycleCode=Jxx` to narrow. PATCH routes to suggestion / potentialreviewer / researcher adapters; DELETE soft-flips `wmkf_selected = false`. PI/institution edits intentionally rejected (those belong on `akoya_request`)
- Adapter extensions: `findByRequest`, `findByPD` (queryAllRecords-paginated to handle PDs with >500 historical requests), `updateLifecycle`, `softDelete`, `bulkUpdateByRequest`; person/researcher `update` methods with the same 100-char `wmkf_organizationname` clamp
- Bug fixes uncovered during validation: `claude-reviewer-service.js` converted from CJS `require()` to ESM `import` (Next 16 + Turbopack interop returned undefined for `usage-logger`'s named exports under CJS); `bypassRestrictions('<endpoint>')` mandatory at handler entry — `DynamicsService` fails closed otherwise; `akoya_request` proposal title field is `akoya_title`, not the assumed `akoya_name`
**Why it matters:** Real production-shape exercise of Connor's table model end-to-end (lead → bibliometric sidecar → lifecycle ledger). Validates the "all org-visible, dashboards filter by PD" pattern in a working surface, not a smoke test. Sets the template for the rest of the user apps that still talk to Postgres.
**Pointers:** `docs/REVIEWER_ARCHITECTURE.md`, `docs/archive/REVIEWER_FINDER_DATAVERSE_CUTOVER_PLAN.md`; commits `b440173` (save dual-write), `9215d03` (validation fixes), `f66cdad` (read cutover), `992126c` (pagination), `cc5f710` (next-steps plan)

---

## April 2026 — Wave 2 schema reshape: align with Connor's wmkf_potentialreviewers (Session 115)

**Milestone:** Wave 2 schema fully landed in prod with a deliberate model pivot. Connor's existing `wmkf_potentialreviewers` becomes the canonical lead/person record (1:1 with `contact` once promoted); our `wmkf_app_reviewer_suggestion` is the lifecycle ledger keyed `(potentialreviewer, request)`; our `wmkf_app_researcher` is the bibliometric sidecar (h-index, citations) on a different update cadence. Tables are empty and ready for adapter wiring.
**Sessions:** 115 (2026-04-29)
**Ship state:**
- Connor's table extended (lookup → contact + 1:1 alt-key + email alt-key); old `wmkf_requestlookup` column dropped after he removed the field from the "Potential Reviewer" main form via the maker portal (Web API PATCH on Active-layer systemforms silently no-ops in our env, even with System Customizer)
- Engine extended: `wave{N}-existing/` directory loads before `wave{N}/`; `extensions-on-existing` spec kind handles attributes + relationships + alt-keys on already-created entities
- Two original schemas had primary-attribute lengths >850 (Dataverse's hard cap); fixed. Dependency ordering fixed via `wmkf_app_z_publication_author.json` rename so its lookup target loads first
- 6 duplicate emails on `wmkf_potentialreviewers` cleaned up by Connor before the email alt-key would apply
**Why it matters:** Replaces the "save-candidates writes a researcher row, no contact link" Postgres model with a CRM-aligned one (lead → contact → suggestion lifecycle). Removes the contacts-pollution risk of auto-creating contacts for every suggested-but-never-contacted candidate. Forms the data foundation for the Reviewer Finder cutover (next session).
**Pointers:** commits `46c7d26` (initial wave 2), `852bd1a` (reshape); `lib/dataverse/schema/wave2-existing/`, `scripts/apply-dataverse-schema.js`

---

## April 2026 — Wave 1 Postgres → Dataverse cutover (Session 112)

**Milestone:** Production cutover. The three Wave 1 tables (`user_app_access`, `user_preferences`, `system_settings`) now read/write through Dataverse on prod traffic. Postgres remains as a failsafe; rollback is `vercel env rm WAVE1_BACKEND_<NAME>` + redeploy.
**Sessions:** 112 (2026-04-27)
**Ship state:**
- All three `WAVE1_BACKEND_*` env vars set to `dataverse` on Vercel production; prod redeployed (`wmkfresearchapps-54h9tcpup-...`, Ready)
- Parity drift caught + fixed during the flip: `concept-evaluator` grants had been removed from Postgres-only in Session 111, surfaced as pg=16 / dv=17 in `scripts/test-wave1-flag-dispatch.js`. Cleanup script rewritten to route through `lib/services/app-access-service.js`; ran against Dataverse, parity restored to 35/35
- Raw-SQL audit found 3 admin scripts that still hit those tables directly (`rotate-encryption-key.js`, `backfill-app-access.js`, `manage-preferences.js`); each now hard-exits with a `[wave1-guard]` message unless `--allow-postgres-only` is passed
- SESSION_PROMPT § 8 captures retirement criteria (14 days clean → drop dispatch wrappers + Postgres tables → Wave 2)
**Why it matters:** First production cutover of a long-running migration. Validates the dispatch-wrapper pattern + the Postgres-Dataverse byte-for-byte sync invariant. Wave 2 (researcher / publication / proposal data) gets the same shape.
**Pointers:** `docs/WAVE1_VERCEL_FLAG_ROLLOUT.md`, commits `dd58730`, `fb36ecb`

---

## April 2026 — Security pass (Codex + remediation) (Session 112)

**Milestone:** Closes 7 of 11 P1/P2 findings from a Codex-driven security audit, raising baseline posture before May 1 cycle. Behavior change: production now fails closed when auth config is incomplete (was: silent bypass).
**Sessions:** 112 (2026-04-26)
**Ship state:**
- Codex's earlier-day pass shipped first: HSTS preload + Permissions-Policy + COOP/CORP, edge-compatible CSP nonces, `/auth/*` brought under middleware, CSRF strict mode for cookie-bearing state-changing methods
- Remediation closed: auth fail-closed + `EMERGENCY_AUTH_BYPASS` escape hatch; decrypted-credentials-to-browser path eliminated (`ApiKeyManager.js` + `ApiSettingsPanel.js` deleted; `/api/api-capabilities` replaces user-stored ORCID/NCBI/SerpAPI keys with server-side env reads); rate-limiter no longer trusts `x-api-key` header; `extract-summary` IDOR gated by ownership check; multipart uploads now stream-aborted at 50MB; log-analysis cron redacts before sending to Claude
- npm audit: 13 → 5 production vulns (all 7 highs resolved; 5 remaining moderates blocked behind Next.js / next-auth majors and queued post-cycle)
- 163 → 173 tests; CI lock-file regenerated + `npm ci` verified
**Deferred per Justin's threat-model read:** public blob privatization, proposal password masking, Dynamics restrictions concurrency fix, the 5 moderate vulns. Tracked in SESSION_PROMPT § 8.
**Pointers:** `docs/SECURITY_FINDINGS_2026-04-26.md`, `docs/SECURITY_CODE_CHANGES_2026-04-26.md`, commits `36a8ab6`, `a8e8147`

---

## April 2026 — Concept Evaluator deprecated (Session 110)

**Milestone:** A user-facing app removed from the active set. Page + API + prompt archived; registry entries removed; no user-visible app remains for the concept-stage screening workflow.
**Sessions:** 110 (2026-04-25)
**Ship state:**
- `pages/concept-evaluator.js`, `pages/api/evaluate-concepts.js`, `shared/config/prompts/concept-evaluator.js` moved into a new top-level `/_archived` directory (Next.js does not route it; nothing live imports them)
- Removed from `appRegistry.js` (APP_REGISTRY array), `baseConfig.js` (APP_MODELS map), `admin.js` (APP_MODEL_NAMES), CLAUDE.md (app inventory + per-app model table), and two utility scripts
- New `_archived/README.md` documents the convention so future deprecations follow it
- Existing `user_app_access` grants for `concept-evaluator` left in place — harmless without an app, drop in a later cleanup pass
**Why it matters:** concept-stage screening workflow superseded by emerging backend automation; intake AI work moves to PA-triggered prompts post-cycle. Removing dead surface area now shrinks the app set staff see in navigation and the per-app model dashboard.
**Pointers:** `_archived/README.md`, commit `bb19027`

---

## April 2026 — Phase 0 Executor architecture shipped on Vercel side (Session 110)

**Milestone:** Prompt rows live in Dynamics + Executor service in Vercel + reference call site refactored. Same prompt row will serve PowerAutomate and Vercel callers when Phase 1 (Connor's PA work) lands.
**Sessions:** 110 (2026-04-25)
**Ship state:**
- `wmkf_ai_prompt` table populated; `phase-i.summary` row live in prod Dynamics (`d4201d8e-3840-f111-88b5-000d3a3065b8`)
- `lib/services/execute-prompt.js` implements the 10-step contract — including step 4 output guards (`skip-if-populated` / `always-overwrite` + `forceOverwrite` input)
- `pages/api/phase-i-dynamics/summarize-v2.js` refactored from 292 → 145 lines — only Vercel-specific concerns remain (auth, file load, 409 shaping)
- Verified end-to-end via UI (`/phase-i-dynamics`) and a smoke-test script with three runs (write / block / cache-hit)
**Why it matters:** Cycle path (May 1 2026) now runs through the new infrastructure. PA-side (Phase 1) and context blocks (Phase 2) are queued as future work; Vercel-side is done.
**Strategic shift captured:** user-facing intake apps (`/phase-i-dynamics`) are winding down post-cycle; backend automation owns the future of compliance/keywords/fit prompts. See `memory/project_phase_i_summary_app_winddown.md`.
**Pointers:** `docs/EXECUTOR_CONTRACT.md`, commits `f465799`..`f47b849`

---

## April 2026 — Executor Contract + Phase 0 schema reconciliation (Session 109)

**Milestone:** Day-long architectural reconciliation with Connor in the room. Output: one shared spec both PowerAutomate and Vercel executors will build against, with phased delivery plan.
**Sessions:** 109 (2026-04-24)
**Ship state:**
- `docs/EXECUTOR_CONTRACT.md` created — the operational spec. Defines 9 (later 10) steps, declarative variable + output metadata, caching contract, logging contract.
- Path B chosen over duplicated wrappers (Path A) and HTTP gateway (Path C). Vocabulary split: prompt row = the **function**, PA/Vercel flows = the **process**, Executor = the shared invocation contract.
- Connor's late additions confirmed live: `wmkf_ai_systemprompt` Memo (system/user split for caching) + Lookup `wmkf_ai_prompt` on `wmkf_ai_run` (fixes provenance gap).
- Phased plan set: Phase 0 (May 1 cycle) = shared core + Vercel Executor; Phase 1 (post-cycle) = PowerAutomate `ExecutePrompt` child flow; Phase 2 = context blocks + cross-prompt cache alignment.
**Why it matters:** Six overlapping design docs from Sessions 90–108 were collapsed into one operational spec. Both implementations build against it. No more drift between Vercel and PA.
**Pointers:** `docs/EXECUTOR_CONTRACT.md`, `docs/PROMPT_STORAGE_DESIGN.md` (now reconciled), commit `adef1c8`

---

## April 2026 — Wave 1 Dataverse Migration Live in Production (Session 108)

Ran the full Wave 1 arc from sandbox security-role work through production cutover in a single long session. 20 commits. End state: prod Dataverse holds byte-for-byte copies of Postgres `user_preferences`, `user_app_access`, `system_settings`; all three tables are wired into the application behind per-table feature flags defaulting to postgres; rollout to production traffic is a config flip away. Documentation and memory are updated so future sessions know the remaining follow-ups.

- **Security role infrastructure** (`e3f865f`): `lib/dataverse/schema/roles/wave1-staff.json` + `lib/dataverse/role-apply.js` + `scripts/apply-security-role.js`. Idempotent apply via `AddPrivilegesRole`, solution binding via `AddSolutionComponent` (ComponentType 20), `systemuserroles_association/$ref` assignment. Dataverse API quirks discovered and documented in the code: `Depth` field requires the string enum form ("Global"), and OData `tolower()` isn't supported in metadata filters — plain `eq` on string fields is case-insensitive in Dataverse.
- **Symmetric two-user isolation test** (`a76697e`, refactored `0094449`): `scripts/test-role-isolation-wave1.js`. Impersonates two real sandbox users via `MSCRMCallerID` and asserts each is blocked from the other's preference rows while retaining Org-level access to the shared settings table. 11/11 assertions pass with Justin + Kevin (both non-admin). Auto-skips sys-admin users and notes why their side would bypass.
- **Postgres → Dataverse data sync** (`518756b`, prod-support added `8c4ee6c`): `scripts/sync-wave1-postgres-to-dataverse.js`. Identity bridge via `user_profiles.azure_email` → `systemuser.internalemailaddress`. Hardcoded `USER_ID_OVERRIDES` handles `id=1 Test User → skip` and `id=6 Tom Rieker → id=5 Beth Pruitt` remap (Tom left the foundation; Beth took over reviewing). 149 rows migrated in sandbox: 20 prefs + 84 app-access + 45 settings. Encrypted preference values carry over as ciphertext unchanged.
- **Read-path byte-level verification** (`b98c249`, prod-support `5398b41`): `scripts/verify-wave1-read-path.js`. Compares at three levels — raw stored bytes (load-bearing, since null-vs-null decrypted values would pass vacuously when the local encryption key is absent), is_encrypted flag, decrypted plaintext. 66/66 assertions across all 7 real users + shared settings.
- **Three Dataverse-backed service adapters** (`817d8f7`, `9965d08`):
  - `lib/services/dataverse-identity-map.js` — profile ↔ systemuser bridge with 5-min TTL.
  - `lib/services/dataverse-prefs-service.js` — 1:1 parity with DatabaseService preference methods including encryption/masking. 16/16 e2e assertions pass.
  - `lib/services/dataverse-app-access-service.js` — listAppKeysForUser / listAllGrantsForAdmin / grantApps / revokeApps. Admin view crosses the Postgres-Dataverse boundary since user_profiles stays in Postgres until Wave 3+.
  - `lib/services/dataverse-settings-service.js` — get/list/set/delete plus listSettingsWithMeta variant for admin/secrets that needs updated_at alongside value.
- **Feature-flag dispatch wiring** (`5b68604`, `8838c8f`, `636b8da`): three independent flags — `WAVE1_BACKEND_PREFS`, `WAVE1_BACKEND_APP_ACCESS`, `WAVE1_BACKEND_SETTINGS`, all defaulting to postgres. Prefs dispatched inside DatabaseService (6 methods). App-access wrapped by new `lib/services/app-access-service.js` with 3 call sites replaced (auth hot path, admin API, NextAuth callback). Settings wrapped by new `lib/services/settings-service.js` with 5 call sites replaced (baseConfig preload, maintenance, admin/models, admin/secrets, cron/secret-check). 35/35 parity assertions via `scripts/test-wave1-flag-dispatch.js` exercise all three wrappers through their real APIs on both backends.
- **Turbopack client-bundle safety** (`11028c5`): Turbopack traces both `require()` and `await import()` statically even when nested in function bodies, which tried to pull the Dataverse client's `fs`/`path` requires into the client bundle via baseConfig → settings-service → dataverse-settings-service → dataverse/client.js. Fix: variable-path requires defeat the tracer (applied in `lib/dataverse/client.js` for fs/path, and in all three wrappers for the Dataverse service loads). Architectural fix: extracted `loadModelOverrides` + `clearModelOverridesCache` out of `shared/config/baseConfig.js` into a new server-only `lib/services/model-override-loader.js`. Updated 15 API route import statements + `shared/config/index.js` re-exports accordingly. Production build goes clean.
- **Prod cutover** (`5398b41`): three privilege rounds with Connor — first `System Customizer` (to get past `prvCreateSystemForm` auto-invoked during table creation), then `prvAssignRole` on the permanent `WMKF AI Tools` role. Schema script hit a transient SQL deadlock (error 1205) on alt-key creation mid-run; idempotent retry resolved it cleanly. Schema + role + data + verification all pass in prod. App behavior unchanged — all three flags still default to postgres.
- **Connor handoff documentation** (six docs across multiple commits): `docs/WAVE1_PROD_RUNBOOK.md` (comprehensive cutover runbook, now historical reference), `docs/WAVE1_PROD_PRIVILEGE_REQUEST.md` (Option A surgical vs Option B System Customizer decision), `docs/WAVE1_PROD_PRIVILEGE_REQUEST_2.md` (`prvAssignRole` follow-up), `docs/WAVE1_REVERT_TEMP_ELEVATIONS.md` (future procedure for removing temp roles when flag rollout is stable), `docs/WAVE1_VERCEL_FLAG_ROLLOUT.md` (sequenced plan: SETTINGS → PREFS → APP_ACCESS, 24h between flips), `docs/CONNOR_PROMPT_TABLE_FOLLOWUP.md` + `docs/CONNOR_PROMPT_SCHEMA_QUESTIONS.md` (re-surfaced `wmkf_ai_prompt` privilege + two schema design questions; privileges confirmed granted, schema decisions pending). Memory index updated so future sessions pick up the two pending follow-ups automatically.
- **End state:** prod Dataverse = byte-for-byte copy of prod Postgres for the 3 Wave 1 tables. App still reads Postgres (flags default postgres). Pending Connor: two `wmkf_ai_prompt` schema decisions (yes/no each). Pending us: flip Vercel flags one at a time per runbook (not yet done — left for a calm session). Pending Connor later: remove temp role elevations after flag rollout is stable.

---

## April 2026 — Wave 1 Dataverse Schema Live in Sandbox (Session 107)

Shipped Wave 1 of the Postgres → Dataverse migration end to end: reusable schema-apply infrastructure, 13 artifacts created in a named solution in the sandbox, idempotent reruns, data-level smoke test passing. Drafted the security-role handoff doc for Connor. Discovered his new `wmkf_ai_prompt` table in prod, flagged access blocker + two design questions for morning.

- **Schema-apply infrastructure** (`f05f3d0`): `lib/dataverse/client.js` (OAuth + fetch helper with solution-header binding, dry-run support), `lib/dataverse/schema-apply.js` (idempotent `ensure*` functions for publisher/solution/entity/attribute/relationship/alt-key with metadata-cache-lag retry), `scripts/apply-dataverse-schema.js` (CLI, sandbox by default, explicit `--execute` + `--target=prod`). Declarative schemas as JSON under `lib/dataverse/schema/wave1/`. Solution `wmkfResearchReviewAppSuite` under publisher `WMKF_Publisher`.
- **Wave 1 artifacts** (`f05f3d0`): `systemuser.wmkf_app_AvatarColor` + `.wmkf_app_NeedsLinking`; `wmkf_AppSystemSetting` (Org-owned, + `wmkf_SettingValue` Memo, + `wmkf_UpdatedBy` N:1 systemuser, + single-column alt-key); `wmkf_AppUserAppAccess` (Org-owned, + required `wmkf_User` N:1 + `wmkf_GrantedBy` N:1 + composite alt-key on (user, app_key)); `wmkf_AppUserPreference` (User-owned, + `wmkf_PreferenceValue` Memo + `wmkf_IsEncrypted` Boolean). 13 artifacts total. Rerun produces all `· exists`.
- **Bugs fixed during first-time execute** (all committed): three publishers share prefix `wmkf` — added `publisherUniqueName` in solution.json for disambiguation. Client header-ordering bug — `MSCRM.SolutionUniqueName` auto-add clobbered extraHeaders suppression; fixed spread order so empty-string override actually suppresses. Dataverse 404s the direct `Attributes(LogicalName='x')` path for non-String subtypes (Memo/Boolean) without a type-cast; switched to filter-based existence check. `ownerid` rejected as polymorphic `PrincipalAttribute` in composite alt-keys — dropped the `(preferencekey, ownerid)` key; per-user uniqueness enforced app-side instead.
- **Data smoke test** (`10c1982`): `scripts/smoke-test-wave1.js` — INSERT into each table, alt-key duplicate attempts, custom-lookup binding, ownerid auto-populate check, full cleanup. All 6 checks pass. **Finding**: custom-lookup `@odata.bind` uses the lookup's **SchemaName (PascalCase)**, not logical name — Dataverse navigation property casing follows `ReferencingEntityNavigationPropertyName`. Applies to every custom lookup we create going forward.
- **Security-role handoff doc** (`a828d22`): `docs/SECURITY_ROLE_WAVE1.md` — explains the one table needing User-level Read (`wmkf_AppUserPreference` holds encrypted secrets), privilege matrix for all three Wave 1 tables, maker-portal walkthrough + Web API alternative, two-user isolation test plan, callouts on BU / role-inheritance / role-name differences I might be wrong about.
- **Connor's `wmkf_ai_prompt` table discovered** (`e67262a`): Connor finished the prompt-storage table while we were on Wave 1. Name: `wmkf_ai_prompt` (not `wmkf_prompt_template` as originally spec'd). Schema is richer than design — includes lifecycle (`wmkf_ai_promptstatus`, `wmkf_ai_iscurrent`, `wmkf_promptversion`, `wmkf_ai_rollbackfrom`, `wmkf_ai_publisheddatetime`, `wmkf_ai_preflightpasseddatetime`, `wmkf_ai_lasttestdatetime`), content (`wmkf_ai_promptbody`, `wmkf_ai_promptvariables`, `wmkf_ai_promptoutputschema`), Claude config (`wmkf_ai_model`, `wmkf_ai_maxtokens`, `wmkf_ai_temperature`), meta (`wmkf_ai_promptname`, `wmkf_ai_notes`). **App user lacks prvRead** on the table — 403 on any query. **Two design questions** flagged in `docs/CONNOR_PROMPT_TABLE_NOTES.md`: single `wmkf_ai_promptbody` collapses the system/user-prompt split we recommended for caching (options: add a second Memo column, use a delimiter, or keep merged); no visible app-key column (confirm that `wmkf_ai_promptname` is the routing key or add a structured one).

**Files:** `lib/dataverse/client.js` (new); `lib/dataverse/schema-apply.js` (new); `lib/dataverse/schema/solution.json` (new); `lib/dataverse/schema/wave1/*.json` (4 new); `scripts/apply-dataverse-schema.js` (new); `scripts/smoke-test-wave1.js` (new); `docs/SECURITY_ROLE_WAVE1.md` (new); `docs/CONNOR_PROMPT_TABLE_NOTES.md` (new); `.env.local` (added `DYNAMICS_SANDBOX_URL`).

---

## April 2026 — Sonnet 4.6 Cache Floor + Connor Sync + Dataverse Migration Plan (Session 106)

Two major threads. First: diagnosed why v2 system-prompt caching never fires. Second, with Connor in the room: resolved the Open Questions in the PDF-input brief, designed the PA-vs-web-apps division of labor, and built a full Postgres → Dataverse migration plan across 27 tables.

- **Sonnet 4.6 cache floor finding** (`48dec12`): Anthropic silently doubled the cache minimum to 2048 tokens in the Sonnet 4.6 generation, undocumented. Confirmed by bisection: 2,019 tokens → no cache; 2,058 → writes. `cache_control` marker is accepted in the request regardless; the write is just dropped. Beta header `prompt-caching-2024-07-31` doesn't help. Audited all app system prompts via `count_tokens` — three apps in the 1024–2047 dead zone: `phase-i-dynamics-v2` (1,419), `qa` with typical 10K-char proposal (1,868), `phase-i-summaries v1` (1,426). Dynamics-explorer (9,345 / 12,073 with tools) is fine. The QA finding is notable — Session 103's "cache paid for itself" data must have been pre-Sonnet-4.6 or on Phase II-sized proposals. Didn't pad v2 — summarize-v3 (native PDF + caching) is the right path; PDF document blocks are always above the floor. `scripts/audit-system-prompt-sizes.js` left in place for future re-checks.
- **Connor sync on `docs/PDF_INPUT_FOR_BACKEND.md`** (`48dec12`): Q1 (Adobe PDF / Encodian) — licensed but **not required**; Anthropic handles PDF rendering. Q2 (PA HTTP body size) — tested to 75 MB, no tenant cap. Q3 (Files API beta header) — end-to-end verified via `scripts/test-files-api.js`; three HTTP calls (upload → reference → delete) all return 200 with `anthropic-beta: files-api-2025-04-14`. PA replication is a PA-config concern only from here. Q4 (multi-pass timing) — Connor's Phase 1 automation is single-request-sequential, caching gives little; future batch-analysis regime (one prompt × many historical files) is where caching + Batch API matter. Q5 (2048 floor) — informational only. New doc section "Future batch-analysis regime" captures the different economics.
- **`docs/RETROSPECTIVE_ANALYSIS_PLAN.md`** (`48dec12`): Division of labor — PA owns recurring single-request workflows; web apps own ad hoc retrospective analyses across historical cycles. Four capability gaps identified (historical-request picker, BYO-prompt batch app, Batch API integration, structured-results export) with recommended sequencing.
- **Dataverse sandbox access unlocked** (`93cbb74`): Justin got System Customizer in prod + Administrator in WM Keck Sandbox. App Registration ("WMK: Research Review App Suite") added as application user in the sandbox. `scripts/discover-dynamics-envs.js` lists envs via Global Discovery Service — both environments now visible. `scripts/probe-sandbox-schema-perms.js` confirms full schema CRUD (create/delete test entity with retry-with-backoff for Dataverse metadata-cache lag).
- **Fiscal-year format verified against production data** (`93cbb74`): `scripts/probe-fiscal-year-format.js` sampled 100 recent requests — `akoya_fiscalyear` uses **long format** (`"June 2026"`, `"December 2026"`), NOT the short codes (`J25`/`D26`) that staff sometimes use as shorthand. 100% of sampled requests have populated `wmkf_meetingdate`; every fiscal-year code maps to exactly one meeting month. Clean data.
- **`docs/POSTGRES_TO_DATAVERSE_MIGRATION.md`** (`93cbb74`): Rewritten across multiple rounds of decisions. Key calls: `wmkf_app_<table>` naming namespace; three-entity person model (`systemuser` for Keck staff, `contact` for external people, `wmkf_app_researcher` narrowed to bibliometric pool, no crossover); ORCID-on-contact is real (24% populated per schema annotation) — enables real match-on-promote + retroactive reconciliation; publications authorship becomes its own junction (`wmkf_app_publication_author`) — original 1:N was a modeling bug; expertise roster is single table with dual person-lookup (staff→systemuser, consultant/board→contact); grant cycles become net-new `wmkf_app_grant_cycle` keyed by fiscal-year string (there is no `akoya_grantcycle` entity in Dynamics today — my earlier assumption was wrong); ownership and visibility are orthogonal (all tables get org-level Read via security role; `wmkf_app_user_preference` is the single User-level-Read exception because it holds secrets); Plan B solution strategy (named unmanaged solution from day 1, scripted creation via Dataverse Web API, managed export for prod; no `pac` dependency). 27 tables categorized: 16 migrate to new `wmkf_app_*` tables, 2 merge into existing entities, 2 eliminate, 7 stay in Postgres. Wave 1 and Wave 2 fully specified; Wave 4 previewed.

**Files:** `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md` (new); `docs/RETROSPECTIVE_ANALYSIS_PLAN.md` (new); `docs/PROMPT_CACHING_PLAN.md`; `docs/PDF_INPUT_FOR_BACKEND.md`; `CLAUDE.md`; `scripts/audit-system-prompt-sizes.js` (new); `scripts/test-files-api.js` (new); `scripts/discover-dynamics-envs.js` (new); `scripts/probe-sandbox-schema-perms.js` (new); `scripts/probe-fiscal-year-format.js` (new).

---

## April 2026 — Spend Monitoring, Cache Bug Fix, PDF Input Research (Session 105)

Shipped M7 (observability-only credit monitoring), fixed a month-long silent cache-token-capture bug in dynamics-explorer, added a generic `updateIfEmpty` helper, and ran the v1-vs-v2 Phase I prompt comparison that turned into a deeper investigation of native PDF input as the path forward for backend processing.

- **M7 spend monitoring** (`04ce74a`): "Today's Spend" tile on `/admin` (total + top 3 apps + top 3 users), hourly `/api/cron/spend-check`, low-balance email via `DynamicsService.createAndSendEmail` (gated on anchor env vars), `scripts/update-balance-anchor.sh` for top-up syncing. `stats.js` now relabels `user_profile_id IS NULL` as `Backend`. Six new env vars deployed across Production/Preview/Development.
- **Dynamics-explorer cache fix** (`5d53a32`): `parseClaudeStream` was reading `input_tokens` from `message_start.message.usage` but skipping `cache_creation_input_tokens` and `cache_read_input_tokens` on the same object. 90 calls over 30 days, 0 cache hits recorded despite `cache_control` being sent. Two-line fix; verified live with an 11-call session showing cache_create=11784 then cache_read ~12K across 10 follow-ups. Non-streaming path was already correct.
- **`DynamicsService.updateIfEmpty()` helper** (`58b77b7`): Composes read + empty-check + ETag-guarded PATCH for AI-writeback fields; returns discriminated `{ ok, reason }` result. `summarize.js` intentionally not migrated — its pre-flight-before-Claude pattern saves token spend on conflict.
- **Phase I v1 vs v2 + PDF input research** (`3653f42`): Built test-discovery + comparison harness against 8 May 2025 Phase I proposals (Stanford, Hopkins, Harvard, Mayo, St. Jude, etc.). v1 vs v2 outputs roughly comparable in length and cost. THE bigger find: native PDF document-block input costs ~3× per call ($0.13 vs $0.05 on SUNY 1001507) but absolute delta is $13/year at our volume. PDF caching with `cache_control` on the document block confirmed: **90% cost reduction and 3× latency reduction** on warm calls. For the 3-stage pipeline plan (fit screen → brief → panel), 1 cold + 2 warm calls drops per-proposal cost from $0.39 → $0.20 and total latency from ~120s → ~60s. **`docs/PDF_INPUT_FOR_BACKEND.md`** written as a Connor-facing brief with the measurements, recommended PA flow, Anthropic API constraints (32 MB request, 600 pages), and Files API guidance for multi-pass workflows.
- **Side observation worth filing**: our existing v2 endpoint puts `cache_control` only on the system block and got 0 cache hits across 8 sequential calls. Our PDF cache test shows the cache fires reliably when `cache_control` is on the document block too. v2 caching deserves a follow-up diagnosis.
- **Process correction**: I initially conflated "Concepts" stage submissions (Dec 2025) with Phase I proposals (Apr 2026), feeding 5 concept PDFs through the Phase I prompt before the user caught it. New memory `feedback_concepts_vs_phase_i.md` captures the distinction.
- **Doc clarifications for Connor** (in `04ce74a`): Expanded `wmkf_prompt_template` schema in `docs/CONNOR_QUESTIONS_2026-04-15.md` with per-field backend-use explanations and a runtime-flow block. Split `wmkf_body` into `wmkf_system_prompt` + `wmkf_user_prompt` to match Claude API + enable caching.

**Files:** `docs/PDF_INPUT_FOR_BACKEND.md` (new); `docs/CONNOR_QUESTIONS_2026-04-15.md`; `pages/admin.js`; `pages/api/admin/stats.js`; `pages/api/cron/spend-check.js` (new); `pages/api/dynamics-explorer/chat.js`; `lib/services/dynamics-service.js`; `vercel.json`; `CLAUDE.md`; `scripts/update-balance-anchor.sh` (new); 7 new investigation scripts under `scripts/` (find-2025-phase-i, find-research-test-cases, find-phase-i-test-cases, list-all-pdfs-for-candidates, compare-phase-i-v1-v2, test-suny-pdf-native, test-suny-pdf-cache, inspect-suny-pdf).

---

## April 2026 — Security Delta Audit + Hardening Pass (Session 104)

First comprehensive security review since the v3.5 baseline (2026-03-11). Three parallel Explore agents audited the new surface area (~25 commits, 4 new apps, Dynamics writeback, PromptResolver). Consolidated findings into `docs/SECURITY_AUDIT_2026-04-18.md`; fixed everything that did not need product or policy input.

- **PromptResolver `.js` fallback** (`06db9a0`): On Dynamics fetch failure the resolver now loads a bundled module (60s cache TTL) instead of throwing. `PROMPT_RESOLVER_STRICT=true` restores loud-failure behavior for prompt-dev. Extracted the Phase I v2 prompt to `shared/config/prompts/phase-i-dynamics.js` as a single source of truth shared with `seed-phase-i-prompt.js`.
- **First-pass fixes** (`c1554c1`): H1 download proxy now requires `requestId` and validates the folder's `{num}_{GUID32}` suffix matches it — prevents arbitrary non-request SharePoint downloads. H2 stopped leaking raw Dynamics error bodies in response fields (four endpoints). M1 added ETag / If-Match optimistic concurrency to `DynamicsService.updateRecord`, closing the TOCTOU on `wmkf_ai_summary` writeback. M2 `auditLogCreated` surfaced in responses. M5 Gemini key moved from URL query to `x-goog-api-key` header. M6 verified no-op, added invariant comment.
- **Second-pass hardening** (`5d86f25`): M3 new `DynamicsService.bypassRestrictions(requestId)` method; migrated 14 call sites from the ambiguous `setRestrictions([])` pattern. M8 `validatePath` decodes before the traversal check. M9 `listFiles` totalTimeoutMs wall-clock deadline. L2 `loadFile` allowlists `ref.source`. I5 `file-loader.js` rejects >50 MB buffers and races `pdf-parse` / `mammoth` against a 30 s timeout via new `withTimeout` helper. I7 `SHAREPOINT_SITE_URL` validated against `ALLOWED_SHAREPOINT_HOSTS`.
- **I3 closed** (`d6ac70f`): `wmkf_ai_run.rawOutput` retention accepted-as-is; IT-governed security profile + no PII in content set.
- **Deferred** (need input or external dependency): M4 prompt-editor governance (Connor), M7 per-user cost caps (scoped out in `project_api_credit_monitoring.md` memo — observability-only, email alerts via Dynamics `createAndSendEmail`), L1 roster CRUD superuser (product), I1 overwrite flag role gating (identity reconciliation), I4 / I6 (cleanup-level).

**Files:** `docs/SECURITY_AUDIT_2026-04-18.md` (new); `lib/services/{dynamics-service,graph-service,prompt-resolver,multi-llm-service}.js`; `lib/utils/file-loader.js`; `pages/api/dynamics-explorer/{download-document,chat}.js`; `pages/api/phase-i-dynamics/{summarize,summarize-v2}.js`; `pages/api/grant-reporting/lookup-grant.js`; `pages/api/virtual-review-panel.js`; `pages/phase-i-dynamics.js`; `shared/config/prompts/phase-i-dynamics.js` (new); 9 scripts migrated to `bypassRestrictions()`.

---

## April 2026 — Grant Reporting App + Multi-Library SharePoint Document Layer (Session 96)

Built the Grant Reporting app end-to-end and hardened the SharePoint document layer for both Grant Reporting and Dynamics Explorer.

- **Grant Reporting app**: Three-step wizard (Dynamics lookup → SharePoint document picker / upload fallback → editable form + Word export). Parallel `Promise.all` extraction calls — `createGrantReportExtractionPrompt` (report only, temp 0.1) and `createGoalsAssessmentPrompt` (proposal vs report, temp 0.2). `compareProposalToReport()` factored as a pure helper for future PowerAutomate-triggered backend use. New `requireAppAccess` route guards on both endpoints; staff-only (not in `DEFAULT_APP_GRANTS`).
- **SharePoint multi-library + subfolder discovery**: Older grants migrated from a previous grants management system store files in `RequestArchive1/2/3` libraries that Dynamics doesn't track, often inside subfolders like `Final Report/` or `Year 1/`. Built `lib/utils/sharepoint-buckets.js` `getRequestSharePointBuckets()` to discover all plausible buckets via Dynamics-tracked locations + speculative archive probes. Added recursive listing to `GraphService.listFiles({ recursive: true })` with depth/breadth caps; filters out folders. Fixed a token-leak/404 in `downloadFile()` by preferring `@microsoft.graph.downloadUrl` over `redirect: 'follow'` against the bound endpoint.
- **`classifyFile()` heuristic**: Custom separator class `[\s_\-]` (since `\b` fails between alphanumerics and underscores); proposal signals win when both fire so "Project Narrative ... FINAL.docx" stays a proposal; Phase I files explicitly excluded.
- **Dynamics Explorer document tools**: `listDocuments` and `searchDocuments` rewritten to use the shared helper. Result shape now carries per-file `library`/`folder`/`subfolder` and a `libraries[]` summary; top-level `library`/`folder` removed. `searchDocuments` fans out KQL searches across all buckets in parallel and dedupes by id/webUrl. Front-end `DocumentLinks` shows location next to each file. Verified: 993879 went from 10 → 63 files, 993347 surfaces nested files correctly.

**Files:** `pages/grant-reporting.js`, `pages/api/grant-reporting/{lookup-grant,extract}.js`, `shared/config/prompts/grant-reporting.js`, `shared/utils/grant-report-word-export.js`, `lib/utils/sharepoint-buckets.js`, `lib/services/graph-service.js`, `pages/api/dynamics-explorer/chat.js`, `pages/dynamics-explorer.js`, `docs/DYNAMICS_EXPLORER_DOCUMENT_LISTING_PLAN.md`

---

## April 2026 — Virtual Review Panel: Devil's Advocate Pass + Progress Timers (Session 93)

Added adversarial "devil's advocate" review stage and improved progress feedback for long-running LLM calls.

- **Devil's Advocate pass**: Optional pipeline stage after structured review, before synthesis. One randomly-selected provider produces an adversarial review (primary concern, failure scenario, challenged assumptions, competitive weaknesses, skeptical verdict). Output labeled separately in synthesis — not averaged with balanced reviews. Red-tinted UI card, full sections in MD/DOCX exports.
- **Progress timers**: Per-provider elapsed timer (ticks every second on in-progress cards), overall elapsed timer in progress header, 15-second server-side heartbeat events during all LLM calls to keep SSE alive and populate event log.

**Files:** `shared/config/prompts/virtual-review-panel.js`, `lib/services/panel-review-service.js`, `pages/virtual-review-panel.js`, `pages/api/virtual-review-panel.js`

---

## March 2026 — Virtual Review Panel: Stage 0 Intelligence + Prompt Rebalancing (Session 91)

Major iteration on Virtual Review Panel based on CSO feedback and new architecture for literature-grounded reviews.

- **Prompt rebalancing**: Rewrote all prompts to balance critique with upside evaluation per Keck's risk-tolerant philosophy. Added rating calibration (use full range), proposal classifier (5 types), `keyUncertaintyResolution` field. Renamed `keyWeaknesses` → `keyConcerns`, added `keyStrengths` and `resolvableVsFundamental` to synthesis.
- **Stage 0 pre-review intelligence**: Optional pipeline — Haiku extracts search queries → parallel searches across PubMed/arXiv/bioRxiv/ChemRxiv/Google Scholar → Haiku collates → Perplexity synthesizes field landscape. Intelligence block injected into Stage 1/2 prompts. Gracefully degradable at each substage.
- **New service**: `LiteratureSearchService` wrapping existing academic database services with deduplication and normalization.
- **Bug fixes**: OpenAI silent timeouts (3-min Promise.race), event log disappearing after completion, JSON parse failures silently passing null, `resolvableVsFundamental` objects crashing React render.
- **Frontend**: Stage 0 toggle, intelligence progress display, all new/renamed fields in UI + Markdown + DOCX exports.

**Files:** `lib/services/literature-search-service.js` (new), `lib/services/panel-review-service.js`, `lib/services/multi-llm-service.js`, `shared/config/prompts/virtual-review-panel.js`, `pages/virtual-review-panel.js`, `pages/api/virtual-review-panel.js`

---

## March 2026 — Feedback Logging, Query Fixes, Request Number Backfill (Session 85)

Built a feedback logging system for Dynamics Explorer (thumbs up/down + auto-detection of failures), fixed export_csv and status field query failures, and backfilled Dynamics request numbers into the Postgres database.

- **Feedback system**: `dynamics_feedback` table, `FeedbackService`, `POST/GET/PATCH /api/dynamics-explorer/feedback`, thumbs up/down UI on chat messages, admin review section on dashboard, auto-detection of failure patterns, maintenance cleanup
- **Query fixes**: EXPORT rule (reuse prior query params), error passthrough to Claude (actual error instead of generic), STATUS FIELD DISAMBIGUATION (Phase II Pending → akoya_requeststatus not wmkf_phaseiistatus)
- **Request numbers**: V23a migration adds `request_number` column to `reviewer_suggestions` and `proposal_searches`. Backfill script matched 23 proposals (332 candidate rows) to Dynamics request numbers. Numbers now visible in Reviewer Finder My Candidates and Review Manager table.

**Files:** `lib/services/feedback-service.js`, `pages/api/dynamics-explorer/feedback.js`, `pages/api/dynamics-explorer/chat.js`, `shared/config/prompts/dynamics-explorer.js`, `scripts/backfill-request-numbers.js`, `pages/reviewer-finder.js`, `pages/review-manager.js`

---

## March 2026 — SharePoint Document Content Search (Session 83)

Added `search_documents` tool to Dynamics Explorer (10th tool). Full-text search within SharePoint document contents (PDFs, Word docs, etc.) via Microsoft Graph Search API with KQL.

- **GraphService.searchFiles()**: `POST /search/query` with KQL path scoping to akoyaGO site. Requires `region: 'US'` for app permissions. Post-filters to ALLOWED_LIBRARIES. Returns hit highlights with matching text snippets.
- **search_documents handler**: Resolves request_number to folder path via sharepointdocumentlocations. Sends `document_links` SSE events for download links.
- **download-document.js**: Authenticated proxy for streaming SharePoint files to browser (committed from prior session).
- **DocumentLinks component**: Frontend component rendering download links from SSE events (committed from prior session).

**Files:** `lib/services/graph-service.js`, `pages/api/dynamics-explorer/chat.js`, `pages/api/dynamics-explorer/download-document.js`, `pages/dynamics-explorer.js`, `shared/config/prompts/dynamics-explorer.js`

---

## March 2026 — Close Profile Directory Enumeration & Security Audit Docs (Session 82)

Closed the profile directory enumeration vulnerability using a multi-tool audit process (Gemini, Codex, Claude Code, human review). Produced comprehensive hardening summary for IT.

- **Profile endpoint scoping**: `GET /api/user-profiles` returns only caller's own profile by default. Full directory via `?all=true` (superuser only). Cross-user `?id=X` lookups return 403. All methods use `requireAuthWithProfile`. Dev mode falls back to all profiles for compatibility.
- **Admin dashboard**: Role management fetch updated to `?all=true`.
- **Security hardening summary**: `docs/SECURITY_HARDENING_SUMMARY_2026-03-10.md` — covers all code changes, audit process, remaining organizational decisions, and three-track path forward for IT.
- **Security audit docs committed**: 12 previously untracked audit/response documents now in git for multi-Mac migration.

**Files:** `pages/api/user-profiles.js`, `pages/admin.js`, `docs/SECURITY_HARDENING_SUMMARY_2026-03-10.md`, `docs/SECURITY_AUDIT_RESPONSE_GEMINI.md`, `docs/SECURITY_AUDIT_RESPONSE_CODEX.md`

---

## March 2026 — Q&A Prompt Caching & Output Fixes (Session 73)

Implemented prompt caching, fixed truncated writeups, and improved Q&A UX.

- **Prompt caching**: System prompt in `/api/qa` now uses `cache_control: { type: 'ephemeral' }` so the large proposal context (~20K tokens) is cached across turns. Cache token metrics extracted from streaming response and logged to `api_usage_log` with correct pricing (1.25x write, 0.1x read). V21 migration adds `cache_creation_tokens` and `cache_read_tokens` columns.
- **Fixed truncated writeups**: `DEFAULT_MAX_TOKENS` was 2000, far too low for the two-part writeup format. Increased to 16384 (model output limit). Affects all summarization endpoints.
- **Q&A markdown rendering**: Added `renderMarkdown()` with DOMPurify sanitization for assistant responses (headers, bold, italic, lists, code, horizontal rules). User messages remain plain text.
- **Q&A conversation persistence**: Closing and reopening the side panel for the same file preserves the conversation. Only resets when switching files.
- **Admin stats**: Summary query now includes `total_cache_creation_tokens` and `total_cache_read_tokens` for monitoring cache effectiveness.

**Files:** `pages/api/qa.js`, `lib/utils/usage-logger.js`, `scripts/setup-database.js`, `pages/api/admin/stats.js`, `pages/proposal-summarizer.js`, `shared/config/baseConfig.js`

---

## March 2026 — Streaming Q&A Chat with Web Search (Session 72)

Upgraded the Proposal Summarizer Q&A from isolated single-question requests to a full streaming multi-turn chat with web search and a side panel UI.

- **Streaming Q&A endpoint**: Rewrote `/api/qa` as SSE streaming endpoint. Full conversation history, system prompt with proposal text (80K chars) + summary, conversation trimming (last 6 messages), 4096 max_tokens, retry on 429.
- **Web search with dynamic filtering**: `web_search_20260209` tool with code_execution auto-injected for dynamic result filtering. Source URLs extracted from streaming blocks and rendered as clickable citation links. Note: `web_search_20260209` auto-injects code_execution — do NOT add it explicitly or you get a 400 error.
- **Side panel UI**: Replaced centered modal with a 520px right-side slide-in panel. Writeup content stays visible underneath. Streaming text with pulsing cursor, dynamic thinking indicators, auto-scroll, AbortController for cancellation.
- **Prompt improvements**: Removed all em dashes from prompt templates to reduce Claude's em dash usage in output. Existing "minimize em dashes" instruction kept; the fix was removing the examples Claude was mirroring.
- **Extraction fixes**: Strip markdown code fences before JSON.parse (most common cause of fallback triggering). Expanded fallback keyword stop list from 12 to ~80 words. State postal abbreviations in city_state field. Extracted Data section collapsed by default.

**Files:** `pages/api/qa.js`, `pages/api/process.js`, `pages/proposal-summarizer.js`, `shared/config/prompts/proposal-summarizer.js`, `shared/components/ResultsDisplay.js`, `tailwind.config.js`

---

## March 2026 — OWASP ZAP Security Scan & Remediation (Session 71)

Performed an OWASP ZAP automated security scan (v2.17.0) against the application in development mode. The scan identified 17 unique alert types across 6 Medium, 4 Low, and 7 Informational findings. No High-risk vulnerabilities were found.

- **X-Powered-By header suppressed**: Added `poweredByHeader: false` to `next.config.js` to prevent `X-Powered-By: Next.js` information disclosure. This was the only actionable finding.
- **CSP warnings (5 Medium)**: All are development-mode artifacts — `unsafe-inline` and `unsafe-eval` required by Next.js HMR/Fast Refresh. Production deployments on Vercel use stricter nonce-based policies automatically.
- **Directory browsing (1 Medium, false positive)**: ZAP flagged `/_next/static/` directory structure, which is standard Next.js public asset serving.
- **HSTS missing (false positive)**: HSTS is configured; alert triggered because ZAP scanned `http://localhost` which doesn't support HTTPS.
- **X-Content-Type-Options missing (9 Low instances)**: Already configured in `next.config.js`; development-mode static assets may not receive the header. Vercel adds it automatically in production.
- **Informational findings (68 suspicious comments, timestamps, etc.)**: Normal development artifacts, no action required.

**Scan metadata:** OWASP ZAP 2.17.0, target `http://localhost:3000`, automated quick start scan, March 2, 2026.

**Files:** `next.config.js`, `docs/SECURITY_ARCHITECTURE.md`

---

## March 2026 — Word Template Export & Silent Truncation Fix (Session 70)

Implemented Phase II Word template export for Proposal Summarizer and fixed a critical silent text truncation bug affecting all PDF-processing apps.

- **Word template export**: `shared/utils/word-export.js` generates .docx files matching the Keck Phase II writeup template (Times New Roman, correct margins/tabs/spacing, page headers with PI/institution/title, page numbers). Export modal in `pages/proposal-summarizer.js` with editable AI-extracted fields and internal fields (Program Type, amounts, Staff Lead). Added Word button to `ResultsDisplay.js`.
- **Prompt restructure**: Two-part output — Part 1 (grade 13 audience summary page with Executive Summary, Impact, Methodology Overview, Personnel Overview, Rationale for Keck Funding) and Part 2 (technical detailed writeup with Background & Impact, Methodology, Personnel). `parseSections()` splits markdown into named sections for Word generation.
- **Silent truncation fix**: All prompt templates were truncating PDF text to 6K-15K characters, silently dropping personnel sections, budgets, and methodology details that appear later in proposals. Increased all limits to 100K characters across 6 prompt files, Q&A endpoint, and common.js TEXT_LIMITS. Affected: Proposal Summarizer, Phase I Summaries, Phase I Writeup, Reviewer Finder, Funding Gap Analyzer, Q&A.
- **PI name cross-reference**: `crossReferenceWithSummary()` in `process.js` extracts `<u>`-tagged names from the summary to fix incorrect PI names in structured extraction.
- **User-friendly API errors**: `getApiErrorMessage()` translates HTTP status codes (429 rate limit, 529/503 overloaded, 401 auth, 400 context length) into clear user-facing messages instead of generic "Failed to generate summary."
- **Legacy fallback**: Current implementation preserved as `proposal-summarizer-legacy.js`, `process-legacy.js`, and legacy prompts file.

**Files:** `shared/utils/word-export.js` (new), `shared/config/prompts/proposal-summarizer.js`, `pages/proposal-summarizer.js`, `pages/api/process.js`, `shared/components/ResultsDisplay.js`, `shared/config/prompts/common.js`, 5 other prompt files, `pages/api/qa.js`

---

## February 2026 — ErrorAlert, Crawler Prevention, Analytics & Dependency Cleanup (Session 69)

Security hardening and infrastructure cleanup session.

- **Shared ErrorAlert component**: `shared/components/ErrorAlert.js` — pattern-matches errors into 12 categories with user-friendly messages, timestamps, reference codes, and collapsible raw details. Validation messages get amber styling. Replaced 11 identical inline error blocks across all app pages.
- **Bot/crawler prevention**: `public/robots.txt` (disallow all), `X-Robots-Tag` header (noindex/nofollow/noarchive), `<meta name="robots">` tag in `_app.js`.
- **Vercel Web Analytics**: Added `@vercel/analytics` package and `<Analytics />` component, CSP updated for `vercel-insights.com`.
- **Dependency cleanup**: Removed unused `eslint`/`eslint-config-next` (resolved all 3 npm audit vulnerabilities), removed deprecated `swcMinify` config, committed missing `dompurify` dependency.
- **Dependabot**: `.github/dependabot.yml` for weekly npm dependency checks.
- **IT security response**: Drafted architecture documentation for IT review of Dynamics Explorer data flow.

**Files:** `shared/components/ErrorAlert.js`, `public/robots.txt`, `next.config.js`, `pages/_app.js`, `.github/dependabot.yml`, `package.json`, 11 app pages

---

## February 2026 — Security Remediation & Cron Fix (Session 67)

Implemented 4 security findings from SECURITY_ARCHITECTURE.md and fixed a production bug where all Vercel cron jobs were silently failing.

- **CSRF origin validation**: `validateOrigin()` in `lib/utils/auth.js` — checks `Origin`/`Referer` against `NEXTAUTH_URL` for state-changing methods. Called in `requireAuth()` and `requireAppAccess()`.
- **Session revocation**: `is_active` check added to `requireAppAccess()` (parallel query, cached) and `requireAuthWithProfile()` (direct query). Disabled accounts blocked before superuser bypass.
- **Dynamics denial logging**: V20 migration adds `was_denied`/`denial_reason` to `dynamics_query_log`. Restriction violations now persisted to audit table.
- **Orphan record cleanup**: `scripts/assign-orphan-records.js` for legacy NULL `user_profile_id` rows.
- **Cron middleware fix**: Edge middleware was intercepting `/api/cron/*` requests (JWT check on CRON_SECRET-authenticated requests). Added `api/cron` to matcher exclusions. All 4 crons were silently failing in production.
- **SECURITY_ARCHITECTURE.md v3.2**: Fixed maxAge (30d→7d), added M8/M9 as REMEDIATED, updated L8/L9 to REMEDIATED, documented cron exclusion.

**Files:** `lib/utils/auth.js`, `middleware.js`, `pages/api/dynamics-explorer/chat.js`, `scripts/setup-database.js`, `scripts/assign-orphan-records.js`, `scripts/README.md`, `docs/SECURITY_ARCHITECTURE.md`

---

## February 2026 — Error Message Hardening & Security Doc Regeneration (Session 64)

Fixed internal error message leakage and regenerated the security architecture document.

- **Error message leakage fix**: Patched ~19 unguarded catch blocks across 8 API files that returned `error.message` directly to clients. Inner helpers now return generic messages; health endpoint errors guarded with `NODE_ENV === 'development'`. Full errors preserved in server-side `console.error()` logs.
- **Security Architecture v3.0**: Complete rewrite of `docs/SECURITY_ARCHITECTURE.md` to match current codebase — 14 apps, three-layer auth model, 18 database tables, app-level access control, corrected CSP/headers, renumbered findings.

**Files:** `pages/api/evaluate-concepts.js`, `pages/api/evaluate-multi-perspective.js`, `pages/api/dynamics-explorer/chat.js`, `pages/api/reviewer-finder/generate-emails.js`, `pages/api/process.js`, `pages/api/process-phase-i.js`, `pages/api/process-phase-i-writeup.js`, `pages/api/health.js`, `docs/SECURITY_ARCHITECTURE.md`

---

## February 2026 — API-Level App Access Enforcement (Session 63)

Added server-side enforcement of app access control to all ~30 app-specific API endpoints. Previously, access control was UI-only — `RequireAppAccess` blocked page navigation and `Layout.js` hid nav links, but API endpoints had no checks. Any authenticated user could call any API directly.

- **`requireAppAccess(req, res, ...appKeys)`** in `lib/utils/auth.js`: Combines auth check + app access verification in one call. Variadic app keys with OR logic, in-memory cache (2-min TTL), parallel DB queries, superuser bypass, dev-mode bypass. Returns `{ profileId, session }` or sends 401/403.
- **Cache invalidation**: `clearAppAccessCache(profileId)` called in `pages/api/app-access.js` after admin grant/revoke operations.
- **29 endpoint updates**: All app-specific endpoints now call `requireAppAccess` with the correct app key(s). Multi-key endpoints (`process.js`, `qa.js`, `refine.js`) accept either `proposal-summarizer` or `batch-proposal-summaries`. Infrastructure endpoints (auth, admin, health, upload) unchanged.

**Files:** `lib/utils/auth.js`, `pages/api/app-access.js`, plus 29 app-specific API endpoint files.

---

## February 2026 — Auth Hardening & Security Audit (Session 62)

Comprehensive security hardening in response to IT security review. Added server-side authentication gate, removed attack surface, and fixed critical authorization vulnerabilities.

- **Next.js middleware auth gate** (`middleware.js`): Validates JWT via `withAuth`/`jose` (Edge Runtime compatible) before serving any page content or JS bundles. Unauthenticated users redirected to `/auth/signin` with no app structure exposed.
- **CORS wildcard removal**: Removed `Access-Control-Allow-Origin: *` from `next.config.js` global headers and 10 inline SSE streaming endpoints. Prevents cross-site request forgery against authenticated sessions.
- **Security headers**: Added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` to all responses.
- **AppAccessContext deny-by-default**: `hasAccess()` returns `false` while loading (was `true`); errors set `allowedApps` to `[]` instead of falling through to allow-all.
- **Stripped debug info**: `/api/auth/status` now returns only `{ enabled }` — removed `debug: { authRequired, hasCredentials }`.
- **Fixed horizontal privilege escalation** in 4 endpoints: `user-preferences`, `user-profiles`, `my-candidates`, `integrity-screener/history` — all now derive `profileId` from the authenticated session instead of trusting user-supplied parameters.
- **Adversarial security audit**: Systematic review of middleware bypass vectors, SSRF, SQL injection, CORS, authorization, dependencies, cryptography. No critical issues remaining after fixes.

**Files:** `middleware.js`, `next.config.js`, `pages/api/auth/status.js`, `shared/context/AppAccessContext.js`, `pages/api/user-preferences.js`, `pages/api/user-profiles.js`, `pages/api/reviewer-finder/my-candidates.js`, `pages/api/integrity-screener/history.js`, plus CORS removal in 10 SSE streaming endpoints.

---

## February 2026 — Documentation & User Guide (Session 61)

Created comprehensive user-facing documentation and an in-app `/guide` page.

- **6 standalone Markdown guides** in `docs/guides/`: Getting Started, Reviewer Finder, Review Manager, Integrity Screener, Dynamics Explorer, Admin Guide
- **In-app guide page** (`pages/guide.js`): sidebar TOC on desktop, floating button on mobile, hash-based anchor navigation, access-filtered sections, admin-only section for superusers
- **HelpButton component**: `?` icon added to 4 complex app page headers, links to `/guide#appKey`
- **Navigation integration**: Guide link in nav ribbon, Layout footer, home page header/footer, WelcomeModal

**Files:** `docs/guides/*.md`, `pages/guide.js`, `shared/config/guideContent.js`, `shared/components/HelpButton.js`, `shared/components/Layout.js`, `pages/index.js`, `shared/components/WelcomeModal.js`

---

## February 2026 — Round-Efficiency Optimizations & Test Suite (Session 56)

Optimized Dynamics Explorer to resolve common queries in fewer tool-call rounds and built an integration test suite to verify.

- **Vocabulary glossary**: System prompt now maps common terms (PI, award amount, Phase I status) to correct CRM fields, reducing exploratory tool calls
- **Hardcoded program GUIDs**: MR, S&E, SoCal, NorCal GUIDs embedded in system prompt — model filters directly without querying lookup tables
- **Expanded get_entity select**: Request lookups now return `_wmkf_projectleader_value`, `akoya_grant`, `wmkf_phaseistatus`, and 20+ other fields in one call
- **Inline wmkf_grantprogram schema**: Added to TABLE_ANNOTATIONS to eliminate `describe_table` calls for program lookups
- **Round-efficiency test suite**: `scripts/test-dynamics-rounds.js` — 6 integration tests against live dev server, SSE stream parsing, pass/fail per query with round counts. All 6 passed (most in 2 rounds, max budget 3)

**Files:** `shared/config/prompts/dynamics-explorer.js`, `scripts/test-dynamics-rounds.js`

---

## February 2026 — AI-Powered Exports & Staff Lookups (Session 55)

Added Excel export with AI-powered data processing and fixed program director lookup accuracy in Dynamics Explorer.

- **Excel export**: `export_csv` tool generates .xlsx files from CRM queries with auto-width columns, delivered via `file_ready` SSE event
- **AI data processing**: Two-phase flow — estimate mode (count + sample + cost) → user confirmation → batch execution (15 records/call, 3 concurrent). AI results added as `ai_*` columns (displayed as "AI: ColumnName" in Excel)
- **countRecords fix**: `/$count` endpoint fails with complex OData filters (Edm.Int32 error). Replaced with `queryRecords` using `$count=true` parameter
- **systemuser entity**: Added to TABLE_ANNOTATIONS with staff lookup support. Model now correctly queries `systemusers` for GUIDs before filtering `akoya_requests` by `_wmkf_programdirector_value`, fixing incorrect program director exports

**Files:** `pages/api/dynamics-explorer/chat.js`, `shared/config/prompts/dynamics-explorer.js`, `pages/dynamics-explorer.js`, `lib/utils/usage-logger.js`

---

## February 2026 — Dynamics Explorer Performance Optimization (Session 54)

Optimized the Dynamics Explorer chat interface for speed and diagnosed a query accuracy bug.

- **Inline schemas**: Top 4 table schemas (akoya_request, account, contact, akoya_requestpayment) embedded in system prompt, eliminating 1 Claude API round-trip for ~80% of queries
- **Parallel execution**: DB queries via `Promise.all()`, multiple tool_use blocks via `Promise.allSettled()`
- **Streaming**: Claude API uses `stream: true`; final text responses forwarded as `text_delta` SSE events for near-zero perceived latency
- **Frontend memoization**: `React.memo` on MessageBubble, `useMemo`/`useCallback` for expensive operations, stable message keys
- **Bug diagnosed**: Model confuses two program lookup fields (`wmkf_grantprogram` with 11 values vs `akoya_program` with 24 values), causing wrong query results. Needs CRM expert input to clarify field semantics before annotation fix.

**Files:** `shared/config/prompts/dynamics-explorer.js`, `pages/api/dynamics-explorer/chat.js`, `pages/dynamics-explorer.js`

---

## February 2026 — App-Level Access Control (Session 53)

Implemented per-user app access control across all 13 apps. New users only get Dynamics Explorer by default with a welcome modal; superusers manage grants from the admin dashboard.

- **V16 migration**: `user_app_access` table with `(user_profile_id, app_key)` unique constraint
- **App registry**: `shared/config/appRegistry.js` — single source of truth for all app definitions (replaced duplicate arrays in Layout.js and index.js)
- **Access flow**: `AppAccessContext` fetches grants → Layout/home page filter by `hasAccess()` → `RequireAppAccess` guard blocks direct URL access
- **New user onboarding**: NextAuth auto-grants `dynamics-explorer`, `WelcomeModal` directs to email admin for more access
- **Admin UI**: Checkbox grid (users x apps) with local edit tracking, amber highlights, save/discard
- **Backfill**: All 7 existing users granted all 13 apps (91 grants)
- **Deferred**: Automated email notifications for new users (requires Azure Mail.Send permission)

**Files:** `shared/config/appRegistry.js`, `shared/context/AppAccessContext.js`, `shared/components/RequireAppAccess.js`, `shared/components/WelcomeModal.js`, `pages/api/app-access.js`, `pages/admin.js`, `pages/api/auth/[...nextauth].js`, all 13 app pages

---

## February 2026 — Dynamics Explorer Architecture Redesign (Sessions 51-52)

Redesigned the Dynamics Explorer from an OData-centric architecture (9 tools, ~3000 token system prompt) to a search-first architecture (7 tools, ~800 token prompt). Key changes:

- **New tool set**: `search`, `get_entity`, `get_related`, `describe_table`, `query_records`, `count_records`, `find_reports_due`. Removed 5 old tools, added 3 new ones.
- **`get_entity`**: Finds accounts by name, abbreviation, or Dataverse Search (handles "Stanford", "UCLA", "USC" → correct institutions). Runs OData + Search in parallel with exact-match tiebreaker.
- **`get_related`**: 11 server-side relationship paths replacing individual composite tools. Handles account→requests/emails/payments/reports, request→payments/reports/emails/annotations/reviewers, contact→requests, reviewer→requests.
- **`describe_table`**: On-demand field metadata from `TABLE_ANNOTATIONS` (17 tables). Replaces hardcoded schema in system prompt.
- **Account name resolution**: Triple-field search (name + akoya_aka + wmkf_dc_aka), Dataverse Search fallback for abbreviations, ambiguity handling when multiple accounts match.

**Files:** `pages/api/dynamics-explorer/chat.js`, `shared/config/prompts/dynamics-explorer.js`, `lib/services/dynamics-service.js`

---

## February 2026 — Dynamics Explorer (Sessions 47-48)

Built a natural-language chatbot for querying the Keck Foundation's Microsoft Dynamics 365 CRM. Uses an agentic tool-use loop: user asks a question → Claude picks tools (query_records, find_emails_for_account, etc.) → server executes against the Dynamics API → results fed back → Claude responds or calls more tools.

**Key architecture decisions:**
- Server-side composite tools for complex multi-step queries (email lookups across account → requests → emails) rather than relying on Claude to chain OData queries
- Hardcoded schema of populated fields in the system prompt (from `scripts/dynamics-schema-map.js` introspection)
- Haiku 4.5 model for higher rate limits (Sonnet 4 hit 30k token/min limit, Haiku 3.5 couldn't handle tool-use)
- Token optimization: conversation compaction between agentic rounds, compact text results instead of raw JSON, HTML stripping for email bodies

**Files:** `pages/dynamics-explorer.js`, `pages/api/dynamics-explorer/chat.js`, `lib/services/dynamics-service.js`, `shared/config/prompts/dynamics-explorer.js`

---

# Legacy chronological session log (deprecated format)

Everything below is the former chronological session archive: the original log through Session 84, followed by three later append-at-tail entries (Sessions 137, 139, and 149). It is not a complete record of Sessions 85–149. The entries are preserved for archaeology. **Do not add new entries below this point** — milestones go above.

---

## September 2025 - Frontend-Backend Data Structure Consistency Audit

**Problem Identified:**
After implementing Vercel Blob storage, the backend was processing files correctly but the frontend wasn't displaying results. Through systematic debugging, identified a critical data structure mismatch between frontend and backend components.

**Root Cause:**
The backend APIs were returning `{formatted, structured}` but various frontend components expected different property names like `{summary, structuredData}`. This inconsistency prevented results from displaying despite successful processing.

**Comprehensive Solution:**
Conducted a systematic audit of all applications to ensure frontend-backend consistency:

### Files Audited and Fixed:

1. **find-reviewers.js** (`pages/find-reviewers.js:118`)
   - **Issue**: Used `structuredData:` instead of `structured:`
   - **Fix**: `structuredData: data.extractedInfo || {}` → `structured: data.extractedInfo || {}`

2. **peer-review-summarizer.js** (`pages/peer-review-summarizer.js`)
   - **Issues**: Multiple references to old data structure properties
   - **Fixes Applied**:
     - Line 116: `results.summary` → `results.formatted`
     - Line 119: `results.questions` → `results.structured?.questions`
     - Line 258: `results.summary` → `results.formatted`
     - Line 264: `results.questions` → `results.structured?.questions`
     - Line 270: `results.questions` → `results.structured.questions`

3. **document-analyzer.js** (`pages/document-analyzer.js`)
   - **Issue**: Refinement state update using wrong property
   - **Fix**: `summary: data.refinedSummary` → `formatted: data.refinedSummary`

4. **batch-proposal-summaries.js** (`pages/batch-proposal-summaries.js`)
   - **Issues**: Multiple summary property references
   - **Fixes**: All `result.summary` references → `result.formatted`

5. **shared/components/ResultsDisplay.js**
   - **Issues**: Inconsistent property names throughout shared component
   - **Fixes**: Standardized all references:
     - `result.summary` → `result.formatted`
     - `result.structuredData` → `result.structured`

6. **proposal-summarizer.js** (`pages/proposal-summarizer.js`)
   - **Issues**: Q&A and refinement context using wrong properties
   - **Fixes**: Updated context references to use `result.formatted`

### API Endpoints Verified:

- **`/api/process`**: Returns `{formatted, structured}` ✅
- **`/api/find-reviewers`**: Returns `{extractedInfo, reviewers, csvData, parsedReviewers, metadata}` ✅
- **`/api/refine`**: Returns `{refinedSummary, timestamp}` ✅
- **`/api/qa`**: Returns `{answer, timestamp}` ✅

### Standardized Data Structure:

All applications now use consistent data structure pattern:
- **`result.formatted`** - Main content/summary text
- **`result.structured`** - Extracted structured data objects
- **`result.metadata`** - File processing metadata
- **`result.csvData`** - CSV export data (reviewers app only)

### Commits Made:

1. **Commit a9ca806**: "Fix frontend-backend data structure consistency across all applications"
   - 6 files changed, 45 insertions(+), 27 deletions(-)
   - Core data structure consistency fixes

2. **Commit 5cb022d**: "Improve Vercel Blob upload handling and streaming response reliability"
   - 3 files changed, 20 insertions(+), 2 deletions(-)
   - Enhanced CORS headers, upload logging, and streaming improvements

**Result:**
Frontend-backend communication is now seamless across all applications. Each app correctly expects and receives the data structure that its corresponding API endpoint provides. The issue was systemic but localized to property naming conventions, not the underlying data flow architecture.

**Testing Required:**
All applications should now display results correctly after file processing. The data flow pattern is: File Upload → Vercel Blob Storage → Claude API Processing → Standardized Data Structure → ResultsDisplay Component.

---

## September 21, 2025 - Dropdown Parameter Integration

**Problem Identified:**
The batch-proposal-summaries app had dropdown menus for Summary Length (1-5 pages) and Technical Level (general-audience to academic), but these values were being sent to the API and completely ignored. The Claude prompts were static and didn't use the user's configuration choices.

**Root Cause:**
The API endpoint `/pages/api/process.js` was only extracting `files` and `apiKey` from the request body, ignoring `summaryLength` and `summaryLevel`. The `PROMPTS.SUMMARIZATION` function was static and didn't accept parameters.

**Solution Implemented:**
1. **API Parameter Extraction** (`pages/api/process.js:11`):
   - Added extraction: `const { files, apiKey, summaryLength = 2, summaryLevel = 'technical-non-expert' } = req.body;`
   - Added debugging logs to track parameter values
   - Updated `generateSummary()` function call to pass parameters

2. **Function Signature Update** (`pages/api/process.js:96`):
   - Modified `generateSummary(text, filename, apiKey, summaryLength, summaryLevel)`
   - Updated prompt generation to use dynamic parameters

3. **Enhanced Claude Prompt** (`lib/config.js:24`):
   - Converted `PROMPTS.SUMMARIZATION` to accept `(text, summaryLength, summaryLevel)` parameters
   - Added length requirements: 1-5 pages, ~500 words per page
   - Added audience-specific language instructions:
     - **General Audience**: Avoids technical jargon, explains concepts accessibly
     - **Technical Non-Expert**: Uses some technical terms with clear explanations
     - **Technical Expert**: Uses field-specific terminology, assumes domain knowledge
     - **Academic**: Uses precise scientific language and detailed methodology

**Result:**
Dropdown selections now properly customize Claude's responses. Users can select summary length and technical level, and Claude will generate summaries according to those specifications.

**Data Flow (Fixed):**
Frontend Dropdowns → POST Request Body → API Parameter Extraction → generateSummary() → Dynamic Claude Prompt → Customized Summary

### Commit Made:
- **Commit e029e0c**: "Implement dropdown parameter integration for batch proposal summaries"
  - 2 files changed, 23 insertions(+), 6 deletions(-)
  - Fixed missing functionality where dropdown selections were ignored

---

## November 7, 2025 - Federal Funding Gap Analyzer

**Feature Implemented:**
A comprehensive federal funding analysis tool that queries the NSF API for real-time award data and uses Claude to analyze the broader federal funding landscape (NIH, DOE, DOD).

**Implementation Details:**

**Files Created:**
1. `lib/fundingApis.js` - NSF API query utilities
   - `queryNSFforPI()` - Queries PI and Co-PI awards with state filtering
   - `queryNSFforKeywords()` - Analyzes funding by research keywords
   - Helper functions for formatting and date handling

2. `pages/api/analyze-funding-gap.js` - Main API endpoint (Pattern B with shared handlers)
   - Multi-step processing pipeline per proposal
   - Streaming SSE responses for real-time progress
   - Token optimization to stay under Claude's 200K limit
   - Individual report generation (no batch summary)

3. `pages/funding-gap-analyzer.js` - Frontend page
   - Configuration options: Search years (3/5/10), Include Co-PIs checkbox
   - Collapsible cards for each proposal (Option B)
   - Individual download buttons with naming pattern
   - ZIP download for all reports (using JSZip)

**Files Modified:**
4. `lib/config.js` - Added 3 new prompts:
   - `FUNDING_EXTRACTION` - Extracts PI, institution, state, and keywords
   - `FUNDING_ANALYSIS` - Generates comprehensive funding analysis
   - `BATCH_FUNDING_SUMMARY` - (Created but not used in final implementation)

5. `shared/components/Layout.js` - Added navigation link

**Key Technical Decisions:**

1. **State-Based Institution Matching:**
   - Changed from institution name matching to state code filtering
   - More reliable for NSF API queries
   - Claude infers state from institution (e.g., "UC Berkeley" → "CA")

2. **Search ALL NSF Awards (Not Just Active):**
   - Provides complete funding history
   - Shows active vs. expired awards in analysis

3. **Co-PI Search (Enabled by Default):**
   - Queries both `pdPIName` and `coPDPIName` parameters
   - Deduplicates awards to avoid double-counting
   - Provides comprehensive view of researcher's NSF involvement

4. **Token Optimization:**
   - Extraction: Limited to 6,000 characters (first few pages only)
   - NSF data: Truncated to 10 PI awards + 5 per keyword
   - Prevents Claude API "prompt too long" errors

5. **Smart Fallback:**
   - First tries full PI name
   - Automatically falls back to last name if no results

6. **Individual Report Mode:**
   - Each proposal generates standalone markdown report
   - Filename pattern: `funding_analysis_[PI_name]_[original_filename]_[date].md`
   - No combined batch report (cleaner for sharing)

**Data Flow:**
```
User uploads PDFs → Vercel Blob → Extract text → Claude (PI/state/keywords) →
NSF API (real awards data) → Claude (NIH/DOE/DOD analysis) →
Individual markdown reports → Collapsible cards + ZIP download
```

**UI/UX Features:**
- Collapsible proposal cards (collapsed by default)
- Quick summary: PI, Institution, State, NSF funding, Keywords
- "View Full Report" button to expand
- Individual "Download" buttons per proposal
- "Download All as ZIP" button at top
- Summary stats card (proposals analyzed, years searched, reports generated)

**Dependencies Added:**
- `jszip@3.10.1` - For ZIP file creation client-side

**Result:**
Fully functional federal funding gap analyzer with NSF integration. Successfully tested with multiple UC proposals. State-based filtering significantly improved NSF award matching accuracy.

**Testing Notes:**
- Single proposal: ~1-2 minutes processing time
- Batch (3 proposals): ~5-7 minutes total
- NSF API rate limiting: 200ms delay between keyword queries
- Token limits: Resolved through data truncation strategy

---

## December 10, 2025 - Expert Reviewers Pro (Beta)

**Feature Implemented:**
A multi-source academic database search tool that finds expert reviewers by querying PubMed, ArXiv, BioRxiv, and Google Scholar.

**Architecture Overview:**

```
Proposal PDF → Vercel Blob → Claude (metadata extraction) →
Multi-source search (PubMed, ArXiv, BioRxiv, Scholar) →
Deduplication → COI filtering → Relevance ranking →
Reviewer candidates with h-index and publications
```

**Files Created:**

1. **Database Schema & Migration:**
   - `lib/db/schema.sql` - 5 tables: search_cache, researchers, publications, researcher_keywords, reviewer_suggestions
   - `scripts/setup-database.js` - Migration script for Vercel Postgres

2. **Service Classes:**
   - `lib/services/database-service.js` - Caching, researcher CRUD, suggestion tracking
   - `lib/services/pubmed-service.js` - NCBI E-utilities API integration
   - `lib/services/arxiv-service.js` - ArXiv Atom feed API
   - `lib/services/biorxiv-service.js` - BioRxiv API with client-side filtering
   - `lib/services/scholar-service.js` - Google Scholar via SerpAPI
   - `lib/services/deduplication-service.js` - Name matching, COI filtering, ranking

3. **API & Frontend:**
   - `pages/api/search-reviewers-pro.js` - Orchestration endpoint (streaming)
   - `pages/find-reviewers-pro.js` - Frontend with source selection and results

**Key Technical Decisions:**

1. **Reuses Existing Code:**
   - File upload via `FileUploaderSimple`
   - Metadata extraction via `createExtractionPrompt()` from find-reviewers
   - Replaces Step 2 (Claude reviewer suggestions) with real database searches

2. **Intelligent Caching:**
   - 6-month cache expiry for search results
   - 3-month cache for individual profiles
   - Stored in Vercel Postgres

3. **Name Deduplication:**
   - Uses `string-similarity` package
   - Matches "J. Smith" with "John Smith"
   - Checks initials and partial first names

4. **Conflict of Interest Filtering:**
   - Excludes researchers from author's institution
   - Institution name normalization for accurate matching

5. **Relevance Ranking (100 points max):**
   - h-index: 0-40 points
   - Citations: 0-20 points (log scale)
   - Multiple sources: 0-15 points
   - Keyword matches: 0-25 points

**New Dependencies Required:**
```bash
npm install @vercel/postgres xml2js serpapi string-similarity
```

**Environment Variables Required:**
- `SERP_API_KEY` - For Google Scholar searches (paid service)
- `NCBI_API_KEY` - Optional, increases PubMed rate limits
- `POSTGRES_URL` - Auto-set by Vercel Postgres

**Setup Instructions:**

1. Create Vercel Postgres database in Vercel Dashboard
2. Run: `vercel env pull .env.local`
3. Run: `node scripts/setup-database.js`
4. Add `SERP_API_KEY` to environment variables

**Result:**
Fully implemented multi-source reviewer finder. Searches real academic databases, deduplicates results, filters conflicts, and ranks by relevance with h-index and citation counts.

---

## December 11, 2025 - Expert Reviewers Pro Improvements

**Issues Fixed:**

1. **PubMed Rate Limiting:**
   - Changed enrichment from `Promise.all()` (parallel) to sequential processing
   - Added 400ms delay between PubMed API calls
   - Prevents "API rate limit exceeded" errors
   - File: `pages/api/search-reviewers-pro.js:469-563`

2. **Publication URL Links:**
   - Added clickable URLs to all publications:
     - PubMed: `https://pubmed.ncbi.nlm.nih.gov/{pmid}`
     - ArXiv: `https://arxiv.org/abs/{arxivId}`
     - BioRxiv: `https://doi.org/${doi}`
   - Fixed operator precedence bug in URL generation
   - Updated on-screen display with blue clickable links
   - Updated markdown export with `[Title](URL)` format
   - Files: `pages/api/search-reviewers-pro.js`, `pages/find-reviewers-pro.js:606-614`

3. **Quality Filter for Results:**
   - Added filter requiring candidates to have BOTH:
     - Recent publications (within last 10 years)
     - Institutional affiliation
   - Removes incomplete/useless candidates from results
   - Stats now include `afterQualityFilter` count
   - File: `pages/api/search-reviewers-pro.js:565-575`

4. **Cache Issues Identified:**
   - Old cache contained irrelevant results from generic queries
   - Solution: Check "Skip cache" option to force fresh searches with Claude-generated queries

**Known Issues / Future Work:**

1. **Google Scholar** - Requires `SERP_API_KEY` (paid). Without it, h-index data unavailable.
2. **Testing Needed** - Verify with "Skip cache" enabled:
   - Claude-generated queries working correctly
   - Publication URLs are clickable
   - Quality filter removing incomplete candidates
3. **Potential Improvements:**
   - Adjust 10-year publication filter if too restrictive
   - Add h-index minimum filter option
   - Enhance affiliation extraction from PubMed articles

---

## December 14, 2025 - Expert Reviewer Finder v2 Session 9

**Features Implemented:**

1. **Google Scholar Profile Links** (`426b6d7`, `b094ee7`)
   - Added Scholar Profile link to CandidateCard and SavedCandidateCard
   - Opens Google Scholar author search in new tab (free, no API needed)
   - URL cleanup: removes titles (Dr., Prof.), extracts institution name from full affiliation
   - `buildScholarSearchUrl()` helper function in `pages/reviewer-finder.js`

2. **Claude API Retry Logic with Fallback Model** (`1cd7416`, `5efed48`)
   - Retry configuration: 2 retries with exponential backoff (1s, 2s delays)
   - After retries exhausted, falls back to `claude-3-haiku-20240307`
   - Only retries on overloaded/rate-limit errors (529, 503)
   - `callClaude()` returns `{ text, usedFallback, model }` object
   - Progress events include `status: 'fallback'` for UI notification
   - File: `lib/services/claude-reviewer-service.js`

3. **Fallback Model UI Indicator**
   - Progress messages track `type` field ('info' or 'fallback')
   - Fallback messages displayed with:
     - Warning emoji prefix
     - Amber/yellow background highlighting (`bg-amber-50 text-amber-600`)
   - Candidates track `reasoningFromFallback` flag

**Files Modified:**
- `pages/reviewer-finder.js` - Scholar links + fallback UI
- `lib/services/claude-reviewer-service.js` - Retry logic with fallback

---

## December 15, 2025 - Expert Reviewer Finder v2 Session 10

**Features Implemented:**

1. **Institution Mismatch Detection**
   - Compares Claude's suggested institution with PubMed-verified affiliation
   - Displays orange warning when institutions don't match (possible wrong person)
   - Handles departmental vs institutional affiliations (e.g., "Center for Integrative Genomics" matches "University of Lausanne")
   - Uses 50+ university abbreviation aliases
   - File: `lib/services/discovery-service.js` - `checkInstitutionMismatch()`

2. **Expertise Mismatch Detection**
   - Checks if Claude's claimed expertise terms appear in candidate's publications
   - Confidence thresholds: <35% (mismatch warning), 35-65% (weak match), >65% (good)
   - Filters generic terms that would match everything (biology, research, molecular, etc.)
   - File: `lib/services/discovery-service.js` - `checkExpertiseMismatch()`

3. **Claude Prompt Improvements**
   - Added INSTITUTION field requirement for verification
   - Added SOURCE field ("Mentioned in proposal", "References", "Known expert", "Field leader")
   - Fixed name order issue (Western order: FirstName LastName with examples)
   - Added "WHERE TO FIND REVIEWERS" prioritization section
   - Relaxed accuracy requirements to avoid missing proposal-mentioned candidates
   - File: `shared/config/prompts/reviewer-finder.js`

4. **UI Improvements**
   - Orange warnings for institution/expertise mismatches
   - Yellow indicator for weak matches (35-65% confidence)
   - Full Claude reasoning displayed (removed 150-character truncation)
   - Google Scholar URL now prefers university name over department name

**Key Functions Added:**

```javascript
// Institution mismatch detection
static checkInstitutionMismatch(verifiedAffiliation, suggestedInstitution) {
  // Simple containment check first
  if (verifiedLower.includes(suggestedLower)) return false;
  // 50+ university aliases (UC system, MIT, Caltech, etc.)
  // Pattern extraction for university names
  // Word overlap fallback (>50% match)
}

// Expertise mismatch detection
static checkExpertiseMismatch(publications, claimedExpertise) {
  // Extract significant terms from claimed expertise
  // Filter generic words (biology, research, molecular, etc.)
  // Check if terms appear in publication titles
  // Returns { hasMismatch, claimedTerms, matchedTerms }
}
```

**Files Modified:**
- `lib/services/discovery-service.js` - Added mismatch detection functions
- `pages/reviewer-finder.js` - UI warnings, Scholar URL fix, full reasoning display
- `shared/config/prompts/reviewer-finder.js` - Prompt improvements

**Bugs Fixed:**
- Name order reversed in Claude output (LastName FirstName → FirstName LastName)
- Google Scholar URL using department name instead of university
- Browser crash from missing `expanded` state variable
- False positive institution mismatches for departmental affiliations

---

## December 15-16, 2025 - Expert Reviewer Finder v2 Session 11 (Contact Enrichment)

**Phase 3: Contact Enrichment - Implementation Complete**

Implemented a tiered contact lookup system to find email addresses and faculty pages for verified candidates:

**Tier System:**
- **Tier 1: PubMed** (Free) - Extracts emails from recent publication affiliations
- **Tier 2: ORCID** (Free) - Looks up email, website, and ORCID ID via API
- **Tier 3: Claude Web Search** (Paid ~$0.015/candidate) - AI-powered faculty page search

**Files Created:**

1. **`shared/components/ApiSettingsPanel.js`** (NEW)
   - Collapsible settings panel for optional API keys (ORCID Client ID/Secret, NCBI API Key)
   - Keys stored in localStorage with base64 encoding
   - Follows existing UI patterns from other apps in the suite

2. **`lib/utils/contact-parser.js`** (NEW)
   - Extracts emails from PubMed affiliation strings using regex
   - Validates email recency (papers < 2 years old considered trustworthy)

3. **`lib/services/orcid-service.js`** (NEW)
   - ORCID API integration with OAuth 2.0 client credentials flow
   - Token caching for efficiency
   - Search by name + affiliation, fetch full profile

4. **`lib/services/contact-enrichment-service.js`** (NEW)
   - Orchestrates 3-tier lookup with fallback logic
   - `isUsefulWebsiteUrl()` filter to exclude generic directory pages
   - Cost estimation for Claude Web Search
   - Database persistence of enriched contact info

5. **`pages/api/reviewer-finder/enrich-contacts.js`** (NEW)
   - SSE streaming endpoint for real-time progress updates
   - Sends cost estimates, progress events, and final results

6. **`lib/db/migrations/002_contact_enrichment.sql`** (NEW)
   - Schema additions for contact tracking fields

**Files Modified:**

7. **`scripts/setup-database.js`**
   - Added v3Alterations array for contact enrichment columns:
     - `researchers.email_source`, `email_year`, `email_verified_at`
     - `researchers.faculty_page_url`, `contact_enriched_at`, `contact_enrichment_source`
     - `reviewer_suggestions.email_sent_at`, `response_type`

8. **`pages/reviewer-finder.js`**
   - Added ApiSettingsPanel integration
   - Added enrichment state management
   - Added "Find Contact Info" button for selected candidates
   - Added enrichment modal with tier options, cost estimate, progress display
   - Fixed ORCID/Claude checkboxes to show unchecked when credentials unavailable

**Bugs Fixed:**
- `DatabaseService.upsertResearcher is not a function` → Changed to `createOrUpdateResearcher`
- Claude API rate limit (30K input tokens/minute) → Switched to Haiku model, reduced prompt size
- Progress UI unclear during enrichment → Added immediate tier status indicators
- Unhelpful directory URLs (e.g., `?p=people`) → Added URL quality filter
- ORCID checkbox couldn't be unchecked → Fixed checkbox to reflect credential availability

**Key Implementation Details:**

```javascript
// URL quality filter
static isUsefulWebsiteUrl(url) {
  const genericPatterns = [
    /[?&]p=people/,           // ?p=people parameters
    /\/people\/?$/,           // ends with /people
    /\/directory\/?$/,        // ends with /directory
    /\/faculty\/?$/,          // ends with /faculty
    // ... more patterns
  ];
  return !genericPatterns.some(pattern => pattern.test(url));
}

// Cost estimation
const COSTS = {
  PUBMED: 0,
  ORCID: 0,
  CLAUDE_WEB_SEARCH: 0.015,  // ~$0.01 search + ~$0.005 Haiku tokens
};
```

**Database Migration:**
Run `node scripts/setup-database.js` to apply v3 schema changes.

---

## December 18-19, 2025 - Expert Reviewer Finder v2 Session 16

**Phase 4: Email Reviewers Feature + Contact Enrichment Improvements**

This session focused on implementing the Email Reviewers feature and fixing several issues with data persistence and contact enrichment.

### Features Implemented

**1. Email Reviewers Feature**

Created a complete system to generate .eml invitation files for reviewer candidates:

**Files Created:**
- `lib/utils/email-generator.js` - EML file generation with placeholder substitution
- `shared/components/EmailSettingsPanel.js` - Sender info and grant cycle settings
- `shared/components/EmailTemplateEditor.js` - Template editing with placeholder insertion
- `shared/components/EmailGeneratorModal.js` - Multi-step generation workflow
- `pages/api/reviewer-finder/generate-emails.js` - SSE endpoint for email generation
- `shared/config/prompts/email-reviewer.js` - Claude prompt for email personalization

**Placeholder System:**
| Placeholder | Source |
|-------------|--------|
| `{{greeting}}` | "Dear Dr. LastName" |
| `{{recipientName}}` | Candidate full name |
| `{{recipientLastName}}` | Parsed last name |
| `{{salutation}}` | "Dr." or "Professor" |
| `{{proposalTitle}}` | From proposal analysis |
| `{{proposalAbstract}}` | From proposal analysis |
| `{{piName}}` | PI name(s) |
| `{{piInstitution}}` | PI institution |
| `{{programName}}` | From grant cycle settings |
| `{{reviewDeadline}}` | Formatted date |
| `{{signature}}` | User's signature block |

**2. Abstract Extraction**
- Modified `shared/config/prompts/reviewer-finder.js` to extract abstract during analysis
- Updated `pages/api/reviewer-finder/analyze.js` to return `proposalAbstract`
- Updated `pages/api/reviewer-finder/save-candidates.js` to store abstract with proposals

### Bugs Fixed

**1. PI and Abstract Missing from Generated Emails**
- `handleSaveCandidates()` wasn't passing `proposalAbstract`, `proposalAuthors`, `proposalInstitution`
- Fixed by adding these fields to the save request in `pages/reviewer-finder.js`

**2. Enriched Contact Info Not Saving to Database**
- Two issues: async state update race condition and missing extraction from `contactEnrichment` object
- Fixed `save-candidates.js` to extract email/website from nested `contactEnrichment` object:
```javascript
const candidateEmail = candidate.email || candidate.contactEnrichment?.email || null;
const candidateWebsite = candidate.website || candidate.contactEnrichment?.website || null;
```

**3. Duplicate Proposals in Database**
- `generateProposalId()` used timestamps, creating unique IDs each save
- Changed to deterministic ID based only on title slug
- Added V5 database migration to merge existing duplicates

**4. Missing Salutation in Emails**
- Added `{{greeting}}` placeholder that combines "Dear Dr. LastName"
- Updated default template to use `{{greeting}}`

**5. Search Results Clearing on Tab Switch**
- Lifted state from `NewSearchTab` to parent `ReviewerFinderPage`
- Persists: `uploadedFiles`, `analysisResult`, `discoveryResult`, `selectedCandidates`

**6. State Clearing on Save**
- Wrapper functions didn't support callback pattern `setState(prev => ...)`
- Fixed by checking if argument is function and calling it with previous value

**7. Google Scholar API 400 Errors**
- `google_scholar_profiles` SerpAPI engine returning 400 errors
- Added `findScholarProfileViaGoogle()` fallback using regular Google search with `site:scholar.google.com`

### Contact Enrichment Improvements

**Expanded Faculty Page URL Detection:**
- More path patterns: `/research/`, `/lab/`, `/group/`, `/member/`, `/team/`, `/investigator/`, etc.
- International domain support: `.ac.uk`, `.ac.jp`, `.edu.au`, `.uni-`, `.u-`, etc.
- Research organization patterns: `nih.gov`, `nsf.gov`, `researchgate.net/profile`, `orcid.org`

**Multiple SerpAPI Fallback Queries:**
1. Primary: `"Name" institution email`
2. Fallback: `"Name" institution faculty`
3. Fallback: `"Name" site:.edu institution`
4. Fallback: `"Name" institution lab research`
5. Fallback: `"Name" institution profile`

**Google Scholar Profile Extraction:**
- New `findScholarProfile()` method for SerpAPI Scholar profiles
- Fallback `findScholarProfileViaGoogle()` for when Scholar API fails
- Returns: `scholarProfileUrl`, `scholarId`, `scholarName`, `scholarAffiliation`, `scholarCitedBy`

### UI Changes

- Renamed "New Search" tab to "Search"
- Search results now persist when switching between tabs

### Files Modified

- `pages/reviewer-finder.js` - State lifting, email integration, tab rename
- `pages/api/reviewer-finder/save-candidates.js` - Email/website extraction from enrichment
- `pages/api/reviewer-finder/analyze.js` - Abstract extraction
- `lib/services/serp-contact-service.js` - Enhanced URL detection, Scholar fallback
- `lib/utils/contact-parser.js` - `isInternationalAcademicDomain()`, improved `isUsefulWebsiteUrl()`
- `lib/utils/email-generator.js` - Added `{{greeting}}` placeholder
- `shared/config/prompts/reviewer-finder.js` - Added abstract extraction
- `scripts/setup-database.js` - V5 migration for duplicate merging

### Test Scripts Added

- `scripts/test-contact-enrichment.js` - Tests Claude web search, ORCID, and SerpAPI services

### Git Commits

- `6187951` Add fallback for Google Scholar API 400 errors
- (Previous commits in session: email feature, state persistence, duplicate fix, etc.)

---

## December 19, 2025 - Expert Reviewer Finder v2 Session 17

**Features Implemented & Bugs Fixed**

### 1. Google Scholar Profiles API Deprecation Fix (`16af684`)

The `google_scholar_profiles` SerpAPI engine has been deprecated and returns errors. Fixed by removing the deprecated API call and using the existing Google search fallback directly.

**File Modified:**
- `lib/services/serp-contact-service.js` - `findScholarProfile()` now calls `findScholarProfileViaGoogle()` directly

### 2. Edit Saved Candidates Feature (`8b92201`)

Added ability to edit researcher information for saved candidates in the My Candidates tab. Edits update the shared `researchers` table, affecting all proposals that include that researcher.

**Editable Fields:**
- Name, Affiliation, Email, Website, h-index

**Files Modified:**
- `pages/api/reviewer-finder/my-candidates.js` - Extended PATCH handler to update researchers table
- `pages/reviewer-finder.js` - Added `EditCandidateModal` component and edit button on `SavedCandidateCard`

**API Changes:**
```javascript
// Extended PATCH /api/reviewer-finder/my-candidates
{
  suggestionId: number,
  // Existing fields
  invited?: boolean,
  accepted?: boolean,
  notes?: string,
  // NEW: researcher fields
  name?: string,
  affiliation?: string,
  email?: string,
  website?: string,
  hIndex?: number
}
```

When email is edited, `email_source` is set to `'manual'` and `contact_enriched_at` is updated.

### 3. PI/Author Self-Suggestion Bug Fix (`3b9fbaf`)

Fixed issue where proposal authors (PI and co-PIs) were being suggested as reviewers for their own proposals.

**Implementation:**
- Added `filterProposalAuthors()` to `DeduplicationService` with fuzzy name matching via `areNamesSimilar()`
- Uses 85% string similarity threshold + initials matching
- Applied filter in `discover.js` to both verified and discovered candidates

**Files Modified:**
- `lib/services/deduplication-service.js` - Added `filterProposalAuthors()` and `areNamesSimilar()` methods
- `pages/api/reviewer-finder/discover.js` - Applied PI/author filter to both tracks

### 4. ChemRxiv Integration (`a01b7e4`, `1e18d24`)

Added ChemRxiv (chemistry preprints) as a new database search source alongside PubMed, ArXiv, and BioRxiv.

**Files Created:**
- `lib/services/chemrxiv-service.js` - Complete ChemRxiv Public API v1 integration
  - Base URL: `https://chemrxiv.org/engage/chemrxiv/public-api/v1`
  - `search()`, `parseResponse()`, `searchByAuthor()` methods
  - `isRelevantForChemRxiv()` - Keyword matching for chemistry-related proposals

**Files Modified:**
- `shared/config/prompts/reviewer-finder.js` - Added CHEMRXIV_QUERIES section to prompt
- `lib/services/discovery-service.js` - Added `searchChemRxiv` option and method
- `pages/reviewer-finder.js` - Added ChemRxiv toggle to search sources UI
- `pages/api/reviewer-finder/discover.js` - Added `searchChemrxiv` option

**ChemRxiv API Details:**
- Supports keyword search via `term` parameter
- Sort by relevance: `RELEVANT_DESC`
- Rate limit: 429 response indicates throttling needed
- Returns authors with corresponding author and institution data

### 5. Search Result Logging Enhancement (`8ef30b7`)

Added comprehensive logging to all four database search methods to help debug which searches return results.

**Log Format:**
```
[Discovery] PubMed search complete: 150 candidates from 3 queries
[Discovery] PubMed unique authors: 87 Smith J, Jones A, Brown M, Wilson K, Lee S...
[ChemRxiv] Query "cyanide donors synthesis..." → 12 total, 12 returned
[ChemRxiv] Sample authors: Pluth M, Smith J, Lee K
```

**Files Modified:**
- `lib/services/discovery-service.js` - Added logging to `searchPubMed()`, `searchArXiv()`, `searchBioRxiv()`, `searchChemRxiv()`
- `lib/services/chemrxiv-service.js` - Added per-query logging with total/returned counts

### Git Commits

- `16af684` Remove deprecated Google Scholar Profiles API
- `8b92201` Add edit saved candidates feature
- `3b9fbaf` Fix PI self-suggestion as reviewer bug
- `a01b7e4` Add ChemRxiv database search integration
- `1e18d24` Fix ChemRxiv API 400 errors (sort parameter)
- `8ef30b7` Add search result logging for all database sources

---

## December 20, 2025 - Session 18: Documentation & UI Cleanup

**Documentation, App Consolidation, and UI Polish Session**

With the Reviewer Finder now stable and production-ready, this session focused on documentation, deprecating redundant apps, and polishing the overall UI consistency.

### Part 1: Documentation & Planning

1. **Created `ROADMAP_DATABASE_TAB.md`**
   - Detailed implementation plan for the Database Tab feature
   - 4-phase approach: Browse/Search → Details → Management → Advanced
   - API endpoint design and UI mockup

2. **Updated project documentation**
   - Updated CLAUDE.md with current app state and categories
   - Added Session 18 summary to DEVELOPMENT_LOG.md

### Part 2: App Deprecation

Deprecated 3 redundant apps (hidden from UI, files retained):

| App | Reason |
|-----|--------|
| document-analyzer | Duplicate of proposal-summarizer with worse UX |
| find-reviewers | Superseded by Reviewer Finder |
| find-reviewers-pro | Merged into Reviewer Finder |

### Part 3: UI Consistency Updates

**App Renaming:**
- "Expert Reviewer Finder v2" → "Reviewer Finder"
- "Batch Proposal Summaries" → "Batch Phase II Summaries"
- "Funding Gap Analyzer" → "Funding Analysis"
- "Phase II Writeup" → "Create Phase II Writeup Draft"
- "Phase I Writeup" → "Create Phase I Writeup Draft"
- "Peer Review Summary" → "Summarize Peer Reviews"

**Icon Consistency:**
- ✍️ for both writeup apps (Phase I and Phase II)
- 📑 for both batch apps (Phase I and Phase II)
- Migrated icon toggle buttons from find-reviewers-pro to Reviewer Finder

**Landing Page Updates:**
- Reordered apps: Batch Phase I, Batch Phase II, Funding Analysis, Create Phase I, Create Phase II, Reviewer Finder, Summarize Peer Reviews, Expense Reporter, Literature Analyzer
- Changed category filters from "Available/Coming Soon" to "Phase I/Phase II/Other Tools"
- Removed redundant feature keywords from app cards
- Updated app descriptions for consistency

**Header Updates:**
- Removed redundant "Document Processing Suite" logo (Home link serves same purpose)
- Updated navigation order to match landing page
- Added Literature Analyzer to navigation

**Footer Updates:**
- Added author credit: "Written by Justin Gallivan" with mailto link

### Reviewer Finder - Current State

The application is feature-complete for the core workflow:
- PDF upload → Claude analysis → 4-database search (PubMed, ArXiv, BioRxiv, ChemRxiv)
- Contact enrichment (5 tiers)
- Email generation with .eml files
- Save/edit/delete candidates in database
- Multi-select operations

**Next Priority:** Database Tab Implementation (see ROADMAP_DATABASE_TAB.md)

---

## January 14, 2026 - Session 22: Email Generation V6 & Settings UI

**Major Feature: Email Generation with Attachments and Settings Modal**

This session completed the email generation workflow with proper attachment support, settings UI, and various bug fixes.

### Features Implemented

**1. Settings Modal Overhaul**
- Reordered sections: Sender Info → Grant Cycle → Email Template → Attachments
- Added "Additional Attachments" section for optional files
- Review template upload via Vercel Blob storage
- Grant cycle custom fields (proposalDueDate, honorarium, proposalSendDate, commitDate)
- Summary page extraction configuration

**2. Email Attachment Support**
- MIME multipart/mixed format for .eml files with attachments
- Automatic project summary extraction from proposal PDFs (using pdf-lib)
- Review template attachment (user-uploaded)
- Additional attachments (multiple optional files)
- Re-extract summary button in My Candidates tab

**3. Investigator Team Formatting**
- New `{{investigatorTeam}}` placeholder handles PI + Co-PI formatting gracefully:
  - 0 Co-PIs: "the PI Dr. Smith"
  - 1 Co-PI: "the PI Dr. Smith and co-investigator Dr. Jones"
  - 2+ Co-PIs: "the PI Dr. Smith and 2 co-investigators (Dr. Jones, Dr. Lee)"
- New `{{investigatorVerb}}` for subject-verb agreement ("was" vs "were")

**4. Enhanced Co-PI Extraction**
- Updated Claude prompt with detailed guidance for finding Co-PIs
- Looks in: title/cover pages, "Senior Personnel" sections, author lists
- Graceful fallback to just PI name when Co-PIs not found

**5. Custom Field Date Formatting**
- `formatCustomFields()` converts ISO dates (2026-01-29) to readable format (January 29, 2026)
- Auto-detects date fields by name pattern or ISO format

### Bug Fixes

- **Webpack cache errors**: Fixed by clearing .next/cache directory
- **Template literal interpretation**: Escaped `${{customField:...}}` to prevent JS interpolation
- **Upload handler mismatch**: Created `/api/upload-file` for direct FormData uploads
- **Custom fields not populating**: Fixed EmailGeneratorModal to merge all localStorage sources
- **Extract summary API error**: Fixed to pass `Buffer.from(extraction.buffer)` instead of object
- **Verb agreement**: "the PI Dr. Smith were" → "the PI Dr. Smith was"

### Email Workflow Documentation

Generated .eml files open as "received" messages in email clients. To send:
1. Open the .eml file
2. Forward to recipient (remove "Fwd:" from subject), OR
3. Copy content into a new message

**Future Consideration:** When integrated with CRM, implement direct email sending via SendGrid, AWS SES, or similar service.

### Files Created/Modified

**New Files:**
- `pages/api/upload-file.js` - Direct FormData upload to Vercel Blob
- `pages/api/reviewer-finder/extract-summary.js` - Re-extract summary pages
- `lib/utils/pdf-extractor.js` - PDF page extraction using pdf-lib

**Modified Files:**
- `lib/utils/email-generator.js` - Attachment support, investigatorTeam, date formatting
- `shared/components/SettingsModal.js` - Reordered sections, additional attachments
- `shared/components/EmailGeneratorModal.js` - Load settings from multiple sources
- `shared/components/EmailTemplateEditor.js` - New placeholder options
- `shared/config/prompts/reviewer-finder.js` - Enhanced Co-PI extraction
- `CLAUDE.md` - Updated documentation with email workflow and future considerations

### Database Schema

**V6 Additions:**
- `reviewer_suggestions.summary_blob_url` - URL to extracted summary PDF

### Git Commits

- Format custom date fields in email template
- Reorder Settings modal menu sections
- Add additional attachments support to Settings modal
- Add investigatorTeam placeholder for better PI/Co-PI formatting
- Enhance Co-PI extraction and improve fallback handling
- Fix extract-summary API: pass buffer not object to Vercel Blob
- Add investigatorVerb for proper subject-verb agreement
- Add X-Unsent header to .eml files for draft mode
- Add Apple Mail draft header and remove Date for draft .eml files
- Update email workflow instructions for Outlook compatibility
- Add email workflow instructions and document future CRM integration

---

## January 15, 2026 - Session 23: Grant Cycle Management & UI Enhancements

**Major Feature: Grant Cycle and Program Area Management**

This session added comprehensive grant cycle management and program area tracking to the Reviewer Finder.

### Features Implemented

**1. Database Migrations (V8, V9)**
- V8: Added `declined` column to `reviewer_suggestions` table
- V9: Added `program_area` column to `reviewer_suggestions` table
- Added historical grant cycles: J23, D23, J24, D24, J25, D25, J26

**2. My Candidates Tab Improvements**
- Editable program area dropdown on each proposal card
  - Options: Science & Engineering Research Program, Medical Research Program, Not assigned
  - Color-coded: Blue for Science & Eng, Red for Medical, Gray for unassigned
- Editable grant cycle dropdown on each proposal card
  - Shows all active cycles from database
  - Color-coded: Purple when assigned, Gray when unassigned
- Declined status button alongside Invited/Accepted (red styling)
- PI and Institution display on proposal cards
- Filter dropdowns for Institution, PI, and Program (only show when >1 unique value)

**3. New Search Tab Enhancement**
- Grant cycle selector dropdown (replaces static indicator)
- Auto-generates cycles for current year + next year (18 months coverage)
- Auto-creates missing cycles in database on page load
- Persists selected cycle to localStorage
- Defaults to first available cycle if none previously selected

**4. Prompt Updates**
- Updated Claude analysis prompt to extract Keck cover page fields:
  - `PROGRAM_AREA`: Medical Research Program or Science and Engineering Research Program
  - `PRINCIPAL_INVESTIGATOR`: Single name from "Project Leader" field
  - `CO_INVESTIGATORS`: Names from "Co-Principal Investigators" field
- Fixed PI field to contain single name (previously had multiple authors)

### API Changes

**`/api/reviewer-finder/my-candidates.js`**
- Added `programArea` to PATCH handler for bulk proposal updates
- Added `declined` to SELECT queries and response mapping
- Added `program_area` to SELECT queries and response mapping

**`/api/reviewer-finder/save-candidates.js`**
- Added `programArea` to request body and INSERT/UPDATE

### Files Modified

- `pages/reviewer-finder.js` - Cycle selector, program/cycle dropdowns, filters
- `pages/api/reviewer-finder/my-candidates.js` - PATCH support for program/cycle
- `pages/api/reviewer-finder/save-candidates.js` - Program area support
- `scripts/setup-database.js` - V8 and V9 migrations
- `shared/config/prompts/reviewer-finder.js` - Keck cover page field extraction

### Git Commits

- Add program area and grant cycle editing to My Candidates
- Add grant cycle selector dropdown to New Search tab

---

## January 16, 2026 - Session 24: Concept Evaluator App

**Major Feature: Pre-Phase I Concept Screening Tool**

This session implemented the Concept Evaluator app, a new tool for screening research concepts before Phase I.

### Features Implemented

**1. Concept Evaluator App**
- Upload multi-page PDFs where each page contains one research concept
- Two-stage AI evaluation process:
  - Stage 1: Claude Vision API extracts title, PI, summary, research area, keywords
  - Stage 2: Literature search + Claude provides final evaluation with ratings
- Automatic literature search based on detected research area:
  - Life sciences → PubMed + BioRxiv
  - Chemistry → PubMed + ChemRxiv
  - Physics/CS/Math → ArXiv
- Label-based ratings (Strong/Moderate/Weak) for:
  - Keck Alignment (high-risk, pioneering, wouldn't be funded elsewhere)
  - Scientific Merit (sound science, clear hypothesis)
  - Feasibility (technical challenges, likelihood of success)
  - Novelty (based on literature search results)
- Export to JSON and Markdown
- New "Concepts" category on landing page

**2. PDF Page Splitter Utility**
- `lib/utils/pdf-page-splitter.js` - Split multi-page PDF into individual pages
- Returns base64-encoded PDF for each page (for Claude Vision API)
- Uses pdf-lib (existing dependency)

### Files Created

- `pages/concept-evaluator.js` - Frontend with streaming progress and results display
- `pages/api/evaluate-concepts.js` - Two-stage evaluation API with literature search
- `lib/utils/pdf-page-splitter.js` - PDF page extraction utility
- `shared/config/prompts/concept-evaluator.js` - Evaluation prompts with Keck criteria

### Files Modified

- `pages/index.js` - Added Concept Evaluator app card and "Concepts" category filter
- `shared/components/Layout.js` - Added navigation link for Concept Evaluator
- `CLAUDE.md` - Added Concept Evaluator documentation

### Architecture

```
PDF Upload → Split Pages → For Each Page:
  1. Claude Vision (Stage 1) → Extract metadata + keywords
  2. Literature Search → PubMed/ArXiv/BioRxiv/ChemRxiv
  3. Claude Text (Stage 2) → Final evaluation with literature context
→ Aggregate Results → Export JSON/Markdown
```

### Git Commits

- Add Concept Evaluator app for pre-Phase I screening

---

## January 16, 2026 - Session 25: Concept Evaluator Refinements

**Concept Evaluator Testing and Improvements**

This session focused on testing the Concept Evaluator with real data and refining the evaluation approach based on user feedback.

### Issues Identified & Fixed

**1. Sycophantic Evaluations**
- Problem: 7 of 8 concepts received identical praise ("This concept represents exactly the type of pioneering, high-risk research that Keck should support")
- Solution: Completely rewrote Stage 2 prompt with anti-sycophancy instructions:
  - Explicit rating distribution guidance (Strong = top 10-20%)
  - List of language to avoid ("exciting", "groundbreaking", "pioneering")
  - Requirement that every concept have substantive concerns
  - Default skeptical stance

**2. Evaluation Framing - Impact vs Feasibility**
- User feedback: Focus on potential impact, not feasibility at screening stage
- Added `potentialImpact` rating with framing: "If everything proposed turns out correct, what is the impact?"
- Feasibility remains but as secondary criterion for identifying addressable concerns
- Key question: "Will success have significant impact on the field or world?"

**3. Literature Search Improvements**
- Problem: Queries too specific - combining 6+ keywords into one long query returned no results
- Example bad query: "retroviral immunity CRISPR screening packageable lentiviral vectors Simian Immunodeficiency Virus innate immunity"
- Solution: Adopted Reviewer Finder pattern:
  - Claude generates 2-3 SHORT queries (3-5 words each)
  - Each query executed individually
  - Results deduplicated across queries
- Example good queries: "CRISPR gene editing", "retroviral vector packaging", "host innate immunity"

**4. Author Display Bug**
- Problem: Authors displayed as "[object Object], [object Object]"
- Cause: Services return author objects with `name` property, code tried to join objects as strings
- Fix: Extract author names properly: `a.name || 'Unknown'`

**5. Missing Paper Links**
- Added clickable URLs to literature results
- Priority: DOI → PubMed → ArXiv
- Links display in both UI and markdown export

### UI Updates

- Literature search section now shows each query as styled tag
- Paper titles are clickable links
- Summary stats show "High Impact" / "Moderate Impact" instead of Keck Fit
- Ratings row: Impact, Keck Fit, Merit, Novelty, Feasibility (5 ratings)

### Model Configuration Discovery

Identified that model selection is centralized in `shared/config/baseConfig.js`:
```javascript
DEFAULT_MODEL: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'
```

All apps currently use the same model. This was flagged as a significant issue - different apps may need different models based on task complexity. Deferred to Session 26 for per-app model configuration.

### Files Modified

- `shared/config/prompts/concept-evaluator.js` - Anti-sycophancy, impact framing, short queries
- `pages/api/evaluate-concepts.js` - Individual query execution, author name extraction, paper URLs
- `pages/concept-evaluator.js` - Query display, paper links, impact-focused stats

### Git Commits

- Enhance Concept Evaluator with impact focus and literature visibility
- Restore full feasibility analysis as secondary criterion
- Improve literature search with focused short queries
- Fix author display and add paper links in literature results

---

## Session 27 - January 18, 2026

### Email Tracking for Reviewer Candidates

Implemented full email tracking lifecycle for the Reviewer Finder:

**API Changes:**
- Extended `my-candidates.js` PATCH endpoint to accept `emailSentAt`, `responseType`, `responseReceivedAt`
- Added `markAsSent` option to `generate-emails.js` that auto-records timestamp when emails are generated
- Supports `'now'` as value for timestamps to set current time

**UI Changes:**
- EmailGeneratorModal now has "Mark candidates as Email Sent" checkbox (default: on)
- SavedCandidateCard displays sent timestamp (📧 Jan 18) next to status buttons
- Clicking Invited toggles `email_sent_at`
- Clicking Accepted/Declined sets `response_type` and `response_received_at`
- Added "Mark Bounced" button in expanded card details

### Database Tab Phase 3 - Researcher Management

Complete CRUD operations for researchers in the Database tab:

**API Endpoints Added (`/api/reviewer-finder/researchers`):**
- `GET ?mode=duplicates` - Find potential duplicates by email, normalized name, ORCID, Google Scholar ID
- `POST` - Merge researchers (moves keywords, transfers proposal associations, keeps best data)
- `PATCH` - Edit researcher fields (name, affiliation, email, website, metrics)
- `DELETE` - Delete single researcher or bulk delete multiple

**UI Features:**
- ResearcherDetailModal enhanced with Edit and Delete buttons
- Edit mode: inline form for all editable fields
- Delete confirmation showing proposal association count
- Bulk selection with checkbox column and "select all" header
- Bulk delete with confirmation dialog
- CSV Export button (fetches up to 1000 matching researchers)
- Find Duplicates button opens DuplicatesModal
- DuplicatesModal shows groups by match type, allows selecting primary and merging

**Merge Logic:**
- Keywords moved to primary (ON CONFLICT DO NOTHING for duplicates)
- Proposal associations (reviewer_suggestions) transferred to primary
- Missing data (email, website, ORCID, Scholar ID) filled from secondary
- Higher metrics (h-index, i10-index, citations) kept
- Secondary researcher deleted after merge

### Files Modified

**Email Tracking:**
- `pages/api/reviewer-finder/my-candidates.js` - Email tracking fields in GET and PATCH
- `pages/api/reviewer-finder/generate-emails.js` - markAsSent option with DB updates
- `shared/components/EmailGeneratorModal.js` - Checkbox and onEmailsGenerated callback
- `pages/reviewer-finder.js` - SavedCandidateCard email display and handlers

**Database Tab Phase 3:**
- `pages/api/reviewer-finder/researchers.js` - POST/PATCH/DELETE + duplicates mode
- `pages/reviewer-finder.js` - ResearcherDetailModal edit/delete, DuplicatesModal, bulk operations

### Git Commits

- `c89a8d4` Add email tracking for reviewer candidates
- `18be0af` Add Database Tab Phase 3: researcher management features

---

## Session 28 - January 18, 2026

### Literature Analyzer App Implementation

Implemented the Literature Analyzer app for research paper analysis and synthesis:

**Core Features:**
- Upload one or more research paper PDFs
- Claude Vision extracts key information from each paper
- Cross-paper synthesis for 2+ papers identifying themes and patterns
- Tabbed results view (Synthesis / Individual Papers)
- Optional focus topic to guide synthesis
- Export as JSON or Markdown

**Paper Extraction (per paper):**
- Title, authors, year, journal, DOI
- Abstract and research type classification
- Background (problem, motivation)
- Methods (approach, techniques, sample/data)
- Findings (main, quantitative, qualitative)
- Conclusions (summary, implications, limitations, future work)
- Keywords and field/subfield

**Synthesis Features (2+ papers):**
- Overview with date range and primary field
- Theme identification with consensus and disagreements
- Key findings categorized (established, emerging, contradictory)
- Research gaps (identified by authors, inferred)
- Methodological approaches comparison
- Future research directions
- Practical implications
- Quality assessment

**Files Created:**
- `pages/literature-analyzer.js` - Frontend with PaperCard and SynthesisSection components
- `pages/api/analyze-literature.js` - Two-stage API (extraction + synthesis)
- `shared/config/prompts/literature-analyzer.js` - Paper extraction and synthesis prompts

**Files Modified:**
- `shared/config/baseConfig.js` - Added literature-analyzer model config (Sonnet 4)
- `shared/components/Layout.js` - Enabled navigation link
- `pages/index.js` - Changed status from coming-soon to active
- `CLAUDE.md` - Added feature summary and model config documentation

### Git Commits

- `75559e3` Implement Literature Analyzer app for paper analysis and synthesis

---

## Session 29 - January 18-19, 2026

### User Profiles Phase 1 Implementation

Implemented multi-user support without authentication, enabling isolated API keys and "My Candidates" data per user.

**Database Schema (V10 Migration):**
- `user_profiles` table - User identity with avatar colors
- `user_preferences` table - Per-user settings with AES-256-GCM encryption for API keys
- Added `user_profile_id` FK to `proposal_searches` and `reviewer_suggestions`

**Core Features:**
- Profile selector dropdown in header for switching users
- Profile Settings page at `/profile-settings` for managing profiles
- Encrypted API key storage per profile (not shared via localStorage)
- My Candidates filtered by current user profile
- Legacy data (NULL user_profile_id) visible to all users until migrated

**API Endpoints:**
- `GET/POST/PATCH/DELETE /api/user-profiles` - Profile CRUD
- `GET/POST/DELETE /api/user-preferences` - Preference management with encryption

**Migration Tools:**
- `export-proposals-for-migration.js` - Export proposals to CSV
- `import-user-assignments.js` - Assign proposals to users from CSV
- `manage-preferences.js` - View/delete API key preferences

**Bug Fixes:**
- Fixed ProfileProvider placement (moved to `_app.js` for SSR compatibility)
- Fixed `setPreferences` naming conflict in ProfileContext
- Fixed infinite re-render loop when switching profiles
- Fixed localStorage fallback showing shared keys across profiles

**Files Created:**
- `lib/utils/encryption.js` - AES-256-GCM encryption utilities
- `shared/context/ProfileContext.js` - React context for profile state
- `shared/components/ProfileSelector.js` - Header dropdown
- `pages/profile-settings.js` - Profile management page
- `pages/api/user-profiles.js` - Profile API
- `pages/api/user-preferences.js` - Preferences API
- `scripts/export-proposals-for-migration.js`
- `scripts/import-user-assignments.js`
- `scripts/manage-preferences.js`
- `scripts/test-profiles.js`

**Files Modified:**
- `scripts/setup-database.js` - V10 migration
- `lib/services/database-service.js` - Profile/preference methods
- `pages/_app.js` - ProfileProvider wrapper
- `shared/components/Layout.js` - ProfileSelector in header
- `shared/components/ApiKeyManager.js` - Profile integration, isolated keys
- `shared/components/ApiSettingsPanel.js` - Profile integration, isolated keys
- `pages/api/reviewer-finder/my-candidates.js` - User scoping
- `pages/api/reviewer-finder/save-candidates.js` - User scoping
- `pages/reviewer-finder.js` - Pass userProfileId to APIs

### Git Commits

- `943cb65` Implement User Profiles Phase 1 for multi-user support
- `de60c03` Fix ProfileProvider and setPreferences naming conflict
- `8277c1b` Fix profile switching loop in API key components
- `f94ceb5` Isolate API keys per profile - do not show localStorage fallback
- `f088353` Add migration CSV to gitignore

---

## Session 30 - January 18, 2026

### Microsoft Azure AD Authentication Implementation

Implemented optional Microsoft Azure AD authentication using NextAuth.js. Authentication is **conditional** - it only activates when Azure credentials are configured in environment variables.

**Key Design Decision:**
- Authentication is optional until Azure AD app registration is set up
- App works exactly as before (with ProfileSelector) when credentials not configured
- Once credentials are added, login via Microsoft becomes required

**Database Schema (V11 Migration):**
- Added `azure_id` (VARCHAR, UNIQUE) to `user_profiles` - Azure AD user ID
- Added `azure_email` (VARCHAR) to `user_profiles` - User's Azure email
- Added `last_login_at` (TIMESTAMP) to `user_profiles` - Last Azure login
- Added `needs_linking` (BOOLEAN) to `user_profiles` - First-login flag
- Added indexes for fast Azure ID/email lookups

**Authentication Flow:**
1. User visits app → `RequireAuth` checks if Azure credentials configured
2. If not configured → App works as before with ProfileSelector
3. If configured and unauthenticated → Redirect to Microsoft login
4. After Azure auth → `signIn` callback checks for linked profile
5. First login → `ProfileLinkingDialog` lets user pick existing profile or create new
6. Future logins → Auto-selects linked profile from session

**Files Created:**
| File | Purpose |
|------|---------|
| `pages/api/auth/[...nextauth].js` | NextAuth API route with Azure AD provider |
| `pages/api/auth/link-profile.js` | API for linking Azure account to profile |
| `pages/api/auth/status.js` | Returns whether auth is enabled (credentials exist) |
| `pages/auth/signin.js` | Custom sign-in page with Microsoft branding |
| `pages/auth/error.js` | Custom error page for auth failures |
| `shared/components/RequireAuth.js` | Auth guard (passes through if auth disabled) |
| `shared/components/ProfileLinkingDialog.js` | First-login profile selection modal |
| `lib/utils/auth.js` | Server-side utilities: `requireAuth`, `requireAuthWithProfile` |

**Files Modified:**
| File | Changes |
|------|---------|
| `pages/_app.js` | Added `SessionProvider` wrapper from NextAuth |
| `pages/index.js` | Wrapped with `RequireAuth`, conditional user menu |
| `shared/components/Layout.js` | User menu when authenticated, ProfileSelector when not |
| `shared/context/ProfileContext.js` | Integrated with `useSession` for auto profile selection |
| `lib/services/database-service.js` | Added Azure fields to profile queries |
| `scripts/setup-database.js` | V11 migration for Azure columns |
| `CLAUDE.md` | Added authentication documentation |

**Environment Variables (Required when enabling auth):**
```env
NEXTAUTH_URL=http://localhost:3000     # Base URL
NEXTAUTH_SECRET=...                     # Generate: openssl rand -base64 32
AZURE_AD_CLIENT_ID=...                  # From Azure Portal
AZURE_AD_CLIENT_SECRET=...              # From Azure Portal
AZURE_AD_TENANT_ID=...                  # Organization tenant ID
```

**Server-Side Auth Utilities:**
```javascript
// In API routes:
import { requireAuth, requireAuthWithProfile } from '../../lib/utils/auth';

// Option 1: Just require authentication
const session = await requireAuth(req, res);
if (!session) return; // 401 already sent

// Option 2: Require auth + profile for data scoping
const profileId = await requireAuthWithProfile(req, res);
if (!profileId) return; // 401 or 403 already sent
```

### Git Commits

- `7de98a5` Add Microsoft Azure AD authentication with NextAuth.js
- `933ccf6` Make authentication optional when Azure credentials not configured

---

## Session 31 - January 19, 2026

### Manual Researcher Management & Bug Fixes

Added comprehensive manual researcher management features and fixed several critical bugs in the email generation workflow.

**New Features:**

1. **Researcher Notes Field (V12 Migration)**
   - Added `notes` column to `researchers` table for tracking conflicts, preferences, past interactions
   - Editable in researcher detail modal with yellow-highlighted display
   - Useful for recording decline reasons and other contextual information

2. **Add Researcher Button (Database Tab)**
   - New "+ Add Researcher" button in Database tab header
   - Opens `AddResearcherModal` with comprehensive form:
     - Basic Info: Name (required), Affiliation, Department
     - Contact: Email, Website, ORCID, Google Scholar ID
     - Metrics: h-index, i10-index, Citations
     - Expertise: Keywords (comma-separated)
     - Notes: General notes field
     - Proposal Association: Grant cycle selector → Proposal dropdown → Match reason

3. **Associate with Proposal (Researcher Detail Modal)**
   - New "+ Add to Proposal" link in Proposal Associations section
   - Expandable green form with grant cycle and proposal selectors
   - Links existing researchers to proposals without re-running discovery
   - Creates `reviewer_suggestions` entry with source='manual'

4. **Status Tracking Improvements**
   - Added "No Response" status option for closing out non-responders
   - Added "Mark as Sent" button for retroactive email tracking on older candidates
   - Filter support for "No Response" status in My Candidates

**Bug Fixes:**

1. **Email Generation Modal Cycling** (`EmailGeneratorModal.js`)
   - Fixed infinite loop caused by `onEmailsGenerated` callback triggering parent re-render during SSE
   - Added `generationTriggeredRef` guard to prevent double generation
   - Added `needsRefreshRef` to defer parent callback until modal closes
   - Consolidated initialization into single useEffect with `hasInitializedRef`

2. **ApiSettingsPanel Infinite Loop** (`ApiSettingsPanel.js`)
   - Fixed infinite re-render caused by `onSettingsChange` in useCallback dependency array
   - Implemented ref pattern: `onSettingsChangeRef.current` instead of direct callback

3. **Proposal Association Bug**
   - Fixed `parseInt()` being called on string proposal hash, causing `NaN`
   - Changed to pass proposalId as string directly

**API Changes:**

1. **POST /api/reviewer-finder/researchers** (Extended)
   - Now supports creating new researchers (when `name` provided instead of `primaryId`)
   - Accepts optional `proposalId` to associate with proposal on creation
   - Accepts `keywords` array for expertise tags

2. **GET /api/reviewer-finder/my-candidates?mode=proposals**
   - New mode to fetch all proposals (from `reviewer_suggestions`) for dropdowns
   - Supports `cycleId` filter for grant cycle scoping
   - Returns distinct proposals with title, hash, and cycle info

**Database:**
- V12 Migration: `ALTER TABLE researchers ADD COLUMN IF NOT EXISTS notes TEXT`

**Files Modified:**
| File | Changes |
|------|---------|
| `pages/reviewer-finder.js` | AddResearcherModal, notes field UI, associate feature, status tracking |
| `pages/api/reviewer-finder/researchers.js` | POST create handler, notes in GET/PATCH |
| `pages/api/reviewer-finder/my-candidates.js` | mode=proposals query |
| `shared/components/EmailGeneratorModal.js` | Fixed cycling/double-generation bugs |
| `shared/components/ApiSettingsPanel.js` | Fixed infinite loop |
| `scripts/setup-database.js` | V12 migration |
| `lib/db/schema.sql` | Added notes column |

### Git Commits

- `9553708` Add manual researcher management and fix email generation bugs

---

## Session 32 - January 20, 2026

### Azure AD (Entra ID) Integration Finalization

IT team completed and refined the Microsoft Azure AD authentication integration using their internal tools. This session focused on reviewing and documenting their changes.

**IMPORTANT: Authentication remains OPTIONAL.** The app continues to work exactly as before (ProfileSelector dropdown, no login required) until Azure credentials are explicitly configured in environment variables. This is by design - authentication only activates when all three Azure variables (`AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`) are set.

**What IT Implemented/Refined:**

The authentication infrastructure was built in Sessions 30-31, but IT refined several components and added new utilities:

**1. Auth Status Endpoint** (`pages/api/auth/status.js`) - NEW
- Simple endpoint returning `{ enabled: true|false }` based on Azure credentials
- Checks `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`
- Used by `RequireAuth` client component to determine if login is required

**2. Enhanced Auth Utilities** (`lib/utils/auth.js`) - REFINED
Added new helper functions:
| Function | Purpose |
|----------|---------|
| `getSession(req, res)` | Get session without sending error response |
| `requireAuth(req, res)` | Require auth, send 401 if unauthenticated |
| `requireAuthWithProfile(req, res)` | Require auth + linked profile, send 401/403 |
| `optionalAuth(req, res)` | Return session if present, null otherwise |

**3. RequireAuth Component** (`shared/components/RequireAuth.js`) - REFINED
- Now fetches `/api/auth/status` on mount to determine if auth is enabled
- Caches result in `window.__AUTH_ENABLED__` for subsequent renders
- Graceful fallback: if status check fails, assumes auth disabled
- Added `useRequireAuth()` hook for use in other components

**4. ProfileLinkingDialog** (`shared/components/ProfileLinkingDialog.js`) - REFINED
- Cleaner implementation with proper loading states
- Filters to only show unlinked profiles (`!p.azureId`)
- Sign out option to switch accounts
- Error handling with user-friendly messages

**5. NextAuth Configuration** (`pages/api/auth/[...nextauth].js`) - REFINED
- Robust signIn callback with multiple profile lookup strategies:
  1. Check by `azure_id` (returning user)
  2. Check by `azure_email` (auto-link if email matches)
  3. Create temp profile with `needs_linking=true` if unlinked profiles exist
  4. Create new profile if no existing profiles
- Error-tolerant: allows sign-in even if DB operations fail

**6. Link Profile Endpoint** (`pages/api/auth/link-profile.js`) - REFINED
- Verifies Azure ID matches session before allowing link
- Cleans up temporary profiles after linking
- Prevents linking to already-linked profiles

**New Files Created by IT:**
| File | Purpose |
|------|---------|
| `.env.local.example` | Template for environment variables |
| `docs/ENTRA_ID_INTEGRATION_SUMMARY.md` | IT's integration documentation |

**Authentication Flow (Finalized):**
```
1. RequireAuth → GET /api/auth/status
2. If enabled && unauthenticated → Show "Sign in with Microsoft" button
3. User clicks → signIn('azure-ad') → Microsoft OAuth
4. NextAuth signIn callback → Find/create/link profile in DB
5. jwt callback → Add profileId, needsLinking to token
6. session callback → Expose to client
7. If needsLinking → Show ProfileLinkingDialog
8. User links → POST /api/auth/link-profile → Reload page
```

**Environment Variables (Complete List):**
```env
# NextAuth Core
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<openssl rand -base64 32>

# Azure AD Credentials
AZURE_AD_CLIENT_ID=<from Azure Portal>
AZURE_AD_CLIENT_SECRET=<from Azure Portal>
AZURE_AD_TENANT_ID=<organization tenant ID>

# Database (auto-set by Vercel)
POSTGRES_URL=<connection string>
```

**Testing Checklist:**
1. `cp .env.local.example .env.local` and fill values
2. `npm run dev`
3. Visit `/api/auth/status` → expect `{"enabled":true}`
4. Visit any page → should redirect to Microsoft login
5. Complete OAuth → should show ProfileLinkingDialog (first login)
6. Link or create profile → should reload with full access
7. Visit `/api/auth/session` → should show `profileId`, `azureEmail`

**Note:** Azure app registration requires redirect URI:
- Dev: `http://localhost:3000/api/auth/callback/azure-ad`
- Prod: `https://your-domain.vercel.app/api/auth/callback/azure-ad`

---

## Session 33 - January 20, 2026

### Per-User Settings Storage for Reviewer Finder

Migrated Reviewer Finder settings from browser localStorage to per-user database storage using the existing `user_preferences` infrastructure.

**Problem:**
Settings (sender info, grant cycle settings, email template, current cycle ID) were stored in browser localStorage, meaning:
- Settings didn't persist across browsers/devices
- All users on the same machine shared the same settings
- No isolation between user profiles

**Solution:**
Updated all settings-related components to use profile preferences with localStorage fallback:

**New File:**
- `shared/config/reviewerFinderPreferences.js` - Preference key constants and legacy storage key mappings

**Updated Components:**
| Component | Changes |
|-----------|---------|
| `SettingsModal.js` | Save/load from profile preferences; auto-migrate from localStorage |
| `EmailTemplateEditor.js` | Save/load template from profile preferences |
| `EmailGeneratorModal.js` | Load settings from profile preferences first |
| `EmailSettingsPanel.js` | Collapsible panel uses profile preferences |

**Preference Keys:**
| Key | Data |
|-----|------|
| `reviewer_finder_sender_info` | Name, email, signature (JSON) |
| `reviewer_finder_grant_cycle_settings` | Program name, deadline, attachments, summary pages (JSON) |
| `reviewer_finder_email_template` | Subject and body template (JSON) |
| `reviewer_finder_current_cycle_id` | Active grant cycle selection |

**Behavior:**
- With profile: Settings stored in `user_preferences` table
- Without profile: Falls back to localStorage (backwards compatible)
- First profile use: Auto-migrates localStorage data to profile
- Profile switching: Loads that profile's saved settings

**Documentation:**
- Added "Settings Storage (Per-User)" section to CLAUDE.md

---

## Session 34 - January 20, 2026

### Multi-Proposal Email Generation Bug Fix

Fixed the bug where generating reviewer invitation emails across multiple proposals only used the first proposal's information.

**Root Cause:** Type mismatch in the proposal info Map lookup - search IDs were stored as integers but looked up as strings.

**Fix:** Added explicit string conversion when storing and looking up proposal info in the Map.

**Files Changed:**
- `pages/api/reviewer-finder/generate-emails.js` - Fixed Map key type handling

**Commits:**
- `cc30c26` - Fix multi-proposal email generation bug
- `8953341` - Fix type mismatch in proposal info Map lookup

---

## Session 35 - January 20, 2026

### Applicant Integrity Screener Implementation

Implemented a new standalone app to screen grant applicants (PIs and Co-PIs) for research integrity concerns before award decisions.

**Features:**
- **Retraction Watch Database** - Imported 68,248 retraction records for local searching
- **PubPeer Search** - SERP API integration with Claude Haiku analysis
- **Google News Search** - SERP API integration with Claude Haiku filtering
- **Multi-tier Name Matching** - Fuzzy matching with confidence scoring (50-100%)
- **SSE Streaming** - Real-time progress updates during screening
- **Dismissal System** - Mark false positives for future reference

**Database Schema (V13 Migration):**
- `retractions` - Retraction Watch data with GIN-indexed normalized author names
- `integrity_screenings` - Screening history with results
- `screening_dismissals` - False positive tracking

**Files Created:**
- `pages/integrity-screener.js` - Frontend with results display
- `pages/api/integrity-screener/screen.js` - Main screening API (SSE streaming)
- `pages/api/integrity-screener/history.js` - Screening history
- `pages/api/integrity-screener/dismiss.js` - False positive dismissal
- `lib/services/integrity-service.js` - Core screening orchestration
- `lib/services/integrity-matching-service.js` - Name matching algorithms
- `shared/config/prompts/integrity-screener.js` - Haiku prompts for analysis
- `scripts/import-retraction-watch.js` - CSV import script using pg package

**Files Modified:**
- `scripts/setup-database.js` - Added V13 migration
- `pages/index.js` - Added app to landing page
- `CLAUDE.md` - Documented new app

**Bug Fixes During Implementation:**
- Fixed ApiKeyManager prop usage (was using wrong props)
- Fixed Claude model ID for Haiku (`claude-haiku-4-20250514` → `claude-3-5-haiku-20241022`)
- Added `pg` package for Node.js v22 compatibility with database operations

**Cost Estimates:**
- SERP API: ~$0.02 per applicant (2 searches)
- Claude Haiku: ~$0.001 per applicant
- Retraction Watch search: Free (local database)

---

## Session 36 - January 21, 2026

### Integrity Screener Refinements

Improved the Applicant Integrity Screener with bug fixes and new features.

**New Features:**

1. **Markdown Export**
   - Added "Export Markdown" button alongside JSON export
   - Generates formatted report with summary, per-applicant results, and status indicators

**Bug Fixes:**

1. **Retraction Watch Display**
   - Fixed: Section only showed when matches were found
   - Now displays "Clear" status when searched with no matches
   - Shows any errors that occurred during search

2. **Middle Initial Search**
   - Fixed: "Justin Gallivan" wasn't matching "Justin P Gallivan"
   - Added text-based fallback search using LIKE patterns
   - Now correctly matches names with middle initials (95% confidence)

**Files Changed:**
- `pages/integrity-screener.js` - Added markdown export, fixed Retraction Watch display
- `lib/services/integrity-service.js` - Added text search fallback for middle initials

**Files Added:**
- `scripts/test-retractions.js` - Database search verification script

**Commits:**
- `7e06656` - Implement Applicant Integrity Screener
- `fa7f99c` - Add markdown export option to Integrity Screener
- `e764483` - Fix Retraction Watch results display in Integrity Screener
- `43c66fe` - Fix Retraction Watch search to handle middle initials

---

## Session 44 - January 30, 2026

### Comprehensive Codebase Cleanup

Performed a major codebase cleanup to remove deprecated code, unused files, and obsolete documentation.

**Impact:**
- **45 files deleted**
- **15,276 lines removed**

**Deprecated Pages Removed:**
- `pages/document-analyzer.js` - Duplicate of proposal-summarizer with worse UX
- `pages/find-reviewers.js` - Superseded by reviewer-finder.js
- `pages/find-reviewers-pro.js` - Merged into reviewer-finder.js

**Deprecated API Endpoints Removed:**
- `pages/api/find-reviewers.js`
- `pages/api/search-reviewers-pro.js`
- `pages/api/analyze-documents-simple.js`
- `pages/api/process-batch-simple.js`
- `pages/api/process-proposals-simple.js`

**Unused Components Removed:**
- `shared/components/FileUploader.js` - Replaced by FileUploaderSimple.js
- `shared/components/GoogleSearchResults.js`
- `shared/components/GoogleSearchModal.js`

**Unused Services & Utilities Removed:**
- `lib/services/scholar-service.js`
- `shared/utils/dataExtraction.js`
- `shared/utils/reviewerParser.js`
- `lib/config.js` and `lib/config.legacy.js`

**Unused Prompt Files Removed:**
- `shared/config/prompts/document-analyzer.js`
- `shared/config/prompts/batch-processor.js`
- `shared/config/prompts/find-reviewers.js`

**Root Directory Cleanup:**
Deleted 23 obsolete planning/migration markdown files:
- Config migration docs (REMAINING_API_MIGRATIONS.md, CONFIG_MIGRATION_AUDIT.md, etc.)
- Expert Reviewer planning docs (EXPERT_REVIEWERS_PRO_PLAN.md, etc.)
- Completed feature docs (ROADMAP_DATABASE_TAB.md, TIER4_SERP_GOOGLE_PLAN.md, etc.)

**Test Files Removed:**
- `test-nih-api.js`
- `tests/unit/prompts/find-reviewers.test.js`

**Files Modified:**
- `shared/config/index.js` - Removed exports for deleted prompt files

**Verification:**
- Build verified after each phase
- All 11 active applications remain functional

**Commits:**
- `5cd855c` - Slim down CLAUDE.md and move content to dedicated docs
- `13cca60` - Remove deprecated code, unused files, and obsolete documentation

---

## Session 58 - February 17, 2026

### Admin-Configurable Claude Model Overrides

Added a new admin dashboard section allowing superusers to change which Claude model each app uses — without code changes or redeployment. Available models are fetched dynamically from the Anthropic API.

**Architecture:**
- Model resolution priority: DB override → env var → hardcoded → default
- `loadModelOverrides()` async function pre-loads DB overrides into a module-level Map (5-min TTL)
- `getModelForApp()` stays synchronous — each API handler calls `loadModelOverrides()` once at the top

**New Files:**
- `pages/api/admin/models.js` — GET/PUT admin API for model overrides
- V17 migration: `system_settings` key-value table in `scripts/setup-database.js`

**Modified Files:**
- `shared/config/baseConfig.js` — Added cache, `loadModelOverrides()`, `clearModelOverridesCache()`, updated `getModelForApp()`
- `shared/config/index.js` — Re-exports
- `pages/admin.js` — New `ModelConfigSection` component (table of apps × model types with dropdowns)
- 12 API route files — Added `await loadModelOverrides()` after auth

**Bug Fixes:**
- Fixed 3 admin API endpoints (`/api/admin/models`, `/api/admin/stats`, `/api/dynamics-explorer/roles`) stalling in dev mode when `AUTH_REQUIRED=false` — applied early-return pattern from `app-access.js`
- Fixed FK constraint violation on `system_settings.updated_by` in dev mode (profileId=0 → null)

**Commits:**
- `a1e2a97` - Add admin-configurable Claude model overrides per app
- `c98b4d1` - Fix admin API endpoints stalling in dev mode
- `5da7efe` - Fix FK constraint violation when saving model overrides in dev mode

---

## Session 81 — Security Hardening: Tests, CI, Safe-Fetch (March 10, 2026)

Implemented the "Easy Wins" security hardening roadmap from the independent code review.

**Authorization Regression Tests (73 tests):**
- Auth mock helper with presets for unauthenticated, authenticated, disabled, no-profile
- Unit tests for all three auth functions + CSRF validation
- Route-level auth tests for 8 representative API endpoints
- Cross-user data isolation tests for email generation routes

**Centralized Fetch Wrapper (`safeFetch`):**
- `lib/utils/safe-fetch.js` — HTTPS-only host allowlist, manual redirect validation
- Migrated `fetchAttachment` in `generate-emails.js` and `send-emails.js`
- Fixed redirect bypass vulnerability found in code review

**CI Security Pipelines (4 new workflows):**
- Gitleaks (secret scanning), Trivy (CVE), CodeQL (static analysis), Jest (tests)
- Fixed orphaned test file and disabled aspirational coverage thresholds

**Also committed prior-session P0/P1 fixes:**
- Profile linking hardened (server-side identity, email match, already-linked guard)
- Token security comments + Semgrep rules

**Commits:**
- `c2be638` - Add security hardening: auth tests, safe-fetch, CI pipelines, PR template
- `f720976` - Add security hardening implementation summary
- `ea66438` - Fix safeFetch redirect bypass and remaining raw fetch calls
- `5395836` - Remove orphaned reviewerParser test
- `3b36957` - Disable aspirational coverage thresholds
- `c87e2a3` - Commit prior-session security fixes

---

### Session 84 — March 12, 2026

**Server-side aggregate tool for Dynamics Explorer**

Added an `aggregate` tool (11th tool) that uses OData `$apply` for exact server-side computation of sums, averages, min, max, and countdistinct. Previously Claude fetched records via `query_records` (capped at 100) and tried to sum them — producing wrong results. Now the CRM computes exact totals in a single API call with minimal token cost. Supports optional `group_by` for breakdowns (e.g., "total funding by program").

Changes across 3 files:
- `DynamicsService.aggregateRecords()` — builds `$apply` with filter/groupby/aggregate composition, restriction checks on field and groupBy
- Chat handler — 5 integration points: executeTool, summarizeToolResult, getThinkingMessage, checkRestriction (defense-in-depth for field/group_by), recordCount logging
- System prompt — added aggregate to TOOLS, added MATH rule, removed false "aggregation" claim from query_records

**Commits:**
- `f42cf99` - Add server-side aggregate tool to Dynamics Explorer for exact totals/averages

---

### Session 137 — May 7, 2026

**Application State Atlas + remediation plan completion + binding self-test mechanism**

S136 surfaced a trust gap: the reviewer migration plan went through 3 Codex rounds because state claims weren't being verified. S137 closed that gap structurally instead of procedurally.

Five-phase `docs/CLAUDE_REMEDIATION_PLAN.md` now complete:
- Phase 1 (Atlas) — `docs/APPLICATION_STATE_ATLAS.md` + 12 per-entity pages in `docs/atlas/`. 11 Codex stress-test rounds before clean signal across cat 1/3/4/5.
- Phase 2 (CI gate) — `scripts/check-application-state-atlas.js` enforces Postgres-table + Dataverse-entity coverage. Wired to CI.
- Phases 0/3 (rules + CLAUDE.md) — done concurrently with Phase 1.
- Phase 4 (Wave 1+2 doc reconciliation) — both migration docs corrected against ground truth; Wave 2 plan passes Codex review on first follow-up.

Bonus: built a binding self-test mechanism after recognizing "remember to grep for parallel patterns" was advisory. `docs/CLAUDE_COVERAGE_LESSONS.md` catalogs every detected pattern; `scripts/check-coverage-self-test.js` runs each through the gate via runtime-generated synthetic fixtures, fails CI if any pattern stops being detected.

**Commits:**
- `b2b0af1` — Build Application State Atlas (Phase 1 of remediation plan)
- `43818b6` — Address Codex round-3 findings on reviewer migration plan
- `e332de5` — Add Atlas CI gate (Phase 2 of remediation plan)
- `5705bd3` — Reconcile Wave 1 doc against Atlas + close CI gate hole
- `40440d6` — Verify Wave 1 entity sets live + wire check:atlas into CI
- `adbf4ae` — Close additional CI gate holes flagged by Codex review
- `f9befb9` — Bind coverage lessons to a CI self-test

### Session 139 — May 7, 2026

**Wave 2 build — full 5-item set shipped in one session**

All five planned Wave 2 / pilot build items landed and were verified live against prod Dataverse:

1. **Echo-prompt parity oracle** — seeded `executor.echo-parity` row in `wmkf_ai_prompts`. Both Vercel `executePrompt()` runs against the same `(requestId, echo_text)` produced byte-identical `wmkf_ai_rawoutput` and the second run reported `cacheHit=true`. First haiku attempt failed cache assertion because Anthropic's ephemeral cache has model-specific minimum-token thresholds (1024 sonnet, 2048 haiku); switching to sonnet-4 + adding stable filler in the system block (cache-load-bearing, documented inline) resolved it. Once Connor's PA-side `ExecutePrompt` lands, the parity oracle compares cross-side.

2. **`wmkf_apprequestperson` junction entity** — net-new schema deployed to prod: table + Role picklist + AuthorPosition int + 2 lookups (request, contact) + alt key `(wmkf_request, wmkf_contact, wmkf_role)`. Sandbox is structurally unsuitable (no AkoyaGo solution, no `wmkf_appreviewersuggestion`); standing pattern is direct-to-prod. Hit Dataverse 429 EntityCustomization throttling between metadata writes — apply script is idempotent so a 30s-backoff retry loop completed it.

3. **Junction backfill** — `scripts/backfill-request-person-junction.js` walks all 25,561 `akoya_request` rows, reads the 6 legacy slot fields, emits one row per populated slot. Final: 4,488 PI + 1,073 Co-PI = 5,561 rows, 0 failures, ~8 min at 11/s. Two findings caught during smoke that would have wrecked a full-volume run: `queryAllRecords` caps at 5000 (replaced with raw paginated fetch + Prefer odata.maxpagesize=5000), and `@odata.bind` keys must use the lookup *schema name* (PascalCase wmkf_Request, wmkf_Contact), not lowercase logical names — lowercase produces 0x80048d19 "Error identified in Payload" 400.

4. **28 fields on akoya_request** — single-batch deploy of 6 workflow-chaining fields + 22 Field Set B (grant report extraction): 8 whole-number counts, 7 multi-line text (one JSON-payload exception for goalsassessment), 6 flat publication fields (Connor 2026-05-07: flat not JSON list), 1 choice (overallrating with successful/mixed/unsuccessful starting set). Same throttle-and-backoff pattern as item 2.

5. **`/api/reviewer-finder/contact-history` UNION endpoint** — GET endpoint reading `wmkf_apprequestperson` UNION `akoya_request._wmkf_projectleader_value` per `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` §5. Live-tested three cases: PI dual-source rows (sources=[junction,projectleader]), co-PI single-source rows (sources=[junction]), empty-history zero-GUID. Per-row `sources` array lets UI distinguish during the pre-PA-cutover transition window. Auth: `requireAppAccess('reviewer-finder')`. API_ROUTE_SECURITY_MATRIX updated; 77 routes (was 76).

**Commits:**
- `2eda700` — Seed executor.echo-parity prompt + harness for two-side parity oracle
- `c8cbfe1` — Deploy wmkf_apprequestperson junction entity to prod Dataverse
- `8b9b287` — Backfill 5,561 wmkf_apprequestperson rows from akoya_request slot fields
- `b536121` — Deploy 28 wmkf_ai_* fields on akoya_request (workflow-chaining + Field Set B)
- `b23586c` — Add /api/reviewer-finder/contact-history with UNION read strategy

**Cross-cutting findings worth carrying forward:**
- Dataverse `EntityCustomization` 429 throttling between metadata writes is the rule, not the exception, on multi-attribute deploys. Wrap `apply-dataverse-schema.js` calls in a 30s-backoff retry loop for any future schema work.
- `@odata.bind` keys are case-sensitive (PascalCase nav-property name); plain field reads/writes are not (lowercase logical name). The smoke `--limit 50` flag caught this before a full 5,500-row commit would have failed silently into the audit-log.
- Anthropic ephemeral prompt caching has per-model minimum-token thresholds; tiny smoke prompts can't satisfy them without padding, and the `cache_control` marker is silently ignored below threshold.
- The standing schema-deploy pattern remains "direct-to-prod" — sandbox lacks AkoyaGo vendor entities and Connor's pre-codebase custom entities, so any custom schema that lookups into them can't be tested in sandbox without a vendor-licensing change.

---

## Session 149 — 2026-05-14

**Two live Connor syncs in one day: schema review + Item 6 resolution**

Long meeting day. Eight schema items + one deferred decision worked across two sessions. Three commits at end-of-day.

### Morning — 2026-05-14 schema review

Walked through `docs/archive/INTAKE_PORTAL_SCHEMA_REVIEW_2026-05-14.md` with Connor. Eight items closed under a "human-legibility over normalization purity" design principle that emerged mid-meeting (memory `feedback_human_legibility_schema_principle`). Material outcomes:

- Item 1: cost-share **unified into `wmkf_proposalbudgetline.wmkf_category` enum** (3 new values: WaivedIndirect / WaivedTuition / OtherCostShare) instead of a separate `wmkf_proposalcostshare` entity.
- Item 3: roster **extends existing `wmkf_apprequestperson`** (3 nullable fields + 5-value `wmkf_role` enum) instead of a new `wmkf_proposalroster` entity.
- Item 5: live-probed `akoya_request` via `EntityDefinitions` API in the meeting — 3 of 4 proposed fields already exist (`wmkf_numberofyearsoffunding`, `akoya_request` Money field, `akoya_expenses`). Only `wmkf_totalothersources` is net-new.
- Item 6 (drain-vs-PA write conflict): deferred — in-meeting plan (PA flow recomputes on every child write) flagged by Codex as direct violation of `INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" rule.
- Items 2, 4, 7, 8: locked as recommended.

Downstream code patches landed for the Item 3 enum expansion (PI/Co-PI source filter in `contact-history.js`, `acceptance-w4.js`, plus comment in `inspect-request-copis.js`) and the Item 5 reuse of `akoya_request` field (removed award-amount fallback in `lookup-grant.js` to avoid surfacing drain-written applicant ask as award amount on pre-decision records). Form mapper resolved 2 entity-choice TODOs.

### Afternoon — Item 6 resolution sync

Wrote `docs/INTAKE_PORTAL_ITEM_6_DISCUSSION.md` — 5 options (A–F) conditional on two Connor-only answers. Three doc-iteration rounds with Codex before the meeting tightened verification claims to Microsoft Learn (v1 had wrong rollup latency 1hr vs actual 12hr-mass/1hr-incremental, unverified PA trigger filter capability, vague plug-in cost; v2 over-claimed feature combinations; v3 narrowed VERIFIED tags to feature-existence with combination claims tagged `[partially verified — Connor must test in maker portal]`).

Connor's answers locked the **A+B hybrid** path:
- **Q1 — does AkoyaGO write `akoya_request` / `akoya_expenses`?** "GoApply updates write to these fields." → Option C (rollup fields) is dead.
- **Q2 — accept narrow exception to 'they never write the same field'?** "Yes, with the narrow exception language."

Option A (status-gated PA flow filtering on parent status via lookup navigation) ships for slice 0; Option B (`$batch` + change sets in `dynamics-service.js`) ships as near-term infrastructure follow-up.

Four preconditions before deploy: three pre-deploy (maker-portal Test 1 + Test 2 + rule-exception edit in design doc) + one post-deploy gate (real-schema verification before PA flow goes live).

Codex in parallel wrote `docs/INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md` (823 lines, step-by-step PA runbook for Connor) and `docs/INTAKE_PORTAL_ITEM_6_QUICK_PROBE.md` (companion fast-path probe). Post-sync doc patches went through three more Codex review rounds catching internal-consistency issues across § 0 preconditions, § 8 next-steps, and Status paragraph wording.

### Commits

- `4bcfdd6` — S149 schema-review decisions — code + doc patches, Item 6 deferred
- `83b4495` — Item 6 discussion doc — drain-vs-PA write conflict options for Connor
- `1c9e143` — Item 6 Connor sync — Q1+Q2 locked, A+B hybrid path, maker-portal test runbook

### Cross-cutting findings worth carrying forward

- **Codex catches `[VERIFIED]`-tag over-claims systematically.** v1 claimed feature behavior from training-data memory (wrong). v2 verified primitives against Microsoft Learn but claimed combinations as VERIFIED when only the individual features were documented. v3 separates the two: `[VERIFIED via URL]` for feature-existence, `[partially verified — Connor tests in maker portal]` for combinations. Saved as memory rule `feedback_verify_external_platform_claims`.
- **Codex output must be pasted verbatim.** I summarized two Codex round-trips mid-session; Justin caught it. Memory rule `feedback_codex_verbatim_output` — applies regardless of how Codex was invoked (inline command vs. Agent subagent).
- **GoApply coexistence shapes schema decisions.** Item 6's path collapsed because Connor confirmed GoApply still writes the same fields the drain wants to write. Read-only conversions (rollup fields) are off the table for any field GoApply touches until the GoApply replacement is complete.
- **Live `EntityDefinitions` probing during meetings is high-leverage.** Item 5's "verify Connor live" step landed 3 field reuses in 5 minutes that would otherwise have shipped as net-new fields, defeating the human-legibility principle that the morning session had just locked in.
- **Background `codex-rescue` agents can't get Bash permission grants.** Two attempts in this session stalled; relaunched in foreground both times. Use foreground for `codex-rescue` until permission flow improves.
