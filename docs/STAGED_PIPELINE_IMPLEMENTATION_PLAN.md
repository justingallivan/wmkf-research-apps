---
title: "Staged Proposal Review Pipeline — App Implementation Plan"
domain: prompt-executor
kind: plan
status: historical
summary: "Historical staged-proposal pipeline design, not a current architecture or approved build sequence."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/STAGED_REVIEW_PIPELINE.md
  - scripts/setup-database.js
  - _archived/shared/config/prompts/virtual-review-panel.js
  - _archived/lib/services/panel-review-service.js
---

# Staged Proposal Review Pipeline — Historical App Implementation Proposal

> **Historical proposal, not current authorization (checked against source on 2026-10-31).** The proposed `pipeline_proposals` persistence, Fit Screener, and Proposal Pipeline were not found in runtime code. This May 2026 design was dormant pending cycle redesign; the current cycle's intake and staff-triage architecture has not been approved by this document. Do not treat its migration, routes, apps, provider choices, Power Automate migration path, costs, or sequence below as current requirements. Any future work needs a fresh owner-approved scope and contract. The concept evaluator has a limited concept-PDF eligibility flag; the successor Review Panel is a separate narrative-only capability. Neither implements this staged proposal workflow.

## Context

The grant cycle is being redesigned with higher proposal volume and potentially no concept/Phase I stages. The staged review pipeline (`docs/STAGED_REVIEW_PIPELINE.md`) defines a 3-stage automated triage: fit screening → intelligence brief → virtual panel review. 

Historical strategy proposal only: interactive apps first, then consider Power Automate. No current service contract or migration decision follows from this text.

## Architecture: Two New Apps

1. **Fit Screener** — Standalone Stage 1 tool. Upload a proposal, get pass/flag/decline-recommend result. Single Haiku call, fast and cheap. Useful independently and as the pipeline's first stage.

