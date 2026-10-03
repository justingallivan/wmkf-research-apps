# Claude Fable review — AssemblyAI pilot revision 2

Reviewed plan SHA-256: `3ebf92913530b0a32657b33dfa1f92d250dbba643c5191a3d22864ec9afd26ef`.
Reviewed commit: `bdc5919ed`.
Model returned: `claude-fable-5-1`; firstParty provider. Claude.ai Team OAuth verified before delegation; API-key/provider override environment variables removed. Read/Glob/Grep tools only; permission denials: none. No Ultrareview or direct model API was used. CLI reports list-price equivalent usage, not evidence of an API charge.

The following is the complete reviewer text, preserved verbatim. This review does not amend the plan or authorize implementation. Provider documentation was not independently fetched by the reviewer.

Write is disabled in this session, so the review is delivered here in full.

# Claude Fable review — AssemblyAI pilot plan, revision 2

Reviewed `docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_PLAN_2026-09-30.md` (revision 2) against the revision 1 review in `docs/plans/evidence/ASSEMBLYAI_PILOT_FABLE_REVIEW_2026-09-30.md`. Worktree at bdc5919ed, clean. Tools used: Read, Glob, Grep only. No vendor documentation was fetched, so every AssemblyAI behavior claim below is graded as plan text, not verified fact. No edits, commands, deployments, paid products, or direct model APIs were used.

## Verdict

**Design-ready for a bounded non-sensitive implementation slice after four must-fix text corrections. Not approved for confidential recordings pending account retention confirmation.** Revision 2 resolves or correctly defers all 27 original findings. The remaining design gaps are text ambiguities in callback authentication, the operator reconciliation surface, delete-versus-lease semantics, and evaluation score retention. Everything else is implementation verification.

## Disposition of the original 27 findings

| # | Status | Rationale |
|---|---|---|
| 1 | Resolved | Exact US/EU hosts, no-redirect option with unchanged defaults and regression tests, buffered body. safeFetch has no options surface today (`lib/utils/safe-fetch.js:65`), so adding one is implementation work. |
| 2 | Resolved | Exact anchored proxy exemption specified. The worker route is already exempt via the api/cron prefix in `proxy.js:198`. |
| 3 | Resolved | Named verifiers and "shared secret" wording match the checker's HMAC_GUARDS list and row regex in `scripts/check-api-route-security-matrix.js:32-79`. |
| 4 | Resolved | Reconciles the uploads token plus two provider secrets. Confirmed the uploads token is still absent from `lib/utils/tracked-secrets.js`. |
| 5 | Resolved | 300s route and vercel.json entry, 240s budget, 7-minute lease, overlap skip, no lease renewal. A specific vercel.json entry is required because the cron glob is 120s; drain-review-panels is the precedent. |
| 6 | Resolved | Both switch names and independent recovery/cleanup semantics specified. |
| 7 | Resolved | Non-null profile required for every user operation. Consequence worth stating: the pilot cannot be exercised locally under AUTH_REQUIRED=false, since `requireSuperuser` returns a null profile there (`lib/utils/auth.js:447-449`). |
| 8 | Resolved | Strict constant-time verifier with no development bypass, following `review-panel-rollout.js:95`. |
| 9 | Resolved with modification | Immediate logical expiry on read plus minute-worker physical cleanup is stronger than the original "no earlier than" suggestion. |
| 10 | Resolved | Bounded 50 MiB buffer with byte counter and measured peak memory. The measurement itself is verification. |
| 11 | Resolved | Purpose-separated AES-GCM/HKDF. The existing module hardcodes its context string and secret (`upload-session-crypto.js:4-8`), so a new module or parameter is needed. |
| 12 | Resolved | Ready and submission_uncertain CHECKs specified. Expiry must flip state and null content fields in one UPDATE or the ready CHECK fails. |
| 13 | Partial | Correlation is unified. But "unknown authenticated correlators" is only reachable if the header is recomputable from the correlation ID alone; the text names two artifacts and stores a digest, leaving a static-header implementation possible. See N1. The 503-on-DB-failure branch assumes 5xx retry; see N2. |
| 14 | Resolved in plan text; vendor behavior unverified | Query correlation, per-attempt header, audio_url verification, operator-only fallback. Whether the transcript object echoes the exact upload reference is a fixture check. The operator fallback has no route; see N3. |
| 15 | Resolved | One global slot via partial unique index on a constant. Precedent for partial unique indexes on active states exists in migration 009. Unique violation on queued→submitting must be handled as "slot busy." |
| 16 | Partial | Retaining the route is a legitimate owner decision. The export is manual with no trigger or owner. Scores are numeric, not content, yet the receipt wording does not retain them. See N4. |
| 17 | Resolved | Allowlisted diagnostic shape with credential fields stripped. The phrase "store the raw provider response" in the same section should say "allowlisted" to avoid self-contradiction. |
| 18 | Resolved | Explicit prohibition covering filenames, notes, headers, references, full errors. |
| 19 | Resolved | Vendor dashboard plus content-free duration receipts; no unsupported internal integration claimed. |
| 20 | Resolved | Total persisted-state to display-label mapping. |
| 21 | Resolved | Dedicated audio service through safeFetch; no usage-log write. |
| 22 | Resolved as decision | Webhook retained for uncertain-submission recovery; polling authoritative; Preview limitation acknowledged. The added surface (route, exemption, matrix row, checker, secret) is accepted knowingly. |
| 23 | Partial, correctly gated | The author's inference (callback carries only an ID, so immediate deletion would break the webhook path too) is sound, but its premise is itself an unverified vendor claim. The plan correctly keeps account behavior as a prerequisite before enabling and as a confidential-use gate. |
| 24 | Resolved as far as documentation allows | No idempotency parameter found; absence not claimed as proof; the no-resubmit policy does not depend on it. |
| 25 | Partial, correctly gated | Upload-only lifecycle remains a fixture/support check; the unresolved-cleanup receipt covers the unknown. |
| 26 | Resolved in plan text; vendor behavior unverified | 2xx within 10 seconds, up to 10 attempts, 4xx stops. The plan's 5xx behavior relies on retries the summary does not state. |
| 27 | Resolved | Requested plus actual model when returned, otherwise "not reported"; DELETE metadata a fixture check. |

