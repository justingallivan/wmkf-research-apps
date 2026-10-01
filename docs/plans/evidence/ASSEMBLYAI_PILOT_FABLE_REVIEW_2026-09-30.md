# Claude Fable review — AssemblyAI pilot revision 1

Reviewed plan SHA-256: `7d830607524eb36e1072bc297b5fa3b34170e11073afd78e679c38c9c99dc713`.
Model returned: `claude-fable-5-1`; firstParty provider. Claude.ai Team OAuth verified before invocation; API-key/provider override environment variables removed. Read/Glob/Grep tools only; permission denials: none. No Ultrareview or direct model API was used. CLI reports list-price equivalent usage, not evidence of an API charge.

The following is the complete reviewer text, preserved verbatim. Findings refer to revision 1; see revision 2 dispositions in the plan.

Review complete. The Write tool is disabled in this session, so the full review is delivered here rather than saved to a file.

**Reviewed:** `docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_PLAN_2026-09-30.md`, Revision 1, against worktree commit a7c68df01. Tools used were Read, Glob, and Grep only. No vendor documentation was fetched, so every AssemblyAI behavior claim is marked not verifiable here.

## Verdict

**Not implementation-ready. Direction sound.** The state model, lease discipline, owner binding, and privacy posture match existing repository patterns. The gaps are seven concrete integration gates the source shows are mandatory but the plan omits, plus one architectural dependency on an unverified provider behavior: whether account zero-data-retention deletes the transcript at delivery time. Resolve that question and fold the corrections below into the plan before sequence step 2.

## A. Verified source mismatches

1. **HIGH, Proposed API and Privacy sections. SSRF allowlist lacks AssemblyAI.** The allowlist in `lib/utils/safe-fetch.js:17-49` has no AssemblyAI host. A worker using safeFetch throws on its first call, and a worker using raw fetch bypasses the policy CLAUDE.md mandates. Correction: list the US and EU host additions as a gate. Also, safeFetch replays options on every redirect hop, so a streaming body cannot be replayed. The plan's "server-to-provider transfer streams" needs a buffered body or a stated no-redirect expectation.

2. **HIGH, webhook route. Proxy exempts webhooks by exact anchored path.** `proxy.js:198` exempts only the BILL and log-drain webhooks. A new AssemblyAI route would be redirected to sign-in, callbacks would never arrive, and polling would mask the failure. Correction: add the anchored matcher entry to the gate list.

3. **MEDIUM, gates. Route security matrix checker hardcodes guard names.** `scripts/check-api-route-security-matrix.js:12-36` enumerates known and HMAC guard helpers, and the matrix row must contain "HMAC" or "shared secret". Correction: name the verifier function and the row wording in the plan.

4. **MEDIUM, upload feasibility and gates. Uploads Blob token is untracked.** `lib/utils/tracked-secrets.js` has no entry for the uploads token even though the credentials runbook lists the store. Correction: add that token plus the AssemblyAI API key and webhook secret.

5. **MEDIUM, runtime feasibility. Function runway unstated.** `vercel.json:15-17` gives cron routes 120 seconds. Only two drain workers export a 300-second limit with their own entries. A 50 MiB Blob read, provider upload, and submit inside 120 seconds is unproven. A lease shorter than the wall lets an overlapping invocation steal the job mid-upload. Correction: state the worker duration, require lease TTL at least the wall plus margin, and acknowledge cron overlap.

6. **MEDIUM, worker switches. No precedent for a worker that keeps running when its flag is off.** `pages/api/cron/drain-review-panels.js:10` returns early when disabled, and the dossier rollout pauses all work on operator stop. The two-switch model must be specified, not inherited. Correction: name both env vars and state exactly what cleanup and recovery ignore.

7. **MEDIUM, ownership. Superuser gate returns a null profile under the dev kill switch.** `lib/utils/auth.js:447-449` returns a null profile when auth is not required. Owner-only rows with a null owner break every ownership query. Correction: job creation fails closed on a null profile, matching the development-bypass binding at `portal-upload-staging.js:96-103`. CSRF is covered: the superuser gate chains down to requireAuth, which validates Origin.

8. **LOW, worker auth. Generic cron auth bypasses in development.** `lib/utils/cron-auth.js:43` returns true in development, while the dossier variant has no bypass. Correction: cite the strict variant for a paid worker.

9. **LOW, retention. Expiry enforcement cadence unstated.** Maintenance runs once daily at 03:00. The 24-hour and 7-day expiries get up to a day of jitter unless the pilot worker owns cleanup. Correction: state which cron enforces each deadline and phrase expiries as "no earlier than".

