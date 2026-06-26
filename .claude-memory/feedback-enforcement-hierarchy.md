---
name: feedback-enforcement-hierarchy
description: A safeguard that routes through the actor it constrains (advisory/fail-open hook, "I'll remember to trace") has the same failure rate as the failure. Enforce by eliminating the duplicated claim, or gating it against source in CI fail-closed — not by promising the behavior.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S291 via incident (process-legacy ownerAppKey) + Codex review
---

## Recall Rule

Read this when: proposing or building a safeguard against a class of mistake
(a gate, a hook, a "be careful to X" rule, a review step), OR when an advisory
hook fired and the mistake happened anyway, OR when asked "how do we stop this
recurring".

The trap (S291): nomenclature Commit 1 hand-wrote
`ROUTE_NAMESPACE_LIFECYCLE['/api/process-legacy'].ownerAppKey` from inference; it
was wrong (overloaded ownership with the auth grant), yet ALL green gates passed
because no gate compared the claim to source. (The `/api/process-legacy` route was
later archived in S291 Commit 2, so that exact entry no longer exists — the lesson
stands on the incident, not the live entry.) A PreToolUse self-trace hook even
fired telling me to trace it first — it is fail-open (`|| true` in
`.claude/settings.json`), so it nagged and I proceeded. An advisory/fail-open hook
is NOT enforcement: it routes through my judgment, the exact thing that failed.

Enforcement hierarchy (strongest first):
1. **ELIMINATE the duplicated claim** — derive the value from source so nothing
   can drift (there is nothing to drift from). Strongest: no gate, no judgment.
2. **If it must be stored, store the right contract and GATE it against source,
   in CI, FAIL-CLOSED.** Right contract: for OR-logic auth, the full accepted
   key set, not one "owner" key. In CI = `.github/workflows/test.yml`, not just
   the `/start` skill (startup-only gates route through whoever runs `/start`).
   Fail-closed = unparseable/missing input FAILS, never silently skips.
3. **Where no machine-readable ground truth exists** — friction only. Keep that
   set small (push claims toward grounded forms) and label the rest `[ASSUMED]`.
   Do not mistake friction for enforcement.

Do:
- Before claiming a safeguard will work, ask: does it depend on the actor it
  constrains? If yes, it is not enforcement — move it up the hierarchy.
- For any claim with a ground-truth source in the repo, build the gate that
  compares claim→source, and wire it into CI (not only `/start`).
- Verify a reviewer's "remove the stray X" instruction against source before
  acting — S291: the "stray token at SERPAPI:379" was a legitimate inline
  doc reference, not a leak; removing it would have damaged a real doc.

Do not:
- Add another advisory/fail-open hook or "mandatory self-trace" prose and call it
  a fix. The existing self-trace hook already says the right words and fails open;
  more words do not change the base rate (theater).
- Overload one field with two meanings (ownership vs auth) — that ambiguity is
  what let the bad value pass.

Why: a safeguard's value is its independence from the failure mode. Restating the
desired behavior ("I'll stop at the gate") is not enforcement if it can not-happen.

How to apply: prefer derive-from-source > gate-against-source-in-CI-fail-closed >
friction+`[ASSUMED]`. New gates land in `.github/workflows/test.yml` with a
self-test. See `check:route-lifecycle-auth` + `check:scaffolding-tokens` (S291)
as the worked examples.

Ground truth: `shared/config/appRegistry.js` (`ROUTE_NAMESPACE_LIFECYCLE`
guardAppKeys/ownerAppKey); `scripts/check-route-lifecycle-auth.js`;
`scripts/check-scaffolding-tokens.js`; `.github/workflows/test.yml`. Related:
[[feedback-red-gates-are-p0]]; [[feedback-self-review-before-delegating-review]];
[[feedback-behavior-claims-cite-the-producer]]; [[feedback-scrutinize-exemptions-and-fallthrough]].
