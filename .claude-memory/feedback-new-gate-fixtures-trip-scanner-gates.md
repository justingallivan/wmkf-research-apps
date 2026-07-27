---
name: feedback-new-gate-fixtures-trip-scanner-gates
description: "Committing a new gate/self-test with synthetic entity-like or path-like fixture strings can turn OTHER scanner gates red (check:atlas scans scripts/ for entity sets) — run the FULL gate suite before pushing new gate scripts, not just \"touched-surface\" gates."
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: c513ecfd-f41e-4862-b3e3-65c7dd7d7a3e
  last_verified: 2026-07-27 via scripts/check-application-state-atlas.js scan roots and synthetic allowlist
---

## Recall Rule

After adding or editing a scanner gate or synthetic fixture, run the full
`check:*` suite before push. If another scanner correctly sees the fixture, use a
documented fixture allowlist rather than weakening the negative test.

S329: Stage 0's self-test fixture used the synthetic entity name
`should_not_count` inside `scripts/check-dataverse-access-layer-self-test.js`.
`check:atlas` scans `scripts/` for entity-set strings, so CI `Tests` went red on
main for THREE pushes before it was noticed — the touched-surface gate
selection ("this is a scripts/ probe, not data-layer") skipped atlas each time.

**Why:** scanner gates sweep paths regardless of what surface a script
"belongs" to. Verified scopes (S329): `check:atlas` scans code incl.
`scripts/` for entity-set strings (the gate that fired); `check:secret-scan`
scans ALL tracked files (`git ls-files`); `check:doc-symbol-refs` resolves
`scripts/...` path refs written in memory/wiki text. (`drain-table-mentions`
and `prompt-storage-mentions` scan only `docs/` + `.claude-memory/` — md
surfaces, not scripts.) A NEW script with synthetic entity- or secret-shaped
fixture strings is inside the first two gates' blast radius.

**How to apply:** when a commit ADDS or edits a gate script or its self-test
fixtures, run the full `check:*` suite (or at minimum every scanner gate)
before pushing — not just the gates for the surface the script targets. Fix
mechanism when a scanner false-positives on a synthetic fixture: the gate's
documented allowlist WITH a written reason (e.g. `ALLOWED_UNDOCUMENTED_ENTITIES`
in `scripts/check-application-state-atlas.js`), not renaming the fixture to a
real name — that weakens the self-test's negative assertion. Related:
[[feedback-red-gates-are-p0]].
