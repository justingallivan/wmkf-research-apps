# Session 263 Prompt: Reviewer retirement done — Group B writeup spine designed, waiting on Connor

> **GIT.** All S262 work is on `main`. Working tree clean, all gates green (2520 tests passing).
> Reviewer Finder / Review Manager retirement shipped. Group B design doc created; build blocked
> pending Connor's Dataverse + Azure AD inputs. Graph API write-access probe script ready to run.

## Session 262 — what happened

Two streams completed:

### Stream 1 — Reviewer Finder / Review Manager retirement (`94bbbce4`)

- Live grant probe (`scripts/probe-reviewer-legacy-grants.js`) confirmed no legacy-only users
- Deleted `pages/reviewer-finder.js` and `pages/review-manager.js`
- Removed `reviewer-finder` and `review-manager` from `appRegistry.js` and `guideContent.js`
- Removed `review-manager` model config from `baseConfig.js`; **kept `reviewer-finder`** (Workbench
  reviewer-pipeline services still call `getModelForApp('reviewer-finder')`)
- Removed `'review-manager': 'Review Manager'` display-name from `pages/admin.js`; preserved legacy
  grant display so admin UI doesn't accidentally revoke them via "All" toggles
- Reconciled `CANONICAL_COUNTS.md` (18→16 apps) and `reviewer-workbench-lifecycle.md` watch_paths
- All gates green; `reviewer-finder`/`review-manager` keys remain in `requireAppAccess(...)` calls in
  API routes (deferred until grant migration confirmed via Connor)

### Stream 2 — Group B writeup spine design

- Created `docs/GROUP_B_WRITEUP_SPINE_DESIGN.md` — full design document for sharing with Connor
- Created `scripts/probe-graph-write-access.mjs` — tests whether Azure AD app registration has
  SharePoint write access via Graph API

**Architecture agreed:**
- SharePoint holds Word doc, Dataverse holds URL pointer (`wmkf_ai_initialwriteupurl`,
  `wmkf_ai_presitevisitwriteupurl` on `akoya_request`)
- D26 posture: Initial Writeups done manually (no backfill → Initial Writeup tab shows empty state
  for D26); Pre-Site-Visit NOT started → **build and use new system for D26 as pilot**
- Generation flows: D26 Pre-Site-Visit staff-triggered from Workbench tab; J27+ Initial Writeup
  PA auto-triggered on triage=Advancing
- Executive dashboard (`executive-review` app key) — separate editorial surface for leadership:
  queries Advancing requests, shows writeup content via Graph API + Open in Word link
- Prompts must migrate from `.js` files to `wmkf_ai_prompt` before building
  (`phase-i-writeup.js` → `writeup.initial`; `proposal-summarizer.js` → `writeup.pre-site-visit`)

**Connor's inputs needed before build can start:**
1. Confirm field names (`wmkf_ai_initialwriteupurl`, `wmkf_ai_presitevisitwriteupurl`) and add to Dataverse
2. Confirm Graph API write access (or grant `Files.ReadWrite` / `Sites.ReadWrite.All` in Azure AD)
3. PA flow design for J27 auto-generation (write Word → SharePoint → URL writeback)
4. Author `writeup.initial` and `writeup.pre-site-visit` prompt rows in `wmkf_ai_prompt`

## Potential Next Steps

### 1. **Run the Graph API write-access probe.**
```bash
node scripts/probe-graph-write-access.mjs <requestId>
```
Where `<requestId>` is the GUID from the Workbench URL `/workbench/<requestId>`.
- CONFIRMED → D26 Pre-Site-Visit tab can write Word docs to SharePoint directly
- 403 → Connor needs to grant write permissions in Azure AD before building

### 2. **Share `docs/GROUP_B_WRITEUP_SPINE_DESIGN.md` with Connor.**
Send him the design doc (or paste into Teams/email). Open questions for him are in the final
section of the doc. Block until he responds on the four inputs above.

### 3. **Group B build** (after Connor confirms prerequisites — in order):
1. Connor adds `wmkf_ai_initialwriteupurl` and `wmkf_ai_presitevisitwriteupurl` to `akoya_request`
2. Connor authors `writeup.initial` and `writeup.pre-site-visit` prompt rows in `wmkf_ai_prompt`
3. Update `pages/api/workbench/resolve-request.js` to return both URL fields in `aiContent`
4. Build `shared/components/workbench/InitialWriteupTab.js` — URL→fetch→preview + Open in Word
   (empty state only for D26 since Initial Writeups done manually)
5. Build `shared/components/workbench/PreSiteVisitWriteupTab.js` — same pattern + Generate draft
   button calling Executor with `writeup.pre-site-visit` prompt row; writes output to SharePoint;
   stores URL back in Dataverse; URL capture fallback if write access unavailable
6. Wire both tabs into `pages/workbench/[requestId].js` (placeholder slots already exist)
7. Build Executive Dashboard (`executive-review` app key, separate page)
8. Update `pages/api/process-phase-i-writeup.js` (and related routes) to add `'reviewers'` to
   `requireAppAccess(...)` so Workbench users can reach them

### 4. **Triage future refinements (low urgency — unchanged from S261).**
- Principled cycle-default via `reviewDeadline` / `isActive` (currently defaults to latest PD cycle)
- PA-trigger run-history spot-check on bulk backfill
- J27 triage-lens expansion

## Continuity guardrails

- **`reviewer-finder` model namespace is still live** — do NOT remove from `baseConfig.js`. The
  Workbench reviewer pipeline services (`lib/services/claude-reviewer-service.js:94`,
  `lib/services/reviewer-exclusion-parser.js:148`) call `getModelForApp('reviewer-finder')`.
- **API routes not touched** — `pages/api/reviewer-finder/*` and `pages/api/review-manager/*` are
  still dual-keyed. Do not remove legacy keys from `requireAppAccess(...)` until Connor confirms
  all grant holders have `reviewers`.
- **Triage is LIVE in prod** — `wmkf_triagestatus` is the signal; `d26Allowlist.js` retired-in-place.
- `git gc.log` warning still printing on commits (unreachable loose objects) — `git prune` not yet run.

## Key Files Reference (S262)

| File | Role |
|------|------|
| `docs/GROUP_B_WRITEUP_SPINE_DESIGN.md` | Full writeup spine design doc (share with Connor) |
| `scripts/probe-graph-write-access.mjs` | Tests Graph API write access; requires requestId from Workbench URL |
| `scripts/probe-reviewer-legacy-grants.js` | Read-only grant check (already ran; no legacy-only users) |
| `shared/config/appRegistry.js` | reviewer-finder / review-manager entries removed |
| `shared/config/baseConfig.js` | reviewer-finder model config KEPT (Workbench callers); review-manager removed |
| `pages/workbench/[requestId].js` | Placeholder tab slots: `initial-writeup`, `pre-site-visit`, `final-writeup` |
| `lib/services/graph-service.js` | `uploadFile()` / `deleteFile()` already implemented |
| `lib/utils/sharepoint-buckets.js` | `getRequestSharePointBuckets()` resolves folder via sharepointdocumentlocations |

## Testing
```bash
npm run build && npm run lint
npm test                       # FULL suite — not a subset (feedback-green-requires-full-test-suite)
npm run check:trust-boundary-guid && npm run check:api-routes && npm run check:fact-consistency
npm run check:status-enum-parity && npm run check:atlas
node scripts/probe-graph-write-access.mjs <requestId>   # confirm Graph API write access
```
