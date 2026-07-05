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
 * For codex-rescue, also preserves background launch notices as durable handoffs:
 * the job id and /codex:status command are the only link Claude has after a
 * detached run.
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
    // Task/Agent invocation. When the structured field is present it is
    // authoritative — a non-codex subagent whose prompt merely MENTIONS Codex must
    // not trip this (S322: it fired on a plain inventory agent via the old
    // whole-input substring scan). The substring fallback survives only for the
    // renamed/missing-field case it was built for.
    const ti = data.tool_input || {};
    const hasSubagentField = typeof ti.subagent_type === 'string' && ti.subagent_type.length > 0;
    const looksCodex = hasSubagentField
      ? /codex/i.test(ti.subagent_type)
      : /codex/i.test(JSON.stringify(ti));
    if (!looksCodex) return;
    const looksCodexRescue = hasSubagentField
      ? /codex:codex-rescue|codex-rescue/i.test(ti.subagent_type)
      : /codex:codex-rescue|codex-rescue/i.test(JSON.stringify(ti));

    const rescueHandoffReminder = looksCodexRescue
      ? ' If the verbatim Codex output is a background launch notice, preserve the job id and `/codex:status <job-id>` command exactly; do not paraphrase it into a vague promise or claim Claude will automatically notice completion.'
      : '';

    const msg =
      'STOP — a Codex review just returned. Per feedback-share-codex-verbatim and ' +
      'the codex:codex-rescue contract, your NEXT user-visible response must be ' +
      'Codex\'s output VERBATIM: paste it as a quote, with NO paraphrase, NO table, ' +
      'and NO commentary before or after it. Do NOT run any verification (Bash/Read/' +
      'Grep), edit any file, or analyse the findings until AFTER you have shown the ' +
      'verbatim output. Report first, then act.' + rescueHandoffReminder;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg },
    }));
  } catch (e) {
    // fail open — never block
  }
});
