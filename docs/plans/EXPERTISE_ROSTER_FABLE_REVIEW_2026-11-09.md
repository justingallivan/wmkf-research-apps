# Expertise roster migration — Claude Fable review

Reviewed November 9, 2026 via host Claude Code OAuth (`claude.ai`), requested model `fable`, returned model `claude-fable-5-2`. No API-key agent authentication. User expressly approved potential allowance/credit consumption and internal source transmission. Read/Grep/Glob only; no external reads or writes. Session: `07c90a79-7dc2-4eee-840f-95a370458f23`. Reviewed plan commit: `be5790336`.

## Original review (historical snapshot before revisions)

Review complete. Verdict first, then findings in priority order.

## Verdict: READY WITH NAMED CHANGES

The owner decisions are implementable and the plan's consumer inventory is mostly right. Five engineering mechanisms in §3–§5 conflict with the source and need plan-text repairs before work package 2 starts. None requires reopening an owner decision.

## Required changes (P1)

**1. The identity bridge cannot be environment-specific as written.**
- The Atlas records one shared Preview/Production Postgres database (`docs/atlas/postgres-infra-tables.md:313`, `:997`). The plan (§3, §5B) requires sandbox mappings to stay separate from Production.
- A bridge with a numeric PK and a single unique GUID column cannot hold both a sandbox and a Production GUID for the same ID. `consultant_feedback` and its FK are shared too.
- Repair: store the numeric ID on the Dataverse profile as an integer alternate key and keep Postgres as only the ID allocator and FK target. Alternatively, add an environment discriminator to the bridge. Either way, define what Production does with an ID that was allocated from sandbox.

**2. A real Contact lookup changes the "no manual fallback" rule.**
- Today a linked row whose Contact is missing or inactive stays linked and gets a null email (`lib/services/site-visit/recipient-directory-service.js:120-133`). The stored `preferred_email` is kept but frozen while linked (`pages/api/expertise-finder/roster.js:51-65`).
- The repo's lookup default is Delete: Restrict (`lib/dataverse/schema-apply.js:363`), which blocks CRM users from deleting a linked Contact. Remove Link would silently unlink the profile and revive the stale preferred email.
- Repair: pick the cascade explicitly, state the Contact-merge behaviour, and add a sandbox test for delete and merge.

**3. Feedback create ordering contradicts the acceptance criteria.**
- `assertConsultantEligible` runs before the `ON CONFLICT` insert (`lib/services/consultant-feedback-service.js:470-476`), so a replay after the consultant retires is rejected today. §4.5 and §6 require it to succeed.
- Repair: look up the existing `(request_id, mutation_id)` row first, then validate remotely only if none exists. Record this as a behaviour change, not preservation.

**4. Feedback update cannot "validate before the transaction" as stated.**
- Whether the author changed is only known after the `FOR UPDATE` read (`consultant-feedback-service.js:543-585`).
- Repair: specify an unlocked pre-read, remote validation if the author differs, then an in-transaction recheck that aborts if the stored author moved to an unvalidated ID.
- A transient Dataverse failure must also not be classed as an attachment loser. The finalize path already retries non-loser errors (`lib/services/consultant-feedback-attachment-service.js:374-385`), so the new error needs a retryable 503 with a distinct reason.

**5. The matching prompt contradicts the lead-eligibility decision.**
- The prompt asks for a primary and secondary PD and labels every active staff row "eligible for primary/secondary PD assignment" (`shared/config/prompts/expertise-finder-dynamics.js:21`, `:156`). It also hard-codes named expertise boundaries (`:30-36`).
- After import, the new PDs (blank expertise) and Beth (eligibility unconfirmed) appear as assignable, and Kevin disappears.
- §4.3 says both "retain the prompt contract" and "do not feed the old assignment prompt". Repair: state which one holds. If the heading changes, the golden fixtures in `tests/unit/tool-prompt-parity/expertise-finder.test.js` change too.

## Required changes (P2)

