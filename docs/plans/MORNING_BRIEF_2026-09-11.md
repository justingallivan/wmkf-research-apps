---
title: "Morning brief — 2026-09-11: what shipped overnight, what is waiting, what to smoke"
status: active
owner: Justin Gallivan (decisions); Claude Fable (author)
created: 2026-09-11
---

# Morning brief — 2026-09-11

Session 504 ran late on 2026-09-10 with the owner present for the smoke tests and the
design critiques, then handed the remaining builds to Claude to finish. Everything below is
either **live in production** (merged with the owner's standing go-ahead earlier in the
evening) or an **open PR with green CI, held for the morning** because the owner asked to
walk through the changes first. Nothing was merged after that request.

## 1. Live in production (merged 2026-09-10 evening)

| PR | Change | Morning check |
|---|---|---|
| #234 | Applicant materials finalize hotfix: the slot-lease `jsonb_build_object` parameters were untyped and every PDF finalize failed with a Postgres error. Casts added; scanner failures now log a cause. | Already verified: PDF and 37 MB PPTX both landed on ZZTEST-03. |
| #233 | Drag-and-drop proposal reordering (superseded in look by #245 below; the persistence path is unchanged). | None; #245 replaces the row. |
| #235 | Admin-editable agenda email subject and message (`email.deliberation_agenda.subject` / `.body`), `{{sessionDate}}` token, blank renders blank per convention. | **Paste the two defaults** in Admin → Workflows → Messages & policies → Workflow email defaults → Internal emails → Deliberation agenda: subject `Deliberation session agenda — {{sessionDate}}`, message `Here is the agenda for our deliberation session. Each proposal's briefing page opens without a login.` Then open a session, "Send agenda…", confirm the prefill. |
| #237, #239, #240, #241 | Workflow email defaults grouped by audience, collapsed by default; both Messages & policies panels collapsible; chevron scoping fix. (All replaced in look by #242 below.) | None; #242 replaces the page. |
| #238 | Applicant materials UX pass: action button + fallback link in the invitation and reminder emails; "replace at any time until…" removed from page and email; "Choose a different file" after a failed finalize; "Need help? Email portalhelp@wmkeck.org" footer from the admin `support` recipients. | On the ZZTEST-03 visit page: "Send invitation again" → check the button email. Open the contributor link → header sentence ends at the due date; footer link present. |

## 2. Open PRs, green CI, held for your walkthrough

### PR #245 — Proposal order row redesign (Build F)
Direct answer to "the arrows don't earn their keep; everything else is too busy."
- Arrows gone. The whole left gutter is the drag handle (48×44 px, visible grip, hover plate, tooltip).
- Keyboard/screen-reader path: a position select (1…n) per row, labelled with the request number; one save for any distance.
- Row shows handle, request, title, briefing line, Minutes, Lead PD. "Move to another session…" and "Remove…" moved into a per-row ⋯ menu with inline confirms.
- Drag feedback is an inset ring (no layout jitter), Escape cancels, the saving row dims.
**Smoke:** merge, then on session `c67dbfbe-47ad-f111-aaab-000d3a361c1f`: drag row 3 to the top by its gutter; confirm the order persists and the Agenda email card shows "Schedule changed since the last agenda"; change a position select; open ⋯ → Remove… → Cancel; Tab through a row.

### PR #242 — Messages & policies refinement (Build E)
From the Impeccable critique (12/40). One disclosure system at every depth; policy slots are closed rows showing the active version; email cards have real chrome and proper labels.
- **Safe publish:** "Edit policy" opens a form prefilled from the active version; the current body collapses while editing; Publish goes through an inline confirm with the diff and "Published versions cannot be edited later."
- **Dirty state:** "Unsaved changes" chip, Save disabled when clean, "Saved · time" persists, per-card "Save all changes", navigate-away guard.
- Shared buttons/inputs with focus rings, one status chip (blank invitation defaults red because they block sends), staff-facing copy for the operator errors.
**Smoke:** merge, then Admin → Workflows → Messages & policies: two closed panels → expand Workflow policies → three closed slot rows → open one → Edit policy → form prefilled → Publish → confirm shows the diff → Back → Cancel editing. Expand Workflow email defaults → Reviewer emails → edit a field → chip + Save enabled → Save → "Saved · time". Click a slot's field-mapping ⓘ while the slot is collapsed (popover must not be clipped).

### PR #243 — Deliberation briefing content polish (Codex, reviewed) — **HOLD for two decisions**
Codex's branch passed an adversarial review with no security findings. Claude fixed the API matrix row and restored main's session prompt on the branch. The preview build cannot render a briefing link, so the visual check happens in production after merge on request 1003222.
**Decisions:**
1. Should the Board-facing Share email (distribution service) adopt "Pre-discussion" / "Research presentation materials"? It still says "Deliberation session" / "site visit materials". (The agenda email has the same drift; it is on Claude's reserved list.)
2. Should a DOCX-uploaded review show "A file review is on record; ask staff for a copy" instead of silently showing ratings only?
**Smoke after merge:** open the 1003222 briefing link (the agenda ledger has it): schedule labels, "Research presentation materials", lead PI/PD under the applicant, "Staff brief and notes" showing only `Staff Brief 1003222.docx`, a review PDF opening inline in a new tab, a DOCX review with no link.

## 3. Critique snapshots (for later polish passes)
`.impeccable/critique/2026-09-11T03-39-34Z__pages-admin-js-governance.md` (12/40, addressed by #242) and
`.impeccable/critique/2026-09-11T04-19-30Z__ts-meeting-tracker-sessioneditor-js-proposal-order.md` (20/40, addressed by #245).

## 4. Still open from the session prompt
- PR 3 for applicant materials (received counts on the deliberations tab, auto-close, reminder cron, staff signal for ambiguous replays).
- Post-merge production check of PR #218 (rail).
- Owner decisions carried: reissue during Dynamics Pending Send; release-reason `no_response` standing.
- Codex worktree `../WMKF_Apps-codex` is on `codex/ui-polish-2026-09-10` (pushed); park it after #243 lands.

## 5. Process notes worth keeping
- Sonnet build → Opus adversarial review → fixes → PR worked well; every review found at least one test that could not fail.
- Mocked SQL clients never reach the planner: memory `feedback-mocked-sql-hides-parameter-typing` records the cast + EXPLAIN habit.
- Browser tools now allow-listed in `.claude/settings.local.json`; the sessions index route does not exist (only `/meeting-tracker/sessions/<id>`).
