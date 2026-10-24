# Meeting coordination release checklist

[VERIFIED via branch implementation and local validation, 2026-10-23] Code is on `codex/session-start-20261023` in its isolated worktree. Product decisions are settled. This document is a concrete promotion proposal, not authorization to deploy or run metered integration services.

## Prepared

- Additive migrations 086–089 and regenerated manifest; actual local migration tests and fresh-install replay.
- Coordinator-approved retained presentation editions, sticky reader enrollment, correction/withdrawal behavior and both external readers.
- Durable checked-input preparation, selective recovery, preserved edited summaries and fenced unknown provider attempts.
- Shared Admin Coordinator-owned collection requests/reminders, explicit enabled sender impersonation and helper preview-only behavior; automatic reminders stay retired.
- Existing consultant directory and explicit empty recipients, agenda keyboard ordering, task navigation, reviewed presentation invitations and PD Workbench priorities.
- Rare manual original-audio/MP4 correspondence in the existing cut worker, reusable proof, explicit replacement and bounded cleanup.
- Ordinary Opus product reviews, findings verified/fixed, scoped tests, build, gates and synthetic browser/media checks; linked receipts in `docs/audits/MEETING_*OPUS_REVIEW_2026-10-23.md`.

## Promotion sequence — requires owner authorization

1. Re-check migration allocation and branch integration against other agents before promotion. Preserve unrelated changes. Apply 086–089 to the authorized rehearsal environment using `scripts/apply-migrations.js`; never use fresh setup on an existing database. This source release requires the new columns even while new admission flags are off.
2. Deploy the consistent edition-aware readers and writers together with new-work admission off. Keep `MEETING_MATERIAL_PREPARATION_ACCESS`, `MEETING_PRESENTATION_INVITATION_ACCESS` and `MEETING_MANUAL_VIDEO_PAIRING_ACCESS` off for ordinary traffic. Verify Shared Admin Coordinator identity and explicit `DYNAMICS_IMPERSONATION_ENABLED=true` without exposing credentials.
3. Select one authorized test request. Inventory/reconcile in-flight work before sticky enrollment. Rehearse names/boundary correction, close/reopen while preparing, partial failure/retry, edited summary preservation, explicit unknown recovery, first approval, correction with old materials still readable, replacement approval and withdrawal through both external readers. Record exact deployment URL/SHA and the edition-aware rollback floor before enrollment.
4. Separately authorize any live mail or metered media/provider rehearsal. Ordinary Opus review authorization does not authorize Vercel Sandbox spending or real recipient delivery. Local tests use synthetic media and mocked remote boundaries; they do not establish hosted performance or delivery.
5. Verify genuine Zoom import/copy identities and the rare manual pair, existing worker cleanup/usage and upload recovery in the authorized environment. Enable only exact `test:<request GUID>` admission until the rehearsal passes. Keep automatic applicant reminders unscheduled.
6. Deliberate owner promotion enables ordinary traffic. Monitor durable failures and cleanup; unresolved send/provider intent must never be cleared to force a retry. A stop of new preparation must retain sticky edition readers, approved-byte references and withdrawal tombstones. Never roll enrolled requests back to pre-edition readers.

[PLANNED] Hosted rehearsal, production migrations/configuration, deployment and owner promotion have not been performed. No further product-design decision is required for the implemented scope.
