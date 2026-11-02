# PubPeer manual-link policy — 2026-11-02

## Authority and source status

[VERIFIED via owner instruction] Remove automated PubPeer searches, add a manual link and update review completion; require OAuth-only read-only Fable review before merging. No subscription purchase, provider call, saved-screen rewrite or production migration is part of this change. Implementation was reviewed on codex/integrity-pubpeer-manual and is now deployed through PR #607; final evidence is below.

The owner supplied June correspondence offering paid DOI/author APIs and limited trial documentation, with proposed real-time/no-cache/no-AI-training use. Six subsequently authorized diagnostic SerpAPI calls returned no valid PubPeer links; explicit site parameters still returned unrelated sites for two people. The signed-in account menu exposed no API documentation. The owner chose manual-only rather than buying access. Earlier assertions that no sanctioned API exists or Google access is unambiguously permitted are superseded. Permission for screening-history storage or LLM summarization under a future subscription remains unknown.

## Contract and invariants

| Invariant | Producer / persistence / consumer | Verification |
|---|---|---|
| No automated PubPeer search or analysis | Both callers → engine: manual DTO only; automated method/prompt removed | Generator tests with configured provider keys prove only google_news requests occur |
| Manual link is not a clean search or completed manual check | sources.pubpeer JSON: mode manual, searched false, no counts/results; both UIs and PDF/Markdown/JSON | UI/export tests pin neutral label and encoded fixed-host link |
| Version-3 approvals require automated sources and legitimate roster/actor | Server review validates Retraction Watch+news, dataset, matching evidence, exact manual marker; unchanged authority and roster guards | Service, route and real-Postgres review tests |
| Old evidence retains old rules | Version-1/2 approval readback remains policy-specific; old unapproved runs cannot receive new approval | Historical approval/hold and unknown-version negative tests |
| No new async or persistence surface | Existing final dataset fence, awaited Workbench insert, append-only review, request-generation UI guards unchanged | Existing regression tests; no migration |

Whole-flow trace: staff request → authenticated run route → server roster → engine with manual PubPeer DTO → existing awaited history JSON insert → final response/UI/history and exports → authorized review route → version-specific coverage/roster/authority checks → append-only review row → status. Manual navigation has no callback or state mutation. News failures and dataset changes remain incomplete. No provider calls were used for implementation tests.

Seven audits: whole-flow and partial-success follow the same full-run save and per-source errors; manual status contributes no concerns. Async guards and final corpus-generation fence are preserved. Helper is limited to generating/describing manual PubPeer evidence; historical policies are not silently reinterpreted. Durable changes stay inside existing JSON; no table/route/migration. Source-version/manual-mode consumers include server review, both UIs, PDF/Markdown/JSON, and tests. Documentation reconciliation updates the guide/wiki/Atlas/catalog/security pointers and distinguishes source from deployment. Fable and release results will be recorded here.

## Controller verification before review closure

[VERIFIED via local execution] 165 focused tests across 10 suites pass; 4 review tests pass against isolated loopback Postgres. Scoped lint has zero errors and the two preexisting IntegrityTab hook warnings. Prompt-injection, Atlas, API-route, docs catalog/currency/fact, symbol, wiki and secret gates and their self-tests pass. No production writes or provider calls were performed. Fable review is pending; merge remains gated on review closure and all release checks.

## Initial Fable review and disposition

[VERIFIED via host OAuth review] Model claude-fable-5-1, 47 turns, no permission denials; read-only tools only, no API/provider credentials or MCP servers. Initial verdict: one P2 help/app-card contradiction blocked merge. Core no-PubPeer-call, manual status, version-3 approval/history, auth/roster/fence/persistence and UI/export invariants were confirmed.

The P2 is corrected in guideContent and appRegistry and covered by a real metadata regression test. P3 route-header, Markdown label, dead concern-count coupling and related credential/prompt/system documentation were also corrected. News analysis and historical data remain unchanged. The bounded Fable closure review completed as READY TO MERGE; final evidence is below.

## Fable closure and release verification

[VERIFIED via host OAuth read-only closure] Model claude-fable-5-1, 18 turns, no permission denials: **READY TO MERGE**, prior P2 closed and no remaining P0–P2 merge blockers. The original review used 47 turns. No provider/API keys were passed to either agent process and no metered review product was substituted. Fable confirmed the actual help/app-card copy and regression test, Markdown/PDF manual link labels, route header, removal of the dead PubPeer concern-count coupling, and prompt/credential/system documentation. Its requested post-promotion source-status reconciliation is included in this final documentation pass.

[VERIFIED via PR #607 and production deployment] Final source head d3a9e25091399033b2a225abffc8952936f4612e passed every release check, including full Tests workflow 41532972263 (application suite and PostgreSQL-16 integration). Local focused verification: **166 tests / 10 suites** and **4 isolated real-Postgres review tests**, scoped lint zero errors (two preexisting hook warnings), relevant prompt/Atlas/API/documentation/wiki/secret gates and self-tests.

PR #607 merged 2026-11-02 at 22:04:36 UTC as **431a718889d577c6e2515cc58e97127654ee3e36**. Vercel production **dpl_EMb1sWckL9wCyvpL3gzw3ce571TX** is READY at that exact merge SHA. Production read-only verification confirms applications.wmkeck.org resolves to this exact deployment; Production worker enablement is on, the monthly refresh entry remains 0 6 1 * *, and all ten dataset/provenance/audit/schedule checks pass. Corpus remains 73,521 records at generation 1 with full-row hash bdb7e1cce9ff5da5e8fae3395101000335a64ccd5b0b94a55239ef5db2189bea and completed initial publication audit 282049. No paid re-screen, PubPeer API call, corpus refresh, migration, saved-screen rewrite or staff decision was invoked during this change. The unrelated dirty main checkout remains untouched.

Current use: run a new screen to obtain policy-version-3 results and its manual PubPeer link. Older failed PubPeer runs remain historical/incomplete under their original policy and cannot be silently re-approved. Opening the manual link does not complete or attest a check; new staff approval requires the latest current-roster screen, complete automated Retraction Watch/news and existing authority. Manual PubPeer review is optional and unrecorded.
