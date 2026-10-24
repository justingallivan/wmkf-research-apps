---
title: Meeting presentation approval implementation receipt
domain: product
kind: audit
status: in-progress
last_verified: 2026-10-23
---

# Meeting presentation approval implementation receipt

Scope: first approval increment of the Meeting Coordination plan, on `codex/session-start-20261023`. Entry is the new panel and strict approval route; persistence is migration 086's visibility/edition tables; consumers are both external presentation and briefing services. Prior findings: plan review F3 (retained split identities), F4 (sticky enrollment), and coordinator-only authority. No production schema writes, deployment, email or paid application processing occurred. The owner authorized a filenames-only tracker read and a Claude Opus OAuth product review.

| Invariant | Mechanism | Verification |
|---|---|---|
| Preparation does not expose replacements | Sticky visibility row; only its active receipt selects external members | Policy tests populate old approved, new replacement and internal material simultaneously |
| Corrections preserve the approved set | Exact receipt identities resolve superseded registry rows; no mutable split-state lookup | Both real external resolvers tested with superseded approved source and newer unapproved video |
| Only assigned coordinator can publish/withdraw | Shared Admin role, exact linked active profile, app guard, role recheck after external waits | Coordinator, service and route tests |
| Old approval cannot undo withdrawal | Request row lock, expected visibility version, unique command identity, active-pointer replay guard | Real local PostgreSQL approval/withdrawal race and replay tests |
| Bytes and source must still match | Current-bound candidate fingerprint; all five existing source/output leases; live metadata and text SHA-256 | Changed bytes, lost lease, changed role, stale fingerprint and missing slot tests |
| Unknown state never falls back | Policy reads map storage failure to unavailable; enrolled null yields no presentation | Outage, enrollment-during-read and withdrawal tests |
| UI cannot show stale request results | Abort controllers, request generation and mutation generation guards; keyed parent | Delayed old GET test; component and card suites |
| Header describes approved Board state | Edition policy separate from current draft readiness | Explicit approved, withdrawn and unknown header tests |

Contract audits: whole flow traced from UI payload through route/session context to service, transaction and both readers. Partial success is a single atomic visibility switch; pre-switch failure retains the old pointer, and confirmed mutation notices survive a failed follow-up GET. Async policy is rechecked after Graph awaits; remaining post-check concurrent change has ordinary snapshot semantics and cannot recall URLs already issued. Helpers preserve staff current-winner behavior and independent applicant-material eligibility. Durable surfaces: migration/manifest, dedicated Atlas page/index, route matrix and generated counts registered; metadata bounded per receipt, retained without cleanup. New raw visibility fields are confined to store/model/reader/service; no broad superseded-row policy was introduced. Documentation scope distinguishes this increment from the remaining planned orchestration and redesign.

Complement/fall-through: unknown actions/keys/versions/IDs reject; non-coordinators cannot mutate; unbound/missing video cannot form a candidate; staff discussion/full transcript/full recording are outside the three-type allowlist; wrong request/file/byte identity fails closed; enrollment-read error is not absence; withdrawn/no-edition markers do not use legacy selection. Truly unenrolled requests retain their prior behavior. Applicant files are independently checked and are not withdrawn with the presentation.

[VERIFIED via tests] Ten policy/service/route/external-consumer suites passed 252 tests. Six panel/card/header regression suites passed 287 tests before three additional edition-header cases were added; the follow-up two suites passed 76 tests. Actual migration 086 passed five tests in a random isolated local PostgreSQL schema. Focused lint had zero errors; seven warnings in pre-existing parts of RecordingAndTranscriptCard remain. Type checking passed. Default Turbopack build could not follow the worktree's external node_modules symlink; supported `next build --webpack` passed.

[VERIFIED via bounded synthetic browser check] Actual panel and shared Button rendered at 1440×1000 and 390×844. Replacement required both review checks and final confirmation; withdrawal showed the recall limit; helpers had no mutation controls; mobile had no horizontal overflow. Synthetic API only, not a signed-in application or live media acceptance. Screenshots were inspected; Impeccable detector returned no findings. No full-page redesign or live processing QA is claimed.

[VERIFIED via sequential gates/self-tests] API matrix covers 308 route files; Atlas coverage, route/service boundary, Dynamics context boundary, trust-boundary GUID, lifecycle/auth, agent symlinks, fact consistency, document currency/catalogue, migration manifest and secret scan passed. Existing external-material route guard warnings remain unchanged. Canonical counts and the IT brief's current route pointer updated together.

[PLANNED] Claude Opus product review is running via verified `claude.ai` Team OAuth, with provider/API-key environment variables removed, strict empty MCP configuration and read-only Read/Grep/Glob tools. No Ultrareview or direct model API substitution. Review result/adjudication will be recorded before calling this increment complete.

Release restrictions: migration 086 is not applied to Production; the filename query proves allocation only. Apply through the canonical runner, verify physical tables/constraints, rehearse both consumers and preserve an edition-aware rollback floor before any promotion. Plan slices 1–3 remain an integrated release dependency. Remaining work includes durable preparation, truthful acknowledgement removal, manual source pairing, coordinator collection sends, before-meeting UI and Workbench layout. This receipt does not mark the whole tracker complete.
