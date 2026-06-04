# Memory Reorganization Audit — 2026-06-04

**Scope:** `.claude-memory/MEMORY.md` after Claude's reorganization, every file routed from that index, and targeted verification of routed claims against current repo code/docs.  
**Auditor:** Codex  
**No memory edits were applied during this audit.**

---

## Executive Summary

The reorganization achieved the main objective: `.claude-memory/MEMORY.md` is now a compact router instead of a dense prose index.

Current router budget:

- `69` lines
- `7,331` bytes
- all routed links resolve
- every routed memory file has a `## Recall Rule`

Existing gates also pass:

- `PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /opt/homebrew/bin/npm run check:fact-consistency`
  - PASS: app-definition-count=18, requireappaccess-endpoint-count=55, api-route-file-count=100
- `PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /opt/homebrew/bin/npm run check:doc-currency`
  - PASS: no drift markers across 8 patterns
- `/opt/homebrew/bin/node scripts/check-memory-drift.js --no-write`
  - PASS, but report is stale (>24h) and has 31 unknown claims

The main remaining problems are not catastrophic, but they are important:

1. Two active routed memories contain stale or misleading current-state claims.
2. The router still points hot task routes at several `status: closed` or `status: stale` memories without warning in the router line.
3. Six router lines exceed the plan's "1-3 files per route" rule.
4. 47 routed files still do not conform to the full metadata contract from `docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md`.

---

## Method

Commands used:

```bash
/usr/bin/wc -l .claude-memory/MEMORY.md
/usr/bin/stat -f '%z bytes' .claude-memory/MEMORY.md
/opt/homebrew/bin/node scripts/check-memory-drift.js --no-write
PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /opt/homebrew/bin/npm run check:fact-consistency
PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /opt/homebrew/bin/npm run check:doc-currency
```

I also ran targeted repo checks against:

- `shared/config/appRegistry.js`
- `pages/api/**`
- `pages/workbench/[requestId].js`
- `pages/api/workbench/applicant-reviewers.js`
- `lib/dataverse/adapters/reviewer-suggestion.js`
- `lib/dataverse/adapters/researcher.js`
- `lib/services/capture-self-reported-orcid.js`
- `pages/api/external/review/[token]/*`
- `proxy.js`
- `docs/atlas/*`

---

## Verified Clean

### Router Shape

`.claude-memory/MEMORY.md` is now safely under the loader budget:

- 69 lines
- 7.3KB
- target from plan was under 150 lines and 18KB

All routed `.md` links resolve. No missing routed memory files were found.

### Recall Rules

All 113 routed memory files have a `## Recall Rule` section with a `Read this when:` trigger.

### Canonical Counts

`project-app-access-control.md` is consistent with current code and canonical counts:

- app definitions: 18 in `shared/config/appRegistry.js`
- real `requireAppAccess(...)` route-file count: 55
- the apparent 56th text hit is only a historical comment in `pages/api/test-email.js`, not a call site
- `DEFAULT_APP_GRANTS = ['dynamics-explorer']` is present
- the additive `reviewers` grant is present and accepted variadically by reviewer routes

### Reviewer Slot Claims

`project-grant-lifecycle-states-confirmed.md` correctly reflects the corrected state:

- `wmkf_potentialreviewer1..5` exists in the Atlas
- current code reads the slots in `pages/api/reviewer-finder/my-proposals.js`
- current code reads them in `pages/api/dynamics-explorer/chat.js`
- current Workbench ingestion reads them in `pages/api/workbench/applicant-reviewers.js`

### Sticky Self-Reported ORCID

`project-reviewer-self-report-orcid-sticky-confirmed.md` matches current code:

- `capture-self-reported-orcid.js` writes a `confirmed` identity decision
- `researcher.writeIdentityDecision` skips overwriting stored `confirmed` unless incoming status is also `confirmed`
- `researcher.clearIdentityFields` skips clearing stored `confirmed`
- `pages/api/external/review/[token]/respond.js` calls the capture path non-fatally after accept/decline
- unit tests exist in `tests/unit/capture-self-reported-orcid.test.js`

