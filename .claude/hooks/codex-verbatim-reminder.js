#!/usr/bin/env node
'use strict';
/*
 * PostToolUse hook (Task/Agent): "paste Codex VERBATIM before acting" reminder.
 *
 * Fires the instant a Codex review/rescue subagent returns. The rule
 * (feedback-share-codex-verbatim + the codex:codex-rescue contract) is: the
 * NEXT user-visible response must be Codex's output VERBATIM — no paraphrase, no
 * commentary before/after, and NO verifying/editing/acting first. This injects a
 * reminder at exactly the moment that rule was broken twice in S221 (I ran
 * verification Bash/Read calls and paraphrased into tables before showing the
 * review).
 *
 * Trigger: the sanctioned Codex flow always runs through the Agent/Task tool with
 * subagent_type 'codex:codex-rescue' (the skill mandates it), so we match that
 * tool and confirm 'codex' appears in the tool input. A raw `codex exec` via Bash
 * is off the sanctioned path and intentionally NOT matched (keeps the hook off
 * the hot Bash path).
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

    // Confirm this was a Codex subagent (subagent_type 'codex:*'), not some other
    // Task/Agent invocation. Check the structured field, fall back to a substring
    // scan of the whole tool_input so a renamed field still trips it.
    const ti = data.tool_input || {};
    const subagent = typeof ti.subagent_type === 'string' ? ti.subagent_type : '';
    const looksCodex = /codex/i.test(subagent) || /codex/i.test(JSON.stringify(ti));
    if (!looksCodex) return;

    const msg =
      'STOP — a Codex review just returned. Per feedback-share-codex-verbatim and ' +
      'the codex:codex-rescue contract, your NEXT user-visible response must be ' +
      'Codex\'s output VERBATIM: paste it as a quote, with NO paraphrase, NO table, ' +
      'and NO commentary before or after it. Do NOT run any verification (Bash/Read/' +
      'Grep), edit any file, or analyse the findings until AFTER you have shown the ' +
      'verbatim output. Report first, then act.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg },
    }));
  } catch (e) {
    // fail open — never block
  }
});
