# Power Automate prompt delivery — consolidated stop handoff

Owner: Justin; coordinating Codex chat **Contracts for PA flows**.
Date: 2026-11-16. Single resume point for both that chat and
**Clarify PA prompt test purpose**. The latter completed its read-only stop packet
and is idle; it made no files, commits, prompt changes or deployments.

## Current direction — owner decided

Deliver Dataverse prompts that Connor can run in his **existing Power Automate
flows**, with clear inputs, output shapes and destination fields. Justin has asked
Connor for an example prompt; it has not arrived in either coordinated chat.

**Backend integration is stopped/parked.** Do not resume submit/poll adoption,
worker scheduling, backend rollout, or more backend acceptance tests as the next
step. Earlier recommendations to do so are superseded. The successful bounded
backend trial proves that path works, not that Connor needs it. Preserve the
implementation and evidence; this decision does not authorize deletion,
deactivation, credential revocation, new prompt publication or more model calls.
The deployed Executive Summary staff editor remains in place.

## Dated prompt inventory evidence

[VERIFIED by the read-only discovery chat through Production Dataverse GETs,
2026-11-16; coordinator retrieved its final report, not a fresh query]
The discovery chat queried all `wmkf_ai_prompts` rows and inspected relevant current
content. Query output exists in that chat; no separate raw receipt was saved.
Recheck relevant current versions before any eventual publication. These are
Production versions, distinct from the separate Sandbox Summary v1 trial.

| Prompt | Observed current version | Compatibility/content gap |
|---|---:|---|
| `grantee-title.generate` | 2 | System/body handling, `source_title` and `source_abstract` substitution, model compatibility; destination `wmkf_wmkfprojectdescription` |
| `proposal.executive-summary` | 2 | Body relies on backend profile/prepared context and frozen PI rather than explicit proposal placeholder; adapt to Connor's convention. ≤200 words, destination `wmkf_layabstract` |
| `proposal.methodology` | 2 | Same packaging issue; published 300–350 words / maximum 400 conflicts with workbook 2 sentences–100 words. Prior quality/length failures remain unresolved; unpublished candidate is not proven |
| `pd-assignment.expertise-match` | 1 | `applications` and `eligible_program_directors` inputs; roster/ID mapping and destination unresolved, model/budget null. Recommendation is not automatic assignment authority |

No dedicated intake Personnel, Rationale, Keywords or Concern Flags prompt was
identified in that full inventory. Existing similar prompts are not confirmed
substitutes. `phase-i.checkin` is non-current/deprecated; `phase-i.summary` produces
the older `wmkf_ai_summary`, not Executive Summary.

## Worksheet baseline, not silently replaced by experiments

Historical extraction: `docs/plans/PREFLIGHT_PROMPTS_HANDOFF_2026-11-10.md` on
`codex/power-automate-integration-2026-11-11` (also inherited by the retained Summary
branch). Original uncommitted workbook:
`J27_Review_Workbook_Mockup_v10.1 (edited by SH, JG, CN, DS 11.10.26).xlsx`,
sheet `1 Review (staff master)`.

| Columns | Requested output |
|---|---|
| H / I | Short Title / Executive Summary ≤200 words |
| J | Methodology, 2 sentences–100 words |
| K | Personnel, length scales with team |
| L | Intake rationale, 3 sentences–100 words, versioned |
| M / N | Field and methods keywords from controlled lists |
| O | Intake flags, versioned |
| P | Open questions with page/section references, accumulated across prompts |
| Q | AI-drafted, human-edited staff notes/rationale |

Keyword lists come from the Keywords table `wmkf_programlevel3` (Connor via owner, 2026-11-18; not seeded yet); flag rubric/audience provisional. P/Q need not
be separate prompts. Compliance and broader expertise matching scope are unresolved.

## Completed work and preservation boundary

- Staff editor: `1037d2dbd` on main, deployed and authenticated-tested on Production
  Request 1003518; original blank restored. Existing editor handoff:
  [Request narratives](REQUEST_NARRATIVES_HANDOFF_2026-11-09.md).
- Parked backend: `codex/executive-summary-generation-2026-11-16`, worktree
  `/private/tmp/wmkf-summary-generation-20261116`. Built `ac7cac093`, real-PDF
  parser correction `6d6a7c724`, successful trial receipt `8e98afb03`.
  Includes inherited unpromoted PA/Executor/Admin/draft/recommendation work; do not
  merge the whole branch to recover prompt text or documents.
- [VERIFIED via hosted HTTP, ledger and Dataverse readback] Sandbox Request
  **1000389** completed one 192-word Summary generation, one audit and one publication.
  Original blank restored; replay did not refill it. Short Title and prior receipts
  unchanged. Ready Preview `dpl_2ZAUCQ6eD7GhHptTZxjsa7cgddgk` had no aliases.
  Detailed receipt is `docs/plans/PA_EXECUTIVE_SUMMARY_LIVE_TRIAL_2026-11-16.md`
  on the parked branch. This was not a test of Connor's existing flow.
