# Session 270 Prompt: Grantee portal — deploy the title cron, chunk 8 (assembly/export), chunk 6

> **S269 built the Grantee Deliverables edited-title generator (chunk 7) end-to-end and shipped the
> prompt to prod.** The "rich-text" decision parked for S269 is RESOLVED (markdown convention; structural
> formatting lives in the assembly template — spec D8). Along the way S269 also shipped a **prompt-seed
> governance** layer (create-only + version-preserving `--force`) and admin version-timestamps. The
> `grantee-title.generate` prompt is SEEDED in prod (v1); the cron is built but **not yet deployed**.

## Session 269 — what happened

Started as "rich-text decision + chunk 6"; became the full **edited-title** feature + prompt governance.
Every piece went design → Codex pre-impl → build → Codex post-impl, all folded and committed.

### Shipped (all committed; prompt seeded to prod)
1. **Design (chunks 7–8)** — edited-title generator + server-side document assembly. Codex pre-impl
   reviewed + folded. Spec D7–D9 (`docs/GRANTEE_PORTAL_SPEC.md`), build plan chunks 7–8.
   - **Key discovery:** the edited title lives in the **EXISTING `wmkf_wmkfprojectdescription`** field
     (Memo 2000) — NOT a new field. No schema wave. `wmkf_projecttitle1..3` is a separate, unused
     numbered-slot family (do NOT touch).
   - **Lifecycle [VERIFIED via probe]:** title generates at `wmkf_phaseistatus=Invited` (100000003);
     research-only; J26's 12 titles already exist (manual) → cron is go-forward (D26+).
     Memory: `project-phaseistatus-decision-lifecycle.md`.
2. **Chunk 7 — title generator** (`d36e0459`, post-impl `0853a542`): `shared/config/prompts/grantee-title.js`
   (validated "v5" prompt — **Sonnet**, title+abstract input, few-shot exemplars, the named-concept rule;
   temp 0.1) + `lib/services/grantee-title-service.js` + `scripts/seed-grantee-title-prompt.js` + A7.
   Prompt validated against the 12 J26 manual titles as an answer key (5 iterations).
3. **Chunk 7 — cron** (`ac5ebe9a`, post-impl `c446a8c1`): `pages/api/cron/generate-grantee-titles.js` —
   seasonal (`0 6 * 4-6,10-12 *`), `verifyCronSecret`, current-cycle + Invited + research + empty-field,
   `queryAllRecords`, **ETag write-when-empty**, bounded concurrency + per-row hard timeout + soft
   budget (under the 120s cap), `?cycleCode=` override. Registered in the security matrix.
4. **Prompt governance** (`85ee312b` / `f6bb692c` / `9a6a468d`): `lib/services/prompt-seed.js` —
   **create-only** seed by default (refuses if any row exists), **version-preserving `--force`**
   (publishes max+1, never resets v1 in place). Both grantee seeds refactored. Admin panel now shows
   version timestamps (created / published / last-touched / by-whom); admin publish stamps
   `publisheddatetime`. Two-tier model captured: `project-prompt-governance.md` + Atlas.
5. **Seeded to prod:** `grantee-title.generate` v1 (`node scripts/seed-grantee-title-prompt.js --execute`).
   Re-run now correctly REFUSES (create-only verified live).

## Potential next steps for S270

### 1. Deploy + verify the title cron ✅ DONE (S270)
Cron is **deployed + registered** in the Vercel cron registry (`/api/cron/generate-grantee-titles`,
`0 6 * 4-6,10-12 *`, built from HEAD); it shipped with the S269-stop push. Verified: 32 cron/service
unit tests pass; read-only probe confirms current J26 cycle is a no-op (0 empty research-Invited rows;
all 24 already filled). **PA-flow check RESOLVED:** field-level audit-trail analysis (J26/D25/J25/D24)
shows `wmkf_wmkfprojectdescription` is exclusively human-curated (named staff, no service-principal/flow
writer, human-paced gaps); **owner confirmed no trigger-flow watches the field.** See Atlas
(`docs/atlas/dataverse-akoya-request.md`) + build plan chunk 7.