### External Reviewer Flow

`project-external-reviewer-file-access.md` matches current code structure:

- `proxy.js` allowlists `/external/*` and `/api/external/*`
- `pages/external/review/[token].js` exists
- `pages/api/external/review/[token]/{context,proposal,respond,upload}.js` exist
- `lib/external/{token-lifecycle,verify-suggestion-token,reviewer-materials,review-form-schema}.js` exist

### Appresearcher Collapse, Code Side

`project-appresearcher-collapse-post-pilot.md` is consistent with runtime code direction:

- reviewer bibliometric fields are read from `wmkf_potentialreviewers`
- `wmkf_primaryaffiliation` is preferred with `wmkf_organizationname` as compat fallback
- runtime refs to the old sidecar are gone from app paths checked

I did not live-probe Dataverse 404s for dropped entities; the audit only verified repo state.

---

## Findings

### P1 — Intake reviewer-capture memory contradicts current Workbench code

File: `.claude-memory/project-intake-portal-reviewer-capture.md`

Problem:

- Lines 16, 27, 29, and 33 say applicant recommended **and excluded** reviewers should be written to `wmkf_appreviewersuggestion`, and line 29 says the D26 Workbench patch migrates legacy slots + free-text into junction rows.
- Current code does not do that for exclusions.

Current code:

- `pages/api/workbench/applicant-reviewers.js:17-23` says free-text excluded reviewers are parsed and returned for soft-block only; no structured `disposition=excluded` junction rows are written.
- `pages/api/workbench/applicant-reviewers.js:144-180` implements that: parse names, return `excluded`, `excludedNames`, and `excludedRaw`; no excluded row write.
- `lib/dataverse/adapters/reviewer-suggestion.js:112-120` defines the `excluded` option defensively, but the active Workbench path does not write it.

Why this matters:

This is a hot routed file for intake work. Claude could incorrectly build or describe the current Workbench ingestion as writing structured excluded rows, or mistakenly believe existing D26 excluded free-text has been materialized into junction rows.

Recommended fix:

- Split the memory into two explicitly labeled states:
  - **Current Workbench legacy ingestion:** recommended slots become `disposition=recommended`; excluded free-text is soft-block only, no rows.
  - **Future direct intake portal capture:** if still desired, excluded reviewer rows may be written directly, but that is future design and must be re-confirmed before implementation.
- Update line 29 to remove the claim that the D26 Workbench patch migrates free-text excludes into junction rows.
- Update line 33 to say excluded rows are a future/direct-intake possibility, not current Workbench behavior.

### P1 — Workbench invite workflow memory says per-user signature is not wired, but it is

File: `.claude-memory/project-reviewer-workbench-invite-workflow.md`

Problem:

- Line 38 says: "Signature is NOT yet wired per-user in the Workbench."
- Current code has wired it.

Current code:

- `pages/workbench/[requestId].js:84-100` reads `PREFERENCE_KEYS.SENDER_INFO`, parses the per-user sender preference, and resolves `settings.signature` from `sender.signature || sender.name || session.user.profileName`.
- `shared/config/reviewerFinderPreferences.js` defines `SENDER_INFO = 'reviewer_finder_sender_info'`.
- `ReviewersTab`, `CandidatesPanel`, `InviteEmailModal`, and `ReviewerManagePanel` pass/use `settings.signature`.

Why this matters:

This is a hot routed Workbench file. Claude may waste effort wiring a feature that already exists or misreport current Workbench behavior.

Recommended fix:

- Replace line 38 with the current state:
  - "Per-user Workbench invite signature is wired from `PREFERENCE_KEYS.SENDER_INFO`; fallback is sender name/profile display name."
- Update `last_verified` to a code-verified date after checking the same files above.

### P2 — Router violates its own 1-3 files per task-route rule

File: `.claude-memory/MEMORY.md`

The router itself says each line should route to 1-3 files. Six lines exceed that:

