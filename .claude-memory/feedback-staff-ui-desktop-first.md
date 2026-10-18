---
name: feedback-staff-ui-desktop-first
description: Staff app is in-office desktop software; prioritize desktop UX, phones are a pinch-only fallback
metadata:
  type: feedback
  status: active
---

## Recall Rule
Read before designing, auditing, or reviewing staff-facing pages and responsive
layouts. Optimize the staff experience at desktop width; keep phone widths usable
for occasional fallback use. Applicant and reviewer portals have separate users
and are outside this preference.

Staff surfaces (Workbench, Meeting Tracker, admin, tools) are used in the office on desktops. Design, critique, review, and verify them at desktop width; narrow/phone widths only need to remain usable in a pinch.

**Historical owner decision (2026-10-05):** after the app-wide UX audit and shell PR #446 spent effort on mobile captures and a mobile-menu finding: "We should not be optimizing for phones. This is an in office app... it's the desktop experience that should be prioritized."

**How to apply:** Don't spend audit/verification rounds on mobile screenshots or let narrow-width concerns drive staff layouts; fix a phone-width defect only when it breaks basic use. External applicant/reviewer portals are a separate audience — this rule does not cover them. Codified in DESIGN.md Page Structure ("Desktop first"). Related: [[feedback-staff-ui-never-shows-internal-ids]].
