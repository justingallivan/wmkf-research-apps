# Codex brief — safe download filenames and Pre-RP census stage (2026-09-23)

## Where

You are in `/Users/gallivan/Code/WMKF_Apps-codex` on branch `codex/download-filenames-census`, created from `origin/main`. Run `/start` first. **Stay on this branch and in this directory.** Claude is working in parallel in the main checkout and in `/Users/gallivan/Code/WMKF_Apps-factory` (Test Request Factory); do not check out other branches, edit those directories, or run gates there.

Commit each item separately with a descriptive message and push this branch (`git push -u origin codex/download-filenames-census`). Pushing a feature branch does not deploy. **Never push to `main`; do not merge.** The owner and Claude review and merge.

## Item 1 — safe `Content-Disposition` filenames on five routes

Source: `docs/CURRENT_WORK_QUEUE.md`, "Unescaped `Content-Disposition` filenames on five download/export routes".

`lib/utils/content-disposition.js` exports `contentDisposition(type, filename)` (ASCII quoted fallback plus RFC 5987 `filename*`), with tests in `tests/unit/content-disposition.test.js`. `pages/api/cycle-dossier/download.js:16` is the reference caller. These five routes still build the header by hand:

| Route | Current header construction |
|---|---|
| `pages/api/review-manager/export-reviews.js` | raw `filename="${exported.filename}"` (~line 45) |
| `pages/api/workbench/export-candidates.js` | raw `filename="${filename}"` (~line 46) |
| `pages/api/dynamics-explorer/download-document.js` | quote-escaping only (~line 82) |
| `pages/api/review-manager/download-review.js` | multi-line `Content-Disposition` (~line 55) |
| `pages/api/reviewer-finder/cycle-material.js` | local `sanitizeFilename(...)` (~line 137) |

Do:
- Read the helper and its tests first; convert each route to `contentDisposition('attachment', <filename>)`, keeping each route's current disposition type.
- Before removing a local sanitiser (for example `sanitizeFilename` in `cycle-material.js`), read what it does. If it serves another purpose besides header escaping, keep that behavior and only replace the header construction.
- Add or extend a route-level test per file that asserts the header for a filename containing a double quote, a non-ASCII character and a CR/LF, so header injection and mojibake cannot regress. Reuse each route's existing test file if one exists.
- Change nothing else in these routes: auth guards, query handling and response bodies stay as they are.
- When done, update that one `docs/CURRENT_WORK_QUEUE.md` entry to record the fix (commit and test files). Do not edit other queue entries.

## Item 2 — allow the Pre-RP brief fallback stage in the explicit-actor census

Source: `SESSION_PROMPT.md` (Verified Open item "Census still treats Pre-RP brief fallback events as violations").

`scripts/probe-request-document-explicit-actor-census.js:20-24` defines `ALLOWED_UNATTRIBUTED_ORIGIN_STAGES` (stage → required producer, `null` meaning stage-only). It lacks `pre-rp-brief-generation`, so the manual census would report the Pre-RP brief's intended fallback as a violation.

Verified facts to build on (re-read them):
- `lib/services/pre-rp-brief/artifact-service.js:908-915` creates the row with `actorPolicy: ALLOW_UNATTRIBUTED` and `actorContext.operation: 'pre-rp-brief-generation'`, and sets `wmkf_producer: PRE_RP_BRIEF_CONTRACT.producer` (~line 901).
- `lib/services/request-document-actor-service.js:116,128-129` records the event with `stage` = the context operation, `metadata.operation` = the same value, and `metadata.producer` = the row's `wmkf_producer`.
- The census matches an event when the stage is allowlisted, `metadata.operation` equals the stage, and, for producer-bound entries, both the row and the event name that producer (`isAllowedOriginEvent`, lines 26-32).

Do:
- Add the `pre-rp-brief-generation` entry. Prefer the producer-bound form using the real value of `PRE_RP_BRIEF_CONTRACT.producer` (locate its definition; do not guess the literal). Use stage-only `null` only if you find a concrete reason the producer can differ, and say why in the commit.
- The script exports `classifyRows` (line 284) but has no unit test. Add `tests/unit/request-document-explicit-actor-census.test.js` covering: an allowed Pre-RP fallback row + event; the same with a mismatched producer (still a violation); an existing stage (`initial-assessment-generation`) unchanged; and an unlisted stage still a violation.
- Do not run the census against Dataverse. It reaches production data, and running it needs the owner's explicit authorization.

## Out of bounds (parallel Factory work)

Do not edit: `lib/services/test-requests/`, `lib/services/dynamics/email.js`, reviewer or grantee email senders (`review-manager/send-emails-service.js`, `reviewer-*-sweep.js`, `reviewer-manual-reminder.js`, `reviewer-acceptance-*.js`, `reviewer-due-extension.js`, `review-manager/withdraw-sufficient-service.js`, `reviewer-engagement/terminal-transition.js`, `workbench/grantee-deliverables/`, `scheduled-email-service.js`), `lib/bill/`, `pages/api/cron/`, Workbench dashboard/search/request-header code, `SESSION_PROMPT.md`, and the Test Request Factory plan docs.

## Checks before each commit

Run sequentially, never in parallel (the self-tests write fixtures the gates scan):
- the focused Jest files you touched, and `npx eslint` on changed files;
- `npm run check:api-routes && npm run check:api-routes:self-test`;
- `npm run check:route-service-boundary && npm run check:route-service-boundary:self-test`;
- after the queue edit: `npm run check:doc-currency && npm run check:doc-currency:self-test` and `npm run check:fact-consistency && npm run check:fact-consistency:self-test`.

Report which checks ran and their results; if a check is red, say so rather than working around it.
