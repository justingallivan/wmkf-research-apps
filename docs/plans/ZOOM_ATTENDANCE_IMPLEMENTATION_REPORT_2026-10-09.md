---
title: Zoom attendance implementation verification
status: branch-built-unmerged
last_verified: 2026-10-09
summary: "Offline verification of attendance and discussion attribution on codex/zoom-attendance; migration 078 is unapplied."
---

# Zoom attendance implementation verification

[VERIFIED via local source, fixtures and commands] Implemented on `codex/zoom-attendance`, based on `4e970b70f`. This receipt describes branch state, not deployed state. Justin must apply migration 078 before merge. No Production access, live Zoom calls, migration application, environment changes or paid products were used.

## Contract reconciliation

Mode A: READY TO IMPLEMENT. The accepted attendance plan and provenance handoff supplied the contract; D1–D4 and Q1–Q4 were retained. Mode B traced authenticated route → frozen source provenance → bounded report → version-checked draft → frozen publication receipt → verified bundle → discussion derivative → summary input.

| Invariant | Implementation | Evidence |
|---|---|---|
| Frozen occurrence is the sole report target | attendance-service + Zoom client | provenance/fallback and endpoint fixtures |
| Presence and attribution remain separate | discussion-attribution | silent attendee, exact-name collision and strict confirmation tests |
| Exclusion affects discussion labels only | presentation-boundary pure resolver | boundary, immutable names/times and proposal tests |
| Every output consumes the same policy | card, bundle, presentation-transcript-service | preview, TXT/VTT, derivative and summary suites |
| Edits invalidate confirmation; recovery compares frozen policy | service + store | replay, rename/end SQL, both recovery paths |
| Old formats and pilot bytes remain stable | bundle + transcript-format | pre-change v1–v6 and pilot byte fixtures |
| No raw attendance identity retention | strict decision DTO + migration | unknown-key validation and client stripping fixtures |

Whole-flow audit: preview, publish, rehydration, registry-present recovery and registry-missing recovery use the same validated decision. The derivative service resolves discussion labels before summary input is produced. Stage 4 surfaces were not changed; source provenance remains content-free.

Partial-success audit: the report is all-or-fallback, not a partial authoritative roster. Failed, malformed, truncated, repeating-token, oversized and count-inconsistent results use checked manual voices. Waiting-only counts are withheld for incomplete reports. Publish freezes one confirmed correction; recovery rejects a differing policy.

Async audit: attendance uses correction version/context plus request generation and detail-sequence checks for success/error/finally writes. The keyed request owner isolates unmounted requests. Explicit refresh resets the attendance attempt key.

Helper audit: the resolver may add only a display marker to excluded discussion utterances. It does not rewrite speaker IDs/names, timestamps, segmentation or proposal inputs. Per Justin’s follow-up decision, there is no manual shared-microphone control. Confirmation accepts exactly `{ reviewId, kept }`; extra keys, including `sharedSpeakerIds`, reject. The automatic multi-attendee voice-row rule in `attendance-service.js` and partial-report voices fallback are unchanged.

Durable audit: additive migration 078, manifest, publication Atlas, imports Atlas, API matrix, service catalog, canonical counts, wiki routing and migration allocation memory were reconciled. The existing fresh-install bootstrap runs the migration manifest; no duplicate schema in `setup-database.js` was necessary. Temporary review/draft data clears on publish/expiry/close; frozen decisions survive published recovery and remain subject to separately owned Stage 5 deletion.

Complement/fall-through audit: unsupported/invalid provenance, unavailable/partial reports and oversized rosters fall back to manual voices; unknown decision fields/statuses and replayed contexts reject; absent legacy policy remains valid, but v1–v6 reject the new field. Both registered and unregistered recovery compare the frozen decision. Literal policy/column consumer searches covered receipt serialization, SQL updates/cleanup, bundle parsing, recovery, preview and derivative reads.

Fresh read-only review found recovery comparison and retry issues. These were fixed and covered by regressions. The manual shared-microphone feature was subsequently removed at the owner’s request. No unresolved review finding remains. External behavior remains unverified as described below.

## Regression evidence

