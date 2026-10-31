# Session 658 Prompt: J27 Factory document slice complete; await Connor

## Session 657 Summary — Codex, 2026-10-31 Pacific

**Destination:** this handoff and feature stay on `codex/session-657-start`, in
`/private/tmp/wmkf-session-657-codex`. Justin explicitly requested an isolated
worktree because Claude is working on main. Do not switch or write Claude's
checkout, merge this branch into main, or treat a stop-time feature push as
production promotion. The user invoked `/stop` to preserve this branch remotely.

Prior handoffs remain retrievable: `git show 6ce1ec21a:SESSION_PROMPT.md` is the
branch's previous handoff; `git show 3703f7bbd:SESSION_PROMPT.md` is the observed
main handoff at this stop, including Claude's newer workstreams. Both were read
and verified retrievable. Those are dated snapshots, not fresh live authority.

### What Was Completed

1. **[VERIFIED via Git and startup checks] Isolated setup and start.** Created this
   branch from `6ce1ec21a`; dependencies and required skills/memory symlinks were
   set up. All 72 startup gate/self-test runs passed. Main's existing WIP was
   preserved. Main advanced during this session; this branch intentionally does
   not include that concurrent runtime work.
2. **[VERIFIED via read-only SharePoint/journal/Dynamics reads] Board-link inquiry.**
   The D26 Board folder contained nine released writeups. Copying finished around
   7:01 p.m. Pacific October 30; the five recorded leadership activities were Sent
   around 8:01 p.m., all linking to that same folder. No copy-after-email evidence
   was found. The specific message Beth clicked and her account's visibility
   remain unverified; Justin had requested the forwarded message. No repair,
   permission change, copy, release or email was performed. Research library
   listing was supplied in chat. Correct path: Research → Documents → Board
   Materials → D26. This is not authorization to resend or re-release anything.
3. **[VERIFIED via source/offline tests] J27 Factory research, plan and bounded build.**
   Both newly submitted and advanced-to-peer-review starting points are planned.
   Only document handling is implemented: confirmed J27 narrative/bibliography
   aliases, exact pair completeness for linked J27 sources, version-6 source
   profile, original source integrity, and canonical renamed copy destinations.
   D26 exports remain v5; retained v2–v5 semantics and existing policy/ledger
   grammar remain intact. No migration, new route, status operation, image/raw
   upload support, deployment or live Factory rehearsal was performed.
4. **[VERIFIED via review receipt] Claude Fable reviewed the plan and build through
   subscription OAuth only, with API-key variables removed.** Initial plan
   findings were incorporated. Build review found no blocking code defect and
   required two tests; both were added. Final verdict: APPROVE. No Ultrareview,
   API-authenticated agent session or substitute product was used.
5. **[OWNER DIRECTED] Remaining Factory work is parked for Connor.** An email was
   drafted in chat; no agent sent it, and owner sending/receipt is unverified.
   Final question 5: “Have you created a J27 test request when testing the portal?”
   Document questions were narrowed because D22/D33 and the readers already
   define contents and the reviewer path. The plan records these clarifications.

### Commits

- `6e58c6682` — Plan J27 Factory submitted and peer-review starting points.
- `557c5431c` — Support J27 Factory AI-input documents with legacy-safe copies.
- Stop documentation commit follows, on this same branch only.

## Next Items

### Verified Open

No additional implementation is scheduled before Connor's reply. The document
slice is source-built, offline-tested and Fable-approved; production readiness
and live behavior are not established. Promotion needs a later deliberate owner
decision. Check the branch and current main before preparing integration.

### Owner / Connor Decisions Needed

Use the [implementation plan](docs/plans/TEST_REQUEST_FACTORY_J27_IMPLEMENTATION_PLAN_2026-10-31.md)
for the full C1–C9 contract/evidence table. Immediate questions:

- We set the test states ourselves. Confirm whether setting Phase I `Invited`
  derives Request Status automatically or both fields must be set explicitly;
  confirm arrival phase-picklist values and automation effects for both presets.
- Exact files-ready, staff-state and program-at-submission field contracts and
  test-marker handling for relevant flows; no field names or options invented.
- Exact combined staff PDF filename/location. Staff-package contents are already
  decided; reviewers receive the same package at the code-enforced
  `Reviewer Materials/Proposal_{n}.pdf` path. Do not reopen those settled points.
- Whether Connor already created a J27 portal test request that can be inspected
  before proposing a separate, authorized live rehearsal.

### Parked

