---
name: project-sandbox-request-status-business-rules
description: "Sandbox akoya_request creates fail without the Factory's GoVerify bypass, and request status is derived by entity-scoped business rules (Phase I Invited → \"Proposal Invited\"; \"Phase II Pending Committee Review\" only when wmkf_proposalreceived lands while Phase II status is empty; production's newer rule derives \"Phase II Pending\" from Phase II status alone; sandbox rules are stale 2024 copies), found when the J27 Factory batch ran 2026-11-09"
metadata:
  node_type: memory
  type: project
  status: active
  originSessionId: 90b09a89-3fb2-4b7a-9bce-c5fb5d8ee6b4
  modified: 2026-11-09T04:12:05.464Z
---

## Recall Rule
Read before creating or finalizing Request rows in the sandbox, or before asserting a derived `akoya_requeststatus` after a Phase I or Phase II write.

Facts (observed 2026-11-09 UTC, batch `owner-j27-2026-11-09`, sandbox `orgd9e66399`):
- Every sandbox Request POST is rejected transactionally (HTTP 400 / `0x80040265` wrapping a remote 500) by the synchronous `GOverify- check Publication 78 on create of a request record` workflow. The Factory's journaled, restore-guarded bypass (`createRequestWithGoverifyBypass`, CLI flag `--bypass-goverify`, sandbox-only) is the only working path; the owner authorizes it per batch. A failed run's ledger row stays `needs_attention` and refuses re-POST, so a retry needs a new `--batch-key`.
- `WMKF Phase I Set Request Status` (entity-scoped) writes `Proposal Invited` when Phase I is Invited (100000003), `Phase I Pending` for Scored and Not Scored, and leaves Intake and Semi-finalist values blank.
- `WMKF_Set Phase II Request Status` (entity-scoped) fires only when `wmkf_proposalreceived` is set, and branches on `wmkf_phaseiistatus`: empty (and `akoya_grant` empty) → `Phase II Pending Committee Review`; 100000001 → `Phase II Declined`; 100000000 → `Phase II Deferred`; 100000003 → `Approved`. No branch for 100000002, so a row whose Phase II status is already Pending Committee Review derives nothing. The sandbox string is `Phase II Pending Committee Review`; the production census (`lib/services/dataverse-export/constants.js`) shows `Phase II Pending`. Production (read 2026-11-09, owner-authorized) runs different rules: `WMKF_Set Request Status Program Phase II` (2024-09) derives `Phase II Pending` directly from Phase II status 100000002 or 100000004 and never reads `wmkf_proposalreceived`. The sandbox's 2024-04/07 rules predate it, so the sandbox cannot derive `Phase II Pending` at all. Production, not the sandbox, defines the Workbench gate strings.
**Why:** the J27 Factory scenario 7 expected `Phase II Pending` from the Phase II write and stopped; the read model's invitation gate (Phase I Invited and request status Phase II Pending) therefore encodes proposal receipt.

**How to apply:** evidence in the Factory code review (`J27_FACTORY_SANDBOX_SCENARIOS_CODE_REVIEW_2026-11-08`, 2026-11-09 addenda, a plans document on branch `codex/j27-factory-scenarios`, not yet on main). Related: [[feedback-factory-safe-not-full-fidelity]], [[feedback-question-the-rehearsal-venue]].
