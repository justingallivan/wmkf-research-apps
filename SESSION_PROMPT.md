# Session 680 Prompt: Connor prompt delivery — one consolidated resume point

## Session 679 summary — coordinated Codex stop, 2026-11-16

Read [the consolidated handoff](docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md)
first. It combines **Contracts for PA flows** and **Clarify PA prompt test purpose**.
The implementation chat led closeout; the discovery chat supplied its read-only
packet and is idle. Resume this work in one session, not two parallel chats.

**Owner direction:** deliver prompts in Dataverse usable by Connor's existing
Power Automate flows. Backend integration is stopped/parked. Submit/poll adoption,
worker scheduling and backend rollout are NOT next steps. Justin has requested an
example prompt from Connor; response pending. Preserve existing work and receipts.

### Completed

- Executive Summary staff editor deployed from `1037d2dbd`; Production test on
  1003518 passed and original blank restored. It stays deployed.
- Separate bounded Sandbox backend trial on 1000389 passed one generation, audit,
  field publication and replay. Original blank restored; replay did not refill it.
  Backend remains on `codex/executive-summary-generation-2026-11-16`, with
  runtime `ac7cac093` / `6d6a7c724`, receipt `8e98afb03`. No runtime promotion.
- Other chat audited Production prompt rows read-only: Short Title v2, Summary v2,
  Methodology v2, PD-match v1. The handoff distinguishes published rows from
  compatibility with Connor's actual flow and preserves the workbook requirements.
- Stop changes are documentation only. Claim-evidence reports unavailable; no
  observation invented. Milestone: return to prompt delivery, backend parked.

### Next items

- **Verified open:** when Connor's example arrives, compare its fields, source input,
  substitution, model/settings and output parsing against the worksheet baseline.
  Produce one gap checklist, beginning with Short Title and Executive Summary.
- **Owner decisions needed:** Methodology length; missing prompt content, controlled
  lists/rubrics, unassigned destinations and versioned storage. See handoff.
- **Parked:** backend adoption/scheduling/rollout; no new AI calls or prompt
  publication authorized by closeout. No new prompt drafts created during stop.
- **Approved cleanup (Session 680):** batch 1 ran Nov 17 (200, `succeeded`).
  Batch 2 is due after Nov 23 18:32 UTC: refresh the Preview OIDC token, then run the
  parked runner's new `expire` mode once. Exact commands are in the handoff's
  preservation section. Fixture removal is not approved; receipts stay.
- **Verify before acting:** relevant current prompt versions/consumers.
- **Do not reopen without owner decision:** replacing Connor's existing runner,
  requiring staff-edit flags, or merging the broad backend branch into main.

### Preservation and other streams

Full prior multi-stream handoff is retrievable with
`git show 57eb7c40f:SESSION_PROMPT.md` (verified at stop). It preserves prior
constraints, decisions, fixtures and local-only evidence; historical observations
are not fresh permission or live state. No other workstream resumed here.

| Stream | Owner / resume source | Boundary |
|---|---|---|
| J27 Workbench | Claude Session 678; prior handoff Stream A and `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Production line retained; intake checks, owner-led bibliography discussion and post-intake cleanup require current verification |
| Expertise roster | Codex; prior handoff Stream B and branch's own latest notes | Do not resume from the older November 9 handoff alone; Production release not authorized |
| J27 Factory / reports | Prior handoff Other streams | Preserve worktrees, fixtures, private exports and branches; no cleanup here |
| Prompt/backend historical trials | Parked Summary branch and its live-trial receipt | Retain code/receipts and exact cleanup scope; no scheduler or production enablement |

Main `.env.local` may target Production; never infer Sandbox isolation from a
Preview/worktree. Do not touch other streams' dirty files, migrations, fixture
records, aliases or settings. `/private/tmp` paths are volatile; code travels via
Git, private credentials and evidence do not.

### Key files and verification

- `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md`: sole current prompt resume point.
- `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md`: deployed staff editor evidence.
- Parked branch `docs/plans/PA_EXECUTIVE_SUMMARY_LIVE_TRIAL_2026-11-16.md`: bounded
  backend test, exact pins and retention obligations.

Earlier implementation verification: 853 distinct local tests, scoped gates/build;
PDF correction 44 focused tests plus types/lint, independent review and hosted build.
Those are backend evidence, not proof that Connor needs this architecture. Stop
verification is scoped documentation/secret checks, with no new model or cloud writes.
