---
name: Relevant red gates block completion on their affected surface
description: When a relevant npm run check:* gate is red, resolve it before completing work on the affected surface, regardless of branch or which session caused it.
type: feedback
originSessionId: 0e402398-f829-45ec-a781-e624832c86e6
status: active
scope: docs
last_verified: 2026-10-22 via CLAUDE.md Universal Operating Rule 4 and .claude/skills/start/SKILL.md Step 2
---

## Recall Rule

Read this when a relevant `npm run check:*` gate runs and comes back red, at session start or during work.

Do:
- Treat a relevant red gate as a P0 blocker on its affected surface; report it as the FIRST item in the session summary when found at startup.
- Resolve the gate before declaring affected work complete.

Do not:
- Ask "did I cause this?" — ask "is the rubric being violated?"; "pre-existing"/"out of scope"/"side-note" are not valid reasons to proceed.
- Reach for `ALLOWED_UNDOCUMENTED_*` without written justification (last resort, not default).

Current policy: `CLAUDE.md` Universal Operating Rule 4 ("Relevant red gates block completion"); mechanics and enforcement are in `docs/CI_GATES_REFERENCE.md`; the startup procedure is `.claude/skills/start/SKILL.md` Step 2.

[VERIFIED via the current `CLAUDE.md` Universal Operating Rules and
`.claude/skills/start/SKILL.md` Step 2.] The old entity incident below is
historical rationale, not a statement about today's Atlas coverage.

A relevant red `npm run check:*` gate means repository policy is unmet on the gate's affected surface. Treat it as a P0 blocker for completing work on that surface, regardless of branch or whether the current session caused the failure.

**Why:** On 2026-05-08 Justin called out a specific failure mode: I ran `check:atlas` during a Codex-review task, saw it red on `wmkf_apprequestpersons`, asked "is this my regression?", got "no — pre-existing from S139", and demoted the violation to a side-note at the end of the response. The gate had been red for ~2 days because the session that broke it (S139, also me) shipped a new Dataverse entity without an Atlas page, and S140 didn't catch it until the user pointed it out. The remediation plan exists *because* this kind of drift is invisible in normal review; the gates are the only mechanical enforcement, and treating them as informational defeats the whole rubric.

**How to apply:**
- At session start, `/start` runs its listed check gates before loading session context. If a relevant gate is red, report it as the FIRST item in the session summary, before recapping the prior session. (S209 added the two drift gates after `check:doc-currency` had sat red for ~8 sessions while masking the Jest signal precisely because `/start` was not running it.)
- During a session: if a relevant `check:*` gate you run is red, surface it and resolve it before completing work on the affected surface. Do not condition the response on who caused the failure.
- "Pre-existing" / "out of scope for current task" / "side-note for follow-up" are NOT valid reasons to declare affected work complete with a relevant red gate. They are the exact rationalizations that produced the failure.
- Fixing the gate is the default. Adding to `ALLOWED_UNDOCUMENTED_*` requires written justification and is a last resort.
- Codified in CLAUDE.md Universal Operating Rule 4 and `.claude/skills/start/SKILL.md` Step 2.
