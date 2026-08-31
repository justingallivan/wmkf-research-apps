# Request Document Explicit Actor — implementation adversarial review

Perform a read-only adversarial review of the Wave 24 implementation on the
current `codex/request-document-explicit-actors` branch. Do not edit files, run
live probes, apply schema, change environments, deploy, or invoke Ultrareview or
any other paid/metered review product. Repository source, tracked documentation,
and local non-mutating tests/checks are in scope.

The approved contract is `docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md`; its
earlier plan review reconciliation is
`docs/audits/request-document-explicit-actor-adversarial-review-reconciliation-2026-08-31.md`.
Review the two implementation commits after `2a7e7fa3`, currently `b5eeda7b`
and `a543a45b`, plus any clean working-tree state at HEAD.

Trace and challenge at least:

1. All six Request Document create seams and the single adapter stamping seam.
2. Fresh session-derived actor validation, disabled/stale/missing behavior, and
   any route or caller that can inject actor/time.
3. Strict versus availability-first flow classification.
4. Duplicate-key, lost-response, reclaim, and concurrent-different-actor
   semantics; immutable origin fields must never be overwritten.
5. Site Visit legacy Review retry versus readiness-era Draft transition,
   including response-loss readback and null-actor event behavior.
6. Whether the `request_document_actor_not_captured` evidence is honest and
   whether its best-effort persistence creates an unacceptable contract gap.
7. The post-promotion census: target/time boundary, Dataverse completeness,
   event matching, false positives/negatives, and strict-flow enforcement.
8. Readiness-off schema compatibility and Production health behavior.
9. Projection/UI migration: service-principal `createdby` must never be labeled
   as the human actor; historical nulls must say “Not captured.”
10. Schema logical names, relationship navigation assumptions, preflight
    exactness, OData selects/binds, and service-principal privileges.
11. Source-gate fail-open paths and missing test discrimination.
12. Documentation claims versus actual source, with no implication that Wave 24
    is applied or deployed.

Use repository evidence and name exact file/line locations. Classify findings
as BLOCKER, HIGH, MEDIUM, or LOW. Distinguish a proven bug from a risk needing a
target probe. Give a final verdict of APPROVE, APPROVE WITH CONDITIONS, or NEEDS
REWORK. Include a receipt with `git rev-parse HEAD`, `git status --short`, and
the SHA-256 of this prompt. Do not recommend staff-role expansion unless you
prove Option B cannot meet the approved business contract.
