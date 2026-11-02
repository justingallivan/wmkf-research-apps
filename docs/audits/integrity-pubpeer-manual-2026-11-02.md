# PubPeer manual-link policy — 2026-11-02

## Authority and source status

[VERIFIED via owner instruction] Remove automated PubPeer searches, add a manual link and update review completion; require OAuth-only read-only Fable review before merging. No subscription purchase, provider call, saved-screen rewrite or production migration is part of this change. Source implementation is on codex/integrity-pubpeer-manual, not deployed yet.

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
