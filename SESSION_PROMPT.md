# Session 503 Prompt: Rehearse the briefing page on a real Share; wire the tracker reader; Staff Deliberations tab redesign

> Session 502 ran on the home Mac across the evening of 2026-09-09 and the morning of
> 2026-09-10 (one conversation, owner present at both ends). Everything below is on `main`
> at `02b754eb` or later. Start with `/start`.

## Session 502 Summary (Claude Fable building and reviewing; Codex on the Meeting Tracker brief and seven adversarial passes)

### What Was Completed

1. **Codex's release-reason branch reviewed, fixed, merged** (PR #219, `8e595e29`). Three
   exact-shape tests re-pinned with the real response-type map; the Playwright spec fixed
   for the new dialog. PR #220 (`cd954a40`): the release modal no longer preselects a
   reason, uses visible choice cards, and fetches previews lazily (impeccable pass).
2. **Meeting Tracker decisions D10–D12 and the Codex brief** (`139a967c`, `d7096fa9`,
   `b0fe9e55`): attendees = fixed staff list + per-session Board; each slot links to the
   external briefing page; app "Meeting Tracker"; Zoom link on the session; §5.4 fixed
   reader contract; §5.6 what the Share email reads. Shape brief for the Staff
   Deliberations tab (`docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md`,
   `f0329be1`): one stage sentence + one primary action per stage, Share = lock then send,
   Download/Regenerate under More, Visit action "Add site-visit edits in Word", Include
   list carries the briefing link (reviews/proposal never attached). Mockups on the design
   canvas (artifact `34849615-…`).
3. **Deliberation briefing page built, reviewed seven times by Codex, merged, and LIVE
   in production** (PR #221, `0eafce4c`; plan `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`,
   D13–D16). Owner applied migration 038 to the shared Neon database (tracker row
   2026-09-10T13:13Z) and set `DELIBERATION_BRIEFING_SCHEMA_READY=on` (Config) in
   Production; redeployed; `/api/external/briefing/<bogus>/context` answers 401
   `malformed` (flag proven on). Codex passes fixed 18 findings (token never persisted on
   the attempt; reissue serialized against sends with FOR UPDATE, unresolved-send window,
   compare-and-swap with required `expectedLinkId`; final rechecks before send intent;
   retries reconcile Dynamics status first; sent-only writeup reader with byte-hash
   verification; expiry = first future cutoff, lookup errors refuse to mint; deterministic
   active-visit rule; unreadable-token recovery; request re-resolution per download;
   flag-off hash byte-identity; flag-cutover refusal; https-only meeting link). One
   accepted as designed: ledger `sent` includes Dynamics Pending Send, so a reissue in
   that window invalidates a queued email's link (reissue copy already requires a resend).
   Record: `outputs/deliberation-briefing-codex-adversarial-review-2026-09-09.md`.
4. **Codex's Meeting Tracker slices 1–2 merged with fixes** (PR #222, `02b754eb`). Codex's
   handoff is in `docs/plans/MEETING_TRACKER_CODEX_BRIEF_2026-09-09.md` § Handoff. Claude's
   adversarial review found 11 issues (2 high: a stale Board attendee reference broke every
   session read and zeroed the schedule reader for the whole cycle); all 11 fixed on the
   merge branch: lenient per-reference attendee resolution with `attendeeIssues`,
   per-session reader isolation, dashboard shows duplicate visits and unresolved requests
   instead of failing, new superuser surface `/api/admin/meeting-tracker-defaults` +
   Admin › Site visits section for the D10 staff list, 404 for unknown ids, auth before
   the readiness check, identity keys rejected, paged slot reads, moves append. Record:
   `outputs/meeting-tracker-claude-adversarial-review-2026-09-10.md`. Sandbox Wave 28 is
   22 exact / 0 absent / 0 divergent (owner readback); production NOT applied; flag
   `MEETING_TRACKER_SCHEMA_READY` unset everywhere, so the tracker is inert.
5. **Gate hygiene.** `check:fact-consistency:self-test` sentinel derived from the live
   count (the literal 13 became live when the tracker app registered); Gitleaks allowlist
   for the briefing verifier's fixture secret.

