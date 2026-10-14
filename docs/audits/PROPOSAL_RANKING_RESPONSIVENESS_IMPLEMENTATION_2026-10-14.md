# Proposal Ranking responsiveness implementation

Date: October 14, 2026. Implementation: `85d07a3bf`, review fixes `99977ce93` on `codex/ranking-pd-save-conflicts`. Production promotion is outside this change.

## Behavior and contract evidence

[VERIFIED via source and 237 passing ranking tests] Private card/bar/confidence edits use one memory-only queue. The first request starts immediately; edits made while it saves replace the queued draft. Functional updates retain rapid choices. Returned receipts, actor/round/preparation/policy, and the expected complete own state are checked before another request starts. A peer-only ETag change may use the existing bounded transport retry; a newer edit from another tab blocks the queue. The authoritative raw view remains the transport base.

[VERIFIED via source/tests] Uncertain outcomes retain the exact final attempted operation and latest draft separately. Missing confirmation stays uncertain. Definite rejections can reload and retry only if own state and scope are unchanged. Access loss clears private state. Timeouts are bounded to 30 seconds and are not proof that a write was canceled. Confirmation/lifecycle actions, refresh, export, history and program navigation wait for a clean queue. Previous-run loads acquire the exclusive busy lock. In-app route and unload guards protect unsaved work; forced browser termination cannot preserve the memory-only draft.

Contract trace: `AssessmentList` → `AssessmentWorkflow` → `private-save-queue.js` → `client.js` → existing ranking API → `workflow-service.js`/`workflow.js` → existing atomic Dataverse changeset plus receipt → acknowledged view and projected draft. No new schema, storage format, provider calls, authorization policy or shared-discussion save behavior.

Complement audit: unknown errors are uncertain; missing/wrong receipts cannot clear the queue; confirmed but unexpected own/scope data blocks; rejected retries with changed own data cannot write; operation-ID reuse blocks; 401/403 clears. Discard is unavailable for unresolved/integrity operations. Late responses after unmount are ignored. Tests use populated contrary states, not empty fixtures. Partial success unit remains one assessment transaction; subsequent local edits are not reported saved by an earlier acknowledgement.

## Verification

- All 22 Proposal Ranking Jest suites: **237 tests pass**.
- Changed-file ESLint, `check:types`, and `npm run build`: pass.
- Status-enum gate/self-test and trust-boundary GUID gate/self-test: pass. The GUID self-test required host execution for temporary worktree fixtures.
- Real-client integration tests cover peer conflict/rebase followed by response loss and exact replay, failed recovery GET, expected receipt/readback, timeout, and rejected retry.
- UI tests cover unresolved move → confidence, latest-draft coalescing, keyboard drop/radio focus, navigation barriers, old-run load locking, StrictMode and recovery.
- Existing static rehearsal clients now emit synthetic operation receipts and use a router-event stub; both harness builds reference the stub. These are fictional adapters, not proof of live auth or navigation behavior.

## Browser experiment

[VERIFIED via loopback Chrome rehearsal] Use `scripts/rehearse-proposal-ranking-v2.js`, choose 23 proposals / 4 PDs, private preparation and the two-second save delay. `scripts/probe-ranking-responsiveness-browser.js` moves the same card then selects confidence while the move save remains pending, waits for the queue to drain, and repeats eight times. It asserts the selection, availability and saving indicator. The fixture has four identities; this timing run uses one identity and is **not** a simultaneous four-user rehearsal.

Baseline: archived `202824194` UI on loopback port 3136, with the same fictional fixture/delay adapter. Candidate: `99977ce93` UI on port 3135. In the baseline, inherited fieldset disabling is checked with `:disabled`; radio.disabled alone is insufficient. The baseline probe waits for controls to become enabled before selecting confidence. Browser errors: zero in each accepted run.

| Measure, n=8 each | Previous UI | New UI |
|---|---:|---:|
| Time from second interaction attempt to selected radio, nearest-rank p50 | 2020.3 ms | 4.5 ms |
| Nearest-rank p95 (maximum for n=8) | 2024.2 ms | 6.9 ms |
| Confidence disabled while first save pending | 8/8 | 0/8 |

Raw selected-radio timing samples (ms): baseline 2014.6, 2020.3, 2019.5, 2024.2, 2021.1, 2023.9, 2020.9, 2019.9; candidate 5.1, 4.3, 6.9, 4.5, 4.4, 4.6, 4.4, 4.6.

These measurements use a synthetic fixed save delay, local Chrome and fictional data. They demonstrate removing the UI wait, not faster Dataverse commits, production INP, cold/warm save latency or a network payload improvement. No real D26 assessments were changed. Independent live PD acceptance and backend latency measurement remain release checks.

## Review and rollout

Claude Opus reviewed through the Team OAuth session. Its initial two medium findings (Back/Forward URL restoration and acknowledgement during drag) were fixed and tested. A focused follow-up reports **No blocking findings**. Full reviews, dispositions and low-priority residuals: `docs/audits/PROPOSAL_RANKING_RESPONSIVENESS_CODE_REVIEW_2026-10-14.md`.

[VERIFIED via real Next.js 16.3.8 Pages Router + Chrome on loopback port 3137] A temporary app mounted the real component with the fictional transport, not a router stub. Dirty suite-link, browser Back and Forward all retained `/ranking` and the selected confidence; clean Back navigated normally; the warning cleared after saving. Browser errors: zero. Automated unit coverage separately pins restoration of Next history metadata and the mid-drag acknowledgement case.

[VERIFIED via Vercel CLI] `99977ce93` deployed as Preview `dpl_34BbqkNXbayt1QjGHH3DMejjDRAm`, Ready. The existing `https://wmkf-meeting-transcription-test.vercel.app` alias now points to `https://wmkf-meeting-transcription-test-d7zjl0gji.vercel.app`. The unique hostname intentionally returns 404 under the existing exact-origin ranking policy; this is not a failed app route. Production was not promoted. Rollback candidate remains `dpl_G41fPqnqwLYVzS2sxE6ATGYiL5RE`.

Published-alias read-only smoke checks through Vercel protection: ranking page HTTP 307 (application sign-in), unauthenticated ranking API HTTP 401, sign-in page HTTP 200. These check routing/auth boundaries, not signed-in persistence.

## Scoped documentation reconciliation

Sweep Mode A: claim changed from planned to implemented client queue. Source/consumer proof is the implementation and tests above. Search terms `PROPOSAL_RANKING_RESPONSIVENESS`, `private-save queue`, and `responsiveness plan` found the accepted plan and dated Opus plan-review record; unrelated performance documents are excluded. The accepted plan's status/evidence is updated; its design remains the accepted specification. The Opus plan review remains explicitly historical review of revision 1. Live performance and multi-user acceptance are UNKNOWN, not asserted complete.
