# Session 449 Prompt: Act on Open Smokes and Watch for the IT Access Answer

## Session 448 Summary

Session 448 was a docs-only housekeeping session on branch `codex/housekeeping`
(kept byte-identical to `main`; both fast-forwarded together). All 57 /start
gate and self-test runs passed. The session recorded IT-provided SharePoint
administrator evidence, reconciled every repo restatement, corrected a
fabricated organization name, and published an access-question memo.

### What Was Completed

1. **SharePoint administrator evidence recorded and reconciled (`0c99fd9c`)**
   - IT screenshots (2026-08-20, retained by the owner, not committed) closed
     the second-stage recycle bin question **positive**: the bin exists and
     held exactly the two 2026-07-30 `_wmkf_library_control_probe_*.txt`
     files, refuting Connor's 2026-08-10 "no second-stage bin" report as an
     access-visibility artifact and proving the full deletion cascade on
     `akoya_request`.
   - Connor's "limited control" resolved as the modern pane caption; the
     Members group's assigned level is built-in **Edit**, so ordinary editors
     presumptively CAN delete files and versions (H1 favored; the Edit
     level's exact Delete checkboxes remain unread).
   - New finding: the akoyaGO site's connected M365 group is **Public** (4
     explicit members), so effectively every tenant account holds Edit over
     the grant document libraries.
   - Owner ruling 2026-08-20: no further administrator information will be
     sought unless a pressing need arises — Purview retention and the Edit
     level's Delete flags are recorded as **owner-accepted-open**.
   - Reconciled restatements in `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`
     (authoritative audit section), the pilot report, work queue item 1, the
     near-term execution plan, the requestdocument atlas page, STRATEGY.md,
     the strategy-roadmap wiki topic, and two memory files. Also fixed
     pre-existing drift: three surfaces still claimed the version limit was
     unanswered although the 2026-08-10 Versioning Settings capture had
     closed it (major-only, keep 500, no age limit).

2. **Public-group access memo published (`a222c108`)**
   - `docs/SHAREPOINT_SITE_PUBLIC_ACCESS_MEMO_2026-08-20.md` asks IT whether
     Public is intentional or an operational/vendor requirement; couched as a
     question, explicitly not a change request. Cross-linked from the
     file-model audit section. Awaiting IT's answer.

3. **Fabricated organization name corrected (in `a222c108`)**
   - The 2026-08-12 Connor primer
     (`outputs/sharepoint-permission-audit-primer-for-connor-2026-08-12.md`)
     had invented "Wilburforce Foundation"; the organization is the **W.M.
     Keck Foundation** (WMKF). Correction note added; owner reviewed the
     sent-copy question and is not concerned. (`outputs/` files are tracked
     despite the gitignored directory — force-added historically.)

4. **Codex handoff check** — no Codex work order exists for this
   branch/worktree; `codex/housekeeping` carried no unique commits at session
   start.

### Commits

- `0c99fd9c` - Record 2026-08-20 IT SharePoint audit evidence
- `a222c108` - Add memo asking IT about the Public akoyaGO group

Both pushed to `main` (owner-run fast-forward `1a0976cc..a222c108`); docs-only,
Tier 0.

## Next Items

### Verified Open

1. **Watch for IT's answer to the Public-group memo.**
   Evidence: `docs/SHAREPOINT_SITE_PUBLIC_ACCESS_MEMO_2026-08-20.md` (status
   section). When the answer arrives, record intentional / operational
   requirement / changed in the memo and reconcile the file-model audit
   section. If Public→Private is ever executed, verify the app's
   `Sites.Selected` access afterward.

2. **Observe Stage II Production outcomes through 2026-09-02.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` records the
   exact-on Production state and organic-observation window. Sample naturally
   produced Stage II DTOs; do not manufacture shared-roster rows. (Unchanged
   from Session 447 — no work this session.)

3. **Run a staff acceptance smoke of reviewer identity remediation.**
   Evidence: `docs/REVIEWER_CONTACT_LEADS_SPEC.md` and commits `d9c29c7d`
   through `5fcd913c`. Use a reviewer genuinely intended for an invite list.
   (Unchanged from Session 447.)

4. **Finish the read-only Phase II document display smoke.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` and commit `83b9c68a`.
   Record filenames plus View and Download end to end; keep it read-only.
   (Unchanged from Session 447.)