10. **LOW, upload feasibility. Cited pattern buffers the whole object.** `portal-upload-staging.js:271` reads the full stream into memory. The plan reuses that pattern while promising bounded memory and streaming. Correction: state that the worker buffers up to 50 MiB, or specify a capped streaming read.

11. **LOW, durable model. A closer template exists for the sensitive upload reference.** Migration 055 has UUID ids, actor binding, state and lease-shape CHECKs, and a sealed upload URL via `upload-session-crypto.js`. The plan marks the provider upload reference server-only with no mechanism. Correction: cite migration 055 and reuse the ciphertext pattern.

12. **LOW, durable model. Terminal-state consistency constraints.** Migration 028 enforces that terminal status and completion timestamp agree. Correction: add CHECKs so ready requires output hashes and submission_uncertain requires a persisted upload reference.

## B. Design findings on durability, races, retention, and scope

13. **HIGH, webhook. Unknown-ID callback behavior is unspecified.** The BILL webhook returns 200 on unknown correlators to avoid retry storms. A callback arriving before the provider ID is committed is the normal race, and a 4xx may trigger vendor retries. Correction: return 2xx and drop with a content-free counter, since polling is primary. Lines 53 and 68 also describe two different correlation schemes. Unify them.

14. **HIGH, durable model. The submission_uncertain state cannot self-resolve as written.** After a lost submit response the row waits for an operator with no recovery path. Two unverified provider mechanisms could fix it: a per-job webhook URL or header value carrying the job id, or the transcript object echoing the submitted audio URL. Correction: list both as verification items. If neither holds, state that the UI never offers automatic retry.

15. **MEDIUM, scope. The global cap of three races across overlapping crons.** A counted check can pass twice. Correction: one active job globally for the pilot, enforced by a partial unique index. The pilot has one owner.

16. **MEDIUM, retention versus acceptance. Evaluation evidence is purged.** Line 84 expires scores and notes seven days after ready, but step 5 and the acceptance criteria depend on that evidence across three to five recordings. Correction: drop the PATCH evaluation route and record scores in a dated evidence doc under the existing evidence directory. This removes a route and a matrix row.

17. **MEDIUM, durable model. Raw provider JSON likely contains the sensitive audio URL.** Correction: redact known URL fields before storing, or classify raw-result paths as credential-bearing.

18. **MEDIUM, privacy. Log hygiene covers only error codes.** The plan classifies filename as content but does not forbid filename or transcript text in console or operational events. Correction: add that prohibition, matching the BILL webhook's keys-only logging.

19. **LOW, scope. Spend visibility.** The spend-check cron reads the API usage log, which this service will not write. Correction: state that cost is monitored at the vendor dashboard, or add a content-free cost receipt.

20. **LOW, workflow versus model. State naming drift.** The UI section uses "transcribing" and "needs-attention" while the model section uses "processing" and "submission_uncertain". Correction: one vocabulary with a label map.

21. **LOW, service boundary. The Executor question is already decidable.** The LLM client is Anthropic-only text and the OpenAI client requires text capabilities. Neither fits audio. Correction: decide now on a standalone service via safeFetch with no usage-log write.

22. **MEDIUM, scope lever. The webhook is optional only if polling can beat retention.** Dropping it removes a route, a proxy exemption, a matrix row, a checker entry, a secret, and the Preview reachability problem. This depends entirely on finding 23.

## C. Unconfirmed provider behavior, not verifiable in this review

23. **HIGH.** Does account zero-data-retention delete the transcript at delivery time? If yes, polling cannot beat it, the webhook is mandatory, and a protected Preview cannot host the test. Resolve this first.
24. **HIGH.** Is there an idempotency key on transcript creation? The plan assumes none exists. If one does, the uncertain state largely disappears.
25. **MEDIUM.** Upload-URL lifetime and auto-deletion of uploaded-but-unsubmitted audio. This decides whether an unresolved-cleanup receipt is ever needed.
26. **MEDIUM.** Webhook retry policy on non-2xx responses, which determines the cost of finding 13.
27. **LOW.** Whether results return model identity, which the UI promises to display, and whether DELETE retains metadata.

**What would make the plan ready:** resolve items 23 and 24 from current vendor documentation and record the date and URL, fold items 1 through 12 into the gate list and model section, apply items 13 through 16 as text changes that shrink scope, and keep the existing instruction not to call the plan implementation-ready until the review record carries these dispositions.