- **Persisted numeric refs are understated.** §2 lists two consumers. The IDs are also persisted in Dataverse `wmkf_attendeerefsjson` on Site Visit, deliberation session and slot (`lib/services/meeting-tracker/session-service.js:240`, `lib/dataverse/adapters/deliberation-slot.js:44`). They are read by `lib/services/pre-site-visit/distribution/context.js:187` and the transcription binding (`lib/services/meeting-tracker-transcription/binding.js:109`). §5A's inventory must read these Dataverse columns, not only Postgres.
- **Null-tolerant uniqueness is unproven.** Unlinked profiles are permanent and imported rows have no creation key. `lib/dataverse/schema/wave3/05_wmkf_policyversion_altkey.json` shows a lookup in an alternate key, but not many-null behaviour. Make it a named sandbox gate with a fallback, and require the key to be active before import.
- **List contract.** The route offers offset paging, a total count and `ILIKE` over text columns (`roster.js:152-189`). State the replacement: a full read with in-memory filter, sort and page is adequate at this size.
- **Prompt parity.** `buildRosterContext` reads snake_case fields and the query sorts by `role_type, name` (`pages/api/expertise-finder/match.js:80-82`). Require the same DTO and sort, and compare a hash of `roster_block` from both stores; no model call needed.
- **Edit attribution.** `updated_by` is the editor's profile today (`roster.js:335`). Say whether Dataverse `modifiedby` will be the acting user or the app identity.
- **Conflict response.** The 409 lookup only finds active holders (`roster.js:67-90`). With all-profile uniqueness it must name an inactive holder and offer reactivation.
- **Role change.** `roster.js:327` allows any role change. Define what happens to the User link, Contact link and eligibility flag when the category changes.
- **Unmapped profiles.** Define per consumer whether a profile without a numeric ID is omitted and flagged, or fails the read.
- **Direct Dataverse edits.** Server-side invariants live only in the app. Readers must treat invariant-violating rows as ineligible.
- **Freeze and sequence.** Enforce the freeze in the database, since `scripts/seed-expertise-roster.js:95-117` and `scripts/link-roster-contacts.js:213` write directly. Advance the new sequence past the old sequence's last value, and advance the old sequence in the rollback path.

## Optional suggestions

- Allocate the numeric ID in Postgres first, then upsert Dataverse on that key. That may remove the creation-key column; it needs sandbox verification.
- Retire the name-matching seed script rather than porting it.
- Update the §7 review-status paragraph, which still says no model review has run.

## Verification limits

- Source only: no live schema, sandbox, database or tests were consulted or run.
- `pages/expertise-finder.js` was searched, not read in full; the UI findings rest on the API route.
- I did not confirm which Dataverse environment Preview targets. Finding 1 rests on the Atlas statements about the shared database.
- Every Dataverse platform behaviour above (null keys, cascade, merge, filtering) is a sandbox gate, not an established fact.

## Codex disposition

All five P1 findings accepted. Revised plan specifies target-scoped bindings in shared Postgres; Contact GUID reference semantics rather than an implicit native cascade; replay-first feedback creation as a behavior improvement; unlocked update pre-read plus locked revalidation and retryable attachment-safe errors; and an explicit matching prompt/eligibility release gate rather than claiming unchanged-prompt compatibility.

All P2 findings accepted into the plan: expanded Dataverse attendee census; null-key/Active-key sandbox gate; list paging/search DTO contract and roster hash parity; actor attribution; inactive-holder conflicts; category transitions; unmapped profiles; fail-closed reads after direct edits; database-enforced freeze and sequence high-water handling. Optional numeric-ID-first creation and seed-script retirement were not required and are not silently adopted.

Source checks reconfirmed feedback create ordering, attachment loser classification, current prompt assignment wording, roster serialization, shared-DB Atlas evidence, and persisted attendee consumers. Live platform semantics were not tested. The revised text has not received a second Fable verdict. Matching prompt/output decisions are required before release; they do not reopen settled profile schema or authorize scoring work.