`node scripts/verify-zoom-attendance-regressions.mjs` temporarily disables a fix, requires a failing Jest assertion, restores exact source bytes and requires a passing suite. Historical evidence at `7ddc5a4e7`: twenty cases were demonstrated: discussion-only resolver, boundary partition, waiting-only hiding, duplicate-name merge, frozen occurrence, partial fallback, recording alignment, replay, shared microphone isolation, SQL rename invalidation, confirmation context, missing-registry recovery, legacy rejection, pilot byte compatibility, registered recovery, checkbox preservation, late success, late failure explicit retry and derivative attribution.

The two late-response mutations disable both keyed request isolation and the corresponding post-await guard; disabling only the redundant inner guard cannot defeat the keyed owner. Initial surviving mutations were not counted as successes. Duplicate-name fixture order was strengthened to expose loss of the latest leave time. All twenty restored suites passed at that commit. The current runner removes the obsolete checkbox-preservation mutation and replaces manual microphone isolation with rejection of extra confirmation keys (19 cases total).

Legacy fixtures were generated from base commit `4e970b70f`, temporarily loading its bundle/formatter under restoration guards. The checked-in fixture captures v1–v6 source/TXT/VTT bytes and pilot TXT/VTT bytes.

## Commands and limits

Affected Jest selection:

```sh
npx jest --runInBand --testPathPatterns='(meeting-tracker-transcription|meeting-transcript-provenance|recording-and-transcript-card|presentation-transcript|transcript-summary|transcription-pilot|transcription-zoom|zoom-client|zoom-import|zoom-attendance|fresh-database|migration-078)'
```

Historical verification at `7ddc5a4e7`: affected Jest: 44 suites passed, 2 skipped; 1,172 tests passed, 38 skipped (including the final derivative assertion). All 70 `check:*` package scripts, including self-tests and `check:types`, ran one at a time: 69 exited zero; only `check:agent-invariants` failed. The known worktree-only invariant failure is retained, not hidden:

```text
Agent instruction invariant failure:
  - Claude memory store: expected /Users/gallivan/Code/WMKF_Apps-codex-labels/.claude-memory; found not a symlink / missing
```

Factory-ledger verification skips without `TEST_REQUEST_LEDGER_URL` or `TEST_REQUEST_SANDBOX_LEDGER_URL`; no environment was provisioned. Changed-source ESLint reported no errors and six pre-existing card ref warnings. No real database migration, live Zoom response, deployed UI, Production recovery or Stage 5 deletion was exercised. Database checks use static SQL/manifest/bootstrap assertions and mocked persistence. The bounded reconciliation excludes unrelated historical plans and Stage 4 ownership.

Implementation details beyond the plan: a 90-second total report deadline, twenty-page cap and oversized-roster manual fallback. These preserve the settled decisions. The fresh-install requirement uses the existing manifest bootstrap rather than duplicating DDL in `setup-database.js`.

## Owner follow-up: remove the manual control

[VERIFIED via local source and offline commands, 2026-10-09] Removed the manual
"Shared microphone" button, client split state/helper, help sentence and optional
confirmation key. Both client save paths now send exactly `{ reviewId, kept }`.
The route delegates confirmation to the service's strict validator; helper tests
reject empty and populated `sharedSpeakerIds`, and the service regression rejects
that key before persistence. No route or DTO separately accepts it.

`attendance-service.js` is unchanged: IDs linked to multiple attendees remain
controlled by their own "Other voices" row, and incomplete reports still fall
back to checked voices. Persistence schema, output policy and async guards are
unchanged; migration and live-state verification are outside this follow-up.

The affected Jest command above passed again: **44 suites passed, 2 skipped;
1,172 tests passed, 38 skipped**. Then `check:types`, `check:api-routes`,
`check:status-enum-parity` and `check:harness-framing` passed sequentially, including
the latter three gates' self-tests. API-route coverage emitted its existing
unguarded-token warnings for the three external-materials routes (non-failing).
`git diff --check` passed. The targeted mutation command
`node scripts/verify-zoom-attendance-regressions.mjs 'confirmation rejects extra keys'`
failed as expected with the exact-key guard disabled and passed after restoration.
The other 18 mutation cases were not rerun in this follow-up.

Changed-fact sweep: runtime symbols, tests, scripts and durable references were
searched. The attendance plan, this report and the API security matrix now reflect
the exact confirmation shape and no manual split. The wiki's shared-microphone
routing term still covers the retained automatic rule. Prior mutation and full-gate
results above are explicitly historical; no current manual-control claim remains.
