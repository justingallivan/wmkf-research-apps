# Session 513 Prompt: Consultant Feedback is production-complete; Wednesday ops remains the next dated checkpoint

> Session 512 ran 2026-09-14. Start with `/start`. Consultant Feedback is complete in production;
> read `docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md` before changing its contract. Do not
> infer work from the old slice branches: the durable plan and current `main` are authoritative.

## Session 512 Summary

### What Was Completed

1. **Consultant Feedback shipped end to end.** Staff can add roster-attributed or one-off feedback
   on the Request Workbench Reviews tab, paste rich text, attach one PDF or DOCX, edit/share/delete
   the entry, and expose shared items on the external deliberation briefing page. Postgres owns the
   entry; `wmkf_requestdocument` plus SharePoint own the optional attachment.
2. **Slices 1–3 are production-live.** PR #293 shipped text feedback and migration 048; PR #295
   shipped the staged attachment lifecycle and migration 049; PR #299 shipped authenticated staff
   attachment access plus list filters and chooser keyboard polish. The owner applied migrations
   048 and 049; the Dataverse artifact type `Consultant Feedback = 100000008` is live.
3. **The first attachment smoke exposed and closed a real collision.** Deterministic filenames are
   valid for this feature but the entries are append-only. PR #300 added Graph's closed `rename`
   conflict behavior and selected it only for Consultant Feedback, preserving both same-name files
   instead of failing or replacing an earlier artifact.
4. **Production smoke passed on request 1003222.** A disposable one-off entry was created with a
   PDF, finalized through private Blob → Graph → Dataverse, opened through the authenticated staff
   proxy, and deleted through the normal UI. Vercel logs showed 2xx on mint, finalize, Graph upload,
   registry create, staff download, and delete/supersede. The feedback row was removed; the consumed
   staging row remains as the expected seven-day idempotency ledger.
5. **Verification and closeout.** The PR #300 tree passed 883 Jest suites / 12,711 tests, types,
   lint with zero errors, and production build. The Consultant Feedback plan, Atlas, service
   catalogue, milestone log, and this handoff were reconciled to the live state.

### Commits and releases

- PR #293 merge `b25e4376` — text feedback, migration 048.
- PR #295 merge `bf6b41be` — attachments, migration 049.
- PR #299 merge `5b25c006` — staff attachment access and polish.
- PR #300 source tip `c653b396`, merged as `ed4aa479` — append-only Graph `rename` repair.

## Next Items

### Verified Open

1. **Wednesday 2026-09-16 ops meeting.** The rescheduled agenda remains active at
   `.claude-memory/project-ops-meeting-2026-09-16-agenda.md`; record resulting decisions in the
   owning plans and close that memory afterward.
2. **Broader repository backlog.** Re-probe `docs/CURRENT_WORK_QUEUE.md`, active project memories,
   and current source before selecting work. This closeout intentionally did not inherit every
   unverified item from the prior Review Panel handoff.

### Owner Decision Needed

1. **Consultant profile link is deferred.** `expertise_roster` has no canonical profile-route key,
   and Expertise Finder is separately gated with no stable consultant deep-link. Add one only after
   an explicit shared route/access contract is decided.

### Parked

1. Consultant profile deep-link from each feedback row, pending the contract above.

### Verify Before Acting

1. Do not manually remove consumed `portal_upload_staging` rows. They are the retry/idempotency
   ledger and the maintenance path prunes terminal rows after seven days.
2. Attachment deletion marks the Dataverse registry row Superseded and removes the Postgres entry;
   it deliberately retains the SharePoint bytes. Physical purge is a separate destructive-policy
   decision, not part of CF5 delete.
3. PR #301's roster-contact work is a separate workstream. Its source plan reported migration 050
   and the owner-run link backfill as pending when this handoff was written; probe live state before
   touching either.
4. Tier 1–3 runtime work uses a feature branch and deliberate promotion. Existing-database
   migrations run through `node scripts/apply-migrations.js`; `scripts/setup-database.js` is
   fresh-install only.

### Do Not Reopen Without a New Decision

1. CF1–CF7 in the Consultant Feedback plan: Reviews-tab home; share defaults on; external name and
   affiliation; section label; edit/delete with no audit; roster or entry-local one-off identity;
   artifact type `100000008`.
2. The feature is three slices and complete. There is no implicit Slice 4; the profile link is a
   separately deferred product/route decision.
3. Consultant Feedback attachments are append-only and use Graph `rename` on path collision.
   Deterministic replacement and create-only snapshot callers keep their own explicit behavior.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md` | decisions, complete contract, production closeout |
| `shared/components/workbench/ConsultantFeedbackSection.js` | staff form, list, filters, attachment actions |
| `lib/services/consultant-feedback-service.js` | Postgres entry lifecycle and staff download membership proof |
| `lib/services/consultant-feedback-attachment-service.js` | staged upload/finalize and registry binding |
| `lib/services/graph-service.js` | closed `fail` / `replace` / `rename` path-upload contract |
| `docs/API_ROUTE_SECURITY_MATRIX.md` | staff and external route guards/contracts |
| `docs/APPLICATION_STATE_ATLAS.md` | cross-store ownership and release state |
| `docs/atlas/postgres-infra-tables.md` | `consultant_feedback` and staging-ledger details |

## Testing

```bash
npx jest tests/unit/consultant-feedback-service.test.js tests/unit/consultant-feedback-attachment-service.test.js tests/unit/workbench-consultant-feedback-section.test.js
npm run check:types && npm run check:api-routes && npm run check:fact-consistency && npm run check:atlas
npm run build
```
