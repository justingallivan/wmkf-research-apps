---
title: "Reviewer Interaction Design — Brief"
domain: reviewer-workbench
kind: spec
status: active
summary: Audience for downstream artifacts: Program Directors. Management is not the primary audience.
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - pages/api/review-manager/render-emails.js
---

# Reviewer Interaction Design — Brief

**Status:** Design brief, pre-build. Captures decisions from a Session 133 design conversation. Scope is the full reviewer journey for external Phase II reviewers, from invitation through post-submission. The artifact is intended as the seed for a PD-facing read-ahead document and slide deck for a staff feedback meeting.

**Date:** 2026-05-05

**Audience for downstream artifacts:** Program Directors. Management is not the primary audience.

---

## 1. Why now

The system today is split between manual operation and partial automation. The current Phase II cycle is months away, and the upcoming one-phase redesign will land soon after. We want to design and stress-test the reviewer-facing wiring before it's needed in production, get colleague feedback while there is still time to incorporate it, and bring temporary PDs (planned for upcoming cycles) onto a tool that is intuitive enough not to require training.

What is already built:

- Magic-link token primitive for external reviewers, including post-submission window extension
- Reviewer materials access (the `Reviewer_Downloads/` folder enforcement)
- Reviewer self-upload of a review file
- A four-field structured-review schema (`affiliation`, `impact`, `risk`, `overallRating`) — defined but not surfaced in any UI
- The Review Manager staff app, including draft-emails-with-cycle-variables capability

What is not built:

- Accept/decline as system events (currently inferred manually)
- Decline reason and referral capture
- Policy acknowledgments (COI, AI use)
- Contact-info confirmation flow
- The actual structured-review form (UI surface)
- Calendar invitation flow
- Automated reminder cadence
- "We're full" pending-invite cancellation
- Post-submit confirmation, read-only window, and reviewer-history capture

This brief covers the design for those gaps as a single coherent journey.

---

## 2. Design rails

These are through-lines that bias every other decision and should hold across all stages.

- **Partial adoption is binary and invisible.** PDs use the system or they do not. Non-adoption produces no data and no triggers; the tool does not silently track activity it was never told about. We will not build comparative dashboards that surface "who is using the system."
- **Defaults must work without configuration.** A temporary PD who never touches their profile should still get a coherent flow.
- **Avoid jargon in the UI.** Internal terms (over-invite buffer, potentialreviewer slot, withdrawn-sufficient) do not leak into staff-facing or reviewer-facing copy.
- **Discoverability over training.** Configuration lives one click from where it is needed, not in a separate admin surface.
- **The implicit competitor is AkoyaGO.** Friction reduction is the lever — staff should pick our tool because it is easier than the alternative for the same outcome.
- **Reviewer history is automatic.** It emerges from invitation and submission timestamps. We do not ask reviewers about future willingness or capture optional profiling.

---

## 3. The journey

The reviewer's experience runs across six stages. Stages 2a and 2b are the same URL with state changes separated by a multi-week (or, in the future cycle, shorter) gap.

### Stage 1 — Invitation email

Sent by the PD via the Review Manager. The current draft-emails-with-cycle-variables capability is the foundation; we are extending it.

**Email content:**

- Personalized to the proposal: PI, co-investigators, applicant institution, abstract preview in the body
- Optional PDF attachment with the abstract
- Cycle-level variables: due date, honorarium amount
- A single line setting expectation that they will confirm contact details on the next page
- Magic link to Stage 2a

**Per-PD template:**

- Each PD has a template stored in their profile (Dataverse-backed via `dataverse-prefs-service.js`)
- On first use, the profile is seeded from the current draft email
- Variables (due date, honorarium, etc.) have profile-level defaults the PD can override (e.g., a PD who wants reviews back earlier than the cycle deadline edits their default)
- Per-invitation overrides remain possible at compose time

**Accept/decline buttons in the email:**

- Optional per PD. Some PDs prefer one-click accept/decline links in the email; others prefer email-reply communications.
- Toggle lives in the PD profile.
- When buttons are used, clicking either fires a workflow: status flip on the potentialreviewer row with timestamp, and a thank-you-for-accepting or polite-acknowledgment-of-decline email back to the reviewer.

