---
title: Final Writeup acknowledgement Wave 23 — Claude Fable adversarial review (2026-08-31)
domain: workbench
kind: audit
status: active
summary: Read-only OAuth Wave 23 review with accepted fixes, followed by owner-attested identity and exact Active Production schema deployment; runtime remains disabled.
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
- **Production safety at review time:** no Wave 23 Production schema write had
  occurred. The later owner-approved apply is recorded below.

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

### Wave 23 metadata and authorized apply

The hardened Production metadata preflight initially reported **11 absent, 0
divergent, 0 pending, and 0 exact**. The ordinary Production apply command also
completed in non-writing dry-run mode and described the expected create
operations. The sandbox dry-run could not start because
`DYNAMICS_SANDBOX_URL` is not configured; this is an environment limitation,
not evidence about Sandbox metadata.

After explicit owner authorization, the first local execute attempt was denied
by `DATAVERSE_TARGET_INTERLOCK` before its first POST; immediate readback stayed
11 absent. The approved rerun used the repository's date-bounded, auditable
`DATAVERSE_PROD_WRITE_ACK` exception without weakening the interlock. It created
the entity, six custom fields, two relationships, and alternate key. Metadata
propagation briefly reported the key absent and then Pending. Final hardened
readback reported **11 exact, 0 absent, 0 divergent, and 0 pending**, entity set
`wmkf_finalwriteupreviewacknowledgements`, and an Active key index. A separate
live count returned zero rows.

## Gate disposition

The identity condition is now satisfied:

- **[RESOLVED]** The owner attested that the probed 11-person roster contains
  every intended PD, PC, CSO, and President.
- **[RESOLVED]** The owner explicitly authorized the Production schema apply;
  final metadata readback is exact and the alternate key is Active.

No runtime acknowledgement path or readiness flag was enabled. The next slice
must add the typed adapter, readiness contract, service, and focused tests before
any UI consumer is introduced.
