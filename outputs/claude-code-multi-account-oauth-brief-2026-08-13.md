# Claude Code Multi-Account OAuth Profile Brief

**Status:** Planned; not implemented\
**Prepared:** 2026-08-13\
**Intended executor:** A future Claude Code session

## Objective

Allow personal and commercial Claude Code sessions to run concurrently on this
Mac without one login changing the account used by the other session. Both
profiles must use interactive Claude OAuth/subscription authentication, never an
Anthropic API key or provider gateway.

## Verified Basis

- `[VERIFIED via Anthropic Claude Code documentation, 2026-08-13]`
  `CLAUDE_CONFIG_DIR` isolates settings, credentials, session history, and
  plugins. Anthropic specifically documents it as useful for running multiple
  accounts side by side.
- `[VERIFIED via Anthropic Claude Help Center, 2026-08-13]` A Team or Enterprise
  Claude Code login uses `/login`, followed by **Claude account with
  subscription**, selection of the commercial plan, and OAuth authorization.
- `[ASSUMED]` The user's commercial subscription is a Team or Enterprise plan.
  Confirm the exact organization during OAuth rather than inferring it.

References:

- <https://code.claude.com/docs/en/env-vars>
- <https://support.claude.com/en/articles/11845131-use-claude-code-with-your-team-or-enterprise-plan>

## Requested Configuration

Inspect the user's existing Bash startup files first and preserve all unrelated
content. Add hardened aliases to the appropriate Bash profile (likely
`~/.bash_profile`, but verify which file the interactive shell loads):

```bash
alias claude-personal='env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX -u CLAUDE_CODE_USE_FOUNDRY CLAUDE_CONFIG_DIR="$HOME/.claude-personal" claude'
alias claude-work='env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX -u CLAUDE_CODE_USE_FOUNDRY CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude'
```

Do not export `CLAUDE_CONFIG_DIR` globally. A global export would recreate the
account-switching problem for every Claude process.

Do not copy credential files between the profile directories. Launch each alias
and authenticate it independently:

1. Run `claude-personal`, then `/login`, and select the personal subscription.
2. Run `claude-work`, then `/login`, and select the Team or Enterprise
   organization covered by the commercial terms.
3. If the OAuth browser chooses the wrong identity or organization, use a
   separate browser profile or private window for the initial authorization.

## Verification

After reloading the Bash profile, verify without printing tokens or credential
files:

1. `type claude-personal` and `type claude-work` resolve to the intended aliases.
2. `claude-personal auth status` reports a Claude subscription OAuth login for
   the personal account.
3. `claude-work auth status` reports a Claude subscription OAuth login for the
   commercial organization.
4. Start both aliases in separate terminals at the same time and confirm that
   logging in or working in one does not change the account reported by the
   other.
5. Confirm neither command falls back to API, Bedrock, Vertex, Foundry, or a
   custom Anthropic base URL.

Never display, commit, copy, or summarize the contents of either profile's
credential files.

## Future `claude-rescue` Integration

Any Codex-to-Claude rescue wrapper for this repository should invoke
`claude-work`, or apply the same environment isolation directly, so delegated
repository work always uses the commercial OAuth profile. It must fail closed
when `claude-work auth status` does not confirm the intended commercial OAuth
account.

## Completion Criteria

- The Bash startup file contains the two isolated aliases and no unrelated
  edits.
- Both profiles are independently authenticated through OAuth.
- The commercial profile is visibly associated with the intended organization.
- Concurrent sessions retain separate identities.
- No API key or alternate-provider authentication is used.

## Suggested Future-Session Prompt

> Implement `outputs/claude-code-multi-account-oauth-brief-2026-08-13.md`.
> Inspect my Bash startup configuration before editing it, preserve unrelated
> content, and do not expose credentials. Pause for my participation when each
> OAuth browser login is required. Verify both profiles and concurrent account
> isolation when finished.
