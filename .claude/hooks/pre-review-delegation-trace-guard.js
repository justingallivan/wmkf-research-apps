#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Task|Agent): self-trace gate BEFORE delegating a review to Codex.
 *
 * Fires the instant a Codex review / pre-impl-review subagent is about to be
 * spawned. Injects a mandatory two-axis self-review gate that I must work through
 * FIRST, so the reviewer confirms my trace instead of doing it for me.
 *
 * This guard exists because in S272 a Codex pre-impl review caught three issues I
 * had missed in my own design doc, and all three were of two specific kinds:
 *   - TEMPORAL: a "reset" that bounces back on the NEXT effect run (I reasoned
 *     about the snapshot, not the next render).
 *   - BOUNDARY: a DELETE route that returns 200 + {success:false} on failure while
 *     the client keys on response.ok; and a merge-only reducer that physically
 *     cannot express a key delete (I verified the contract SHAPE, not its
 *     value SEMANTICS on each side).
 * On two of those I had literally pointed Codex at the exact spot in my prompt —
 * i.e. I sensed the soft spot and outsourced the trace instead of doing it. A
 * promise to "run a self-pass next time" is not enforceable; this hook is.
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
      'SELF-TRACE GATE — before this review delegation, run your OWN trace on the two ' +
      'axes a reviewer keeps catching for you (S272). Do not outsource a trace you can ' +
      'do yourself; the reviewer should CONFIRM your work, not replace it.\n' +
      '  (1) TEMPORAL — for every state change in scope, simulate the NEXT render / ' +
      're-entry / re-run, not just the snapshot. Does a reset bounce back when an async ' +
      'value lands? Does an effect re-fire and clobber? Does a flag get re-read stale?\n' +
      '  (2) BOUNDARY — for every cross-layer contract, check both sides agree on VALUE ' +
      'SEMANTICS, not just shape. Return codes vs. how the caller detects success ' +
      '(200 + {success:false} vs. response.ok); success flags; whether the data ' +
      'structure can even EXPRESS the operation (e.g. a merge-only reducer cannot delete).\n' +
      'State your findings on BOTH axes in your delegation prompt WITH EVIDENCE, so the ' +
      'reviewer confirms a trace and not a bare assertion. For each axis give either a ' +
      'concrete artifact — file:line of the state change / both contract sides, the ' +
      'caller→consumer path, and "checked X, found Y" — or an explicit "traced <the ' +
      'specific thing> at <file:line>, none found". A finding with no file:line is an ' +
      'assertion, not a trace. If you caught yourself about to ask the reviewer to ' +
      '"trace whether X" — that is the signal to trace X yourself first.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch (e) {
    // fail open — never block a delegation
  }
});
