#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Task|Agent): self-trace gate BEFORE delegating a review to Codex.
 *
 * Fires the instant a Codex review / pre-impl-review subagent is about to be
 * spawned. Injects a mandatory lifecycle+provenance self-review gate I must work through
 * FIRST, so the reviewer confirms my trace instead of doing it for me.
 *
 * This guard exists because in S272 Codex reviews repeatedly caught issues I had
 * missed, all of one general defect: I verify what's present and the happy path
 * forward, but skip a thing's LIFECYCLE and PROVENANCE. The two axes:
 *   - LIFECYCLE: I trace forward from creation along edges the code CONTAINS and
 *     miss the edge it OMITS — a one-way latch with no reset that goes stale across
 *     an identity change; a "reset" that bounces back on the next run. (Trace from
 *     the landed state, not the snapshot.)
 *   - PROVENANCE & VALUE-SEMANTICS: I track a value but not what produced it, and
 *     check a contract's SHAPE but not its failure path / what both sides mean
 *     (DELETE returns 200 + {success:false}; a merge-only reducer cannot delete).
 * And when I could NAME the check, I outsourced it to the reviewer (or proposed a
 * project tool to catch it later) instead of doing it — the defect dodging the fix.
 * A promise to "run a self-pass next time" is not enforceable; this hook is.
 *
 * Trigger (exact rule): a Task/Agent call that is EITHER
 *   (a) any Codex subagent — subagent_type contains 'codex', or 'codex' appears
 *       anywhere in tool_input (renamed-field fallback). EVERY Codex delegation
 *       fires, not just review-worded ones: the sanctioned Codex path here is
 *       review/rescue, and over-firing on a rare non-review Codex call costs only
 *       one extra paragraph of context — the safe failure direction for a
 *       discipline gate. OR
 *   (b) any OTHER agent whose prompt looks like a review/verify/confirm-refute pass.
 * A non-Codex agent doing search/implementation (Explore, general-purpose) does NOT
 * fire, to keep the hook off the common fan-out path.
 *
 * FAILS OPEN: any parse error / missing field exits 0 silently — never blocks.
 */
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (!data) return;
    const tool = data.tool_name || '';
    if (tool !== 'Task' && tool !== 'Agent') return;

    const ti = data.tool_input || {};
    const subagent = typeof ti.subagent_type === 'string' ? ti.subagent_type : '';
    const prompt = typeof ti.prompt === 'string' ? ti.prompt : '';

    // (a) Any Codex subagent. Check the structured field, then fall back to scanning
    // the whole tool_input so a renamed field still trips it (parity with the sibling
    // codex-verbatim-reminder.js).
    const looksCodex = /codex/i.test(subagent) || /codex/i.test(JSON.stringify(ti));
    // (b) Any other delegation whose prompt asks for a review/verify/critique pass.
    // Kept deliberately broad on phrasing AND number (finding/findings) — a false
    // positive is cheap, a missed review delegation defeats the gate.
    const looksReview =
      /\b(pre[- ]?impl(?:ementation)?|post[- ]?impl(?:ementation)?|design review|code review|review (?:this|the|my|our|these)|re-?review|confirm[- ]?(?:or|\/)[- ]?refute|adversarial|red[- ]?team|critique|sanity[- ]?check|audit (?:this|the|my)|validate (?:this|the|my)|verify (?:this|the|these|my|our)|check (?:my|the) reasoning|look(?:ing)? for (?:regressions|bugs)|find(?: the)? bugs?|scrutin)/i
        .test(prompt);
    if (!looksCodex && !looksReview) return;

    const msg =
      'SELF-TRACE GATE — before this review delegation, complete lifecycle and ' +
      'provenance/value-semantics tracing with file evidence. Put the trace in the ' +
      'delegation prompt so the reviewer can verify it directly.\n' +
      '  (1) LIFECYCLE (not snapshot) — for every stateful thing (flag, ref, resource, ' +
      'cache, subscription), trace FROM its landed state, not just the happy-path entry. ' +
      'Enumerate what arrives there and every transition OUT. A value set in one direction ' +
      'with no reset is a bug until proven a deliberate one-shot. What un-does this and ' +
      'when? What re-fires after an async value lands? What goes stale on an identity ' +
      'change / remount? (The edge the code OMITS is the one you miss.)\n' +
      '  (2) PROVENANCE & VALUE-SEMANTICS — track what PRODUCED a value (does state survive ' +
      'an identity change it should not?), and for every cross-layer contract check the ' +
      'FAILURE path and what both sides MEAN, not just field shape (200 + {success:false} ' +
      'vs. response.ok; can the structure even EXPRESS the op — a merge-only reducer cannot delete).\n' +
      'State your findings on BOTH axes in your delegation prompt WITH EVIDENCE. For each axis give either a ' +
      'concrete artifact — file:line of the state change / both contract sides, the ' +
      'caller→consumer path, and "checked X, found Y" — or an explicit "traced <the ' +
      'specific thing> at <file:line>, none found". A finding with no file:line is an ' +
      'assertion, not a trace. If the prompt asks the reviewer to "trace whether X" ' +
      'or proposes a future tool/gate for a named risk, first trace X now and include the result.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch (e) {
    // fail open — never block a delegation
  }
});
