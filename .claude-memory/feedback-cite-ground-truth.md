---
name: Cite ground truth — never pass through unsourced
description: Every external OR local-environment fact stated to the user gets a source citation (URL, file path + line, the command run and its output, Codex round + their citation, or explicit "unverified, from memory/training"). `[VERIFIED]` means a command was run whose output can be quoted — never an inference. Pass-through citations from Codex must be retained.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S377 via /doctor install-path failure 2026-07-26 (re-probed)
---

## Recall Rule

Read this when: about to state any external fact to the user — especially platform-specific facts (pricing, retention, quota, API behavior, security model) or facts pulled from a Codex round.

Also read it before stating any **local-environment or toolchain fact** — how a tool was
installed, which manager owns it, what version is live, which config file is in effect.
These feel like observations because the machine is right there, but "I saw a path and
know what it means" is an inference, not an observation. Same citation bar.

Do:
- Attach a citation to every external-fact claim (URL, `path:line`, "I ran `<script>` and observed X", `[[memory-entry]]`, or "Codex round N per `<URL>`").
- Preserve the source URL Codex cited — don't strip it when relaying.
- Give tables of numeric facts (prices, limits, retention windows) a "Source:" line.

Do not:
- State bare platform facts (e.g. "6 hours") without provenance.
- Pass through training/general knowledge as fact — flag it explicitly as unverified.

Ground truth: historical-only (lesson from S188 Neon-pricing burn). Pair with [[feedback-verify-external-platform-claims]] (do the verify) and [[feedback-share-codex-verbatim]] (don't strip Codex output).

**The rule:** Every external-fact claim in a user-facing response gets a citation. No exceptions.

Categories + the shape of the citation:

| Source of fact | Citation shape |
|---|---|
| Codex finding | "per Codex round N's check against `<URL Codex cited>`" — and preserve the URL Codex gave |
| WebFetch I ran | `[per webfetch of <url> in this session]` |
| File contents I read | `<path>:<line>` |
| Live Dataverse / Postgres probe | "I ran `<script/command>` and observed X" with the timestamp |
| Memory entry | `[[memory-entry-name]]` |
| General training / knowledge | **explicitly flag as unverified**, e.g., "I think X (general knowledge — not verified against current docs)" |
| Repo CLAUDE.md / docs | `<docfile>:<section>` |
| Local environment / toolchain (installer, version, which config is live) | the command **and** its output, from a source that names the thing — `npm -g ls --depth=0`, `brew list --versions <tool>`, `readlink <path>` — never a path prefix or a filename pattern |

## The `[VERIFIED]` Label

`[VERIFIED]` is a promise that a command was run whose output can be quoted on demand.
It is not a confidence marker. If the basis is an inference — however obvious — the label
is `[ASSUMED]`, or the claim is narrowed to what was actually observed.

A wrong fact carrying `[VERIFIED]` is worse than the same fact unlabeled: the label tells
the next reader (and the next session) not to re-check it. Two guards:

- Before writing `[VERIFIED]`, name the command and be able to paste its output.
- **Prefer a source that names the entity over one that merely contains it.** `npm -g ls`
  names the package; `/opt/homebrew/bin/...` merely contains the binary. Containment is
  circumstantial — shared prefixes, shared directories, and coincidental naming all break it.

## When Codex Contradicts a Checkable Local Fact

Run the check; don't out-assert it. Skepticism toward another agent's output is warranted
for judgment and analysis, but a disagreement over a mechanically checkable fact
(installer, version, file contents, which config is live) is settled by one command, and
the agent volunteering the correction is the one who probably ran it. Repeated identical
advice from Codex is a signal, not noise. Pair with [[feedback-share-codex-verbatim]].

**Why:** S188 — user asked about Neon Postgres billing after I claimed (in a doc, then by extension in conversation) "Free tier provides ~7 days of PITR." That claim was wrong on both fronts (Free is 6h, not 7d; AND Free has a "or 1 GB of data changes" cap I omitted). Codex caught it on review and cited `neon.com/pricing`. When I subsequently discussed the issue with the user, I stated the correct numbers but **without passing through the citation Codex gave me** — which the user explicitly called out as the pattern problem.

A user receiving unsourced platform-billing claims can be misled into a real-money decision. This is exactly the failure mode `feedback-verify-external-platform-claims` is about — but that entry covers the verification step BEFORE writing claims. This entry covers the citation step AT THE POINT of stating them.

**Why (second burn, S377 — local facts, and the `[VERIFIED]` label):** asked whether the
`vercel` CLI was Homebrew- or npm-installed, I ran `which vercel`, saw `/opt/homebrew/bin/vercel`,
and asserted "Homebrew-installed" — writing it into durable memory tagged `[VERIFIED]`.
It was npm. npm's global prefix on this machine *is* `/opt/homebrew`, so npm and Homebrew
binaries share that directory and the path proves nothing. Codex had been repeatedly telling
the owner to update via npm and was right; I contradicted it from an inference. One command
settled it: `readlink /opt/homebrew/bin/vercel` → `../lib/node_modules/vercel/dist/vc.js`.
Full toolchain map and the diagnostic live in [[project-vercel-plugin-disabled-restore]].

Two distinct failures worth separating: (a) treating a cheap inference as an observation
because the check was also cheap and the answer "felt known"; (b) stamping `[VERIFIED]` on
it, which converts a correctable error into one the next reader is told to skip. (a) is
covered by [[feedback-falsify-not-confirm]]; (b) is this entry's.

**How to apply:**
- When pulling a fact from a Codex round, preserve the source URL Codex cited in your own response. Don't strip it.
- Before stating any platform-specific fact (pricing, retention, quota, API behavior, security model), check: do I have a citation handy? If not, either (a) WebFetch the authoritative source first, OR (b) explicitly flag as unverified.
- Tables of facts (especially numeric ones — prices, retention windows, limits) get a "Source:" line.
- "Per Codex's verification" or "per WebFetch of X" is the minimum acceptable citation form. Bare numbers like "6 hours" without provenance is the failure shape.
- For local-environment facts, cite the command and its output. "It's at `/opt/homebrew/bin`, so it's brew" is the failure shape — the path is containment, not identity.
- Never write `[VERIFIED]` unless a command was run whose output you can paste. Otherwise `[ASSUMED]`, or narrow the claim to what was observed.
- When Codex (or the owner) contradicts you on a mechanically checkable fact, run the check before replying.
- Pair with [[feedback-verify-external-platform-claims]] (do the verify), [[feedback-share-codex-verbatim]] (don't strip Codex output), and [[feedback-falsify-not-confirm]] (run the disconfirming query first).