## New actionable findings

**N1. HIGH. Durable model and transitions (lines 68–70). Callback authentication derivation is ambiguous.** The text persists "an immutable attempt nonce" and separately "a random attempt correlation ID and a digest of its per-attempt callback authentication value," derives the header from the secret and the nonce, and then says unknown correlators are "authenticated." An unknown row has no nonce or digest to compare against, so that branch is unreachable unless the header is recomputable from the correlation ID alone. Failure scenario: an implementer resolves the contradiction by sending a static header derived from the secret only, losing per-attempt binding, so anyone who learns the header can inject candidate IDs for any attempt. Minimal correction: define one artifact. The correlation ID is a random per-attempt value. The header value is HMAC-SHA256 keyed by the webhook secret over a fixed purpose prefix plus the correlation ID. The route recomputes and constant-time compares before any row lookup. The stored digest is unnecessary and should be dropped or marked optional. Add one sentence that rotating the webhook secret invalidates callbacks for in-flight attempts and routes them to polling or operator reconciliation.

**N2. LOW. Durable model and transitions (line 70). 503 on transient DB failure assumes the vendor retries 5xx.** The plan's own finding-26 summary says only that 4xx stops retries. The BILL webhook precedent returns 200 on DB failure to avoid retry storms (`pages/api/webhooks/bill.js:114-119`). Failure scenario: the vendor treats 5xx as terminal, the callback is lost, and the job relies on polling anyway. Minimal correction: label the 503 as a deliberate divergence with unverified benefit, state that polling is authoritative, and cover the 503 path in the missing-webhook test.

**N3. MEDIUM. Proposed API and service surface (lines 47–54) versus line 72. Operator reconciliation has no route.** Line 72 promises the operator can supply a provider ID or explicitly abandon an attempt, and line 20 says an uncertain job holds the single global slot until that happens. No route or UI action is listed. Failure scenario: one lost submit response wedges the entire pilot, and the only unwedge is a hand-edited database row with no audit trail and none of the uniqueness checks. Minimal correction: either add two owner-only, superuser, flag-gated routes (reconcile with provider ID; abandon attempt) with matrix rows and the same API-key, audio-reference and uniqueness checks, or state explicitly that these are documented SQL runbook steps for the pilot and list them under the runbook gate.

