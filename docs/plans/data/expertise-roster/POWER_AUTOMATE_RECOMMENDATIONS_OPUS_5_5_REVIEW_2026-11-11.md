# Expertise automation plan — Opus 5.5 review

Scope: read-only plan review through Claude subscription OAuth, exclusively
`claude-opus-5-5`. No application model calls, live writes, runtime edits or paid
review add-ons. Reviewed direction: [recommendations-only plan](POWER_AUTOMATE_RECOMMENDATIONS_PLAN_2026-11-11.md).

## Disposition

Initial verdict: READY WITH NAMED CHANGES. All eight findings were incorporated:
private sealed roster extension (chosen with the shared owner), strict User read
completeness, recursive output-key/type and duplicate-lead checks, post-checkpoint
validation, no freshness IO in status polling, trusted read-only roster authority,
single canonical output contract and expertise-specific scope/store admission.

Follow-up verdict: READY for the agreed bounded implementation direction, with no
implementation blockers. Final document corrections create this receipt, clarify
no roster expertise truncation, define a freshness hash reproducible after source
expiry, and select a single protected roster rendering in Slice 2. The shared
owner implements/reviews that compiler change; old text tasks keep their behavior.
No further broad review iteration is warranted. Runtime changes still require
implementation review and the explicit interface/release gates in the plan.

The shared owner confirmed clean baseline `0c4b8d39c`, ownership and the sealed
snapshot/checkpoint decision in chat. Source location and caching policy remain
OPEN. No automatic assignment is authorized; future assignment requires Connor.
Scoped durable docs/gates are checked by the coordinating session, not by Opus.

## Initial review — exact transcript

**Verdict: READY WITH NAMED CHANGES.** Nothing needs rework. The plan needs eight bounded edits, and only the first is material. This was read-only: no edits, no code or gates run, no external calls. Writing to the plan file is disabled in this session, so the review is only in this message.

**Confirmed against the code (no change needed)**
- **Idempotency:** the duplicate-request check hashes only what the caller sends (`store.js:247`), not the frozen configuration. A repeat with the same key returns the original job, and its record outlives content expiry. Plan §3 is accurate.
- **Frozen inputs:** the saved model response is tied to the sealed snapshot's integrity hash (`execute-prompt.js:439`), so it is bound to the frozen roster.
- **Caching:** records sit after the cache marker (`context.js:91-92`). The document nonce includes the authorization scope (`context.js:56`), so the plan is right that cache reuse needs the same authorization domain.
- **Typed output and 4,096 budget:** the plan's handoff targets the right places.
  - The 1,536-token limit is checked in two places (`capabilities.js:52-55`, `execute-prompt.js:430`).
  - Only the first output is size-checked (`execute-prompt.js:479-480`).
  - Text-only checks are at `profile.js:86`, `worker.js:149` and `store.js:71,554`.

**Named changes**

1. **Decide where the roster manifest is stored (material).**
   - A record's provenance field allows only 1,024 bytes (`context.js:9,44`), so per-profile ETags and User states won't fit there.
   - Putting the manifest inside the single prompt-visible record causes two problems. It is rendered into the prompt twice (`context.js:82` and again through the placeholder at `:86-89`). It is also JSON-escaped, so the model sees escaped JSON instead of the legacy formatted roster text. That changes what the prompt says, not just its layout.
   - **Change:** use two records:
     - a visible `roster_block` holding exactly what `buildRosterV2Variables` produces today (`expertise-finder-roster-v2.js:17-22`);
     - a hidden `roster_snapshot` holding the rows, eligible lead GUIDs, warnings and manifest. It is protected by the snapshot's integrity check but never shown to the model.
   - The adapter rebuilds `roster_block` from `roster_snapshot` and requires an exact match before sending and before validating.
   - **I'm not certain** the shared compiler should accept hidden records. That is the infrastructure owner's call. If they decline, the fallback is a shared snapshot extension.
   - Size measurement must count the double rendering and escaping against the 64,000-byte record limit (`profile.js:13`) and the input-size check (`execute-prompt.js:433-438`).

2. **Fail closed on an incomplete User read.** Today `roster-match-contract.js:25` silently drops a lead candidate whenever `isdisabled` isn't `false`, including when the field is missing. That contradicts plan lines 98-99. The new manifest builder must stop preparation instead. State that only `validateRosterMatch` is reused, not `matchRosterSnapshot`.

3. **Close two validator gaps.**
   - `validateRosterMatch` accepts the same person as primary and secondary lead (`roster-match-contract.js:53`). Reject that.
   - `validateAiJson` silently drops unknown keys unless `allowExtra:'error'` is set (`ai-output-schema.js:139-145`). Plan line 145 ("where the capability requires it") leaves this open. Choose one rule: drop and record the dropped paths, or reject.

4. **Say where validation runs.** It should run in the post-response step of `executeProfiledPrompt` (`execute-prompt.js:476-486`), using the roster from the integrity-checked snapshot. Then a failure becomes `profile_output_invalid`, the saved response is kept, and a replay validates without another model call.

5. **Keep freshness checks off status polling.** The planned result format includes `freshness`, but computing it means reading every profile, every lead candidate's User record and the source. Power Automate status polls should stay content-free and do none of that work. Check freshness only when an authorized caller reads the result.

