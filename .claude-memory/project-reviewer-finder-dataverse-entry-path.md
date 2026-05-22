---
name: Reviewer Finder — Dataverse-native entry path
description: Reviewer Finder is fully Dataverse-native. Picker, save-candidates, and browse/email/summary/cycles flows all run on Dataverse since W3–W6 cutovers (2026-05-12). Postgres reviewer tables are drain-only and scheduled for deletion ≥ 2026-07-01.
type: project
originSessionId: 97cd3044-49bb-4f67-b000-5d32980d6faa
---
**Status: SHIPPED.** Both pieces of the original direction landed before 2026-05-03; verified by reading the live code:

- **Picker UI:** `pages/reviewer-finder.js` exposes a "From My Proposals" / "Upload PDF" tab toggle. The picker (`ProposalPickerCard`) is the default tab, calling `/api/reviewer-finder/my-proposals` for the cycle dropdown and `/api/reviewer-finder/load-proposal` to materialize the chosen proposal's narrative PDF into Vercel Blob for the existing analyze pipeline. PDF upload retained as a fallback only.
- **Save-candidates writeback:** `pages/api/reviewer-finder/save-candidates.js` writes via the three Dataverse adapters (`potential-reviewer`, `researcher`, `reviewer-suggestion`) — Postgres is **no longer written by this endpoint**. Review Manager and My Candidates both read from Dataverse.

**Postgres reviewer tables are now drain-only (W3–W6 cutovers complete 2026-05-12).** The migration that the prior framing said was needed has shipped:
- `pages/api/reviewer-finder/researchers.js` — **deleted W6 step 1 2026-05-12** (per `docs/atlas/postgres-researchers.md:51,59,70`).
- `pages/api/reviewer-finder/extract-summary.js` — **retired W5 step 5 2026-05-12** (per `docs/atlas/postgres-other-reviewer-tables.md:23`).
- `pages/api/reviewer-finder/grant-cycles.js` — **Dataverse-only since W3 cutover 2026-05-12** (header at `pages/api/reviewer-finder/grant-cycles.js:9` reads "W3 cutover (2026-05-12) — Dataverse-only"; `wmkf_appgrantcycles` has 10 rows live per audit 2026-05-14).
- `pages/api/reviewer-finder/generate-emails.js` — zero `@vercel/postgres` imports (verified 2026-05-14).
- `pages/api/reviewer-finder/my-proposals.js` — Dataverse-only, builds OData filter on `akoya_request`.

**How to apply:** when planning Reviewer Finder work, do not rebuild the picker or save-candidates writeback — they're done. The four drain-only Postgres tables (`researchers`, `researcher_keywords`, `publications`, `proposal_searches`) are scheduled for one-shot DELETE per `project_w6_table_drop_pending.md` (trigger ≥ 2026-07-01). Earlier "do NOT drop the Postgres reviewer tables" framing is now stale — drop is the planned next step, not a forbidden one.
- **Identity bridge (`user_profiles` → `systemuser`)** — the original direction listed this as a prerequisite. It's working in prod (the picker uses it via `program-director-resolver.js`), but the broader identity-reconciliation TODO in `project_dynamics_identity_reconciliation.md` covers attribution on Dataverse writes and joined reporting, which is a different scope and still open.

**Verification commands** (if status ever needs to be re-confirmed):
- `grep -n "ProposalPickerCard\|FileUploaderSimple" pages/reviewer-finder.js` — both should be present, picker as default tab.
- `head -20 pages/api/reviewer-finder/save-candidates.js` — header comment confirms Postgres is no longer written.
- `ls pages/api/reviewer-finder/researchers.js pages/api/reviewer-finder/extract-summary.js` — both should return "No such file" (deleted W5/W6 2026-05-12).
- `grep "Dataverse-only" pages/api/reviewer-finder/grant-cycles.js` — should match the W3 cutover header.