5. **Re-probe and close Track A passive safety.**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` still
   carries the completed 48-hour window as open guidance. Reconcile against
   the live Log Drain first. (Unchanged from Session 447.)

### Owner Decision Needed

1. **Choose and approve a Production record for the direct-upload business
   smoke.** Evidence: `docs/LARGE_UPLOAD_DIRECT_BLOB_REMEDIATION_PLAN.md`
   §§9.2 and 15. Do not use the affected grantee as the tester.

2. **Choose an approved request for the Site Visit handoff smoke.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`. The action locks
   Pre-Site regeneration; do not click without explicit request approval.

3. **After 2026-09-02, retain or remove the Stage II rollout flag.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Re-probe
   the live environment before changing it.

### Parked

1. **Purview retention and the Edit level's Delete-flag read-out.**
   Evidence: owner ruling 2026-08-20 in
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` audit section. Reopen only on a
   pressing need; do not re-ask IT routinely.

2. **`NEXTAUTH_SECRET` rotation and Vercel Sensitive conversion.**
   Evidence: owner decision Session 447. Reopen only with a coordinated
   session-invalidation window.

3. **Reviewer multipart direct-upload conversion.**
   Evidence: `docs/LARGE_UPLOAD_DIRECT_BLOB_REMEDIATION_PLAN.md` §8. Complete
   consumer discovery and obtain an owner decision first.

4. **Stage III institution identity authority.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Blocked
   until the execution-point contract exists.

5. **Site Visit dossier/logistics and Final copy transaction.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`. Inventory Dataverse
   fields and SharePoint categories before proposing changes.

### Verify Before Acting

1. The two probe files in the second-stage recycle bin age out on their own
   (~93-day window, [ASSUMED] standard, so around late October 2026). Do not
   restore or purge them; their presence is the recorded evidence.
2. A rollback may leave additive migration 031 in place; never drop
   `portal_upload_staging` during incident rollback or delete SharePoint
   content referenced by committed Dataverse state.
3. Re-probe live upload configuration and use a named approved record before
   the remaining business smoke.
4. Re-probe the live Stage II environment before changing/removing its flag;
   `NEXT_PUBLIC_` changes require a new build.
5. Reconcile the Track A plan with the live Log Drain before collecting or
   interpreting closeout evidence.

### Do Not Reopen Without New Decision

1. Recording "no second-stage recycle bin exists" — refuted by direct
   administrator screenshot evidence 2026-08-20.
2. A multipart fallback or proxy-matcher exclusion for large grantee images;
   falsified by the measured Function transport boundary.
3. Another string-side institution checker or Stage III authority flip based
   only on the 25-case Stage II benchmark.
4. A separate Site Visit Writeup or Dataverse staff-observations memo.
5. Routine Vercel CLI update reminders without a concrete incompatibility.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Authoritative SharePoint audit evidence and classifications (updated 2026-08-20) |
| `docs/SHAREPOINT_SITE_PUBLIC_ACCESS_MEMO_2026-08-20.md` | Public-group question memo for IT; record the answer here |
| `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` | Pilot evidence matrix and item 5 standing state |
| `docs/CURRENT_WORK_QUEUE.md` | Priority queue; item 1 boundary updated 2026-08-20 |
| `docs/LARGE_UPLOAD_DIRECT_BLOB_REMEDIATION_PLAN.md` | Direct-upload contract and remaining business smoke |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Phase II display and Site Visit handoff smokes |

## Testing

Session 448 was docs-only. All 57 /start gate + self-test runs passed at
session start; the docs drift gates (docs-catalog, doc-currency,
fact-consistency, canonical-pointers, doc-symbol-refs, build-claim-freshness,
agent-wiki, memory-router, drain-table-mentions, prompt-storage-mentions)
passed after each reconciliation commit. No runtime code changed.
