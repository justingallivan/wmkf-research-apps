# Session 414 Prompt: Version history shipped and live-verified; milestone design decided (S413)

> **Handoff, 2026-08-10 (Session 413).** Two merges to `main`, both deployed and
> verified Ready. Shipped read-only SharePoint version history on the Initial
> Assessment tab after four adversarial review rounds, then **live-verified it**
> with a signed-in smoke — the first end-to-end execution of that route→service→
> Graph chain, which every test mocks. Settled three SharePoint questions with
> live evidence (version-ordering, version policy, and that the version limit is
> unreadable via Graph), and the owner decided milestone snapshots **copy bytes**
> rather than store a pointer, which unblocks that producer.

## Session 413 Summary

### What Was Completed

1. **Staff replace path merged** (`221ac40a`). The `staff-submission-replace`
   branch was 10 commits behind `main` but touched a disjoint file set; clean
   merge, no conflicts. 7206/7206 unit, all gates green, deployed.

2. **25 reviewer affiliation alerts closed by the owner** — resolved outside the
   app. Verified with the read-only probe: **0 open / 75 resolved**, total held
   at 75, so they were resolved in place rather than deleted. The probe reports
   alert status only; whether each underlying affiliation was corrected in
   Dataverse was **not** verified.

3. **Read-only SharePoint version history shipped** (merge `147d3e49`). Fetched
   only when staff open the disclosure on the Initial Assessment tab: route →
   service → `GraphService.listFileVersions` → UI. Drive/item identity comes from the registry row and is
   never accepted from the caller; a stale `expectedArtifactId` returns 409
   rather than showing another artifact's editors. **No restore action and no
   Dataverse write** — a test asserts the restore control's absence.

4. **Four adversarial review rounds, ~9 defects** — and each round found defects
   in the previous round's fixes, including one fix that reintroduced the bug its
   predecessor closed. Resolved structurally in the end: the current version is
   fetched **before** pagination, so materializing it never competes with the
   bounded scan for the deadline.

5. **Live-verified by signed-in smoke** (`22f27e71`) — see "Live production
   behavior" below. This retired the mock-coverage gap.

6. **Three SharePoint facts settled by live evidence:**
   - **Version ordering** (`2da7054b`): Graph accepts `$orderby` on `/versions`
     with **HTTP 200 and silently ignores it**. The client-side sort and page cap
     are therefore platform-forced, not defensive. Do not re-propose `$orderby`.
   - **Version policy** (`75c7831c`): read from the signed-in Versioning Settings
     page — major versions only, **no time limit**, **keep 500 major versions**,
     drafts unchecked, check-out not required.
   - **The version limit is not readable via Graph** (`e352d161`):
     `GET /drives/{driveId}/list` returns **200** — so this is a
     permissions-independent gap, not another `Sites.Selected` denial. The facet
     carries only `contentTypesEnabled`, `hidden`, `template`.

7. **Milestone pointer-vs-copy DECIDED: copy the bytes** (owner). Recorded with
   the honest caveat that one leg of the argument weakened *after* the decision —
   the version limit turned out to be a comfortable 500, so accidental pruning is
   not a material risk.

8. **`scope-claim-reminder` hook false positives fixed** (`e26c5fa0`) — path
   citations were being read as quantities, and the hook's own prescribed
   resolution marker re-triggered the block.

### Live production behavior that changed today

The Initial Assessment tab now offers **`View version history`** per artifact,
fetched only on staff disclosure — never on page load. Verified live on Request
`1003109`: rendered `Version 2.0 · current · Justin Gallivan · Jul 30 6:33 PM`
over `Version 1.0 · SharePoint App · Jul 30 5:28 PM`, no truncation note. Two
cross-checks passed: those timestamps equal the direct-Graph probe's UTC values
converted to Pacific (proving the chain returns what a direct Graph call does),
and the `current` badge agrees with the tab header's separately-issued
`publication.versionId` read.

### Commits (all pushed; production deploys verified Ready)