### 2. Chunk 8 — document assembly + export (the bigger downstream piece)
Server-side template: structured header (institution→bold, location/PI+coPI→italic, amount→currency,
edited title→italic) + body/caption (markdown) → portal preview · website HTML · cycle export (replaces
Connor's manual PDF). Design is in build-plan chunk 8 (one canonical assembly model; PI = `wmkf_projectleader`,
Co-PIs = `fetchCoPIs()`; staff-authed export reads the SharePoint image ref directly). **One open question:**
is the edited title PI-editable in the portal, or staff-owned?

### 3. Chunk 6 — reminders + approval copy (carryover)
Reminder cadence/deadline; draft Foundation-voice email default + waiver/T&C copy for owner approval.

### 4. Open items / follow-ups
- **[Task #1] Connor + Sarah** — confirm title-field provenance (hypothesis: `wmkf_wmkfprojectdescription`
  = PD-authored at end; `wmkf_projecttitle1` = staff early best-guess). Owner emailed them S269. Once
  confirmed, drop the `[UNVERIFIED]` label in the build plan + memory.
- Legacy-seed conversion sweep (other seeds still upsert; grantee seeds are create-only) — separate task.
- Admin-can-edit-`variables` A7 hardening (a superuser admin edit can weaken the untrusted boundary on the
  live row, ungated) — tracked in `project-prompt-governance.md`.

### 5. Carryover from S267 (unverified-until-checked)
- **Branded domains:** `reviews.wmkeck.org` now appears in the project's Vercel domains (observed S269) —
  may already be live; verify before assuming. When confirmed: set `REVIEWER_PORTAL_BASE_URL`, redeploy.
- S266 TEMP generation audit log in `discover.js` (`d0fb1ef5`) still live — revert when done.

## Continuity guardrails
- **Prompt governance (never regress):** Dataverse `wmkf_ai_prompts` is the source of truth for Tier-1
  system prompts. Seeds are **create-only**; a plain `--execute` on an existing prompt REFUSES — edit via
  `/admin` (versioned) or `--execute --force` (version-preserving recovery). Don't reintroduce in-place
  overwrite. See `project-prompt-governance.md`.
- **Title cron safety:** write-when-empty + ETag (never overwrites staff curation); research-only;
  `wmkf_phaseistatus=Invited` ≠ awarded. `wmkf_projecttitle1..3` is unrelated — do not read/write.
- **Grantee portal safety (S268, unchanged):** stateless `aud:'grantee'` token; submit refuses once
  `Complete`; image magic-byte + virus scan; ETag-conditional writes; waiver is a client gate, never persisted.
- **Don't tell the user when they're out of time.** Multi-agent: Codex also works on `main`; clean tree,
  scoped commits, `git pull --rebase` before push.

## Key Files Reference (S269 additions)
| File | Role |
|------|------|
| `shared/config/prompts/grantee-title.js` · `lib/services/grantee-title-service.js` | Edited-title prompt (Sonnet, seeded) + service |
| `scripts/seed-grantee-title-prompt.js` · `lib/services/prompt-seed.js` | Title seed + the create-only/`--force` governance helper |
| `pages/api/cron/generate-grantee-titles.js` | The go-forward cron (seasonal; not yet deployed) |
| `pages/api/admin/prompts/{index,[name]}.js` · `shared/components/admin/PromptTemplatesSection.js` | Admin version-timestamps + publish stamp |
| `.claude-memory/project-prompt-governance.md` · `project-phaseistatus-decision-lifecycle.md` | Governance + lifecycle decisions |
| `docs/GRANTEE_PORTAL_BUILD_PLAN.md` chunks 7–8 · `docs/GRANTEE_PORTAL_SPEC.md` D7–D9 | Design + remaining chunk 8 |

## Testing
```bash
npm run build && npm run lint
npm test                       # FULL suite — 2855 tests (serial green; rare residual parallel flake)
node scripts/seed-grantee-title-prompt.js --dry-run    # plan only (read-only)
npm run check:api-routes && npm run check:fact-consistency && npm run check:prompt-injection-tagging
```