- **Factory lifecycle/status presets and all live rehearsals:** owner hold until
  Connor is available and replies. No status PATCH, new test record, provider
  work, send, schema apply, cleanup or production promotion is authorized.
- **PR553 / Windows09:** inherited owner-directed hold pending Connor's Windows
  offline results, recorded in the [Monday archive](docs/plans/PR553_MONDAY_RESUME_2026-11-02.md).
  This stream was not resumed or inspected at stop. Preserve its unpushed feature
  work and local artifacts; do not push its branch or add Connor's ZIP to Git.

### Verify Before Acting

- Worktree paths are local and temporary; verify branch, commit, files and remote
  before resuming. The Factory branch's push preserves tracked code/docs, not
  local dependencies, environment links or external review logs.
- Production source lookup expansion, real J27 cycle-link population, Graph MIME
  and actual flow effects remain unprobed for this build. Unit tests do not prove
  them. A source without a linked J27 cycle and without J27-named inputs follows
  legacy rules; do not claim such a fixture is J27-ready.
- Keep v6 runs on compatible code. Old code must not advance them. Preserve all
  dispatch evidence and artifacts; never reset a stopped run to retry a write.
- A Basic run's ready status is not proof of either proposed J27 starting state.
- Main has newer Claude changes; use its current source/handoff when resuming
  those streams, rather than this branch's older snapshot.

### Do Not Reopen Without New Direction

- No automatic reviewer/AI history generation or full GOApply fidelity expansion.
- No re-release of Board files or resend of prior leadership activities.
- No Connor ZIP in Git; no PR553 activation from an offline PASS alone.
- No destructive carryover or historical-record cleanup based on a handoff.

## Concurrent Workstreams

| Owner / stream | Resume boundary |
|---|---|
| Codex / J27 Factory | This branch; document subset complete; lifecycle/live work held for Connor; owning plan linked above. |
| Claude / main and invited-reviewer outcomes | Active concurrently. Observed main tip `3703f7bbd`; its handoff records #569/#570 and Production schema steps. Those live claims were not re-probed here. Resume from current main and its owning plan; no authority transferred. |
| Claude / #561, #562, #568 | Main's observed handoff records these merged/deployed. Historical evidence only here; do not carry earlier open-merge tasks forward. |
| Codex / PR553 | Parked per Monday archive; no new implementation, promotion or branch push in this session. |
| Ranking, archive, research corpus | Other-owner streams; not revalidated or assigned here. |

## Key Files

| File | Purpose |
|---|---|
| `docs/plans/TEST_REQUEST_FACTORY_J27_IMPLEMENTATION_PLAN_2026-10-31.md` | Scope, Fable dispositions, build evidence and Connor questions |
| `docs/plans/evidence/FACTORY_J27_DOCUMENT_HANDLING_REVIEW_2026-10-31.json` | OAuth Fable review, final APPROVE, fingerprint and verification limits |
| `lib/services/test-requests/document-profile.js` | Pure J27 pair/profile and abstract-version checks |
| `lib/services/test-requests/source-bundle.js` | v6 J27 exports/read validation; legacy formats retained |
| `lib/services/test-requests/file-plan.js` | Alias source validation and canonical copy destinations |
| `tests/unit/test-request-j27-documents.test.js` | Export/copy integrity, completeness, downgrade and partial-selection coverage |
| `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` | Branch-only document handling and operational limits |
| `docs/atlas/postgres-test-request-runs.md` | Artifact ownership and unchanged ledger contract |

## Verification and Closeout

[VERIFIED via session commands] Before stop: 70 Factory unit suites / 2,303 tests
passed. Fable's requested additions subsequently passed in the focused J27 suite
(19 tests); the default Admin exporter suite passed 117 tests. Types, touched-file
lint (zero errors, two existing unused-disable warnings), all 38 selected gate/
self-test runs and canonical `npm run build` passed. Final docs/reference/fact/
J27/secret checks passed again after the review receipt. No live Factory action
or schema application was used for verification.

The stop claim-evidence report was attempted but local state was unavailable.
No eligible-session observation or zero-advisory row was invented. Memory router
was not edited, and no new router-growth advisory was received.

**Milestone determination:** no DEVELOPMENT_LOG entry required. This is an
unmerged branch implementation, not a shipped production capability/cutover.
No CLAUDE.md change is needed: no app, endpoint, schema, executable script,
configuration or repository convention was added. Factory-specific contracts
are documented in its plan, runbook, Atlas and catalog. Stop updates only this
handoff and the plan's final owner clarifications; main remains with Claude.