- `221ac40a` — Merge: staff image/caption replace path
- `147d3e49` — Merge: read-only SharePoint version history (8 branch commits)
- `2da7054b` — Settle the Graph version-ordering premise with a live probe
- `5f04002d` — Reconcile durable docs to the shipped display
- `22f27e71` — Close the display: live-verified by signed-in smoke
- `e352d161` — Record that the major-version limit is not readable via Graph
- `ccf4d965` — Correct the versioning-settings deep link: untested, and it failed
- `75c7831c` — Record the library version policy; settle pointer-vs-copy as copy
- `aeac48d2` — Record the delete attempt as null evidence, and route around it
- `10b8f9a0` — Record both hypotheses for the edit-yes/delete-no asymmetry

Unit suite on `main`: **7247/7247**.

## Next Items

### Verified Open

1. **Build the milestone snapshot producer.** Evidence:
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` "Board milestone freeze" — now marked
   **DECIDED: copy the bytes** (owner, 2026-08-10), so this is **unblocked**.
   Retain a DOCX (and/or PDF) snapshot in a separate governed location, keeping
   `wmkf_milestoneversionid` / `wmkf_milestonecontenthash` /
   `wmkf_milestonecreatedat` as identity **beside** the copy rather than instead
   of it. Nothing is sunk — those three fields are written nowhere today
   (`lib/dataverse/adapters/request-document.js:38-40`, read at
   `lib/services/initial-assessment/artifact-service.js:257-259`). Read the
   recorded reasoning before building; it deliberately includes which leg of the
   argument weakened after the decision.

2. **Two SharePoint checks that need no email and would close a blocker.**
   Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` H1/H2 block. Both are
   non-destructive and settle whether ordinary members can delete:
   (a) add the **"Checked Out To"** column to the `akoya_request` view;
   (b) open the Members group's permission **level** and read **Delete Items** /
   **Delete Versions**. See "Verify Before Acting" for the safety constraint.

3. **Optional cleanup:** `origin/staff-submission-replace`,
   `origin/artifact-version-history`, and `origin/codex/alert-triage-dataverse-probe`
   are all fully contained in `main` and kept as free backups. Delete when you want.

### Owner Decision Needed

1. **Should a staff image substitution leave an audit trace?** Evidence:
   `docs/GRANTEE_SUBMIT_VISIBILITY_SPEC.md` "As built". The writer deletes the
   prior image on replacement, so the grantee's original leaves the folder and
   survives only in SharePoint's recycle bin, with no in-app record. Consent is
   settled; this is "what does the record say we published". Cheap now, awkward
   to retrofit.
2. **What triggers `Closed No Response`?** Manual, or automatic after an overdue
   threshold? Blocks the last undesigned transition.
3. **Per-send deadline override divergence.** Evidence:
   `render-emails-service.js:271`, `send-emails-service.js:916`. Unchanged.
4. **Whether `DEVELOPMENT_LOG.md` is revived or formally retired.** Evidence:
   file tail "Last Updated: May 14, 2026"; S409–S413 added no entries. **No entry
   was added this session deliberately** — writing one would preempt this decision.
5. **Residual Reviews-surface duplication.** Owner said "looks good for now"; drop
   only on explicit request.
6. **Cycle measurement tool live evidence re-discovery.** Justin said he would
   test further.

### Blocked — Waiting On External Response

1. **Initial Assessment pilot: administrative evidence — NARROWED 2026-08-10.**
   Evidence: `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` evidence
   matrix. Of the original four checks:
   - **Version policy — ANSWERED. Do not re-ask.** (see Summary item 6.)
   - **Second-stage recycle recovery — reported absent**, unusual for SharePoint
     Online. Confirm with site-collection admin rights before any durability
     guarantee rests on it.
   - **Purview retention — unanswered** ("not familiar with purview"). Needs an
     **M365 compliance admin**, not Connor.
   - **Editor delete rights — the one unresolved durability question**, and now
     with two competing hypotheses (Next Items item 2 has the checks).

   **This blocks administrator restore only.** The version-history display shipped
   without it; the milestone producer is unblocked by the copy decision.

### Verify Before Acting

1. **Do not resolve the delete-rights question by deleting a governed artifact.**
   With no confirmed second-stage recycle bin, a *successful* delete is the bad
   outcome — destroying an artifact to test whether artifacts survive destruction.
   Use the non-destructive checks in Next Items item 2. A disposable
   tester-created file in a non-governed location only establishes delete-**own**.

