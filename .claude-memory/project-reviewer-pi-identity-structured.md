---
name: project-reviewer-pi-identity-structured
description: "The proposal PI is STRUCTURED data, not LLM-extracted: akoya_request._wmkf_projectleader_value → a contact carrying wmkf_orcid (+ fullname, emailaddress1). ORCID → exact OpenAlex author (hard key, no namesake hazard). Use this for PI identity / exclusion / COI, NOT proposal-text extraction. Distinct from PD (program director)."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-10 via live probe on 1002794 / 1002959 / 1003020
---

## Recall Rule
Read whenever you need the proposal's PI (Project Leader) identity — for the applicant trail, PI exclusion, institution/COI, or any path that currently LLM-extracts the PI from proposal text.

## The path (READ-ONLY, structured)
- `akoya_request._wmkf_projectleader_value` → a **contact** (fall back to `_wmkf_researchleader_value`). This is the SCIENTIST/PI — distinct from the program director (`_wmkf_programdirector_value`, see [[project-akoya-request-pd-fields]]) and from `akoya_primarycontactid` (foundation liaison).
- The contact carries `wmkf_orcid`, `fullname`/`firstname`/`lastname`, and `emailaddress1` (domain ≈ institution). All three S239 PIs had `wmkf_orcid` populated.
- ORCID → **exact** OpenAlex author: `GET https://api.openalex.org/authors/https://orcid.org/<id>`. ORCID is the hard key → no name-search namesake hazard.

## Why this matters
LLM extraction of the PI from the proposal narrative is unreliable: on 1002794 the cover page did not state the institution, so Claude parametrically guessed "Wayne State" wrapped in hedge text, and a fuzzy name+institution resolver misresolved "Wen Li" → "Yanping Li" (a different, prolific same-surname author) with FALSE confidence. The structured ORCID path removes that at the root.

## Residual risk
A MIS-ENTERED ORCID on the contact would silently resolve to the wrong person. Guard: cross-check the contact name against the ORCID-registry record (`https://pub.orcid.org/v3.0/<id>/person`) before trusting it (S239 verified all three correct; e.g. `0000-0002-3721-4008` → ORCID registry = Wen Li, Wayne State).

Identity-EXACT ≠ corpus-clean — see [[project-openalex-merge-use-orcid-works]]. Consumed by [[project-reviewer-origination-multilane]].
