# Session 509 Prompt: Monday ops meeting, then Cycle Dossier pilot-mode hardening

> Session 508 ran 2026-09-12 with the owner present. Start with `/start`. **The Cycle Dossier
> smoke on 1002852 SUCCEEDED end to end** after four production fixes; the pilot remains in smoke
> mode (profile 2, allowlist 1002852). Next: Monday 2026-09-14 ops meeting, then the hardening
> slice in work queue item 11.

## Session 508 Summary (Claude Fable, owner-directed; no subagents)

### What Was Completed

1. **Startup gates all green** (38 gates + 29 self-tests). Memory and Codex-skills symlinks
   consolidated. Gate list in `.claude/skills/start/SKILL.md` matches `package.json`.
2. **Missing production env found and fixed (owner).** `CYCLE_DOSSIER_REQUEST_ALLOWLIST` had never
   been saved in Vercel in any environment; the S507 handoff claim was wrong because the preflight
   reads the shell's env, not Vercel's. Owner added it as a readable `--type config` var and
   redeployed. Page then loaded the one-request roster.
3. **Launch bug: JSONB key order** (PR #260, `56538f94`). Launch re-digested the persisted
   `item.destination` object; Postgres JSONB reorders keys so `JSON.stringify` never matched and
   every launch returned 409 "SharePoint destination changed". Preview now stores
   `destinationHash` (string) beside `destination`; launch and the worker's pre-publish check
   compare against it. Old previews fail closed with "Preview again".
4. **First paid run** at 09:38: research-plan call + 3 PubMed searches, entry call, render,
   DOCX uploaded; then the post-upload integrity check failed. Total spend $0.135; every later
   retry was free (research/entry checkpointed).
5. **SharePoint rewrites Office packages on upload** (three PRs as each layer surfaced):
   #261 `2fed91b3` structural DOCX comparison (decompressed `word/` parts; PDF exact);
   #262 `06d0ecc3` relationship parts compared as attribute sets ignoring customXml links
   (SharePoint appends rId13–rId15 to `word/_rels/document.xml.rels`) + the worker now logs the
   differing part names; #264 `bde60a8a` ignore `[trash]/NNNN.dat` packaging slots. Evidence came
   from the owner's Word Online copy and then from the new log line. Facts recorded in
   `docs/CYCLE_DOSSIER_PILOT_DESIGN.md` and `docs/agent-wiki/topics/dataverse-dynamics.md`.
6. **Owner-side hazard discovered:** opening the SharePoint DOCX in Word Online autosaved a
   re-serialised package, so verification failed legitimately (every `word/` part differed,
   `[trash]` parts present). Recovered by restoring version 1.0 in the SharePoint folder view
   (file-row ⋯ menu → Version history). Recorded as a hardening item.
7. **Usage logging** (PR #263, `4cabe501`). The Executor's LLMClient has no `appName` by design;
   the dossier stages never logged. `loggedExecute` in `cycle-dossier-generation.js` writes one
   `api_usage_log` row per paid call (`cycle-dossier`, run owner profile, tokens, model, latency;
   error rows on failure). Not retroactive. Admin dollars (`MODEL_PRICING`) may differ slightly
   from the run ledger (snapshot rates).
8. **Smoke result:** run completed, item ready, edition `7b656b74…` assembled 11:14 PDT, owner
   reviewed the PDF ("makes sense"). DOCX and PDF in the request's
   `AI Artifacts/Cycle Dossier/D26/<revision>/` folder. Work queue item 11 updated
   (`cfc7e60d`) with the result and the hardening findings.

### Commits (main, this session)
`0a37dfee`/`56538f94` #260 · `f224ed7a`/`2fed91b3` #261 · `fc7ff7fb`/`06d0ecc3` #262 ·
`297d73b7`/`bde60a8a` #264 · `157c2785`/`4cabe501` #263 · `cfc7e60d` queue item 11.

## Next Items

### Verified Open

1. **Monday 2026-09-14 ops meeting** — agenda in `project-ops-meeting-2026-09-14-agenda.md`
   (6 items): materials reminder cron schedule + effects; PC-reminder race (DONE via #258,
   informational); hidden "other" upload; per-user role gap (record-only); dossier drain-cron
   cadence (per-minute today; the smoke needed a tick per stage, ~5 ticks per entry). After the
   meeting: record decisions in `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 and
   `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`, add cron entries to `vercel.json` if decided, close the memory.
2. **Cycle Dossier pilot-mode hardening** (work queue item 11, evidence: today's smoke): round
   the USD estimate to two decimals; rename "Retry failed" → "Retry failed entries"; show the
   error banner beside the launch control (owner missed the 409 above the fold); default to the
   Progress tab while the latest run is unsettled; warn against opening the SharePoint copy in
   Word Online before ready; plus the S507 list (stop re-read inside LLMClient retries and between
   `ensureFolderPath` POSTs; preview/Blob retention; dead `pausing`/`cancelling` strings;
   `Content-Disposition` filename escaping; design-doc `last_verified` refresh).
3. **Email send feedback and consistency audit** (work queue item 10): unchanged from S507.
4. Owner production checks still not eyeballed: Share composer preview and agenda "Exact email"
   preview on 1003222; PR #218 cycle view.
5. **Verify the two SharePoint files exist** in the request folder (owner saw the DOCX; the PDF
   upload succeeded per logs but was not eyeballed in SharePoint).

### Owner Decision Needed

1. Pilot mode: when to widen from smoke (one request, profile 2) to the full D26 roster and other
   superusers. Suggested gate: the hardening slice above.
2. Materials reminder cron: `vercel.json` entry or manual (ops Monday).
3. Dossier drain cron cadence (ops Monday).
4. Combined dossier / preview retention policy (open since S494).
5. PR #116 (ROR resolver shadow mode): keep or close. 6. 45 unmerged local branches: prune or keep
   (grep live refs first). 7. Carried: reissue during Dynamics Pending Send; release-reason
   `no_response`; Program select on Final writeups/Awardees; PD front-end flip.
8. Sibling engagement routes may share the closeout route's old generic-500 gap (not audited).
9. The other four `CYCLE_DOSSIER_*` flags are still hidden secrets; re-add with `--type config`
   if auditability matters (the allowlist is already readable).

### Parked

1. Connor items (J27 Q5, back-end status changes, slice G). 2. Request Quick Find metadata repair.
3. Legacy Complete row with null eligibility. 4. `NEXTAUTH_SECRET` rotation; multipart direct-upload
conversion; Stage III institution identity authority. 5. Playwright coverage for external briefing
and materials pages. 6. Proposal order P3s. 7. Messages & policies P3s. 8. Slots-only reload after
reorder. 9. Card-vs-line materials count paths. 10. Consolidating Executor usage accounting (the
Executor comment's follow-up) — the dossier logs its own rows; do not generalise without a decision.

### Verify Before Acting

1. **Never set Vercel env vars yourself**; hand the owner a `! <command>` line. The auto-mode
   classifier also refused a `curl` drain probe with the cron secret this session; the owner runs
   probes. `vercel env ls` and `vercel logs --query` are fine.
2. **Handoff env claims are not Vercel state.** Verify with `vercel env ls <environment>`; the
   dossier preflight reads `process.env` only (see `feedback-verify-vercel-env-with-env-ls`).
3. Worktrees: `../WMKF_Apps-codex` (`codex/parked`), `../WMKF_Apps-codex-tracker`
   (`codex/meeting-tracker`, merged long ago).
4. Production hostname for probes: `https://wmkfresearch.vercel.app`; SharePoint site
   `https://appriver3651007194.sharepoint.com/sites/akoyaGO`, library `akoya_request`.
5. Fresh-install blocks: migration 045 = block V47; next migration is 046 → block v48.
6. Retry resumes from the last checkpoint on a NEW run row (spent resets to 0 on the card; the
   source run keeps its charges). "Spent $0" on a retry is expected, not a logging gap.

### Do Not Reopen Without New Decision

1. Cycle Dossier: roster scope server-side Research; institution from the Applicant lookup;
   smoke mode = profile 2 + 1002852; entry downloads shared across superusers, combined editions
   owner-private; **DOCX verification is structural, PDF exact (2026-09-12)**; frozen bytes in the
   private Blob store remain the artifact of record, the SharePoint copy is a derived publication.
2. Materials reminder cron stays out of `vercel.json` until ops/owner decide (M5).
3. Optional "other" applicant upload hidden, not retired. 4. Briefing header order and non-PDF
download behaviour (D28). 5. Role-gap send failure is record-only. 6. Prior decisions unchanged.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/cycle-dossier-worker.js` | `assertPublishedMatchesFrozen`, `ooxmlDifferingParts`, `SHAREPOINT_OWNED_PART`; logs differing parts |
| `lib/services/cycle-dossier-service.js` | preview stores `destinationHash`; launch compares against it |
| `lib/services/cycle-dossier-generation.js` | `loggedExecute` → `api_usage_log` per paid stage |
| `lib/services/cycle-dossier-rollout.js` | smoke/pilot gates; allowlist parser (rejects quoted values) |
| `docs/CYCLE_DOSSIER_PILOT_DESIGN.md` | design + SharePoint rewrite facts + usage-logging note |
| `docs/agent-wiki/topics/dataverse-dynamics.md` | Operating note: SharePoint rewrites Office packages |
| `docs/CURRENT_WORK_QUEUE.md` item 11 | smoke record + hardening findings |
| `.claude-memory/project-ops-meeting-2026-09-14-agenda.md` | Monday ops agenda |

## Testing

```bash
npx jest tests/unit/cycle-dossier
npm run check:types && npm run check:status-enum-parity
vercel logs --environment production --since 30m --query "drain-cycle-dossiers" --limit 100 --json
vercel env ls production | grep CYCLE_DOSSIER
```
