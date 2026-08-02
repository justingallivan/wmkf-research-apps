---
name: project-reviewer-referral-capture
description: "SHIPPED S249; structured portal capture and durable referral closure added 2026-08-01 on the review branch. The external decline form collects up to four Name/Institution/Email rows; structured closure derives from existing referred-candidate provenance, while legacy free-text records remain readable and dismissible only after staff resolves them. Identity resolution still uses manual-reviewer-add plus the hardened abstain-or-confirm spine."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-08-01
---

## Recall Rule
Read when touching the Workbench invite/track flow, manual reviewer add, or
reviewer referral capture and identity resolution.

## Status: SHIPPED S249
Built as a thin layer over manual-add: `referredBy` on `manual-reviewer.js` →
`referred` provenance kind (`reviewer-provenance.js`; grounded-rank bonus +
identity-review-exempt/selectable-with-verify like `proposal_named`) + the referrer
in the durable match reason (no new Dataverse field) + a `referred` `wmkf_sources`
token so it survives a `my-candidates` reload. UI: the manual-add card is now "Add
or Refer a Reviewer" (`ReviewerFindPanel.js`). Codex-reviewed (the durability
reload gap was the HIGH it caught — fixed). Design + decisions:
`docs/REVIEWER_FINDER_REFERRAL_CAPTURE_DESIGN.md`. The sections below are the
original S244 design intent, now realized.

## Why (validated S244)
The J26 coverage tests showed referral chains are how panels actually fill
perspective gaps: for 1002379, Claude surfaced **Abby Doyle**; Justin contacted
her and she **referred Tim Newhouse** (a synthesis reviewer no lane had surfaced).
So the tool's job is a strong candidate pool + efficient human curation +
**referral capture** — NOT full automation. A referral from a respected reviewer
is a STRONG signal (≈ proposal_named strength) and worth surfacing in ranking/UI.
See [[project-reviewer-apps-redesign-direction]] (human-in-the-loop).

## The feature
A contacted reviewer suggests an alternate → one action adds that person to the
request's Candidates pool, enriched/verified, tagged provenance **referred** +
**referredBy** (who suggested them).

## The hard part (Justin) + the safety posture
The external decline form now captures up to four structured rows with a
required published name and optional institution/email. Existing records may
still contain legacy free text. The Workbench never submits a legacy prose
block as one person's name: staff add its people separately, then dismiss the
resolved legacy note. Structured rows disappear only when the request already
has an exact-name referred candidate (and exact email too when the referral
supplied one) that is selected or engaged. This reuses the existing `referred`
`wmkf_sources` provenance instead of adding operational tokens to that field;
failed/ambiguous adds and promotion/restore remedies therefore remain visible.
Legacy dismissal preserves the original text behind a versioned prefix in
`wmkf_declinereferral`. Staff can still enter a sparse referral.
Resolving any referral to a canonical person is the **same name→identity problem
the pipeline already solves** — apply the same
posture as [[project-reviewer-verify-fail-dangerous]]: resolve confidently OR
present the top matches for **1-click human confirmation**; on ambiguity keep a
**sparse name-only candidate flagged "unresolved — needs contact"** (do NOT
fabricate or auto-resolve to a namesake — wrong-person here means emailing the
wrong reviewer).

## Reuse, don't rebuild
`pages/api/workbench/manual-reviewer.js` (S236 manual add) already adds a sparse
person into Candidates with provenance + a manual email-source LOW-confidence
flag. Referral capture = manual-add + a **referrer** field + structured contact
hints + a **referred** provenance tag. Identity resolution reuses the
OpenAlex/ORCID/PubMed spine + `lib/services/reviewer-identity-resolver.js`.
