---
name: project-reviewer-referral-capture
description: "Endorsed feature (S244, Justin): 'add suggested candidate' — capture reviewer-REFERRED candidates. A contacted reviewer who declines/responds often suggests a colleague via FREE TEXT (name ± institution/context). The hard part is resolving that free text to a real person; reuses manual-reviewer-add (S236) + the identity spine, with abstain-or-confirm safety (never auto-resolve to a namesake)."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-12
---

## Recall Rule
Read when building the Workbench invite/track flow, manual reviewer add, or any
reviewer free-text → identity resolution.

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
Referrals arrive as **free text** (name only / name+institution / name+context /
email signature / a reviewer-form field). Resolving to a canonical person is the
**same name→identity problem the pipeline already solves** — apply the same
posture as [[project-reviewer-verify-fail-dangerous]]: resolve confidently OR
present the top matches for **1-click human confirmation**; on ambiguity keep a
**sparse name-only candidate flagged "unresolved — needs contact"** (do NOT
fabricate or auto-resolve to a namesake — wrong-person here means emailing the
wrong reviewer).

## Reuse, don't rebuild
`pages/api/workbench/manual-reviewer.js` (S236 manual add) already adds a sparse
person into Candidates with provenance + a manual email-source LOW-confidence
flag. Referral capture = manual-add + a **referrer** field + the free-text
resolution UX + a **referred** provenance tag. Identity resolution reuses the
OpenAlex/ORCID/PubMed spine + `lib/services/reviewer-identity-resolver.js`.
