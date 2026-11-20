---
title: Power Automate Intake Sweep — 2026-11-20
summary: "Mode B sweep reconciling docs, memory, Atlas and wiki to Connor's Research intake flow map; 57 fields verified in Production metadata, flows not visible to the app identity."
canonical: false
owner: product-engineering
last_verified: 2026-11-20
---
Status: point-in-time evidence report. Repo baseline: main @ 73d5ee531 (map added);
reconciliation committed on top.

## Scope

- **Mode:** B (domain truth audit), triggered by Connor's intake field map.
- **Domain:** Research intake Power Automate flows (steps 0–7): what runs, what it
  writes, where, in what format, and the app's dependencies on it.
- **Canonical output:** `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md`.
- **Durable surfaces searched:** every `docs/**`, `.claude-memory/**`, `docs/atlas/**`,
  `docs/agent-wiki/**`, `CLAUDE.md`, rules and skills file matching 28 terms (flow
  names, stage fields, intake file names, step-3 field names, prompt names, keyword
  table): 196 files; plus code comments in `lib/`, `pages/`, `shared/`, `scripts/`,
  `modules/`.
- **Excluded:** `docs/archive/`, `docs/audits/` (historical), `SESSION_PROMPT.md`
  (rewritten at session close), `docs/DOCS_CATALOG.md` (generated).

## Authoritative evidence

1. Connor's map, 2026-11-20 (owner-supplied): flow behavior, status labels.
   Reported, not probed.
2. Owner-approved, read-only Production metadata reads through the interlocked
   client (`lib/dataverse/client` with an explicit prod-read flag), no row data:
   - attribute existence, type and options for 57 named fields across six tables;
   - Memo `MaxLength` for 15 text fields;
   - lookup targets for 4 fields;
   - cloud-flow (workflow category 5) names and on/off state.
