---
title: Final Writeup acknowledgement Wave 23 — Claude Fable adversarial review (2026-08-31)
domain: workbench
kind: audit
status: active
summary: Read-only OAuth review of the Wave 23 acknowledgement preflight; accepted findings were fixed and roster completeness was owner-attested, while Production apply still needs explicit approval.
canonical: false
cataloged: 2026-08-31
last_verified: 2026-08-31
owner: product-engineering
related:
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
  - lib/dataverse/schema/wave23-final-writeup-review-acknowledgement/wmkf_finalwriteupreviewacknowledgement.json
  - scripts/preflight-final-writeup-review-acknowledgement-schema.mjs
  - scripts/probe-access-and-identity-census.js
---

# Final Writeup acknowledgement Wave 23 — adversarial review

## Review conditions

- **Date:** 2026-08-31
- **Branch:** `codex/final-writeup-acknowledgements`
- **Mode:** read-only adversarial review; the reviewer made no file or live-state changes.
- **Authentication:** Claude Code's Keychain-backed `claude.ai` OAuth session, with `ANTHROPIC_API_KEY` and `CLAUDE_API_KEY` removed from the delegated process environment.
- **Model disclosure:** the requested review was described as Opus, but the delegated CLI identified the completed review as `claude-fable-5`. The owner explicitly accepted that disclosed review and authorized fixing findings that Codex agreed with.
- **Production safety:** no Wave 23 Production schema write occurred.

## Verdict

**READY WITH NAMED CHANGES.** The review found no reason to reject the proposed
organization-owned acknowledgement entity or its Final-document + reviewer
identity key. Its accepted findings required a stricter preflight and a narrower
statement of what the identity census proves.

## Accepted findings and disposition

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | The access/identity census proves link integrity for profiles it sees, not that `user_profiles` contains every intended PD, PC, CSO, and President. | Fixed probe output and durable status language. **Resolved:** the owner confirmed on 2026-08-30 PT / 2026-08-31 UTC that the verified 11-person roster is the complete intended audience. |
| P2 | Relationship metadata must verify the exact schema name, lookup/navigation binding, and cascade behavior, especially `Delete: Restrict`. | Fixed. Both relationship schema names are pinned and the preflight checks the complete cascade contract. |
| P2 | A failed alternate-key index is terminally divergent, not merely pending. | Fixed. Only `Pending` and `InProgress` classify pending; `Failed` and unknown states classify divergent. |
| P2 | An existing relationship with the intended schema name but the wrong metadata type must classify divergent, not absent. | Fixed with an untyped existence probe followed by the typed cast. |
| P2 | Classifier self-tests must discriminate wrong attribute shape, relationship binding/cascade/type, key attributes, and key-index states. | Fixed with explicit negative fixtures for each case. |
| P2 | The identity probe's safety header and exit-code contract were incomplete, and inactive exclusions were not visible. | Fixed. The header describes all reads, documents exits `0`/`2`, and reports active-without-email and inactive exclusions. |
| P2 | Operators should be led to the non-writing schema dry-run before any execute command and should see the exact entity-set name after creation. | Fixed. The preflight prints dry-run-first guidance and the live `EntitySetName` when present. |

## Read-only evidence

### Identity link integrity

The Production census found 13 profiles. Eleven active, sign-in-capable staff
profiles resolved by exact Azure/internal email to existing enabled Dataverse
`systemuser` rows. One active synthetic Test User has no Azure email and cannot
sign in; one inactive Tom Rieker profile also has no Azure email and is excluded.

This is **[VERIFIED via the 2026-08-31 read-only Production census]** for the 11
profiles in the probe. It does **not** establish that the roster contains every
person intended to serve as a PD, PC, CSO, or President. That completeness claim
was subsequently **[OWNER-ATTESTED 2026-08-30 PT / 2026-08-31 UTC]** for the
complete intended PD/PC/CSO/President audience.

### Wave 23 metadata

The hardened Production metadata preflight reported **11 absent, 0 divergent,
0 pending, and 0 exact**. The ordinary Production apply command also completed
in non-writing dry-run mode and described the expected create operations. This
is **[VERIFIED via Production metadata reads and apply dry-run]** as
creation-compatible, not deployed. The sandbox dry-run could not start because
`DYNAMICS_SANDBOX_URL` is not configured; this is an environment limitation,
not evidence about Sandbox metadata.

## Remaining gates

The identity condition is now satisfied:

- **[RESOLVED]** The owner attested that the probed 11-person roster contains
  every intended PD, PC, CSO, and President.
- **[OPEN]** The owner gives explicit authorization for the Production schema
  apply.

After any authorized apply, exact metadata readback and
`EntityKeyIndexStatus === 'Active'` remain required before a readiness flag or
runtime acknowledgement path can be enabled.