### Commits (first-parent, this session)
- `02b754eb` Meeting Tracker slices 1–2 (Codex) with adversarial-review fixes (#222)
- `d99c87f4` Adversarial review record for the Meeting Tracker branch
- `0eafce4c` Deliberation briefing page (#221; 10 commits incl. seven Codex passes)
- `f0329be1`, `139a967c`, `d7096fa9`, `b0fe9e55` tracker decisions, brief, shape brief
- `cd954a40` PR #220 release-reason chooser; `8e595e29` PR #219 release-reason re-pin
- `17bcb381` review of `codex/reviewer-release-reason`

## Next Items

### Verified Open

1. **Briefing page rehearsal needs a proxy request at Draft or Shared.** Evidence:
   1002788 is at Final/leadership review with no reverse path (`reopen-service.js:244-249`
   refuses when a Final Writeup derives). Pick any D26 request at Draft or Shared in the
   Staff deliberations cycle view; owner creates a PDF preview to their own address
   (composer shows "Briefing page: Link included"), sends, opens the email link in a
   private window; expect institution-led title, "Session: Not yet scheduled", writeup PDF,
   received reviews with names, proposal narrative; then Issue new link and reload. Claude
   watches `deliberation_briefing_links` (read-only probe) and the external route logs.
   Confirm the [ASSUMED] expiry rule (plan §2.2) afterward.
2. **Wire the tracker reader into the briefing page's null seam.** Evidence:
   `lib/services/deliberation-briefing/session-reader.js` returns null;
   `lib/services/meeting-tracker/schedule-reader.js` exports
   `getDeliberationScheduleByRequests(requestIds)` (fail-open, flag-gated). Small change +
   test; the page's session line and the Share email then read the tracker once the flag
   is on.
3. **Staff Deliberations tab redesign** per the shape brief and mockups. Evidence: brief
   and canvas; the briefing link, history response, reissue control, and stale-code
   handling already exist in `PreSiteDistributionPanel.js`. Tier 1 on a branch from main;
   owner clicks through before merge (next week's Share can run on today's tab).
4. **Meeting Tracker production enablement (owner-run).** Evidence: Codex handoff
   "Slice 1 apply/readback". Production Wave 28 apply + readback
   (`node scripts/preflight-meeting-tracker-schema.mjs --target=production` after the
   apply; expect 22/0/0), verify the app role's privileges on both entities, then
   `vercel env add MEETING_TRACKER_SCHEMA_READY production --value "on" --type config --yes`
   and redeploy. Grant `meeting-tracker` to the PC in Admin. Set the D10 default staff
   list in Admin › Site visits › Meeting Tracker default attendees.
5. **Post-merge production check of PR #218** (rail) — still not done. Evidence: PR body.
6. **Site Visit Materials plan review (read-only)** — still open. Evidence: owner brief
   2026-09-09 §3; the briefing-room subset is now built, so review the remaining
   applicant-materials collection only.
7. Carried unchanged: closeout route generic 500 (`close-review.js:64-71`); Codex
   `codex/UI-audit` reviewer UI commits; Cycle Dossier reconciliation (PR #179).

### Owner Decision Needed

1. **Reissue during Dynamics Pending Send** (Codex pass 7): accept as designed (current)
   or add a short post-send hold on reissue. Evidence: review record, seventh pass.
2. **Briefing expiry rule** [ASSUMED]: first future cutoff of visit end + 7d, then meeting
   date + 7d, else 60 days. Evidence: plan §2.2.
3. **Release reason:** whether a PD-recorded `no_response` lowers standing anywhere.
   Evidence: `docs/plans/REVIEWER_RELEASE_REASON_CODEX_BRIEF_2026-09-09.md`.
4. Carried: Program select on Final writeups/Awardees; historic suggestion rows with stale
   cycle codes; dossier roster scope; Codex branches to abandon (`codex/UI-audit`,
   `codex/reviewer-ui-surfacing`, `codex/c0-4-action-policy-foundation`,
   `codex/ror-api-production-shadow`); combined dossier retention; PD front-end flip;
   distribution email copy edits.

### Parked

1. Connor items (J27 Q5, back-end status changes, slice G). 2. Request Quick Find metadata
repair. 3. Legacy Complete row with null eligibility. 4. `NEXTAUTH_SECRET` rotation;
multipart direct-upload conversion; Stage III institution identity authority.
5. Playwright coverage for `pages/external/briefing/[token].js` (needs the flag and
Postgres in the e2e environment).

### Verify Before Acting

1. **Never set `DATAVERSE_ALLOW_PROD_READS`, `DATAVERSE_PROD_WRITE_ACK`, or any
   `*_SCHEMA_READY` yourself.** Owner ran migration 038 and the briefing flag today; the
   tracker flag stays owner-run. Hand over `! <command>` lines.
2. **Merged remote branches to delete** (`claude/pending-invites-visible`,
   `claude/site-visit-schedulable-gate`, `claude/deliberations-stage-rail`,
   `claude/release-reason-repin`, `claude/release-reason-chooser`,
   `feature/deliberation-briefing-page`, `merge/meeting-tracker`,
   `codex/reviewer-release-reason`, `codex/meeting-tracker`): confirm each is merged
   (`git branch -r --merged origin/main`) before `git push origin --delete …`.
3. **Codex worktrees** (`../WMKF_Apps-codex`, `../WMKF_Apps-codex-tracker`): do not
   operate in them; both branches are merged.
4. **`check:agent-wiki` and Jest fixtures fail in fresh worktrees** without the
   `.agents/skills` and `node_modules` symlinks; not code failures.
5. **`visitExpected()`** remains the single D26 assumption; J27 register row when it changes.

### Do Not Reopen Without New Decision

1. **Briefing page D13–D16** (full reviews with authors; all completed reviews; Share mints;
   revoke reissues) and the departure from the Codex plan's stored manifest (writeup pinned
   by the latest `sent` attempt; reviews live). Evidence: plan §1, §2.1.
2. **Tracker D1–D12.** Evidence: `docs/PC_MEETING_TRACKER_PLAN.md` §2, §9.
3. **Ledger `sent` = transport accepted (statuses 3/6/7)**; unchanged since 2026-08-24.
4. Initial assessments hidden for D26; copy-the-bytes Board snapshot; "sufficient review
   coverage" wording; `wmkf_meetingdate` as the single temporal axis.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md` | Briefing page contract, D13–D16, security, release |
| `lib/services/deliberation-briefing/*` | link store/service (mint, ensure, reissue CAS), page model, site-visit selection, null session seam |
| `lib/external/verify-briefing-token.js` | Stored-digest verifier (`aud:'briefing'`) |
| `pages/api/external/briefing/[token]/{context,document}.js`; `pages/external/briefing/[token].js` | External surface |
| `pages/api/workbench/pre-site-visit/briefing-link.js` | Staff GET/ensure/reissue (`expectedLinkId` required) |
| `lib/services/pre-site-visit/distribution-service.js` | Share integration: placeholder body, `resolveBoundBriefingUrl`, rechecks before send intent |
| `lib/services/meeting-tracker/*` | Codex's tracker services (+ lenient attendee resolution) |
| `lib/services/meeting-tracker/schedule-reader.js` | `getDeliberationScheduleByRequests` (plan §5.4) |
| `pages/api/admin/meeting-tracker-defaults.js`; `shared/components/admin/MeetingTrackerDefaultsSection.js` | D10 default staff list |
| `docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md` | Tab redesign brief |
| `outputs/*-adversarial-review-2026-09-*.md` | Review records (force-added) |

## Testing

```bash
npx jest tests/unit/deliberation-briefing-* tests/unit/verify-briefing-token.test.js tests/unit/external-briefing-* tests/unit/workbench-briefing-link-route.test.js tests/unit/pre-site-distribution-service.test.js tests/unit/meeting-tracker-* tests/unit/admin-meeting-tracker-defaults-route.test.js
npm run check:types && npm run check:api-routes && npm run check:atlas && npm run check:fact-consistency && npm run check:fact-consistency:self-test
# External route fails closed (flag on in production):
curl -s https://reviews.wmkeck.org/api/external/briefing/not-a-real-token/context   # → {"ok":false,"reason":"malformed"}
```
