---
name: Codex as recurring code review surface
description: Justin runs Codex periodically as a sanity-check reviewer; expect more reviews and use them to calibrate priorities
type: project
originSessionId: 87c3bedf-c936-4b4d-bdb8-69e4062e9249
---
Justin plans to run Codex (or similar third-party static review) periodically as a sanity check on the codebase. The 2026-04-30 review (`docs/archive/CODE_REVIEW_FRAGILITY_FINDINGS_2026-04-30.md`) is the first one; my response is in `docs/archive/CODE_REVIEW_RESPONSE_2026-04-30.md`.

**Why:** independent eyes catch architectural drift the active developer (and I) miss. Codex doesn't see conversation context, so it sometimes flags things we've already planned to fix — that's still useful confirming signal.

**How to apply:**
- When a new Codex (or similar) review lands, mirror the response shape used in `docs/archive/CODE_REVIEW_RESPONSE_2026-04-30.md`: independently verify each finding against the code, push back where Codex missed context, propose sequencing in waves, save addenda as decisions land.
- Treat findings that overlap with our existing plan as confirming signal, not duplication — note that explicitly.
- Treat findings about properties that have shifted since the last review (e.g., "Postgres user_profile_id filter" after a Dataverse cutover) as architectural-drift markers worth recording in the doc.
- Don't let the review become the to-do list — use it as input, prioritize against the user's actual goals (Wave 1 / 2 / 3 framing).
- **Session 129 update (2026-05-04):** Codex shifted from one-shot reviews to ongoing security-audit cadence. `docs/API_ROUTE_SECURITY_MATRIX.md` is the living artifact — now **tracked in the repo** and CI-gated via `npm run check:api-routes` (per `CLAUDE.md:245`); PRs touching `pages/api/**` fail without a matrix update. Justin pastes findings to me, I act on them. When responding, write the response as a copy-pasteable message so Justin can take it back to the Codex session unchanged.
