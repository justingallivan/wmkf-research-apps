# Expertise roster migration — second Claude Fable review

Reviewed November 9, 2026 via host Claude Code OAuth. Model: `claude-fable-5-2`. Session: `21ea0ecc-c011-4f40-b0bf-6aa841d55662`. Reviewed source/plan commit: `acc1f7507` (confirmed by coordinating Codex). Read-only; no external data access or implementation.

# Second review: expertise roster migration plan

## Verdict: READY WITH NAMED CHANGES

All five P1 repairs are present in the plan text, and four hold against source. The shared-database repair (P1-1) introduced a new defect in the rehearsal window, and the prompt gate (P1-5) is stated but not wired into the cutover sequence. Both are plan-text fixes and neither reopens an owner decision.

This was a source-only review. I could not confirm the commit hash with read-only tools, so I assumed the worktree HEAD is `acc1f7507`, per the session git status.

## Prior P1 findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Environment-specific bridge | **Resolved as designed; new defect B1** | §3 adds a binding table keyed by `(roster_id, target_host)` with unique `(target_host, guid)`. It also defines Production's behaviour for a sandbox-only identity. |
| 2 | Contact lookup and fallback | **Resolved; one wording gap (B4)** | §3 chooses a non-native GUID reference and states delete, merge, inactive and unlink behaviour. This matches `recipient-directory-service.js:120-133`. |
| 3 | Feedback create ordering | **Resolved** | §4.5 checks `(request_id, mutation_id)` before remote validation and records it as a behaviour change. Source still validates first (`consultant-feedback-service.js:470`). |
| 4 | Feedback update and transient errors | **Resolved** | §4.5 specifies an unlocked pre-read, validation only on author change, a locked recheck and a retryable abort. The new 503 reason falls outside `PERMANENT_RESULT_CODES` (`finalize.js:40-44`) and outside the loser check (`consultant-feedback-attachment-service.js:375`), so staging is released. An attachment bind patch carries no author key, so it never reaches remote validation. |
| 5 | Prompt versus lead eligibility | **Resolved as a gate; not wired in (B2)** | §4.3 drops the unchanged-prompt claim and lists the contract requirements. |

## Prior P2 findings

| Finding | Status | Evidence |
|---|---|---|
| Persisted numeric refs | Resolved | §5A names `wmkf_attendeerefsjson` on all three tables and the four readers. |
| Null-tolerant uniqueness | Resolved as a gate | §3 has a sandbox proof, an Active-key check and a named fallback. Its wording still assumes a lookup (B4). |
| List contract | Resolved | §4.2: full read, in-memory filter, sort, count and paging; a cap is an error. |
| Prompt parity | Resolved | §4.2–4.3: snake_case DTO, `role_type, name` order, hash comparison. |
| Edit attribution | Resolved | §3 offers two mechanisms with sandbox verification. |
| Conflict response | Resolved | §4.2 names inactive holders and offers reactivation. |
| Role change | Resolved | §3 clears incompatible links and eligibility atomically, with editor review. |
| Unmapped profiles | **Partly resolved (B3)** | §3 says "if needed profiles lack bindings" without saying which consumers need them. |
| Direct Dataverse edits | Resolved | §3 says readers fail closed. Row-level versus whole-read scope is covered by B3. |
| Freeze and sequence | **Resolved at cutover; gap before it (B1)** | §3, §5C and §5D cover the freeze guard and both high-water marks. |

## Blocking changes

**B1. The shared database has two live ID allocators before the freeze.**
- §5B applies the bridge migration and rehearses new profiles while Production's old editor is still live. `expertise_roster.id` is `SERIAL` (`004_expertise_finder.sql:6`), and §3 advances the new sequence only once.
- A Production roster row created during rehearsal and a sandbox-only identity can therefore receive the same number. The final delta import ("existing IDs unchanged") then collides.
- A rehearsal profile's feedback insert also fails, because the FK still points at `expertise_roster` (`048_consultant_feedback.sql:30`). Retargeting it early changes Production.
- §5D's rollback rehearsal rewrites the old table, sequence and FK. On the shared database that is Production data.
- Repair: either name a dedicated rehearsal Postgres, or use a single allocator from the moment the migration is applied. The Atlas records a dedicated Preview Neon for another feature (`docs/atlas/postgres-transcription-pilot.md:277`). Whichever is chosen, state which work-package-4 steps touch the shared database and need Production authorization.