6. **Say whose authority the roster reads use.** Roster and User data don't belong to any one Request. The plan should say these reads are server-owned and read-only, run under the trusted Dataverse context (`withDalContext`) and the target interlock, and never borrow or widen the Power Automate flow's Request access. The current target guard is sandbox-only, so the Production roster cutover remains a stated dependency.

7. **Prompt-parity mapping must include text the compiler adds.** The shared path requires an empty system prompt (`profile.js:68`), so all of the legacy system prompt moves into the body, including its inline JSON example. The compiler also adds a "Structured record values are authoritative" sentence and an `OUTPUT CONTRACT` block (`context.js:90-91`). Keep a single description of the output shape so the old example and the typed schema can't disagree, and add a golden test for it.

8. **Admission detail (minor; belongs in Slice 3).** Admission currently accepts only the proposal environments plus `test`, and proposal environments require exactly the two proposal tasks (`store.js:152-166`). Task enablement requires a `proposal-trial:` scope (`capabilities.js:19-25`). Expertise needs its own enablement rule rather than reusing the proposal-trial scope.

**Not asking for:** a settled document source or cache decision, new tables, or field-level change detection. Treating any profile ETag change as stale is acceptable for a first version. The 4,096-token budget matches the setting already used in rehearsal (`roster-match-contract.js:32`).


## Follow-up review — exact transcript

**Verdict: READY for the agreed bounded implementation direction, with no implementation blockers.** Slices 0–1, the pure expertise contract and fabricated-roster tests, can start once both owners pin the shared commit. Two small document fixes are needed before the plan is marked reviewed, and three choices need settling at the shared checkpoint. I used only Read, Glob and Grep and edited nothing, so no plan file was written either. That follows your tool limit, which overrides plan mode's request for one.

**The eight named changes**

1. **Where the roster manifest is stored:** resolved, and better than my fallback. It goes in a code-owned, versioned sealed snapshot extension instead of generic hidden records or the provenance field (106–114). The visible roster block must be rebuilt exactly (116–118). The checkpoint binds snapshot integrity plus the capability and validator versions, and old text-only jobs still replay (118–122). Size checks count the double rendering and JSON escaping (129–131).
2. **Incomplete User reads:** resolved. A new manifest builder requires a true/false disabled state on every User and blocks preparation otherwise. `matchRosterSnapshot` isn't reused (98–101).
3. **Validator gaps:** resolved. Unknown keys are rejected recursively before normalization (176, 217–221), and the same person as both leads is rejected (177).
4. **Where validation runs:** resolved. It runs after the response is saved, against the integrity-checked roster; failure is `profile_output_invalid`, and recovery revalidates without another model call (178–181).
5. **Status polling:** resolved. Polls do no source, roster or User reads; freshness is checked on authorized result reads (141–143).
6. **Authority for roster reads:** resolved. They are server-owned and read-only under `withDalContext` and the target interlock, they don't borrow the flow's Request access, and roster cutover stays a dependency (102–104).
7. **Prompt parity:** resolved. Text the compiler adds is mapped, there is one output-shape description, and a golden test covers it (156–161). The empty-system-prompt relocation isn't named but falls under "map every legacy instruction."
8. **Admission:** resolved. Expertise gets its own scope and enablement rule, and the store's two-proposal-task gate is explicitly addressed (205–208).

The rest of your checklist is also incorporated: bounded hashes and versions in configuration (113, 122–124), source expiry for the full roster (111), a single output schema (159–161), and the separate-scope documents (314–318). Document source and caching stay OPEN as an owner requirement (22–25, 88–92, 282), which is correct.

**Concrete remaining items (none block the direction)**

- **A claimed record doesn't exist yet.** Lines 5–6 say, in the present tense, that the Opus disposition "is recorded in the companion review document." No such file exists in `docs/plans/data/expertise-roster/`; other reviews follow the `*_OPUS_5_5_REVIEW_2026-11-11.md` pattern. Change it to the future tense, as lines 301–302 already have it, or create the record. It's a fix before the plan is marked reviewed, not a build blocker.
- **How the roster is rendered to the model is still undecided.** Lines 131–133 allow the current behavior (the roster rendered twice, as escaped JSON) or a reviewed rendering change in the compiler. Slice 2 should pick one, since the parity proof differs between them.
- **The freshness hash needs one sentence.** After the 24-hour source expiry, only the hash remains. State that it is computed only from data a fresh read can reproduce (profile GUID, ETag, User GUID, disabled state), so a later check never needs the expired snapshot.
- **Wording:** "Full source text retained" in Slice 1's exit (265) is ambiguous. It most likely means no truncation of roster expertise.

**Shared runtime pieces still PLANNED** (none built or merged into the roster branch, per lines 36–47 and 330):
- the sealed snapshot extension;
- the versioned checkpoint contract;
- typed results with per-capability output size and token limits across Admin validation, admission, the Executor, the worker, the store and result formats;
- the expertise enablement rule and the store admission update;
- the optional compiler rendering change;
- the staff read path for a Request's results;
- Power Automate app-only admission and status;
- worker scheduling, recovery and retention;
- the document source interface.

Release also still needs Production roster cutover and a separately authorized paid recommendation run.
