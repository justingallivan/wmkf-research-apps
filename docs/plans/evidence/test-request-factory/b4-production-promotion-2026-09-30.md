# B4 Production promotion — 2026-09-30

**MERGED AND DEPLOYED. Operational readiness checks remain incomplete; no slot PATCH is authorized.**

[OWNER-AUTHORIZED via human chat] After all 12 candidate checks passed and the outstanding ledger/Local prerequisites were reported, the owner instructed “Let's merge.” This supersedes the draft/promotion hold for PR #369. The owner elected runtime deployment while those evidence items remain pending; they are not recorded as passed. No migration, slot PATCH, Factory run/cast/status change, email or live job drain was performed by this agent.

[VERIFIED via GitHub] PR #369 merged at 2026-09-30T22:23:03Z, candidate `09b00d7c130931cb5b7922a49dc047a2b0b36372`, merge commit `a18882a0b7e7192f4197db76a57362bf06c589b8`. All 12 candidate checks passed. A fetched-commit diff of candidate versus merge across lib/scripts/pages/shared/modules/tests/.github and deployment/package configuration returned no changes; main's additional changes were documentation. The worktree stayed on codex/factory-reviewer-b4-runtime; Claude's checkout was not inspected or changed.

[VERIFIED via Vercel list/inspect] Production deployment `dpl_9dLJN7TZ6nDU234PCNYwMKTf9Va5` reached READY and carries the merge commit. Its aliases include applications.wmkeck.org and reviews.wmkeck.org. [Deployment](https://wmkfresearchapps-f59dhlk5o-justin-gallivans-projects.vercel.app). [Sanitized receipt](b4-production-promotion-2026-09-30.json).

[VERIFIED via private Production env pull immediately before merge, 22:22:54Z] TEST_REQUEST_ISOLATION and SYNTHETIC_REVIEWER_ISOLATION both resolve on. Pull files were chmod-600 and deleted in finally; only key names and on/off classifications are retained. Deployment-specific env pull remains unavailable, so captured runtime values remain UNKNOWN. No environment value was changed. The sign-in page rendered in the browser; unauthenticated GET / and GET /api/health both returned 307 to /auth/signin. The initial in-app browser was signed out. The owner then logged into Chrome; authenticated staff home and the Workbench Research/December 2026 request list rendered, showing 10 assigned requests. No request was opened or edited. This proves the signed-in list read path, not a full integration-health check or job resumption. No live job drain ran; resumption remains UNVERIFIED.

## Outstanding operational checks

- Local isolation remains off/off after shared-link restoration; establish literal-on configuration before Local B4 checks.
- Operational wmkf-ledger-pg/ledger_prod and wmkf-ledger-pg/ledger restore, §6 preflight/apply/record and cast address-digest ownership match: blocked, ledger not on this machine. Never use this Mac's stale ledger.
- Shared Production/Preview migration consistency and owner-run 058 receipt remain pending, separate from runtime operation; this agent applies no Production migrations.
- All six lookup-only automation dispositions are owner-classified in the Connor companion. Fresh metadata/visibility plus exact Request/run/person/digest/ETag checks remain required before any later owner-authorized slot PATCH. The raw probe's six-entry complete=false receipt is unchanged.
- PR #374 was OPEN at merge time. Its second landing must use requireLedgerUrl(args.target) in the B4 slot path and regenerate the ledger fingerprint after integrating 058, against disposable scratch Postgres. Claude owns that work; #374 was not merged/rebased here.

## Rollback reference

[VERIFIED via premerge Vercel inspect] Prior Ready Production was `dpl_HSLQZ6jvdtpJyhSz4L7fxmMBCmkA`, source `cd177c471e9c9c6fd8a725c9765cbe31b5f6c2f3`. If rollback is required, restore that code deployment first:

```bash
vercel rollback https://wmkfresearchapps-og127m40f-justin-gallivans-projects.vercel.app --scope justin-gallivans-projects
```

The command is recorded, not executed. Never disable either isolation switch as the sole rollback: the owner-selected B4 policy blocks binds and pauses all acceptance jobs when switches are non-on. Code rollback does not undo data or email effects.

## Bounded reconciliation

/contract-reconcile Mode A and /sweep Mode A: owner merge instruction → GitHub merge → Vercel Git deployment → Production aliases and sign-in entry → B4 plan/current reports/branch handoff. Partial success is explicit: deployment is verified; ledger parity, captured flag values and live resumption are not. The owner-supplied Chrome session subsequently passed signed-in home and Workbench-list smoke. Helper/schema/symbol changes are N/A; this follow-up changes documentation only. Historical probe/Opus/CI captures retain dated results. The operational dispositions are scoped to lookup-only binding; the separate status setter is outside that clearance. Unrelated scheduled-email code, 059/V58, Claude's portability implementation and checkout are excluded. The deployment milestone is recorded here and in DEVELOPMENT_LOG.md by the explicitly requested /stop pass.

[VERIFIED via sequential local output] All 20 scoped documentation/Atlas/secret/invariant gate and self-test commands passed, with each self-test after its gate. Staged whitespace and redacted Gitleaks scans passed. The separate mainline handoff below the preservation marker is byte-for-byte unchanged. Runtime/slot tests were not rerun for this documentation-only follow-up; candidate CI was green and post-merge Jest, PostgreSQL ledger and Playwright passed. The bounded restatement search leaves only explicitly historical/verbatim draft/promotion-hold statements; current B4 checklist, reports, owner packet and handoff now point to this promotion. Captured flags, live resumption and ledger/schema/digest evidence remain unknown/incomplete.

[VERIFIED via GitHub at stop] All nine post-merge check runs succeeded, including the final JavaScript/TypeScript CodeQL analysis; the Vercel status succeeded. The companion JSON retains the final dated check snapshot. Stop advisory report unavailable (local state unreadable); no observation row fabricated.
