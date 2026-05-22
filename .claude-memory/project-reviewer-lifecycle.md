---
name: Reviewer Lifecycle Automation Plan
description: Phased plan for automating the full reviewer lifecycle — from discovery through review filing. Pain is distributed across all stages.
type: project
---

Reviewer lifecycle has 8 stages. Current state: discovery is well-automated (Reviewer Finder), everything else has significant manual friction.

**Phases agreed upon (Session 87, 2026-03-13):**
- **Phase A:** CRM email send (invitations, materials, reminders, thank-yous via Dynamics). Foundation for everything else.
- **Phase B:** Status dashboard + one-click reminders for overdue reviewers
- **Phase C:** Review intake + auto-filing to SharePoint (needs `Sites.ReadWrite.Selected` permission)
- **Phase D:** Schema cleanup (declined_at, normalize invited/accepted/declined booleans, responded_at)

**Key pain points (all roughly equal):**
- Invitation send + tracking (friction of .eml → Outlook → send)
- Response tracking (accepted/declined/ghosted is manual)
- Reminders (done manually this cycle, tedious)
- Filing reviews to SharePoint (lots of mouse-clicking to get files in correct folders)
- Making reviews visible to Dynamics (requires human or PowerAutomate)

**Reviewer Portal concept (agreed Session 87, 2026-03-14):**
- Token-based, time-limited link for each accepted reviewer (e.g., `/review/[token]`)
- No login required — token IS the auth, scoped to one assignment
- Reviewer sees: proposal abstract, downloadable forms (review template, COI), upload zones for completed review + COI + billing info
- Uploads auto-route to correct SharePoint folder; DB updated on receipt
- Collapses multiple email round-trips into self-service

**Monitoring approach:**
- Option 2 (dashboard-driven, human in the loop) first, with Option 1 (cron monitoring) as backbone
- Build with intent to move to Option 3 (Dynamics event-driven triggers via PowerAutomate) later
- Cron flags overdue items → dashboard surfaces them → user decides action
- APIs should be stateless/callable without browser session for future PowerAutomate integration

**Multi-program flexibility:**
- Multiple grant programs: Research (S&E, Medical Research), SoCal, special programs
- Workflows differ significantly across programs — different steps, forms, number of reviewers, approval processes
- SoCal is more high-touch; staff less technically savvy — dashboard UX must be simple
- Current focus is Research programs, but architecture must not require rebuilding for other programs
- Solution: workflow steps should be data-driven per grant cycle (JSONB config), not hardcoded
- Phase A (CRM send) is program-agnostic by design — no Research-specific assumptions

**Timeline/deadline model:**
- Grant cycles define default deadlines (live source of truth is Dataverse `wmkf_appgrantcycle.wmkf_reviewreturndeadline` post-W3 cutover 2026-05-12; historical Postgres `grant_cycles.review_deadline` was 0% populated and is drain-only)
- Per-reviewer extensions needed → `wmkf_appreviewersuggestion` should have its own `review_due_date` (defaults to cycle deadline, overridable)
- Grant cycle calendar is pre-defined (Science programs + SoCal program)

**Staff roles and access model:**
- **Program Director (PD):** Scientific lead — picks reviewers, writes summaries, collates reviews, makes recommendations
- **Program Coordinator (PC):** Administrative — sends materials, tracks deadlines, collects forms, files documents
- **Other staff / management:** Need visibility into all proposals but don't typically act on others' assignments
- Access model: **don't restrict, filter the default view** (mirrors AkoyaGO). Everyone can see everything; dashboards show "my proposals" by default.
- Historical `reviewer_suggestions.user_profile_id` (Postgres, now drain-only) was single-user scoped; current Dataverse `wmkf_appreviewersuggestion` has the same single-user model (PD scope) — the cycle/proposal/role assignment expansion is still open as a design item but now operates against `wmkf_appreviewersuggestion`
- Future: `cycle_assignments` table mapping user → cycle/proposal → role (director, coordinator)

**Invitation management:**
- Minimum 3 reviews per proposal (can vary). Often invite more since not everyone accepts.
- Tension: paying reviewers now, so can't cast too wide a net (risk of too many accepting)
- Dashboard must show invitation funnel: target vs invited vs accepted vs pending vs declined
- Need graceful "un-invite" if over-subscribed
- Referral pipeline: declining reviewers often suggest alternates; capturing referral-source on suggested alternates is an unbuilt need. (A prior note pinned this to an "Add Researcher modal" at `reviewer-finder.js:2802`; that line/modal no longer resolves — current reviewer-finder modals are Enrichment/EmailGenerator/EditCandidate/Settings, i.e. **edit existing** candidates; no add/create-from-scratch reviewer UI was found. Do NOT assume a manual-entry surface exists — re-verify the entry path before building referral tracking on it. Don't re-pin design notes to line numbers.)

**Review process details:**
- Reviews are fully independent (no panel discussion, no inter-reviewer visibility)
- Materials standardized per cycle (not per reviewer)
- COI: two-stage — automated pre-invitation screening (built), formal self-declaration post-acceptance (future portal)
- Reminder cadence: configurable per staff with defaults, manual override. Different staff have different practices.
- Post-review downstream steps (synthesis, board prep, notification) — scope later. Peer Review Summarizer handles synthesis.

**Conversational workflow triggers:**
- Dynamics Explorer (or purpose-built chatbot) could gain reviewer-lifecycle tools
- Natural language queries: "Are all reviews in for 1002266?" → query `wmkf_appreviewersuggestion`
- Action triggers: "Send a reminder to Dr. Smith" → invoke CRM send
- Existing agentic tool-use pattern in chat.js supports this — just add new tools
- Another reason CRM send must be in a shared, stateless helper (callable from UI or chatbot)

**Why:** User wants personal touch (customizable templates, not raw form emails) but with automation removing the repetitive file-management and send steps.

**How to apply:** Each feature touching reviewer emails should be designed with the full lifecycle in mind. CRM send is always the foundation. APIs should be designed to be callable by PowerAutomate in the future (stateless, token-authenticated).
