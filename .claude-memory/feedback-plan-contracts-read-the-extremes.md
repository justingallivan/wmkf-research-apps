---
name: feedback-plan-contracts-read-the-extremes
description: "Plan-authoring guards from the S330 P0 miss — derive denominators and their dependent tables from the same probe; read the largest/oddest instances before writing a contract over N files; same-session docs need the reconcile sweep too; verify the conversion operation, not just endpoint equivalence"
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: c18124b6-2252-442d-b924-73ea740f86cf
---

Four guards for staged-plan authoring, from the S330 Route→Service P0 round-1 verdict (1 live-state error + 7 required changes, all coverage misses — Codex's advantage was reading the files, not deeper reasoning).

**Why:** The plan's wave table was built on a 47-route breakdown while the baseline row above it said "union TBD" (true union: 49); the route-shell contract was written without opening the named hardest routes, so three SSE routes and a multi-verb route contradicted it; the gate-design wording went stale the same session when the scanner was hardened; the wrapper-swap decision proved A≡B but not the swap's own failure modes (non-string labels throw; scope can shrink during restructuring).

**How to apply:**
1. A denominator and every artifact derived from it come from the SAME probe run at planning time. Any input still marked TBD/[ASSUMED] makes every derived table TBD — no silent inheritance. If the resolving probe is one command, run it now.
2. Before writing a contract that N files must satisfy, read the 2-3 largest/oddest members of N (the plan usually already names them by size). A contract checked only against the ideal case is a hypothesis.
3. Never hand a reviewer a question answerable by reading a file already identified ("check whether any routes stream") — read it first; the review then verifies instead of discovers.
4. The durable-docs reconcile sweep includes documents authored earlier in the SAME session — own-authorship recency is false evidence of currency.
5. For any "replace A with B, they're equivalent" step: enumerate the failure modes of performing the replacement (call-shape variance, boundary shrink), not just endpoint equivalence.

Related: [[feedback-falsify-not-confirm]], [[feedback-behavior-claims-cite-the-producer]], [[feedback-reconcile-dont-append-docs]].
