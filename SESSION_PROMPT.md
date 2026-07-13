# Session 361 Prompt: first reviewer identity-binding caller observation

## Current objective

Observe the newly promoted first production caller of
`reviewer-identity-binding-writer.js` without widening the identity-policy
migration.

Implementation PR #57 merged to `main` at `00ffb09c`; deployment
`dpl_4YpnVVdRmDHyuzgPVSKXNcx22bKu` is READY on the production aliases. Current
follow-up branch: `codex/reviewer-binding-activation-live-docs`.

## Decision and scope

The owner approved this exact first-caller strategy on 2026-07-13:

1. Activate the writer only in the durable reviewer-acceptance drain's
   self-report path, using the acceptance job's stable `accepted_at`.
2. Clean unbound and already-bound rows use the versioned writer.
3. Only typed `IdentityBindingWriteError` code
   `legacy_classification_required` may use the existing transitional person
   writes.
4. Every other writer failure fails closed before contact fill, honorarium,
   back-propagation, board identity, email, quota, or job completion; the durable
   job remains retryable.
5. Decline/no-stable-timestamp capture, automated writers/readers, backfill,
   merge/action policy, and the four Wave 13 suggestion COI fields are unchanged.

## Promoted implementation

- `lib/services/capture-self-reported-orcid.js`
  - accepts `bindingEventAt`;
  - builds a partial `self_reported` binding event with canonical ORCID anchor;
  - accepts only committed writer outcomes `init`, `refresh`, `rebind`, `noop`;
  - uses the legacy two-write fallback only for the exact typed classification
    error;
  - performs contact fill only after person persistence.
- `lib/services/reviewer-acceptance-drain.js`
  - canonicalizes `accepted_at` / payload `acceptedAt` to ISO;
  - captures the self-report before honorarium and all other follow-up;
  - removes the pre-persistence synthetic in-memory `confirmed` value;
  - marks the in-memory reviewer confirmed only after capture returns
    `{persisted:true}`;
  - lets binding/capture failures bubble so the acceptance job retries.
- Unit tests pin stable event reuse, Date normalization, ordering, typed-only
  fallback, forged/untyped error refusal, blocked/missing/unknown outcome
  refusal, and no downstream work after capture failure.

## Verified evidence

- Focused contract suite after the final fail-closed tightening:
  5 suites / 135 tests green (capture, acceptance drain, binding writer,
  honorarium orchestrator, ORCID back-propagation).
- Adjacent acceptance/trust suites: 3 suites / 45 tests green. Scoped ESLint and
  `check:types` are green.
- Full suite: 482/482 suites and 5,504/5,504 tests green. Production build is
  green.
- Atlas, API-route, Dataverse-DAL, route/service-boundary, docs-catalog,
  fact-consistency, doc-symbol, build-claim, doc-currency, memory-router, and
  memory-drift gates are green; every defined self-test was run sequentially.
- Pre-activation production population probe on 2026-07-13:
  4,417 potential-reviewer rows; 0 bound; 2,559 clean unbound; 1,858
  legacy-dirty. This was read-only and does not imply post-deployment state.
- Final read-only Wave 13 preflight: 0 ABSENT / 10 EXACT / 0 DIVERGENT, zero
  populated person rows, zero populated suggestion rows, and second-precision
  persisted resolver timestamps. The earlier evidence remains captured at
  `docs/audits/reviewer-identity-binding-prod-preflight-2026-07-13.md`.
- `/contract-reconcile` Mode B is complete across whole flow, async/retry state,
  helper semantics, durable surfaces, docs, and raw caller fan-out. `/sweep`
  leaves zero live stale first-caller claims; remaining old claims are explicitly
  historical records.
- Post-promotion verification: the production deployment is READY; three
  scheduled acceptance-drain calls completed with no error-level logs. An
  immediate post-deploy population probe still found zero Wave 13 rows, so the
  caller is live but no first durable binding event has yet been observed.

## Next observation

1. After the next reviewer acceptance containing a valid self-reported ORCID,
   re-run the read-only population/preflight and inspect acceptance-drain logs.
   Confirm that a clean row gains the expected self-reported binding, or that a
   dirty legacy row takes only the approved typed fallback.
2. Keep automated writers, backfill, policy readers, merge/action policy, and
   suggestion COI currency gated until separately approved.

## Parked / unchanged

- Policy reader and complete consumer migration (plan I2.3).
- Automated, staff-correction, merge, revocation, and backfill callers.
- Structured suggestion COI currency readers/writers.
- Legacy-row classification/backfill beyond the explicitly approved self-report
  fallback.
- Interlock `warn` to `on`, Daily Maintenance operational confirmation,
  `label_conflict` spot-check, reviewer-institution linking, and address-based
  onboarding scope.

## Key files

- `lib/services/capture-self-reported-orcid.js`
- `lib/services/reviewer-acceptance-drain.js`
- `lib/services/reviewer-identity-binding-writer.js`
- `tests/unit/capture-self-reported-orcid.test.js`
- `tests/unit/reviewer-acceptance-drain.test.js`
- `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`
- `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`
