---
title: Reviewer Identity & Contact — Codex Build Handoff
domain: reviewer-identity
kind: runbook
status: active
summary: "Continuation handoff: W0/W1 are live and W2 has a legacy-default runtime seam; authoritative cutover remains owner-gated."
canonical: false
cataloged: 2026-07-19
owner: product-engineering
related:
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
  - docs/audits/reviewer-disambiguation-email-external-alternatives-fable-2026-07-18.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
---

# Reviewer Identity & Contact — Codex Build Handoff

This is the continuation entry point for the
[Reviewer Identity & Contact plan](REVIEWER_IDENTITY_CONTACT_PLAN.md).

## Current state

- **W0 `[IMPLEMENTED]`:** the request-scoped OpenAlex institution resolver
  remains null-on-ambiguity and provider-failure-safe.
- **W1 `[IMPLEMENTED on codex/agent-self-verification-enforcement]`:**
  production discovery, enrichment, workbench, save-time COI, mismatch-alert,
  and identity-corroboration paths now use the institution substrate.
- Shared **Broad** or **HHMI** alone remains visible but is exempt from automatic
  hard drop. A directly shared MIT, Harvard, hospital, or other campus still
  hard-drops. No additional umbrella organization is exempt.
- **Janelia Research Campus is distinct from HHMI.**
- OpenAlex `associated_institutions` is used only for one-hop consistency in
  mismatch alerts and identity corroboration. It is not imported into the COI
  hard-drop matcher and common-parent transitivity is not inferred.
- The authoritative save path recomputes against both candidate evidence and
  trusted CRM reuse affiliations before its first write; a direct CRM match
  outranks a Broad/HHMI exemption.
- **W2 `[LEGACY-DEFAULT RUNTIME SEAM; CUTOVER NOT BUILT]`:** the
  works-first resolver passed the pinned 40-case benchmark with +9 correct
  binds, zero genuine wrong-person binds, one unchanged right-person-policy
  bind, and three remaining misses. Same-ORCID fragments collapse; distinct
  ORCIDs always go to review. The scoring overlay cannot affect resolver
  consensus.
- `ReviewerIdentityRuntime` now owns the production Track-A spine call. Unset,
  `legacy`, and unknown `REVIEWER_IDENTITY_RESOLVER_MODE` values execute legacy
  only. `shadow` settles every legacy candidate in the batch first, then runs
  each W2 comparison under an independent hard 15-second deadline, but returns
  the exact legacy objects. Observer failures are contained. No authoritative
  W2 mode exists.

## Verification state

The W1 matrix covers Broad/HHMI exemptions, direct-campus precedence, Janelia
separation, Dana-Farber versus MGH, Dana-Farber/Harvard consistency,
Whitehead/MIT consistency, IAS/Princeton separation, same-hospital matching,
provider abstention, and the no-widening firewall. Relevant existing route and
partial-batch tests remain green.

The W2 evaluator and shadow arm have no Dataverse/Postgres/Blob writes. Default
production resolver behavior is unchanged, and raw benchmark output remains
gitignored.
The corrected run changed 11 automatic outcomes. Its only two mandatory review
cases are the already-labeled unsafe initials-only A. Patel and J. Kim cases;
seven additional review leads do not alter automatic behavior. The
evaluation/scoring client used 176 OpenAlex requests at $0.104, excluding the
current spine's internal OpenAlex traffic.

The required fresh-agent adversarial reviews found and closed twelve defects
before promotion: scoring-label leakage into resolver consensus, unqualified
request accounting, an unsafe shared-title duplicate-ORCID heuristic, shadow
provider contention, runtime/evaluator anchor-comparison drift, incomplete
provider-failure accounting, evaluator drift from W0 institution resolution,
observer exceptions that could escape the shadow seam, cross-candidate provider
contention, swallowed evaluation-provider failures, and a cooperative rather
than hard shadow deadline, plus per-request timeout leakage into retry backoff.
Focused tests and the clean post-extraction 40-case rerun are green. The runner
rate-paces requests and requires zero provider failures, preventing throttling
from passing as misses.

## Next product choice

W2's next optional product step is an owner-approved shadow observation period by
setting `REVIEWER_IDENTITY_RESOLVER_MODE=shadow` in a chosen environment and
redeploying. Do not set it as part of this build. Authoritative cutover requires
a later reviewed code change because the current mode allowlist contains only
`legacy` and `shadow`. The separate open policy questions are whether to add any umbrella
organization beyond HHMI/Broad and whether the benchmark should credit a
correct-but-flagged bind for fragmented famous names. The buy-vs-build question
is closed: continue the in-house resolver and do not evaluate Prophy.
`[OWNER DECISION 2026-07-18; owner-reported Prophy assessment, not independently
benchmarked]`

Reproduce the W2 run with:

```bash
npm run eval:reviewer-identity:w2
```

Tracked inputs are
`docs/audits/reviewer-holistic-identity-benchmark-v2.json` and
`docs/audits/reviewer-identity-w2-person-equivalence-v1.json`; the runner checks
their pinned hashes and refuses mutation.
