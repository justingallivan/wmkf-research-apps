'use strict';

/**
 * Shared trigger detection for the PreToolUse(Bash) commit hooks
 * (enum-parity-commit-guard, trust-boundary-guid-commit-guard, pre-commit-self-review).
 *
 * Replaces the brittle /\bgit\s+commit\b/ test, which:
 *   (a) MISSED real commits that carry a global option between `git` and the
 *       subcommand — `git -c user.name=x commit`, `git -C /path commit`,
 *       `git --no-pager commit`. For a BLOCKING guard a missed commit is a silent
 *       disable, the dangerous direction.
 *   (b) false-fired on the `commit-tree` / `commit-graph` plumbing commands and on
 *       the substring `git commit` inside unrelated text.
 * (Codex S259 review, finding B4.)
 *
 * Approach: split the command on shell separators (&& || ; | newline) so a
 * compound `git add . && git commit` is seen, then within each segment find the
 * `git` token and walk PAST git's global options (skipping the separate value of
 * value-taking options like `-c key=val`) to the first subcommand token — match
 * iff it is exactly `commit`.
 *
 * This APPROXIMATES shell parsing (it does not model quoting, heredocs, or
 * subshells). That trade is deliberate: these hooks fail OPEN, so the cost of a
 * rare false-positive is one extra gate run on a clean tree (harmless), while the
 * property that matters — never MISSING a real `git commit` form — is what the
 * token walk buys. Bias is toward detecting a commit, not toward suppressing one.
 */

// `git` global options that consume a SEPARATE following argument; their value
// must be skipped so it is not mistaken for the subcommand. (`--opt=value` and
// bare flags consume only themselves and need no entry here.)
const GLOBAL_OPTS_WITH_VALUE = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix',
]);

function segmentIsGitCommit(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  const gi = tokens.indexOf('git');
  if (gi === -1) return false;
  let i = gi + 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.startsWith('-')) {
      // `-c key=val` / `-C dir` separate-arg form: skip the option AND its value.
      i += GLOBAL_OPTS_WITH_VALUE.has(t) ? 2 : 1;
      continue;
    }
    // First non-option token after `git` is the subcommand. `commit-tree` /
    // `commit-graph` are distinct subcommands and correctly do NOT match.
    return t === 'commit';
  }
  return false;
}

/** True iff `cmd` invokes the `git commit` subcommand (in any global-option form,
 *  in any segment of a compound command). */
function isGitCommit(cmd) {
  if (typeof cmd !== 'string' || cmd.length === 0) return false;
  return cmd.split(/&&|\|\||;|\n|\|/).some(segmentIsGitCommit);
}

/** True iff the command carries `--amend` (used to skip amend commits). */
function isAmend(cmd) {
  return typeof cmd === 'string' && /--amend\b/.test(cmd);
}

module.exports = { isGitCommit, isAmend };