2. **The two 2026-08-10 delete attempts are NULL evidence — do not cite them.**
   `File is checked out to another user` (`0x80060728`) is a catch-all for any
   lock, not the permissions message. The real finding is the **asymmetry**: the
   same user could edit the file but not delete it, which no standard permission
   level allows.

3. **Do NOT batch-resolve affiliation alerts by key prefix.** Evidence:
   `.claude-memory/feedback-list-and-confirm-before-bulk-deletes.md`. An alert
   describes a mismatch; resolving one that was never fixed destroys the only
   signal that reviewer needs attention. Reuse
   `scripts/resolve-fixed-reviewer-affiliation-alerts.mjs`, which re-derives each
   row's justification at run time and refuses what it cannot reproduce.

4. **Request `1002788` is still `Submitted` with a live package** and has no
   in-app path forward. Re-cleaning is manual: delete the `wmkf_granteedeliverable`
   row, clear `wmkf_abstractapproved`, remove the SharePoint file. Also: request
   `1002788`'s image is the fixture that proved the inline-image path — any live
   smoke of the replace control goes on a **different** request.

5. **The `Complete` gate has a sequencing trap.** Nothing writes `COMPLETE`, and
   no consumer reads deliverable status `[VERIFIED via cycle-export-service.js:57-61]`.
   Applying an eligibility filter before the writer exists would **empty the cycle
   export**. Order: writer → backfill → gate; warn rather than exclude first.

6. **Retired-table operational scripts** (25 non-archive scripts referencing
   dropped `reviewer_suggestions`). Still needs caller review + owner-approved scope.

### Do Not Reopen Without New Decision

1. **Milestone pointer-vs-copy** — owner decided **copy** 2026-08-10. H2 turning
   out true would not reopen it; delete rights are one of four reasons.
2. **`$orderby` on Graph `/versions`** — probed live; returns 200 and is silently
   ignored. The sort and page cap stay.
3. **Another adversarial round on the version-history feature** — four rounds plus
   a live smoke; the marginal reading pass is spent.
4. **`Revision Requested` as a built transition** — deferred in favour of email.
5. **Re-consent on staff replacement** — original waiver stands; knowingly accepted.
6. **The S411 shared-footer placement of `Deliverable outputs`** — superseded.
7. **ROR strategic reset**, **institution checker / enrichment seam iteration**,
   **S408 15-row promotion diagnostic**, **S328 post-submit downloads** — closed.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/graph-service.js` | `listFileVersions` — current version fetched BEFORE pagination; 3-page cap; `$orderby` is a no-op (probed) |
| `lib/services/initial-assessment/artifact-service.js` | `listInitialAssessmentArtifactVersions` — resolves the Ready row server-side; 409 on `expectedArtifactId` mismatch |
| `pages/api/workbench/initial-assessment/versions.js` | GET only, `requireAppAccess('reviewers')`, both GUIDs validated before any adapter call. **No restore branch** |
| `shared/components/workbench/ArtifactVersionHistory.js` | Fetched on staff disclosure only; status allowlist with a visible fall-through; `loadSequence` stale guard |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Version policy, the copy decision and its reasoning, H1/H2, and what is unreadable via Graph |
| `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` | Evidence matrix — version history now PASS |
| `.claude-memory/feedback-share-codex-verbatim.md` | A tool result is not a user-visible message |
| `.claude-memory/feedback-vacuous-clean-results-print-the-denominator.md` | S413 extension: estimate the denominator BEFORE proposing a probe |

## Testing

```bash
npx jest tests/unit                       # 7247/7247 on main
npm run check:types

# Version history (all four layers)
npx jest tests/unit/graph-service-versions.test.js \
  tests/unit/initial-assessment-artifact-versions.test.js \
  tests/unit/workbench-initial-assessment-versions-route.test.js \
  tests/unit/artifact-version-history.test.js --runTestsByPath

# NOTE: every test above stubs its outbound boundary. Green here does NOT
# establish that the route→service→Graph chain works; only a signed-in smoke
# does (last run 2026-08-10 on request 1003109, PASS).

node scripts/probe-reviewer-affiliation-alerts.mjs   # read-only, no writes
```
