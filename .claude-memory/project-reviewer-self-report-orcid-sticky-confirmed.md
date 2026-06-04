---
name: project-reviewer-self-report-orcid-sticky-confirmed
description: PR4 shipped — reviewer self-reported ORCID capture; `confirmed` is a sticky human-attestation sentinel the resolver must never emit or overwrite.
metadata:
  type: project
---

PR4 (reviewer self-reported ORCID) SHIPPED to prod S218 (merge `876dd88`, headless e2e runner `015aad6`). At Stage 2a the reviewer confirms/corrects their own ORCID on the authenticated magic-link accept/decline form; `pages/api/external/review/[token]/respond.js` then calls `captureSelfReportedReviewerOrcid` (`lib/services/capture-self-reported-orcid.js`) — **non-fatal** (accept/decline already committed) — which OVERWRITES the person `wmkf_orcid`/`wmkf_orcidurl` (self-report beats a resolver guess) and fill-only writes the contact join key via `setOrcidIfAbsent`.

**Invariant (the thing a future change can silently break):** `confirmed` on `wmkf_identitystatus` is a RESERVED sticky human-attestation sentinel. The automated resolver (`lib/services/reviewer-identity-resolver.js`) only ever emits probable/unresolved/ambiguous — `confirmed` is NOT reachable from it. Both write paths in `lib/dataverse/adapters/researcher.js` enforce this:
- `writeIdentityDecision` (~L203–213): if the incoming decision isn't itself `confirmed`, it reads the row and RETURNS without overwriting when stored status is `confirmed`.
- `clearIdentityFields` (~L237–245): refuses to null identity fields when stored status is `confirmed`.
Both reads **fail CLOSED** (Codex S217 #1): a transient/403 read error propagates rather than falling through and wiping an attestation we couldn't verify.

**Why:** without these guards an automated resolver verdict (or a downgrade-triggered field clear) would silently overwrite/wipe a reviewer-attested ORCID — the highest-trust source we have (the person attested it after receiving the token at their own email).

**How to apply:** if you ever make the resolver emit `confirmed`, add a manual-attestation status, or refactor `writeIdentityDecision`/`clearIdentityFields`, you MUST preserve the sticky-skip + fail-closed reads, or you reintroduce the silent-wipe bug. Tests: `tests/unit/capture-self-reported-orcid.test.js`. Design: `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` §14. Related: [[project-reviewer-identity-resolution-phase1]] (the resolver + `wmkf_identity*` fields), [[project-reviewer-identity-resolution]].
