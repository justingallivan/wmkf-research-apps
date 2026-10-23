---
name: project-reviewer-pi-identity-structured
description: "The intended proposal PI role is owner-attested structured data: akoya_request._wmkf_projectleader_value → contact. The current branch resolver selects Project Leader only; this source repair is not a deployment verdict. ORCID anchors person identity, not PI role. See the 2026-10-22 audit."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-10-22 source review; June 10, 2026 probes remain sample evidence only
---

## Recall Rule
Read whenever a reviewer flow needs proposal PI identity for the applicant trail, PI exclusion, institution/COI, or proposal-text fallback. The intended role semantics below are owner-attested; source behavior and deployment state are separate claims.

## The path (structured source and owner semantics)
- **Owner-attested intended meaning (S159):** `akoya_request._wmkf_projectleader_value` → a **contact** who is the scientist/PI, distinct from the program director (`_wmkf_programdirector_value`, see [[project-akoya-request-pd-fields]]) and `akoya_primarycontactid` (foundation liaison). `wmkf_researchleader` means the institution's research officer, not the PI.
- **Current branch source [VERIFIED via source, 2026-10-22]:** `lib/services/proposal-pi-identity.js` selects only `projectleader`; absent Project Leader returns `no_project_leader` without selecting officer identity. The focused unit fixture keeps a Research Leader with valid identity metadata inert. This is a source repair on the current branch, not evidence of deployment or live behavior. No approved program-specific exception was found. The June 10, 2026 read-only Dataverse/ORCID probes on requests 1002794, 1002959, and 1003020 are sample observations, not proof of all-program semantics or population; affected live population/impact is UNKNOWN. Name and ORCID checks validate a selected person's identity, not that the person has the PI role.
- The contact carries `wmkf_orcid`, `fullname`/`firstname`/`lastname`, and `emailaddress1` (domain ≈ institution). All three S239 PIs had `wmkf_orcid` populated.
- ORCID → an **identity-anchored** OpenAlex author record:
  `GET https://api.openalex.org/authors/https://orcid.org/<id>`. This avoids
  name-search selection, but does not prove the OpenAlex cluster's corpus is
  clean; same-name merges still occur.

## Why this matters
LLM extraction of the PI from the proposal narrative is unreliable: on 1002794 the cover page did not state the institution, so Claude parametrically guessed "Wayne State" wrapped in hedge text, and a fuzzy name+institution resolver misresolved "Wen Li" → "Yanping Li" (a different, prolific same-surname author) with FALSE confidence. When the selected structured contact is the PI, its ORCID anchors person lookup without a name-search selection; it does not establish that the selected contact holds the PI role.

## Residual risk
The resolver checks the Project Leader contact against the OpenAlex author by comparing available forename and surname values; a contradiction or an uncheckable comparison abstains. This is a person-identity check, not a role check. The ORCID-registry lookup (`https://pub.orcid.org/v3.0/<id>/person`) is a best-effort corroboration, not an enforced prerequisite; S239's three sample checks included `0000-0002-3721-4008` → Wen Li, Wayne State. The role meaning remains owner-attested; source repair alone does not establish live deployment or population impact.

Identity-EXACT ≠ corpus-clean — see [[project-openalex-merge-use-orcid-works]]. Request context also consumes this selection for COI (`lib/services/reviewer-request-context.js:281,297`); discovery/enrichment identity exclusion and name augmentation are affected consumers. `docs/audits/pi-identity-request-mutation-audit-2026-10-22.md` is the original finding and impact inventory; re-check current source and live state before treating its deployment or population conclusions as current. Consumed by [[project-reviewer-origination-multilane]].