3. Source reads for app-side claims (cited inline in the map's section 9).

## Evidence matrix

| Claim | Producer | Persistence | Consumer | Strongest evidence | Status |
|---|---|---|---|---|---|
| Steps 1–2 live; 3 planned; 5 built not live; 6–7 planned | PA flows (Connor) | n/a | staff, app readers | Connor's report; the three named flows are **not visible** to the app identity (0 matches; broader name search found only unrelated Sales/GOapply flows) | ASSUMED (Connor-reported); flow existence UNKNOWN to us |
| Stage relay `wmkf_ingeststage` / `wmkf_ingesterror` | PA steps 1–3 | `akoya_goapplystatustracking` | PA | Fields exist; 7 options match (labels "Document done", "AI Review …") | VERIFIED (schema) / ASSUMED (behavior) |
| Step 1 request, personnel, reviewer, CRO writes | PA step 1 | `akoya_request`, `contact`, `wmkf_apprequestperson`, `wmkf_potentialreviewers`, `wmkf_appreviewersuggestion`, `account` | app reviewer/person readers | All named fields exist; role picklist has 3 extra values | VERIFIED (schema) / ASSUMED (behavior) |
| J27 Program field not set | PA step 1 | `akoya_programid` (exists) | app membership readers | Connor's list omits it; matches the blank-Program test request (owner-authorized probe, 2026-11-19) | ASSUMED, consistent |
| Step-3 targets, types, lengths | PA step 3 (planned) | `akoya_request` | Workbench, briefings, lists | All exist; lengths match the map (2,000 / 10,000 / 100,000) | VERIFIED (schema) / PLANNED (writer) |
| Compliance advisory; acceptance manual | step 3 / coordinator | `wmkf_ai_compliancecheck`, `wmkf_ai_complianceissues`, `akoya_submissionaccepted` | coordinator; step 5 trigger | Options verified; manual acceptance Connor-reported; conflicts with v3 spec | VERIFIED (schema) / CONFLICT (v3 spec, now annotated) |
| `wmkf_ai_run` PA tagging | PA | `wmkf_ai_run` | app run views | runsource/tasktype values exist (extra values present) | VERIFIED (schema) / ASSUMED (behavior) |
| Keyword table, MR/SE bucket | Connor (seed); step 3 (coined) | `wmkf_programlevel3` | app keyword sections | `wmkf_keywordinternalprogram` → `akoya_program`; 247 seeded rows (other docs say 259 total / 247 active) | VERIFIED (schema) / UNKNOWN (row counts, fill rate) |
| Staff version, Narrative-Bibliography, derived files in `Submission-Documents` | PA step 5 (built) | SharePoint | Workbench Proposal tab, Reviewer Finder | App matcher accepts the keyword name (`workbench-proposal-documents.js:212-228`) | PARTIAL (app side verified; files not yet produced) |
| `wmkf_readyforreview` is manual | staff | `akoya_request` | Workbench discovery, Reviewer Finder, readiness | App gates 2027+ visibility on it (`workbenchVisibility.js:74`, `requestReadiness.js:17`, `my-proposals-service.js:153`); app writes it only for Factory test requests (`readiness-finalizer.js:113`) | VERIFIED (app gate) / owner-confirmed manual (2026-11-20); app comment and older plans that assume PA sets it are stale |

Claims: 10. Each row is graded on two axes: the field schema and the flow behaviour.
- Schema: 7 VERIFIED.
- Flow behaviour (Connor-reported): 5 ASSUMED.
- Other grades: 1 PARTIAL, 1 PLANNED, 1 CONFLICT (the v3 compliance spec, now annotated), 2 UNKNOWN (flow existence, keyword-table row counts).
- The ready-for-review row was a CONFLICT when written. Later the same day the owner confirmed the flag is a deliberate manual gate that staff withhold from non-compliant applications. Only the app code comment is now stale.

## Restatement classification

Four delegated passes over disjoint file sets, followed by a session review of the scope (`git status` matches the assignments) and of sample diffs:

| Group | Files | Edited (STALE or omission fixed) | Notes |
|---|---|---|---|
| Top-level docs A–I | 52 | 16 | 21 UNRELATED; the rest AGREE/HISTORICAL |
| Top-level docs J–Z | 38 | 10 | 17 UNRELATED |
| `docs/plans` + security audit | 45 | 17 | 31 UNRELATED/HISTORICAL |
| Memory, Atlas, wiki | 60 | 17 | ~20 UNRELATED; dated pilot leaves HISTORICAL |

Session follow-ups:
- **Atlas keyword fields:** the length is corrected to 10,000 (verified).
- **J27 register Q9:** the title-cron note now records its dependency on step 3.
- **File contract:** the claim about the Expertise Finder batch match is corrected; that feature was retired.
- **Promotion status:** five "J27 line, not promoted" statements about the Proposal tab are corrected (`0dcd87f5c` is an ancestor of `origin/main`).
- **Ready-for-review:** the conflict is added to the map.

Structural fixes are described in the agents' reports. They added pointers and
rewrote rows; they did not add banners above contradictory text, except one-line
dated notes in dated records.

## Re-run searches

Run over `docs/**` and `.claude-memory/**`, excluding archive and audits:

| Pattern | Live hits remaining |
|---|---|
| "Narrative-Bibliography … not yet created/built" | 0 |
| PA "sets/owns" `wmkf_readyforreview` | 0 |
| "JSON array, 4000)" | 0 |
| "not yet shipped" | 0 |
| "J27 line … not promoted" (map scope) | 0 |
| "only applicant originals" | Only lines that now state the correction |

**Gates:** each gate and its self-test passed, run one after another: docs-catalog, doc-currency, fact-consistency, canonical-pointers, doc-symbol-refs, build-claim-freshness, agent-wiki, memory-router, atlas, j27-register, drain-table-mentions, prompt-storage-mentions, harness-framing, secret-scan, scaffolding-tokens.

These gates check structure and pointers, not the truth of the flow facts.

## Disconfirming checks

| Conclusion tested | Check | Result |
|---|---|---|
| "Fields exist" | Listed every attribute per table and diffed the named set | 57/57 present; 0 missing |
| "Flows are live" | Searched visible category-5 flows by exact name, then by substring | No match. Not falsified, not confirmed: the flows are invisible to the app identity |
| "App does not set ready-for-review" | Grepped `lib/`, `shared/`, `pages/`, `scripts/` for writers | Only the Factory finalizer |

## Remaining

**Live STALE: 1.** `shared/config/requestReadiness.js:3` comment ("Power Automate owns
real-intake `wmkf_readyforreview`"). The owner has since confirmed the flag is set manually
by staff (2026-11-20). **Fixed the same day** in PR #665 (merge `996ba8187`); live STALE is now 0.

**Out of scope, noted:**
- Alignment log D64–D67 still say "Built on `claude/j27-cycle-page`, not promoted". Those features are cycle-page work, not intake.
- `docs/CURRENT_WORK_QUEUE.md` says the Factory has no J27 `Submission-Documents` support, but `lib/services/test-requests/file-plan.js:23-30` has it.

**Open questions:** for Connor, see map section 10 (seven items, ordered by urgency; the most urgent is the staff-version file on re-run).

**Step-3 limits:** the handoffs differ from the map in 12 places. Group 3 listed them; the owner reviews them and they were not reconciled.

**Verdict:** CLAIM NOT RECONCILED. Every durable doc in scope is reconciled. One
code comment is pending an owner decision, and flow existence is not independently
verifiable from the app identity.
