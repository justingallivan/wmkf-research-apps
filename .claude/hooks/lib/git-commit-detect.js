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
 * Approach: strip quoted spans (so a `git commit` mention inside a `-m "…"`
 * message or an `echo "git commit"` string is not seen as a command), then split
 * on shell separators (&& || ; | newline and `(` `)` grouping) so a compound
 * `git add . && git commit` or a subshell `(git commit …)` is seen, then within
 * each segment find the `git` token and walk PAST git's global options (skipping
 * the separate value of value-taking options like `-c key=val`) to the first
 * subcommand token — match iff it is exactly `commit`.
 *
 * This APPROXIMATES shell parsing (it does not model heredoc bodies, nested
 * escapes, or `git` reached only through a variable/alias). That trade is
 * deliberate: these hooks fail OPEN, so the cost of a rare false-positive is one
 * extra gate run on a clean tree (harmless), while the property that matters —
 * never MISSING a real `git commit` form — is what the token walk buys. Matching
 * stays liberal (any `git` token in a segment, not only at segment start) on
 * purpose: anchoring to the start would risk a false NEGATIVE on an unlisted
 * command prefix, the one direction a BLOCKING guard must not take.
 *
 * Codex (S259, follow-up review) confirmed GLOBAL_OPTS_WITH_VALUE is complete and
 * flagged the quoted-message / subshell / require-placement gaps addressed here.
 */

// Remove double-, single-, and backtick-quoted spans (honoring backslash escapes)
// so their contents are never tokenized as a command. Replace with a space so
// adjacent tokens do not fuse.
function stripQuoted(s) {
  return s
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' ');
}

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
  return stripQuoted(cmd).split(/&&|\|\||;|\n|\||\(|\)/).some(segmentIsGitCommit);
}

/** True iff the command carries the `--amend` FLAG (used to skip amend commits).
 *  Quoted spans are stripped first so `--amend` inside a commit MESSAGE does not
 *  falsely trigger a skip. */
function isAmend(cmd) {
  return typeof cmd === 'string' && /--amend\b/.test(stripQuoted(cmd));
}

module.exports = { isGitCommit, isAmend };
