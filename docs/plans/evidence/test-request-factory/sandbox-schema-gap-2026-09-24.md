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

## Resolution (2026-09-24, Session 538)

Resolved without a solution import. The sandbox was brought to production
`wmkf_` schema parity from the repository: every schema wave was replayed and
two waves were generated from read-only production metadata for the items
that had no schema file. A post-apply inventory of both environments found
every production `wmkf_` table, column and choice value present in the sandbox,
except the rollup's two helper columns; two computed columns exist there as
plain columns. The 22 `akoya_` vendor tables that exist only in production
were left out. Record and replay recipe: PR #331,
`docs/plans/SANDBOX_SCHEMA_PARITY_2026-09-24.md` on branch
`claude/sandbox-schema-parity`. <!-- doc-symbol-refs:ignore reason=other-branch -->

