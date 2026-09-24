# Sandbox schema gap for later-stage Test Request Factory recipes

Read-only metadata probe of the registered sandbox (`orgd9e66399.crm.dynamics.com`),
2026-09-24 UTC, Session 537, via `EntityDefinitions` and the `akoya_request`
attribute list. Names only; no row data was read.

## Custom entities referenced by application code but absent from the sandbox

`wmkf_requestdocuments`, `wmkf_appreviewersuggestions`, `wmkf_appreviewanswers`,
`wmkf_reviewquestions`, `wmkf_ai_runs`, `wmkf_ai_prompts`, `wmkf_appgrantcycles`,
`wmkf_apprequestpersons`, `wmkf_finalwriteupreviewacknowledgements`,
`wmkf_granteedeliverables`, `wmkf_portalmemberships`, `wmkf_proposalbudgetlines`.

Present: the 100 `akoya_*` entities and `wmkf_appsystemsetting`,
`wmkf_appuserappaccess`, `wmkf_appuserpreference`, `wmkf_bbstatus`,
`wmkf_deliberationsession`, `wmkf_deliberationslot`, `wmkf_donors`,
`wmkf_grantprogram`, `wmkf_policy`, `wmkf_policyversion`,
`wmkf_potentialreviewers`, `wmkf_programlevel2`, `wmkf_programlevel3`,
`wmkf_sitevisit`, `wmkf_supporttype`, `wmkf_type`.

## `akoya_request` columns the later-stage recipes write or read, absent from the sandbox

`wmkf_currentinitialassessment` (Initial Assessment pointer), `wmkf_ai_fieldprimer`
(Field Primer), and every other application-added request column except the
Factory's own `wmkf_istestrequest` and `wmkf_testcreationrunid`, which the
sandbox does carry.

## Consequence

Build-order item 6 (Initial Assessment recipe, synthetic reviewers and reviews,
site-visit materials, Pre-Site seed, Pre-RP brief, Final Writeup) cannot be
proven live in the sandbox until the application solution (request-document
registry, review tables, request columns) is imported there. That import is an
owner action outside this repository.