### Stage 2a — Landing page (pre-materials)

The reviewer clicks the magic link. They see one page with several stacked elements; this page does **not** show the full proposal materials.

**Order on page:**

1. **Proposal summary card** (read-only): project title, PI, co-investigators, applicant institution, abstract. Institution is essential — it is the COI-relevant fact.
2. **Confirm your contact info** (pre-filled from Dynamics): name (with display preference), title, affiliation, email, ORCID. No phone field. Editable inline; saving writes directly to the Dynamics contact record with an audit trail (timestamp, before/after, source = "reviewer self-confirmed at invitation"). Field-length and character validation enforced before write to prevent buffer issues.
3. **Honorarium opt-out** (single checkbox): "I'd prefer to decline the honorarium." Default unchecked. Captured at this stage so staff can plan.
4. **Two policy acknowledgments** (stacked separate cards, both required to accept):
   - **Confidentiality / COI policy** — read and acknowledge
   - **AI use policy** — read and acknowledge (text already exists in the current reviewer form footer)
5. **Accept** and **Decline** buttons.

**Behavior:**

- Decline does not require contact confirmation or policy acknowledgment.
- Accept requires both acknowledgments.
- On accept, the reviewer is redirected to the post-accept confirmation screen; status flips and accept-confirmation workflow fires.
- On decline, the reviewer is redirected to the decline page (see Stage 3).

**Policy storage and acknowledgment tracking:**

- Policy text lives in a new Dataverse entity (working name `wmkf_policy`: code, version, title, body, effective_date)
- Acknowledgments tracked in a new Dataverse entity (working name `wmkf_reviewer_acknowledgment`: potentialreviewer ref, policy ref, version stamp, timestamp, optional captured-data JSON for future policy types)
- Designed to support N policies (1..N), not hardcoded to two — a future honorarium policy with embedded form fields fits the same shape
- Policies do not change mid-cycle; no re-acknowledgment design needed

### Stage 3 — Accept and decline as events

**Accept confirmation screen** (terminal page, browser-close-friendly):

- "Thank you. You're confirmed as a reviewer for [proposal]."
- "We expect materials around [date]. You'll receive an email when they're available."
- "Two calendar invites are attached / on the way."
- "You can return to this page any time using the original link."
- Optional: PD name and email for questions.

**Calendar invites** sent at accept time:

- Two separate single-event ICS attachments
- One for expected materials-delivery date
- One for due date
- Magic link embedded in invite description (and possibly location field)
- ICS `UID`s tracked on the potentialreviewer row so reschedule messages (`METHOD:REQUEST` with incremented `SEQUENCE`) can be sent if either date shifts

**Decline page:**

- Field order: **referral first, reason second** (referral is most useful)
- **Referral**: single freeform textbox. Aspiring to capture name + institution + email cleanly is unrealistic in practice; we accept loose text and ensure it is searchable.
- **Reason**: single-select with structured options (Too busy / COI / Outside expertise / Bad timing / Other) plus optional free-text. Optional, not required.
- Submit-without-answering allowed; any decline is recorded.
- Decline confirmation copy: "Thanks. We hope we can call on you in the future."
- Decline triggers: status flip, polite-acknowledgment email back to reviewer, and — if a referral was supplied — an automated email to the PD with a deep link to the "add reviewer to database" page in our app, pre-filled with the reviewer's referral text. Referrals are never auto-invitations; staff vet and decide.

**Reversibility:**

- Reversible-via-link (clicking the other button flips state) until materials are downloaded
- Staff-override only after that point

**Status state machine on `wmkf_potentialreviewer`:**

- `Invited` → `Accepted` (timestamp)
- `Invited` → `Declined` (timestamp, reason, referral text)
- `Invited` → `No Response` (treatment described below)
- `Accepted` → `Submitted` (later, at Stage 5)
- `Invited` or `Accepted` → `Withdrawn-Sufficient` (when a PD calls off pending invitations because they have enough confirmed reviewers; see below)

### Stage 4 — Working window (between materials and submission)

**Materials notification:**