- line 34: Reviewer identity / ORCID routes to 4 files
- line 46: Dynamics CRM routes to 4 files
- line 48: Dynamics Explorer routes to 4 files
- line 57: Dev environment routes to 4 files
- line 59: Strategy / system model / roadmap routes to 4 files
- line 61: Planned capabilities routes to 7 files

Why this matters:

The new router is compact, but these rows reintroduce the old "read everything vaguely related" problem. The worst offender is planned capabilities: a single line points to seven files.

Recommended fix:

- Split those rows by intent.
- For planned capabilities, make separate rows, for example:
  - "Review pipeline / proposal extracts"
  - "Backend automation / interim reports"
  - "Post-award / IRS / new AI capabilities"
- Keep each row to no more than three links.

### P2 — Hot routes point to closed/stale memories without router warning

File: `.claude-memory/MEMORY.md`

The router includes closed/stale files in hot paths without labeling them as historical, closed, or invariant-only.

Examples:

- line 25 routes to `feedback-profile-context-runtime-bugs.md`, which is `status: closed`
- line 36 routes to three closed reviewer data-model/migration memories
- line 39 routes to `project-external-reviewer-file-access.md`, `status: closed`
- line 41 routes to `project-intake-portal-external-id-foundation.md`, `status: closed`
- line 48 routes to two closed Dynamics Explorer memories
- line 57 routes to two closed dev-environment memories
- line 59 routes to `project-app-roadmap-2026-04-25.md`, `status: stale`
- line 61 routes to `project-irs-exempt-verification.md`, `status: closed`

Why this matters:

Some closed files still contain active invariants, so the route may be reasonable. But the status semantics are now muddy: a "closed" file can still be required for active work. That undermines the new metadata layer.

Recommended fix:

Choose one convention:

- If a memory contains an active behavioral invariant, set `status: active` even if the originating work is closed.
- If a memory is only historical, keep `status: closed` and move it to the Archive route or label the router line as "historical reference."
- If a stale memory is intentionally routed, say so in the router line, e.g. "historical roadmap snapshot; cross-check current strategy."

### P2 — Metadata normalization is incomplete

47 routed files do not meet the full metadata contract from `docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md`.

Common issues:

- top-level `type/status/scope/last_verified` rather than nested `metadata:`
- missing `metadata.status`
- missing `metadata.scope`
- missing `metadata.last_verified`

This is not as dangerous as stale factual claims because every routed file has a recall rule, but it means the plan was only partially implemented.

Recommended fix:

- Normalize the highest-risk routed files first:
  - always-read guardrails
  - Reviewer Workbench / ORCID / intake files
  - Dataverse / Dynamics files
- Do not try to normalize every historical file in one giant pass unless reviewed afterward.

### P3 — Memory drift check was clean but not fully authoritative

Command:

```bash
/opt/homebrew/bin/node scripts/check-memory-drift.js --no-write
```

Result:

- PASS
- report is older than 24h
- 31 unknown claims remain

Why this matters:

The read-only gate is useful as a smoke test, but it did not regenerate `docs/RECONCILIATION_REPORT.json`, so it should not be treated as a fresh live reconciliation.

Recommended fix:

- For a final closeout after memory edits, run the non-`--no-write` reconciliation path if acceptable.
- Commit any regenerated report only if that is the established workflow for the session.

---

## Suggested Repair Order

1. Fix `project-intake-portal-reviewer-capture.md`.
2. Fix `project-reviewer-workbench-invite-workflow.md`.
3. Split overfull router rows to max three files each.
4. Decide and apply status semantics for "closed work with active invariant."
5. Normalize metadata for the highest-risk routed memories.
6. Re-run:

```bash
PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /opt/homebrew/bin/npm run check:fact-consistency
PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /opt/homebrew/bin/npm run check:doc-currency
/opt/homebrew/bin/node scripts/check-memory-drift.js --no-write
```

---

## Bottom Line

The reorganization worked structurally. The new router is much more usable than the old index.

Do not call it complete yet. Two routed active memories contain stale current-state guidance, and the router still needs a small cleanup pass so it routes Claude toward current truths rather than mixed active/closed/stale history.