**B2. The prompt gate is not connected to the Production switch.**
- §4.3 says matching cutover waits. §5C freezes the old table, deploys consumers together and verifies matching. §3 forbids falling back to the old roster. The plan never says what matching reads in between.
- Repair: state that the owner-reviewed prompt contract is a precondition of §5C, or define matching as disabled in the interim. Add the gate to the §6 matching line.
- The system prompt is a per-environment Dataverse row with a bundled fallback (`lib/services/tool-prompt-resolver.js:80-112`). The gate must cover the row update in each target, coordinated with the code and golden fixtures.
- Output is name-only today (`expertise-finder-output-schema.js:54-60`). Rejecting "unknown or ambiguous identities" therefore needs a profile token in the roster block and a server-side check against the eligible set.
- Hash parity excepts only "eligibility changes". Kevin's inactivation and the two new PDs also change `roster_block`. Take parity on the raw import, before owner overrides.

**B3. Unmapped and invalid profiles need a per-consumer rule.**
- Matching never uses numeric IDs (`match.js:80-82`, `buildRosterContext`). As written, one abandoned create or one direct Dataverse row could fail every match run and the whole attendee directory.
- Repair: one sentence per consumer (matching, directory, feedback picker, historical attribution) saying whether the row is omitted and flagged or the read fails. Apply the same rule to invariant-violating rows.

**B4. The uniqueness text still describes a lookup for Contact.**
- §3 makes Contact a plain GUID reference, but the duplicate-enforcement paragraph says "alternate key on lookup".
- Repair: name the column type, require canonical lower-case storage, and point the null-key gate at that type. User remains a lookup.

**B5. Import rows have no stated idempotency key.**
- §5B requires no duplicates after an interrupted response, but imported rows carry no creation key. A lost response on an unlinked Board row cannot be told apart from a failed create.
- Repair: give each imported row a deterministic creation key derived from its legacy ID. This also removes the many-nulls dependency for creation keys.

## Optional suggestions

- **Second replay key.** `writeFeedbackEntry` also replays on `requestdocument_id` (`consultant-feedback-service.js:504-514`), and that path still sits behind eligibility. Extend the pre-check to cover it.
- **`target_host` source.** Several services resolve `DYNAMICS_SANDBOX_URL || DYNAMICS_URL` (for example `lib/services/dataverse-identity-map.js:37`), while adapters use `DYNAMICS_URL`. Say the host is taken from the URL the roster adapter actually calls. An unregistered host should fail closed even when the interlock is `off` (`interlock.js:79`).
- **Update conflict code.** Name the "retryable conflict" reason. Drop "version", since `consultant_feedback` has no version column.
- **Post-commit hydration.** A hydration failure after commit should return the saved row with unavailable attribution, not an error.
- **Filename path.** A permanently unbound historical consultant makes attachment finalize fail forever. Today it falls back to "Consultant" (`consultant-feedback-attachment-service.js:281`). Consider keeping that fallback.
- **Stale Preview branches.** Old-code previews will read the frozen table after cutover. Note this next to the freeze guard.

## Missing rehearsal gates

- **Sandbox reference census.** Sandbox Site Visit, session and slot rows hold the same numeric IDs. Every one needs a sandbox binding.
- **Per-target link mapping.** A User lookup must resolve in the target org, and Production Contact GUIDs will be missing in sandbox. The import needs an explicit per-target rule.
- **Sandbox refresh.** A Production-to-sandbox copy invalidates sandbox bindings. Define the rebind step.
- **Prompt row rollout.** Rehearse the row, code and fixture change together in sandbox, including the bundled-fallback path.
- **Freeze guard.** Rehearse installation and removal on a non-shared database, and include an old-code Preview writer.
- **Sort parity.** Confirm that the in-memory `role_type, name` order matches Postgres collation, using the roster-block hash.

## Verification limits

- No live schema, sandbox, database or tests were consulted.
- Dataverse behaviour (null keys, key types, merge, attribution) remains a sandbox gate, not an established fact.
- Whether Preview currently uses the shared or a dedicated Postgres is unverified. The Atlas records both patterns.
- `pages/expertise-finder.js` and the meeting-tracker readers were searched, not read in full.

## Disposition

Review findings retained as open; this second-review task does not implement the proposed repairs. The plan is not unconditionally approved for implementation. Resolve B1–B5 and the named rehearsal gates before treating the affected work packages as ready. Optional suggestions remain suggestions, not owner decisions.
