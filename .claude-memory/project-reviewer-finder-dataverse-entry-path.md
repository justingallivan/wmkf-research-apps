---
name: Reviewer Finder — Dataverse-native entry path
description: Reviewer-finder APIs are fully Dataverse-native. Save-candidates and cycle/material flows run on Dataverse since W3–W6 cutovers (2026-05-12). The standalone page was retired S261; the reviewer-finder Postgres drain tables were DROPPED 2026-06-04 (migration 018).
type: project
originSessionId: 97cd3044-49bb-4f67-b000-5d32980d6faa
status: active
scope: reviewer
last_verified: 2026-06-16 via standalone page retirement + prior live Postgres probe/migration 018 verification
---

## Recall Rule

Read this when: planning reviewer-finder API work that touches save-candidates writeback or the (now-dropped) Postgres reviewer tables.

Do:
- Treat the Dataverse-native API entry path as DONE (save-candidates shipped W3–W6, 2026-05-12); don't rebuild it.
- Treat the standalone Reviewer Finder page as retired S261; Workbench reviewer components are now the staff UI.
- Use the verification commands in the body to re-confirm status if needed.
- Treat the 5 reviewer-finder Postgres tables as GONE — DROPPED 2026-06-04 via migration 018 ([[project-w6-table-drop-pending]], now closed).

Do not:
- Reference `researchers`/`researcher_keywords`/`publications`/`proposal_searches`/`reviewer_suggestions` as live Postgres tables — they no longer exist (only `search_cache` survives).
- Assume `researchers.js`/`extract-summary.js` still exist (deleted W5/W6).

Ground truth: `shared/components/reviewers/ReviewerFindPanel.js`, `pages/api/reviewer-finder/save-candidates.js`, `docs/atlas/postgres-researchers.md`, `docs/atlas/postgres-other-reviewer-tables.md`, [[project-w6-table-drop-pending]].

**Status: SHIPPED, then UI rehomed.** Both pieces of the original direction landed before 2026-05-03; the standalone page was later retired S261 after the Workbench superseded it:

- **Picker UI:** Superseded by the Workbench reviewer flow; do not cite `pages/reviewer-finder.js` as live code after S261.
- **Save-candidates writeback:** `pages/api/reviewer-finder/save-candidates.js` writes via the three Dataverse adapters (`potential-reviewer`, `researcher`, `reviewer-suggestion`) — Postgres is **no longer written by this endpoint**. Review Manager and My Candidates both read from Dataverse.

**Postgres reviewer tables DROPPED 2026-06-04 (migration 018), after draining via the W3–W6 cutovers (2026-05-12).** The migration that the prior framing said was needed has shipped, and the drained tables have now been removed:
- `pages/api/reviewer-finder/researchers.js` — **deleted W6 step 1 2026-05-12** (per `docs/atlas/postgres-researchers.md:51,59,70`).
- `pages/api/reviewer-finder/extract-summary.js` — **retired W5 step 5 2026-05-12** (per `docs/atlas/postgres-other-reviewer-tables.md:23`).
- `pages/api/reviewer-finder/grant-cycles.js` — **Dataverse-only since W3 cutover 2026-05-12** (header at `pages/api/reviewer-finder/grant-cycles.js:9` reads "W3 cutover (2026-05-12) — Dataverse-only"; `wmkf_appgrantcycles` has 10 rows live per audit 2026-05-14).
- `pages/api/reviewer-finder/generate-emails.js` — zero `@vercel/postgres` imports (verified 2026-05-14).
- `pages/api/reviewer-finder/my-proposals.js` — Dataverse-only, builds OData filter on `akoya_request`.

**How to apply:** when planning reviewer-finder API work, do not rebuild save-candidates writeback — it's done. The standalone page is retired; use Workbench reviewer components for staff UI context. The reviewer-finder Postgres tables (`researchers`, `researcher_keywords`, `publications`, `proposal_searches`, `reviewer_suggestions`) were DROPPED 2026-06-04 via migration `018_drop_reviewer_finder_postgres_tables.sql` (done early at Justin's direction; see `project-w6-table-drop-pending.md`, now closed). `search_cache` was kept (live literature-search cache). Don't reference the dropped tables as live.
- **Identity bridge (`user_profiles` → `systemuser`)** — the original direction listed this as a prerequisite. It's working in prod (the picker uses it via `program-director-resolver.js`), but the broader identity-reconciliation TODO in `project-dynamics-identity-reconciliation.md` covers attribution on Dataverse writes and joined reporting, which is a different scope and still open.

**Verification commands** (if status ever needs to be re-confirmed):
- `test ! -f pages/reviewer-finder.js` — standalone page should remain retired.
- `head -20 pages/api/reviewer-finder/save-candidates.js` — header comment confirms Postgres is no longer written.
- `ls pages/api/reviewer-finder/researchers.js pages/api/reviewer-finder/extract-summary.js` — both should return "No such file" (deleted W5/W6 2026-05-12).
- `grep "Dataverse-only" pages/api/reviewer-finder/grant-cycles.js` — should match the W3 cutover header.