When materials become available, the reviewer is notified via a fresh email containing a NEW secure link. **The link is NOT stable across the journey** (corrected 2026-06-21 to match the code): the send path (`pages/api/review-manager/render-emails.js`) re-mints the JWT and overwrites the stored hash on every email that contains `{{externalLink}}`, so any earlier link (the original invitation, a prior reminder) **stops verifying** once a newer email goes out — "the email body becomes the canonical link." The backend still resolves the same engagement (the `wmkf_appreviewersuggestion` row) regardless of which token is presented, and flips the page from Stage 2a to Stage 2b state — but reviewers must use the link in the **most recent** email. (Any future calendar-invite feature must therefore embed the link from whichever email is current, not a one-time URL.)

**Stage 2b landing page** (same URL, materials-available state):

- Same proposal summary card
- Full materials list, downloadable
- Review form (Stage 5)
- Submission

**Drafts:**

- Auto-save on every field blur (no save button; Google-Docs style)
- Same magic link works across multiple sessions and devices
- Refresh-on-load is fine; drafts saved server-side

**Reminder cadence:**

- Per-staff preference, default = "nudge all"
- Default cadence: T-7 days, T-2 days, T+0 (overdue gentle nudge)
- Each reminder individually disable-able by the PD
- Opt-out entirely is supported per-PD

**"We're full" cancellation:**

- A PD-initiated action that closes pending invitations when enough reviewers have accepted
- Sends a polite "thank you, no longer needed" email to all pending invitees
- Status flipped to `Withdrawn-Sufficient`
- Distinct from `Declined` and `No Response` — preserves the data quality of those states
- Different PD styles will produce very different over-invitation patterns. The system accommodates rather than standardizes.

**In-page guidance during the review:**

- No inline tooltips or "what makes a good review" panels on the submission form itself
- Guidance and rubric framing live in **reviewer instructions delivered with materials**, not on the form
- By submission time, the reviewer has done the work; the form should not ambush them with new framing

**Withdrawal during the review window:**

- Self-service withdrawal not exposed
- "Contact the PD" is the path — the rare case warrants a human conversation

### Stage 5 — Submission form

The form is structurally derived from the current Word reviewer form (which has been in use for ~18 months). The form's content is subject to staff feedback in a dedicated meeting; this brief locks in the **mechanics**, not the question wording.

**Structured ratings (always on the page, radio buttons, single-select enforced by UI):**

- **Impact** (4-point): Little to no / Disciplinary publications / Broad publications / Rewrite textbooks
- **Risk** (4-point): Low / Medium / High / Impossible (with fatal-flaw note)
- **Overall rating** (5-point): Excellent / Very Good / Good / Fair / Poor

Rating menus solve the multi-check problem the current Word form has. Each rating has a paired narrative companion field for nuance ("specific impacts foreseen," "what are the risks") so reviewers can express judgment without breaking categorical data.

**Narrative questions (8):**

1. Specific significant impacts foreseen
2. Risk details (technical vs. hypothesis vs. scope-overreach)
3. Methods, data gathering, and analysis appropriateness
4. Questions or issues to raise with the PI before an award
5. Personnel and infrastructure adequacy
6. **Fundability elsewhere** — would a traditional funding agency support this? (WMK-distinctive; retained.)
7. Budget issues
8. Anything else (optional)

**Narrative collection — reviewer choice:**

- Inline textboxes on the page **OR**
- Word document upload (single attachment containing all narrative answers)

The reviewer picks the path that fits their workflow. Senior reviewers who have already drafted in Word use upload; others type inline. Either path produces a complete review.

**No AI extraction at MVP.** Uploads are stored as attachments; downstream consumers either read the file or work with the structured ratings only. AI extraction with human-in-the-loop confirmation at submit time is **documented as a future feature** (Phase 2 of this work) but is not built initially. The HITL pattern: reviewer uploads, system parses, reviewer confirms or edits the parsed result before final submit. This eliminates silent miscategorization risk.

**Reviewer identity at submission:**

- Pre-filled from confirmed Stage 2a data (name, title, affiliation)
- No re-entry required

### Stage 6 — Post-submit

**Confirmation screen:**

- "Thank you. Your review has been received."
- "[PD name] will review your assessment along with others. We'll be in touch if any clarification is needed."
- Honorarium-relevant copy if not opted out
- No reciprocal "would you like to review again?" prompt — reviewer history captures participation automatically

**Post-submit access:**