**N4. MEDIUM. Privacy, retention and deletion (line 92) and sequence step 5. Evaluation scores are purged with content.** Numeric 1–5 scores and the content-free job receipt are not content, yet the receipt text retains only duration and job identity. The export is a manual instruction with no trigger. Failure scenario: a recording transcribed on day one is scored on day three and its result expires on day eight before the five-recording comparison is written up. The score and the job's provenance are gone. Minimal correction: list scores, processing duration, model identity and ready/expiry timestamps as fields of the 30-day receipt. Keep free-text notes on the 7-day content schedule. Name the owner and trigger for the dated evaluation export.

**N5. MEDIUM. Proposed API (line 52) and Privacy (line 96). DELETE semantics against a valid lease and the global slot are implied, not stated.** Failure scenario A: DELETE changes the state of a job whose worker is mid-upload, the state leaves the slot set, a second job submits, and two provider jobs run concurrently against the one-slot promise. Failure scenario B: DELETE on a submission_uncertain job is treated as the "explicit close," releasing the slot and hiding duplicate-cost exposure. Minimal correction: DELETE sets cleanup_requested_at only. It never mutates a processing state while a lease is valid. The worker performs the transition after its external call returns. A queued job without a lease may transition directly. DELETE on an uncertain job records the request but does not release the slot until reconciliation or an explicit abandon action with its cost receipt.

**N6. LOW. Durable model (line 70). "Conflicts remain unresolved" names no state.** Failure scenario: a callback candidate ID and a POST response ID differ, the job stays in processing, its lease expires, and a later worker re-claims and binds one of them. Minimal correction: a mismatch transitions the job to submission_uncertain with both IDs recorded content-free, holds the slot, and requires the operator path.

**N7. LOW. Upload and runtime feasibility (line 86). Flag literal "on" diverges from repo convention.** Existing flags compare against the string "true" (`pages/api/cron/drain-review-panels.js:10`, virus scan). Minimal correction: use "true" unless there is a reason to differ, and say so.

**N8. LOW. Durable model (line 94). Failed jobs after content purge need a permitted shape.** Cleanup is independent of state, so a failed job keeps state failed with nulled content fields. Minimal correction: state that CHECKs constrain only ready and submission_uncertain, and that the display mapping covers "failed, content purged."

## Feasibility and approval, assessed separately

**Non-sensitive pilot: feasible with the current design.** Every integration gate the first review found is now named, and each matches source. Repository precedents exist for every mechanism: lease-token-gated writes in `lib/services/portal-upload-staging.js`, one-active-job partial unique indexes in migration 009, sealed references and shape CHECKs in migration 055, keys-only webhook logging in the BILL route. The real unknowns are runtime media inspection within the function budget, maximum-size transfer timing, and the provider fixture checks the plan already lists as prerequisites. None of these block starting a bounded implementation slice. They block enabling the pilot.

**Confidential data: not approved, and the plan is right to say so.** The gate is account-specific async retention behavior plus contractual coverage of audio, transcript, derived content and subprocessors. Owner-reported settings are not account guarantees, and nothing in this review verifies vendor documentation. Keep that gate separate from pilot enablement.

**Must-fix design gaps** (plan text, before sequence step 2):

1. N1: one callback-authentication derivation recomputable from the correlation ID; drop or mark optional the stored digest; note secret rotation.
2. N3: operator reconciliation surface, as routes or as named runbook steps.
3. N5: DELETE never mutates a leased processing state and does not release the uncertain slot.
4. N4: scores and provenance in the 30-day receipt; named owner and trigger for the export.

Fold N6, N7, N8 and the finding-17 wording nit into the same pass.

**Implementation verification tasks** (not design gaps):

- Specific vercel.json maxDuration entry for the new cron route; confirm the effective limit in a deployment.
- safeFetch no-redirect option with unchanged defaults and regression tests; buffered provider upload body.
- New purpose-separated crypto module or parameterized context; confirm the encryption secret's availability or provision a dedicated key.
- Partial unique index on a constant; the queued→submitting claim treats unique violation as slot busy.
- Expiry UPDATE flips state and nulls content fields atomically under the ready CHECK.
- Document that local development requires real auth because the bypass cannot create an owner.
- Media inspector library choice, runtime compatibility, bounded duration, malformed-file behavior, peak memory at 50 MiB.
- Vendor fixtures: audio_url echo equals the stored upload reference; webhook query and header delivery; retry behavior on 5xx; model identity and DELETE metadata; upload-only lifecycle; actual async TTL window.
- Discriminating tests as listed in the plan, plus three additions: callback candidate ID disagreeing with the POST response; DELETE during an in-flight upload; DELETE on an uncertain job.
