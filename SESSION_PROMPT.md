# Session 280 Prompt: Email copy formatting + Reviewers-tab rethink (post onboarding-at-accept)

## Session 279 Summary

Large session, all shipped to prod. Codex built each chunk; Claude reviewed every diff (contract +
gates + full `npm test`, green except the two known-red suites throughout). Three things landed:
a reviewer **onboarding-at-accept** redesign, an **admin-editable email/text-defaults** mechanism, and
the **workbench email migrations** onto it — plus end-of-session copy fixes.

### What Was Completed

1. **Reviewer onboarding-at-accept redesign** (`30e54890`, `443bcfd2`, `45b425ed`, `a8676af1`, `5834fa1f`)
   - Collapsed invite→hold→finalize→accept into ONE final **Accept**: reviewer onboards up front
     (COI/AI acks + honorarium opt-in/address via the existing **capture-only** path — NO Bill.com),
     gets an acceptance-confirmation email + review-due `.ics`. PD-only exit (server guard rejecting
     accepted→decline + atomic Remove that clears engagement flags so quota frees).
   - **Retired the hold/finalize path** (templates, `HoldView`, `lib/external/proposal-readiness.js`,
     the `respond.js` hold action) — `scripts/probe-held-reviewers.mjs` confirmed **0 held rows** in
     prod. The `held` enum (100000004) + `wmkf_heldat` column kept for read-safety; a historical held
     row routes to the accept form.
   - **`HONORARIUM_ONBOARDING_DEFERRED=true` set in prod** (explicit capture-only lock); the 3
     discriminator GUIDs are unset → no Bill.com can fire this cycle. Verified via `vercel env ls`.
   - Docs/memory reconciled via `/sweep` (RETIRED banner on `REVIEWER_HOLD_STEP_BUILD_PLAN`, plus
     `REVIEWER_ENGAGEMENT_SPEC`, agent-wiki, `project-reviewer-hold-step-decouple` memory).

2. **Admin-editable email/text-defaults mechanism** (`30fad067` storage, `6d45c4ab` UI+rewire)
   - Catalog `shared/config/editableTextDefaults.js` → Dataverse `wmkf_appsystemsettings`
     (`getSettingStrict`) → **`/admin → Email Defaults`** (superuser). **No hidden hardcoded fallback**:
     a blank value shows as a discoverable blank; an outage shows "unavailable" (distinct). Canonical
     copy lives in `lib/seed/email-defaults/*` (seed/backup, not imported at runtime); create-only
     `scripts/seed-email-defaults.mjs`. Grantee invite migrated first.

3. **Workbench emails migrated onto the mechanism** (`f4eddaf3` crons, `7b5d2fcc` actions)
   - Reviewer respond-by/review-due reminders + grantee deliverable reminder (cron — the blank/
     unavailable guard runs **before the fire-once claim** so a misconfig never burns a reminder
     marker), reviewer acceptance (skip-on-blank, keep 200 accept), reviewer withdraw (owner option a:
     withdraw still proceeds, only the courtesy email skips). Shared reader `lib/services/email-defaults.js`.

4. **Email copy fixes — DEPLOYED end of S279** (`7e913ac4`, `5f4ac69e`, `ae22bfa1`, `2c9d66dc`)
   - **Request number removed from ALL external surfaces** (acceptance email + `.ics`; the
     `Stage2aView` + `MaterialsView` reviewer portals; the grantee portal) — outsiders never see it.
   - Renamed opaque `[proposal title clause]` → `[proposal]` (renderers dual-map the legacy token).
   - Grantee reminder greeting now uses the **surname** (consistent with the invite).
   - **Preview tool `scripts/preview-emails.mjs`** renders all six emails from the real templates.

### Commits (newest first)
- `2c9d66dc` Grantee reminder surname + email preview tool
- `ae22bfa1` Transitional [requestNumber] strip + re-baseline script
- `5f4ac69e` Email copy fixes: remove request number from external surfaces; rename token
- `7e913ac4` Note: group /admin Email Defaults cards (future)
- `7b5d2fcc` Workbench email migration 1B (acceptance + withdraw)
- `f4eddaf3` Workbench email migration 1A (cron reminders)
- `6d45c4ab` Admin-editable email defaults — Chunk 2 (UI + rewire + constant removal)
- `30fad067` Admin-editable email defaults — Chunk 1 (storage + routes + seed)
- `5834fa1f` Reconcile docs/memory to the retired hold path (Chunk D /sweep)
- `a8676af1` Retire the reviewer hold/finalize path (Chunk D)
- `45b425ed` Reviewer onboarding-at-accept: acceptance email + .ics (A) + PD-only exit (B)
- `443bcfd2` Document HONORARIUM_ONBOARDING_DEFERRED=true set in prod
- `30e54890` Reviewer redesign prep + held-row probe

## Potential Next Steps

