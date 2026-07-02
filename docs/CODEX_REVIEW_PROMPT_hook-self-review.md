---
title: "Codex review prompt — pre-commit self-review hook strategy + implementation"
domain: agent-harness
kind: draft
status: draft
summary: "✅ COMPLETED (S259, 2026-06-15). This review was run, relayed verbatim, and acted on."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/agent-wiki/topics/security-auth.md
  - pages/api/workbench/resolve-request.js
  - pages/api
  - lib/db/
---

# Codex review prompt — pre-commit self-review hook strategy + implementation

> **✅ COMPLETED (S259, 2026-06-15).** This review was run, relayed verbatim, and acted on.
> Codex found the S258 trust-boundary fan-out was incomplete; the remediation (per-route GUID
> validation + a BLOCKING `check:trust-boundary-guid` gate/commit-guard + a hardened commit-hook
> trigger) shipped in `58d5fd35`, `ae016131`, `fd94267d`, `692a82a4`. See
> `docs/agent-wiki/topics/security-auth.md` → "Trust-Boundary GUID Validation". The prompt below is
> retained as a HISTORICAL record of what was asked — it is no longer a startup action.
>
> Files under review (all committed at S258, commit `10c49802`):
> - `.claude/hooks/pre-commit-self-review.js` (the hook)
> - `.claude/settings.json` (the PreToolUse Bash wiring, alongside `enum-parity-commit-guard.js`)
> - `.claude-memory/feedback-self-review-before-delegating-review.md` (the lesson)
> - `pages/api/workbench/resolve-request.js` (the fan-out-audit fix it prompted)

---

## Prompt to hand Codex

Run an adversarial design + implementation review (no code changes) of a new
pre-commit "self-review" hook in /Users/gallivan/Code/WMKF_Apps. Be skeptical: the
hook was authored by the same agent whose mistakes it's meant to catch, at the end of
a long session, and was NOT independently reviewed. Your job is to find where the
strategy is wrong or the implementation is broken. Return findings by severity with
file:line evidence.

Read first: `.claude/hooks/pre-commit-self-review.js`, its wiring in
`.claude/settings.json` (the `PreToolUse` → `Bash` matcher block, where it sits next to
`.claude/hooks/enum-parity-commit-guard.js`), `.claude-memory/feedback-self-review-before-delegating-review.md`,
and the existing reminder-hook conventions (e.g. `.claude/hooks/scope-claim-reminder.js`,
`contract-surface-reminder.js`). Background: across S258 (the Workbench Proposal-tab +
Field Primer build) Codex review repeatedly caught the SAME self-catchable failure modes
— most often a guard/validation applied in one place but not its siblings ("fan-out"),
and contract facts asserted without reading the source. The hook is the attempted fix.

**A. STRATEGY — is this the right remediation, or theater?**
1. The hook is NON-BLOCKING (injects a checklist as additionalContext at `git commit`,
   never exit 2). The project already has many advisory PreToolUse reminder hooks that
   fired all session and did NOT prevent these mistakes. Argue the strongest case that
   this new hook will ALSO be ignored (alert-fatigue / just-another-reminder), and what
   would make it actually change behavior.
2. The author deliberately did NOT build blocking gates for these modes, reasoning they
   are "judgment-shaped" and a false block would wedge commits. Is that defensible, or a
   cop-out? Identify which of the four modes (verify-claims / fan-out guards / trust
   boundaries / concurrency-on-durable-writes) COULD be turned into a precise, low-false-
   positive BLOCKING gate (like `check:status-enum-parity`), and whether it should be.
   Concretely: is "every pages/api route that passes a client id into DynamicsService.getRecord
   must GUID-validate it" a writable, robust gate? Sketch how you'd build it (and its self-test).
3. Is "shift-left: self-run /contract-reconcile + a fan-out grep before delegating a
   review" a real process change or hand-waving? What's the single highest-leverage
   improvement to the overall strategy?

**B. IMPLEMENTATION — correctness of `pre-commit-self-review.js`:**
4. Trigger correctness: fires only on real `git commit` (not other Bash), skips `--amend`,
   reads `git diff --cached --name-only`, returns silently when nothing relevant is staged.
   Can it EVER block/wedge a commit (it must never)? Does it fail open on every error path?
5. Staged-diff classification: the regexes for `isApi` / `isComponent` / `isService` /
   `isDurableDoc`. Find the FALSE NEGATIVES — staged files that should trigger a bullet but
   won't (e.g. `lib/db/**`, `lib/utils/**` persistence, `.mjs` scripts, `pages/api/**/*.ts`,
   API routes under non-obvious paths, React components outside `shared/components`). Does
   missing a class defeat the hook's purpose for that change?
6. Wiring: in `settings.json` the command is `node .../pre-commit-self-review.js 2>/dev/null || true`.
   Does `2>/dev/null` or `|| true` interfere with the stdout additionalContext JSON or the
   exit semantics? Does it compose correctly with the other Bash hook (enum-parity) — both
   run, ordering, one's output not clobbering the other? Is the `hookSpecificOutput` JSON
   shape correct for a PreToolUse hook in this harness?

**C. The fan-out-audit fix it prompted:**
7. `pages/api/workbench/resolve-request.js` now GUID-validates `requestId` before `getRecord`.
   Confirm it's correct AND complete. Then DO THE FAN-OUT THE AUTHOR CLAIMS TO HAVE DONE:
   independently grep the workbench API surface (and adjacent: reviewer-finder, review-manager,
   external/review) for any OTHER route that passes a client-supplied id into a Dataverse/
   SharePoint selector without validation. List any the author missed.

**D. The memory:** is `feedback-self-review-before-delegating-review.md` accurate, well-placed
(leaf + router pointer), and not duplicative of `feedback-symbol-consumer-fanout` /
`feedback-idempotency-name-the-mechanism`? Should any of it instead live in an agent-wiki topic?

**Bottom line:** will this measurably reduce review churn, or is it theater? Give the ONE change
you'd make to the strategy and the ONE bug (if any) you'd fix in the implementation first.