- Retained Sandbox fixture PI/contact, synthetic SharePoint PDF, prompt/profile and
  ledger receipts remain. Shared SharePoint site is not a Sandbox site; only the
  dedicated TEST folder was written. No new cleanup performed during stop.
- Policy expiry: November 18, 19:30 UTC. Source/response expiry November 17,
  18:31:58.521 UTC; remaining content November 23 at that time. Physical scoped
  cleanup remains due and is separate from restarting integration or deleting
  receipts/infrastructure. Check the retained receipt and current state before action.
- **Owner-approved content-expiry cleanup (Session 680, 2026-11-16).** Run the parked
  worktree's `scripts/run-summary-sandbox-http.cjs tick` once after 2026-11-17
  18:31:58 UTC and once after 2026-11-23 18:31:58 UTC. [VERIFIED via parked-branch
  source `8d97e9999`] The worker deletes only expired `prompt_job_content` rows in this
  Summary pilot's scope before its active-policy check, so deletion still runs after
  the Nov 18 policy expiry; the completed job then returns without model calls or
  Dataverse writes. A tick before expiry deletes nothing. The saved Preview OIDC token
  expires 2026-11-17 06:24 UTC and must be refreshed first (private file only). The
  runner allows 8 ticks; 5 were used, so 3 remain. Each tick appends to
  `http-state.json`. [ASSUMED from trial notes, not probed] the Preview deployment and
  its settings still exist and the content rows are present. Out of scope: the two
  earlier Short Title jobs in the same database, and fixture removal (test PI link on
  1000389 and the TEST-folder PDF), which stay until the owner decides.
- **Batch 1 ran 2026-11-17 19:00 UTC.** The Entra credential file
  `/private/tmp/wmkf-pa-entra-credential-20261112.json` was gone, and the old `tick`
  mode refuses finished jobs and expired policies. Owner chose option A: parked-branch
  commit `d86870146` adds `expire` mode, which needs only the OIDC token and cron secret
  and accepts only `succeeded`/`disabled`. One POST returned 200 `{"stage":"succeeded"}`
  [VERIFIED via runner output and `http-state.json`: ticks 6 of 8, no pending intent].
  The response does not report a deleted-row count; deletion is inferred from the
  worker code path, not read back from the database.
- **Batch 2 (after 2026-11-23 18:31:58 UTC):** from the parked worktree, refresh the
  token with `vercel env pull --environment=development --yes
  /private/tmp/wmkf-summary-live-20261116/development.env` (run from the linked main
  checkout; it writes only that file), then run `node scripts/run-summary-sandbox-http.cjs
  expire` once. After the Nov 18 policy expiry, expect `disabled`. That result is
  ambiguous: it is also what the worker returns if the Preview's pilot setting were
  missing, in which case nothing is deleted.
- Private credentials/source/receipts under `/private/tmp/wmkf-summary-live-20261116`
  are not in Git and do not transfer between Macs. Do not copy credential files into
  handoff artifacts. Worktree directories are volatile; pushed branches preserve code.

## Resume in one session

**Verified open:** compare Connor's example with the worksheet extraction and the
inventory above. Establish prompt columns read, document/text attachment or
substitution, placeholder syntax, model/settings ownership, plain-text/JSON output,
parsing and field writeback. Ask only for mechanics missing from the example.
Then prepare one per-output gap checklist, beginning with Short Title and Summary.
Prompt drafts can be prepared before the example if requested, but final packaging
must follow the actual flow. No such new drafts were created during closeout.

**Owner decisions needed:** Methodology length, missing content/rubrics/lists,
unassigned destinations, versioned storage and broader output scope. Do not choose
these silently or treat historical experimental limits as approved requirements.

**Parked:** backend submit/poll integration, scheduling, wider enrollment and
Production promotion. Reopen only on a new owner decision demonstrating a need.

**Verify before acting:** current prompt versions and existing consumers before
publication; credential/policy expiry and exact retained scope before cleanup.
No production integration release, fresh live test or destructive cleanup is
implicitly authorized by this handoff.

## Coordinated stop evidence

The implementation chat owns the consolidated docs; the discovery chat supplied a
read-only packet and made no overlapping edits. Both attempted the current-session
claim-evidence report; local state was unavailable, so no observation row was invented.
Scoped changed-fact reconciliation records the new owner direction in the session
handoff and branch runbook; earlier tests remain historical evidence. No runtime
change is part of stop. Strategic pivot merits a milestone entry; no new production
backend capability shipped. CLAUDE.md and its symlink invariants need no changes.
