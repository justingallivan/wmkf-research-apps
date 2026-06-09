---
name: project-reviewer-self-report-orcid-sticky-confirmed
description: PR4 shipped — reviewer self-reported ORCID capture; `confirmed` is meant to be a sticky human-attestation sentinel. ⚠️ S235 DISCREPANCY (Codex-verified): the automated OpenAlex/ORCID SPINE (S232/S233) DOES emit `confirmed` — the "resolver never emits confirmed" invariant below is contradicted by live code. Needs a dedicated reconciliation pass.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: S218 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: touching the reviewer self-reported ORCID capture, the identity resolver's emitted statuses, or `writeIdentityDecision`/`clearIdentityFields`.

> ⚠️ **OPEN DISCREPANCY (S235, Codex-verified — needs a dedicated reconciliation pass).** This memory's core invariant ("the automated resolver NEVER emits `confirmed`") is **false for the OpenAlex/ORCID identity SPINE** shipped later (S232 `0ac4728` / S233 `86b8dd4`): `classifySpineEvidence` returns `confirmed` (`lib/services/reviewer-identity-resolver.js:165,172`), `mapSpineVerificationResult` maps it straight to verified/high-confidence (`lib/services/discovery-service.js`), and tests lock that behavior (`reviewer-identity-evidence.test.js`). So an AUTOMATED `confirmed` IS reachable. The sticky-skip guards in `researcher.js` (`writeIdentityDecision`/`clearIdentityFields`) still hold, but the "only a human emits confirmed" premise they were designed around no longer holds — whether the spine's `confirmed` should be downgraded to `probable`, or the sentinel model changed, is the open question. Do NOT rely on "automated = never confirmed" until reconciled. (The S235 ORCID-employment promotion fix deliberately emits `probable` only, so it did not widen this.)

Do:
- Preserve `confirmed` on `wmkf_identitystatus` as a RESERVED sticky human-attestation sentinel. (CAVEAT: the automated spine emits `confirmed` too — see the discrepancy above; this "Do" reflects the original PR4 intent, not current spine behavior.)
- Keep both adapter write paths refusing to overwrite/null when stored status is `confirmed`, and keep both reads FAIL-CLOSED (transient/403 propagates, never falls through to a wipe).
- Treat reviewer self-report as the highest-trust ORCID source (it overwrites a resolver guess).

Do not:
- Make the resolver emit `confirmed`, add a manual-attestation status, or refactor the two adapter methods without re-preserving the sticky-skip + fail-closed reads — you reintroduce the silent-wipe bug.

Ground truth: `lib/services/capture-self-reported-orcid.js`, `lib/dataverse/adapters/researcher.js` (`writeIdentityDecision`, `clearIdentityFields`), `pages/api/external/review/[token]/respond.js`, `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` §14, `tests/unit/capture-self-reported-orcid.test.js`.

PR4 (reviewer self-reported ORCID) SHIPPED to prod S218 (merge `876dd88`, headless e2e runner `015aad6`). At Stage 2a the reviewer confirms/corrects their own ORCID on the authenticated magic-link accept/decline form; `pages/api/external/review/[token]/respond.js` then calls `captureSelfReportedReviewerOrcid` (`lib/services/capture-self-reported-orcid.js`) — **non-fatal** (accept/decline already committed) — which OVERWRITES the person `wmkf_orcid`/`wmkf_orcidurl` (self-report beats a resolver guess) and fill-only writes the contact join key via `setOrcidIfAbsent`.

**Invariant (PR4 design intent — see the S235 discrepancy above; partly false now):** `confirmed` on `wmkf_identitystatus` was meant to be a RESERVED sticky human-attestation sentinel that the automated resolver never emits. As of the S232/S233 spine that is **no longer true** — the spine's `classifySpineEvidence` DOES emit `confirmed`. What still holds: both write paths in `lib/dataverse/adapters/researcher.js` refuse to overwrite/null a stored `confirmed` (the sticky-skip + fail-closed reads):
- `writeIdentityDecision` (~L203–213): if the incoming decision isn't itself `confirmed`, it reads the row and RETURNS without overwriting when stored status is `confirmed`.
- `clearIdentityFields` (~L237–245): refuses to null identity fields when stored status is `confirmed`.
Both reads **fail CLOSED** (Codex S217 #1): a transient/403 read error propagates rather than falling through and wiping an attestation we couldn't verify.

**Why:** without these guards an automated resolver verdict (or a downgrade-triggered field clear) would silently overwrite/wipe a reviewer-attested ORCID — the highest-trust source we have (the person attested it after receiving the token at their own email).

**How to apply:** if you ever make the resolver emit `confirmed`, add a manual-attestation status, or refactor `writeIdentityDecision`/`clearIdentityFields`, you MUST preserve the sticky-skip + fail-closed reads, or you reintroduce the silent-wipe bug. Tests: `tests/unit/capture-self-reported-orcid.test.js`. Design: `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` §14. Related: [[project-reviewer-identity-resolution-phase1]] (the resolver + `wmkf_identity*` fields), [[project-reviewer-identity-resolution]].
