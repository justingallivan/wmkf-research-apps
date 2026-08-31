# Request Document Explicit Actor Implementation — Adversarial Review Reconciliation

Date: 2026-08-31
Reviewer: Claude Opus through the local Keychain-backed `claude.ai` OAuth session
Reviewed HEAD: `a543a45bd61a3e28d5a7c1fe0b9a58e9df832e10`
Prompt SHA-256: `cce8ba8deab38de22ceaa75929d7f02eea7a029d1e61cf95087287944cbbd565`
Verdict: **APPROVE WITH CONDITIONS**; no Blocker or High finding

The review was read-only. It ran no live probe, schema apply, environment
change, deployment, or metered review product. The full prompt is retained at
`outputs/request-document-explicit-actor-implementation-claude-review-prompt-2026-08-31.md`.

## Reconciliation

| Finding | Decision | Resolution |
|---|---|---|
| Medium — a committed availability-first create can lose its response before the missing-actor event is recorded | **Accept** | The adapter now rereads the exact generation-key row after a create error. If exactly one committed row has both origin fields null, it records the same deduplicated event before rethrowing the original error to the caller's existing recovery path. A focused lost-response test proves the repair. The event store remains best-effort; the census treats any residual gap as a violation. |
| Medium — writer/immutability gate was manual only | **Accept** | `.github/workflows/test.yml` now runs the gate and its self-test sequentially before build/test. The CI reference is updated. |
| Medium — create accepted caller-supplied origin fields while update rejected them | **Accept** | One adapter guard now rejects the three server-owned origin keys on create and update, case-insensitively, before resolution or transport. A focused test proves no identity read or Dataverse write occurs. |
| Low — quoted timestamp key evaded the source regex and the scan covered only `.js` in two directories | **Accept in bounded part** | The source census now recognizes quoted/unquoted timestamp keys and scans JS/MJS/CJS/TS/TSX under `lib`, `pages`, `shared`, and `modules`. A full AST alias-law conversion is not required for this wave; runtime create/update guards remain authoritative. |
| Low — health copy could encourage flag-before-schema order | **Accept** | The Production health error now says the flag follows exact Wave 24 preflight and schema apply. |
| Low — Final resolves the actor twice | **No change** | Both reads are bounded and fail closed; avoiding the second read would require a trusted pre-resolved-actor adapter contract that is not justified here. |
| Low — required flows tighten the null-profile/no-systemuser edge to actionable 403 | **No change** | This is the owner-approved strict-flow policy and is documented for promotion. |

## Post-fix local receipt

- Focused post-fix suites: 28/28 tests pass across actor adapter/service and Site Visit.
- `check:request-document-writers` and its self-test pass.
- Type checking passes.
- Full post-fix Wave 24 receipt: 12 suites / 229 tests, all applicable
  data/route/doc gates, and canonical Next.js/Turbopack build passed.

No finding requires Request Document privileges on a staff role. Option B
remains the approved architecture. At the reviewed HEAD, Wave 24 was
source-only. Later on 2026-08-31, the separately approved creation-only
Production schema apply completed and independent readback reported 3 exact /
0 absent / 0 divergent; readiness and runtime promotion remained separate.
