---
name: Intake portal as a chance to capture machine-legible structured data
description: New portal forms should split structured content (budgets, rosters, milestones) out of narrative text, so downstream AI tools don't have to re-extract from PDFs
type: project
originSessionId: 05e61454-b0c9-4b62-a30f-89e979b3157b
---
The new applicant intake portal is a strategic opportunity to capture
machine-legible structured data instead of stuffing everything into narrative
free-text fields like GOapply does.

**Why:** GOapply pushes structured content (budget tables, co-PI rosters,
milestone lists, prior-support disclosures) into narrative form fields or
uploaded PDFs. Every downstream AI tool we've built (reviewer matching,
integrity screening, intelligence brief, retrospective analysis) then has to
re-extract that structure from prose or PDF — adds latency, cost, and
extraction-error risk. If the portal captures it as structured rows from day
one, every downstream tool gets it free.

**How to apply:** When designing a form with Sarah and Connor, the question
to ask isn't "what fields does GOapply have here?" — it's "what's the most
structured representation we can extract from the applicant without making
the form annoying?" Examples:

- Budget — structured table (year × category × amount), not a narrative
  paragraph or an XLSX upload
- Co-PI roster — structured rows (name, affiliation, role, % effort), not a
  free-text "Personnel" field
- Milestones / timeline — structured rows (date, deliverable), not a prose
  timeline
- Prior support — structured rows (funder, amount, dates, role), not a free-
  text "Other support" section

Attachments stay as files when they're naturally documents (CV/biosketch,
letters of support, full budget justification narrative). Structured content
that's currently inside narrative or spreadsheets should become real fields.

This compounds with the broader strategic direction (Dynamics as ground truth
long-term — `project_strategy_direction.md`).

**Note:** Sarah is a Foundation colleague who has form wishlists for this
work; Connor is also a stakeholder. Their input shapes the field inventory
per phase.
