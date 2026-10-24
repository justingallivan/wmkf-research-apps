---
title: Meeting presentation approvals
status: branch-built
last_verified: 2026-10-23
---

# Meeting presentation approvals

[VERIFIED via migration 086 and isolated PostgreSQL tests, 2026-10-23] Source-built on `codex/session-start-20261023`; not deployed. The owner-authorized filenames-only Production tracker query found no migration 086, and 355 local/remote refs had no allocation above 085. This does not prove physical Production schema. Apply migration 086 with the canonical migration runner and verify both tables and constraints before deploying the new readers; no production apply is authorized by that filename query.

`meeting_presentation_visibility` holds one sticky enrollment row per Dataverse Request GUID, a nullable active edition UUID, monotonic optimistic version, and enrollment/change/withdrawal actors and times. Its composite foreign key prevents a cross-request active pointer. No row means existing legacy presentation selection; an enrolled row with no active edition means no presentation members. Database errors never authorize legacy fallback.

`meeting_presentation_editions` holds append-only application approval receipts: request/command uniqueness, source revision and presentation ending, three bounded JSON file identities, fingerprint, approving profile and time. Member types are restricted in the model/store to Presentation Transcript, Transcript Summary and Presentation Video. Text identities pin size, SHA-256 and eTag; video identities pin the approved cut, exact drive/item, size and quickXorHash. No transcript text, tokens or download URLs persist here. The receipt is immutable through the application, not a database-trigger guarantee.

Writes: `edition-service.js` rechecks the configured Program Coordinator and active profile, uses the existing five artifact slot leases, checks current candidate identity and live SharePoint metadata/text bytes, renews leases and rechecks role before `edition-store.js` atomically inserts a receipt and switches the pointer under a request-row lock. Withdrawal compares version and exact active edition. Enrollment uses `ON CONFLICT DO NOTHING`, without restamping. A replayed withdrawn command cannot revive an edition.

Entry points: `PresentationApprovalPanel.js` → `/api/meeting-tracker/visits/[requestId]/presentation-approval` → `edition-service.js` → `edition-store.js`. GET returns minimized status/candidate fingerprints, not file identities. POST accepts only strict enrollment, approval or withdrawal bodies, with session-derived actor. Both the presentation page and deliberation briefing read through `edition-reader.js`; they recheck policy after external waits before returning presentation bytes/redirects. Applicant materials retain their independent policy. Superseded staff registry rows remain eligible only when pinned by the active receipt and still matching its exact identity. New drafts never substitute for the approved set.

Retention: no automatic cleanup in this increment. One visibility row per request; each deliberate approval adds one bounded receipt (three members, JSON ≤16 KiB). Old receipts and referenced files are retained, including after withdrawal, for correction continuity and audit. No file deletion or token revocation is introduced. Withdrawal blocks new app access but cannot revoke URLs already issued by Microsoft or downloaded bytes.

Verification: `presentation-editions.pg.test.js` executes the actual migration in a random local-only schema and tests concurrent enrollment/approval/withdrawal, replay and cross-request constraints. Policy/service/route/component tests cover both consumers, live byte mismatch, lost leases, changed roles, internal-material exclusion, stale requests and confirmations. These tests do not assert Production acceptance or the remaining durable-processing/UI plan slices.
