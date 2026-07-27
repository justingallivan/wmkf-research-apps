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

Ground truth: historical owner feedback from the S188 Neon-pricing error and
the S377 local-toolchain error. Pair with
[[feedback-verify-external-platform-claims]] (verify first),
[[feedback-share-codex-verbatim]] (preserve reviewer output), and
[[feedback-falsify-not-confirm]] (run the disconfirming check).

## Evidence Shapes

- External platform: current authoritative URL beside the claim.
- Repo fact: current `path:line` or the exact command and bounded output.
- Live service: named read-only probe plus timestamp and scope.
- Reviewer finding: retain the review round and its cited source.
- Training or memory only: label explicitly unverified; do not upgrade it to fact.
- Local toolchain: use a command that names ownership/version (`npm -g ls`,
  package metadata, `readlink`), not a containing directory or filename pattern.

`[VERIFIED]` means the cited command or probe was actually run and its output can
be reproduced. It is not a confidence label. An inference stays `[ASSUMED]`, even
when it looks obvious.

## Historical Failure Pattern

- S188: an incorrect Neon retention claim was repeated without the authoritative
  citation supplied by review.
- S377: `/opt/homebrew/bin/vercel` was mistaken for proof of Homebrew ownership;
  `readlink` showed it belonged to npm. A path contained the binary but did not
  identify its installer.

When another agent or the owner disputes a mechanically checkable fact, run the
check and cite it. Do not out-assert the evidence.