- Brief read-only window using the existing `extendForPostSubmissionWindow` token primitive
- Reviewer can re-read what they submitted; cannot edit
- Lockout follows after the window closes
- Default window length: TBD with staff (suggest 7 days)

**Outcome notification:**

- **None.** Reviewers are not informed whether the proposal was funded. Funding decisions sometimes turn on portfolio balance rather than the science itself, and surfacing outcomes risks misinterpretation. This matches WMK convention.

**Reviewer history capture:**

- Participation metadata (completed, when) emerges automatically from existing invitation and submission timestamps
- No additional profiling
- Reviewer Finder consumes this naturally for "has this person reviewed for us before?" queries
- No "willing to review again" capture, no quality scoring, no PD post-cycle annotations beyond what staff already do informally

---

## 4. Cross-cutting concerns

### Data model additions (Dataverse)

Three new entities, designed to be flexible:

- **`wmkf_policy`** — code (e.g., `coi`, `ai-use`, `honorarium`), version, title, body (rich text), effective_date, status. Editable by non-technical staff; same pattern as `wmkf_ai_prompt`.
- **`wmkf_reviewer_acknowledgment`** — potentialreviewer ref, policy ref, version stamp, timestamp, optional captured-data JSON (extensible for future policy types that capture data alongside acknowledgment).
- **State fields on `wmkf_potentialreviewer`** — additional status states (`Withdrawn-Sufficient`), decline reason, decline referral text, ICS `UID`s for calendar invite reschedules, accepted_at / declined_at / submitted_at timestamps.

### Staff parity (Review Manager UI)

For PDs who prefer email replies over in-email accept/decline buttons, the Review Manager must offer **one-click status update affordances** on the reviewer row that fire the same workflow as button clicks (timestamp, status flip, thank-you/ack email back to reviewer). Inline on the row, no modal, single click with optional reason. The implicit competitor here is AkoyaGO; if updating status in our app is harder than in AkoyaGO, PDs will use AkoyaGO and the data benefits are lost.

### Admin view

A general state-of-affairs view at the cycle level — totals, slot fill rates, in-flight invitations. **No PD-comparative metrics, no leaderboards.** The tool serves PDs, not management surveillance.

### Future features (documented, not built)

- AI extraction of uploaded narrative content with HITL confirmation at submit time (Phase 2 of submission form work)
- Honorarium acknowledgment with embedded form fields (W-9 status, payment method preferences) — fits the same `wmkf_policy` + `wmkf_reviewer_acknowledgment` pattern; capture point likely Stage 2a
- One-phase cycle redesign — collapses the gap between Stage 2a and Stage 2b but does not eliminate it (COI still gates materials access)

---

## 5. Open questions for staff feedback

These are deliberately left open for the staff meeting:

- Is the current set of 8 narrative questions still pulling weight? Is there one to drop, one to add, one to rephrase?
- What read-only window length feels right post-submission?
- Are there policy texts beyond COI and AI use that should be acknowledged at invitation time?
- Are there PD-specific workflow needs we haven't captured (specific decline-reason categories, custom reminder cadences) that should be configurable rather than fixed?
- Is the optional-reason / required-referral-textbox structure on the decline page right, or should reason move ahead of referral for some staff workflows?

---

## 6. Appendix — current reviewer form (reference)

The current form, used for ~18 months, is the basis for Stage 5. Fields, in the order they appear:

| # | Field | Type |
|---|---|---|
| 1 | Applicant Institution | Auto-fill |
| 2 | Project Title | Auto-fill |
| 3 | Referee Name, Title & Organization | Manual entry |
| 4 | Impact rating | Single-select (4-point) |
| 5 | Specific significant impacts foreseen | Free text |
| 6 | Risk rating | Single-select (4-point) |
| 7 | Risk details | Free text |
| 8 | Methods/data/analysis appropriateness | Free text |
| 9 | Questions for PI before award | Free text |
| 10 | Personnel & infrastructure | Free text |
| 11 | Fundability elsewhere | Free text |
| 12 | Budget issues | Free text |
| 13 | Overall rating | Single-select (5-point) |
| 14 | Anything else (optional) | Free text |

The form footer contains the confidentiality and AI-use statement that becomes the AI policy acknowledgment text in the new flow.
