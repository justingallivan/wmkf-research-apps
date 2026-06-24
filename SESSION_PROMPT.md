# Session 285 Prompt: Reviewer-portal review-upload design decision; E2E with 1002788

## Session 284 Summary

A build session on `main`. Started green on CI (full `check:*` gate set + self-tests
all passed, no P0 blockers). Shipped the reviewer acknowledgement policies live AND
fixed a previously-latent, prod-breaking jsdom/serverless bug across all three markdown
surfaces.

### What Was Completed

1. **Reviewer acknowledgement policies are LIVE (the S283 #1 content task — DONE).**
   Justin published both versioned policy slots via `/admin → Policies`:
   - **Confidentiality Terms** → slot `reviewer-coi`, label `2026-06-24`
   - **Responsible Use of AI** → slot `reviewer-ai-use`, label `2026-06-24`
   The "COI" rename to "Confidentiality Terms" is **title-only** — the internal slot code
   stays `reviewer-coi` (wired into `respond.js` enforcement, `context.js`, `Stage2aView.js`).
   Source text lives in iCloud (`.../Keck Foundation/Policy Docs/Reviewer Confidentiality
   Policy 6_24_26.md` + `AI Policies for Reviewers.md`), cleaned + validator-confirmed.
   The Stage 2a accept flow now requires both acks on a fresh accept.

2. **Reviewer policy-ack modal now renders markdown (was raw text).** `98bf2ce1` —
   `PolicyAckModal.js` renders via the shared sanitized renderer + enabled
   `@tailwindcss/typography` (the `prose` classes were no-ops across 5 surfaces, incl. the
   admin policy preview). Reviewers see formatted headings/bullets/italics, matching the
   admin preview. Verified in a throwaway local Stage 2a preview (since deleted).

3. **Fixed prod-breaking jsdom/serverless incompatibility (all 3 markdown utils).**
   `POST /api/admin/policies` 500'd in prod: server-side DOMPurify loads jsdom via
   `eval('require')`, but jsdom's ESM-only transitive deps (`@exodus/bytes`, `parse5`,
   `entities`, `tough-cookie`, `@asamuzakjp/css-color`) **can't be `require()`'d in the
   Vercel/Turbopack serverless runtime**. Fix (after several reverted bundling dead-ends —
   serverExternalPackages, force-trace, dep-pin, linkedom): **don't externalize a DOM lib;
   use a DOM-free sanitizer.** See `project-jsdom-serverless-esm-incompat` memory.
   - `policy-markdown` → split into `policy-markdown-client.js` (DOMPurify+window) and
     `policy-markdown-server.js` (`sanitize-html`, no jsdom). Codex-implemented (`e597747e`).
     **Publish now works in prod (Justin confirmed).**
   - `grantee-markdown.js` → server-only (4 live routes), converted wholesale to
     `sanitize-html` (`77a003fb`). 88 tests pass; route traces show jsdom:0 + sanitize-html.
   - `app-markdown.js` → client-only (sole consumer `Phase2QAModal` renders client-side),
     dead jsdom branch removed, fails loud if called server-side (`d76af6ea`). No behavior change.
   - **No `eval('require')('jsdom')` remains in `shared/utils`.**

### Commits
- `98bf2ce1` — Render reviewer policy-ack modal body as sanitized markdown (+ typography plugin)
- `b58d5ef0` / `b39dc546` / `1a240b85` — jsdom-bundling attempts + revert (dead ends; context only)
- `e597747e` — Split policy markdown client/server sanitizers (Codex; the real publish fix)
- `77a003fb` — Fix grantee-markdown serverless jsdom bug (DOM-free sanitize-html) + memory
- `d76af6ea` — Make app-markdown explicitly client-only; drop dead jsdom branch

## Potential Next Steps

> Each checked against ground truth this session.

### 1. Reviewer-portal review-upload DESIGN decision (open question, not a bug)
The live review-upload form captures **3 structured ratings (Q1/Q3/Q10) + uploaded PDF** —
this is the deliberate `lib/external/review-form-schema.js` design (free-text Q2/Q4–Q9/Q11
stay in the PDF). Open decision for Justin: **capture more of the 11 questions as structured
Dataverse fields, or is "3 ratings + PDF" sufficient?** If a change is wanted, that's the
engineering delta; otherwise this is verify-and-confirm. (Carried from S283 #2; the
review-upload flow itself is already built/live — do NOT re-plan as greenfield.)

### 2. E2E test of the review flow with request 1002788
Request **1002788** (D26, GUID `feabe26f-dc1b-f111-8341-000d3a306da2`) is parked as
**Advancing** to exercise reviewer flows: run a reviewer through accept → materials → upload
on the live form; confirm SharePoint write + Dataverse PATCH + ReviewsTab readback. **Now
that policy acks are live, a fresh accept requires both acknowledgements.** ⚠️ Confirm the
prod-accept automation hazard first (see Gotchas) — a real accept fires a live
honorarium/Bill.com chain; capture-only is locked via `HONORARIUM_ONBOARDING_DEFERRED=true`.

### 3. Test-data cleanup (OWED) — revert 1002788 to Set-aside
Request 1002788 is flipped to Advancing for testing; **revert to Set-aside when done.**

### 4. Auto-on-award abstract cron — still unbuilt, OPTIONAL
Idempotent `pages/api/cron/*` to pre-generate the publishable **abstract** for research
awardees (distinct from `generate-grantee-titles.js`). See `docs/GRANTEE_PORTAL_BUILD_PLAN.md`
and `project-phaseistatus-decision-lifecycle`. Lower priority.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/utils/policy-markdown-server.js` | Server policy validator — `sanitize-html`, no jsdom |
| `shared/utils/policy-markdown-client.js` | Browser policy renderer — DOMPurify + window |
| `shared/utils/grantee-markdown.js` | Grantee doc renderer — now `sanitize-html` (server-only) |
| `shared/utils/app-markdown.js` | App markdown renderer — now client-only (DOMPurify; throws server-side) |
| `pages/api/admin/policies.js` | Versioned policy publish (superuser); slots `reviewer-coi`, `reviewer-ai-use` |
| `shared/components/external/PolicyAckModal.js` | Reviewer ack modal — renders markdown |
| `lib/external/review-form-schema.js` | Review form's 4 structured fields; deliberate 3-rating design |
| `tailwind.config.js` | `@tailwindcss/typography` now enabled |

## Gotchas / Continuity

- **jsdom is banned from the serverless runtime.** Any NEW server-side markdown/HTML
  sanitization must use `sanitize-html` (DOM-free), NEVER DOMPurify+jsdom — jsdom's ESM
  deps can't load in Vercel/Turbopack functions. See `project-jsdom-serverless-esm-incompat`.
- **Policy rename is title-only.** Reviewers see "Confidentiality Terms"; the slot code is
  still `reviewer-coi` everywhere in code. Don't rename the slot code.
- **Prod-accept automation hazard:** a real reviewer accept CREATEs a honorarium `akoya_request`
  → AkoyaGo + Bill.com + Business-Central. Capture-only locked (`HONORARIUM_ONBOARDING_DEFERRED=true`);
  confirm before any prod accept test. `project-reviewer-accept-prod-automation`.
- **Branch discipline (shared working dir):** `git status --short --branch` before any commit/checkout.
- **Known-red suites:** `bill.test.js` + `discovery-verification-status.test.js` only (CI-excluded).

## Testing

```bash
npm test                          # full suite (only the 2 known-red above should fail locally)
npm run lint
npx jest policy-markdown grantee-markdown app-markdown   # the three sanitizer modules
```