### 0. (owner request) Rework the workbench email copy formatting
The six workbench emails are admin-editable (`shared/config/editableTextDefaults.js` →
`wmkf_appsystemsettings` → `/admin → Email Defaults`); seed/backup copy in `lib/seed/email-defaults/*`.
Their default copy has **inconsistent formatting** — greeting punctuation ("Dear X:" vs "Dear X,"),
signature/closing spacing, and the grantee deliverable reminder being one dense paragraph while the
others are paragraph-structured. Make it consistent across all six.
- **Preview:** `node scripts/preview-emails.mjs` (renders all six; `--request <num>` resolves a real
  title/PD; reviewer + dates are proxies).
- **⚠️ Rollout gotcha:** `rebaseline-email-defaults.mjs` currently only overwrites prod values that
  still carry a REMOVED token (`[requestNumber]`/`[proposal title clause]`). After the S279 deploy the
  prod values no longer carry those, so a formatting-only seed change WON'T be picked up — either
  extend the re-baseline script (add a `--force-keys` mode) or edit the copy directly in `/admin`.

### 0b. (owner request) Walk through the workbench Reviewers tab step-by-step
The workbench **Reviewers tab** (`shared/components/reviewers/` — `ReviewersTab.js`,
`ReviewerManagePanel.js`, `CandidatesPanel.js`) was built on the **old Reviewer Manager app**. After the
S279 redesign several affordances are obsolete — owner flagged the manual **"check that materials have
been sent"** step. Plan a step-by-step walkthrough with the owner to decide, per affordance, what stays
vs. retires. The later-stage UI isn't visible until a reviewer reaches that stage (may need a test
reviewer / capture tooling). Pairs with `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.

### 0c. Group the /admin → Email Defaults cards (small)
Panel renders one flat card per catalog entry (12+). Group by audience (Reviewer/Grantee) and pair each
email's subject+body into one card. Catalog-driven; see the FUTURE note atop `editableTextDefaults.js`.

### 1. Prod sanity-check the S279 deploys
`/admin → Email Defaults` shows all 12 entries editable; a test-reviewer accept produces the
confirmation email (+ `.ics`, no request number); the Awardee-tab compose base body is unchanged.

### 2. (deferred) Migrate other hardcoded copy onto the mechanism
Non-workbench apps were de-prioritized. The remaining workbench prompt gap is small (most are already
admin-editable via `wmkf_ai_prompt`). Inventory is in this session's discovery (email-generator
fallback, reviewer `DEFAULT_TEMPLATES` admin-default layer).

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/config/editableTextDefaults.js` | Catalog of admin-editable email/text defaults (drives `/admin` panel + seed) |
| `lib/services/email-defaults.js` | `readRequiredEmailDefaults` — getSettingStrict + blank/unavailable + deduped misconfig alert |
| `lib/seed/email-defaults/*.js` | Canonical seed/backup copy (NOT imported at runtime) |
| `scripts/seed-email-defaults.mjs` | Create-only seed of the catalog keys into prod |
| `scripts/rebaseline-email-defaults.mjs` | Safe re-baseline of stale-token defaults (see 0 gotcha) |
| `scripts/preview-emails.mjs` | Render all six emails from real templates for preview |
| `pages/api/admin/email-defaults.js` / `pages/api/email-defaults/grantee-invite.js` | Superuser edit / PD read routes |
| `shared/components/admin/EmailDefaultsSection.js` | `/admin → Email Defaults` panel |
| `scripts/probe-held-reviewers.mjs` | Read-only held-row probe (0 in prod) |
| `pages/api/external/review/[token]/respond.js` | The single Accept (acks + capture-only honorarium + acceptance email) |

## Testing

```bash
npx jest                          # full suite; only bill.test.js + discovery-verification-status.test.js expected-red
npm run check:api-routes && npm run check:trust-boundary-guid
node scripts/preview-emails.mjs   # eyeball all six email drafts
node scripts/rebaseline-email-defaults.mjs   # dry-run (shows what re-baseline would touch)
```

## Gotchas / Continuity

- **Email defaults live source is PROD, not code.** The seed/catalog seeds the value once; the live
  copy is the `wmkf_appsystemsettings` setting. After editing seed copy you MUST re-baseline prod —
  and the current re-baseline only catches removed-token staleness (see Next Step 0).
- **Cron blank-default guards run BEFORE the fire-once claim** (`reviewer-reminder-sweep.js`,
  `grantee-deliverable-reminders.js`). Keep that ordering on any new cron email — a post-claim guard
  would permanently burn the reminder marker on a misconfig.
- **`[proposal]` token** renders `the proposal "Title"` (via `titleClause`, graceful no-title
  fallback); renderers still dual-map the legacy `[proposal title clause]` — safe to drop once no prod
  value carries it.
- **Capture-only honorarium lock** = `HONORARIUM_ONBOARDING_DEFERRED=true` in prod + GUIDs unset. To
  ever enable Bill.com: configure the 3 discriminator GUIDs AND unset the flag.
- **Codex sandbox** now has write access to this repo's `.git` (`writable_roots` in `~/.codex/config.toml`,
  backup `config.toml.bak-pre-gitwritable`) — so Codex CAN commit; build prompts still instruct it NOT
  to (Claude reviews-then-commits stays the workflow by instruction, not sandbox).
- **Known-red suites:** `bill.test.js` + `discovery-verification-status.test.js` only — confirm it's
  just those before chasing a "red" suite.