2. **Proposal Pipeline** — Orchestration dashboard for all 3 stages. Tracks proposals through screening → intelligence → panel review, with staff decision points between stages. Stage 3 delegates to the existing `PanelReviewService` (links to `panel_reviews` table, doesn't duplicate).

(Superseded 2026-10-04: the legacy Virtual Review Panel was retired and archived. The successor Review Panel is a distinct narrative-only Workbench capability; it is not a Stage 3 implementation of this pipeline and is not connected to the proposed fit-screening or intelligence-brief stages.)

---

## Implementation Phases

### Phase 1: Database + Fit Screener

**1a. V25 migration** — `scripts/setup-database.js`

New `pipeline_proposals` table:
```sql
CREATE TABLE IF NOT EXISTS pipeline_proposals (
  id SERIAL PRIMARY KEY,
  user_profile_id INTEGER REFERENCES user_profiles(id),
  proposal_title TEXT NOT NULL,
  proposal_filename VARCHAR(255),
  proposal_text_hash VARCHAR(64),
  blob_url VARCHAR(500),
  -- Stage 1
  stage1_status VARCHAR(20) DEFAULT 'pending',
  stage1_result JSONB,
  stage1_completed_at TIMESTAMP,
  -- Stage 2
  stage2_status VARCHAR(20) DEFAULT 'pending',
  stage2_result JSONB,
  stage2_completed_at TIMESTAMP,
  -- Stage 3 (delegates to panel_reviews)
  stage3_status VARCHAR(20) DEFAULT 'pending',
  stage3_panel_review_id INTEGER REFERENCES panel_reviews(id),
  stage3_completed_at TIMESTAMP,
  -- Workflow
  current_stage VARCHAR(20) DEFAULT 'screening',
  overall_status VARCHAR(20) DEFAULT 'pending',
  staff_decision VARCHAR(20),
  staff_notes TEXT,
  staff_decided_at TIMESTAMP,
  staff_decided_by INTEGER REFERENCES user_profiles(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```
Indexes on user_profile_id, overall_status, current_stage, stage3_panel_review_id.

**1b. Fit screening prompt** — `shared/config/prompts/fit-screener.js`
- 6-item checklist: discipline fit, mission fit, institutional eligibility, PI type, completeness, budget range
- Keck mission statement injected as system context
- Returns JSON: `{ overallFlag, flags[], staffNote }`
- Routing logic: 0 flags = pass, 1-2 = flag for staff, 3+ or discipline/mission flag = decline_recommend

**1c. Pipeline service (Stage 1 methods)** — `lib/services/pipeline-service.js`
- CRUD: `createProposal`, `getProposal`, `listProposals`, `updateProposal`
- `runFitScreening(proposalId, proposalText, sendEvent)` — single Haiku call via `MultiLLMService`

**1d. Fit Screener app**
- `pages/api/fit-screener.js` — SSE streaming API, auth via `requireAppAccess`
- `pages/fit-screener.js` — FileUploader + checklist results display (pass/flag indicators per criterion)
- Register in `appRegistry.js`

### Phase 2: Intelligence Pass Refactor

Extract `_runIntelligencePass` from `PanelReviewService` (lines 449-548) into a standalone method in `PipelineService.runIntelligencePass()`. Update `PanelReviewService._runIntelligencePass` to delegate to it. This is a pure extraction — same code, same behavior, shared between both apps.

Reuses prompts from `_archived/shared/config/prompts/virtual-review-panel.js` (archived with the legacy panel 2026-10-04) (claim extraction, collation, synthesis, assembleIntelligenceBlock) unchanged.

**Test:** Run Virtual Review Panel with intelligence pass enabled, confirm identical behavior.

### Phase 3: Pipeline App (Stages 1-2)

**3a. Additional service methods:**
- `runIntelligenceBrief(proposalId, proposalText, sendEvent)` — wraps intelligence pass + formats as Intelligence Brief schema
- `recordStaffDecision(proposalId, { decision, notes, decidedBy })`
- `advanceToNextStage(proposalId)`

**3b. API routes** — `pages/api/proposal-pipeline/`
- `list.js` — GET, paginated proposal list
- `screen.js` — POST, upload + run Stage 1 (SSE)
- `brief.js` — POST, run Stage 2 on existing proposal (SSE)
- `decide.js` — POST, record staff decision
- `detail.js` — GET, full proposal detail with all stage results

**3c. Pipeline page** — `pages/proposal-pipeline.js`

Two views:
- **List view:** Table of proposals with stage indicators (3-step progress), status, staff decision, actions
- **Detail view:** Stage timeline + expandable cards per stage. Stage 1 shows checklist. Stage 2 shows intelligence brief sections (novelty, PI capability, landscape, flags). Staff decision area between stages with Advance/Hold/Decline buttons + notes.

Register in `appRegistry.js`.

### Phase 4: Stage 3 Integration

- `PipelineService.initiatePanelReview(proposalId, proposalText, providers, options)` — creates `panel_reviews` record, injects Stage 2 intelligence brief as the `intelligenceBlock`, delegates to `PanelReviewService.runFullPanel`
- `pages/api/proposal-pipeline/review.js` — POST, run Stage 3 (SSE, 600s timeout)
- Stage 3 card in pipeline page shows panel summary + links to full results

### Phase 5: Devil's Advocate + Polish

- Add Devil's Advocate pass to `PanelReviewService` — one adversarial LLM call after structured review, before synthesis. Output labeled separately in synthesis. Benefits both Virtual Review Panel and Pipeline.
- Intelligence Brief export (DOCX) using existing `docx` library

---

## Key Files

| File | Action |
|------|--------|
| `scripts/setup-database.js` | Add V25 migration |
| `shared/config/prompts/fit-screener.js` | New — screening prompt |
| `lib/services/pipeline-service.js` | New — orchestration service |
| `lib/services/panel-review-service.js` | Refactor — extract intelligence pass |
| `pages/fit-screener.js` | New — Fit Screener page |
| `pages/api/fit-screener.js` | New — Fit Screener API |
| `pages/proposal-pipeline.js` | New — Pipeline page |
| `pages/api/proposal-pipeline/*.js` | New — Pipeline API routes (5 files) |
| `shared/config/appRegistry.js` | Add 2 entries |

## Backend Migration Path

The service layer is designed for direct migration:
- Service methods accept a `sendEvent` callback (defaults to no-op for backend use)
- All state persisted in `pipeline_proposals` table (no in-memory dependencies)
- PowerAutomate triggers replace the UI "Run" buttons: status change in Dynamics → HTTP request → same service method
- Staff decision stays interactive (must remain human-in-the-loop)
- SSE streaming replaced by status polling or webhook notifications

## Verification

After each phase:
1. `npm run build` — no build errors
2. Upload a real proposal PDF through the new app
3. Verify SSE streaming shows progress
4. Verify results render correctly
5. After Phase 2 refactor: run existing Virtual Review Panel with intelligence pass, confirm no regression
