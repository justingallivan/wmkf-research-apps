---
title: Reviewer Identity & Contact — Codex Build Handoff
domain: reviewer-identity
kind: runbook
status: active
summary: "Continuation handoff: W0 and W1 affiliation/COI are implemented; promotion verification is next, while W2-W4 remain gated."
canonical: false
cataloged: 2026-07-18
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

## Verification state

The W1 matrix covers Broad/HHMI exemptions, direct-campus precedence, Janelia
separation, Dana-Farber versus MGH, Dana-Farber/Harvard consistency,
Whitehead/MIT consistency, IAS/Princeton separation, same-hospital matching,
provider abstention, and the no-widening firewall. Relevant existing route and
partial-batch tests remain green.

Before promotion, run the named red gates and self-tests sequentially, the full
test suite/build, and an author-adversarial diff review. Reconcile any findings
before merging. This is Tier 1+ runtime work and must not land directly on
`main` without deliberate promotion.

## Next product choice

W2 works-first disambiguation remains unstarted and eval-gated. The open owner
questions are whether to add any umbrella organization beyond HHMI/Broad,
whether the frozen benchmark should credit a correct-but-flagged bind for
fragmented famous names, and whether to evaluate Prophy versus continue the
in-house resolver.

For W2, the frozen 40-case identity benchmark is not on this branch; retrieve it
with:

```bash
git show codex/m1-evaluation-foundation:docs/audits/reviewer-holistic-identity-benchmark-v2.json
```
