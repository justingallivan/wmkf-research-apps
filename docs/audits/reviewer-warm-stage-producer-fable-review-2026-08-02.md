---
title: Reviewer Warm-Stage Producer Specification — Claude Fable Review
domain: reviewer-workbench
kind: audit
status: complete
summary: "Read-only Fable review of the authoritative warm-stage producer specification and the primary agent's disposition."
canonical: false
cataloged: 2026-08-02
owner: product-engineering
related:
  - docs/REVIEWER_WARM_STAGE_PRODUCER_SPEC.md
  - docs/REVIEWER_FIND_PERFORMANCE_PLAN.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
---

# Reviewer Warm-Stage Producer Specification — Claude Fable Review

## Review boundary

Claude Fable reviewed the first draft read-only on 2026-08-02 against the
controlling performance plan and enforcement contracts. It was asked to test
cold receipt emission, zero-provider warm revisits, freshness versus promotion
authority, one-candidate/stage isolation, dependency/version binding,
concurrency, partial success, address trust, terminal convergence, and
fail-closed complements. It did not edit the branch.

The first full-source Fable CLI attempt produced no output and was terminated
after approximately nine minutes. A bounded second attempt read the three
controlling documents in full and returned the findings below. Its verdict on
the first draft was **NEEDS REWORK**.

## Findings and disposition

| Severity | Fable finding | Primary-agent disposition |
|---|---|---|
| P1 | No closed writer set could guarantee `roster_persistence` after cold emission, invalidation, or a lost terminal CAS. | **Accepted.** Cold upsert and manual completion now write terminal state atomically; a provider-free explicit legacy repair is the third and only other writer. Warm GET remains read-only. |
| P1 | Identity consumed proposal-derived context without binding the proposal content version. | **Accepted.** Identity now binds `proposalContentVersion`; the performance-plan invalidation matrix invalidates identity and its dependents on proposal change. |
| P1 | “Current identity” conflated completed evidence with positive identity authority, risking wrong-person provider work or a refresh deadlock. | **Accepted.** The contract now separates `identityStageCurrent` from `identityAuthoritySatisfied`, uses structured staff repair, and emits reason-coded downstream N/A receipts without provider work when identity is complete but nonauthoritative. |
| P1 | Trusted institution-domain evidence had no owning producer or invalidation edges. | **Accepted.** A distinct `institution_domains` producer now owns bounded anchored/plausible domains and per-lookup completeness; eligibility/contact depend on its receipt. |
| P2 | Address repair did not say how a new staff-verified address replaces prior `missing_email` contact and address N/A receipts. | **Accepted as blocking for implementation.** The dedicated structured action now re-projects contact and address trust together in one CAS. |
| P2 | The completion receipt union appeared to conflict with persisted `refreshing`/derived `stale`. | **Accepted.** Lease metadata and planner-derived stale state are now explicitly separate from completed receipt state. |
| P2 | Warm recomputation of a proposal-author fingerprint could violate the no-proposal-parse warm rule. | **Accepted.** Sealed derived fingerprints are reused only while their outer Graph content version still matches cheap metadata. |
| P2 | API outcomes diverged from the performance-plan vocabulary and failure persistence was ambiguous. | **Accepted.** The documents now share one closed outcome union and distinguish durable failed receipts, rejected prerequisites, CAS loss, and successful current/N/A recording. |
| P3 | “Reject versions” contradicted the required opaque roster CAS token. | **Accepted.** The token is explicitly permitted as correlation only; authority/content/result versions remain prohibited request inputs. |
| P3 | Optional wording for N/A outcomes was too permissive. | **Accepted.** N/A conditions now use deterministic server reason codes including `no_trusted_domains`, `no_proposal_authors`, and `identity_not_authoritative`. |

## Primary-agent review

The Fable findings were concrete and contract-relevant. The primary agent
verified the proposal-version contradiction in the performance-plan matrix and
verified that the current domain-evidence helper lives inside the composite
contact finalizer and can swallow individual OpenAlex lookup failures. The
first-draft verdict is therefore upheld.

## Closure reviews

A bounded second Fable pass confirmed nine original findings closed and found
one residual P1 documentation contradiction plus two nonblocking omissions:

- the plan still described `refreshing`/`stale` as completed receipt states;
- the locked one-stage boundary omitted the dedicated structured-address
  two-receipt exception; and
- the matrix omitted applicant→institution-domain invalidation and did not
  state the nonauthoritative-identity N/A branch precisely.

All three were corrected. A final narrow Fable pass verified the completed
receipt/live lease/derived stale separation, the sole address-action exception,
and both matrix corrections. It returned **READY FOR IMPLEMENTATION** with no
P0/P1 blockers. Its sole optional P2 requested an explicit location for N/A
reason codes; the result envelope now carries allowlisted `reasonCode` separately
from failure-only `failureCode`.
