---
title: "Reviewer Lifecycle Automation — Historical Staff Proposal"
domain: reviewer-workbench
kind: plan
status: historical
summary: "Historical staff-facing proposal retained for product rationale; current implementation and remaining work are documented in the linked Workbench plans."
canonical: false
cataloged: 2026-07-02
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md
  - docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md
  - docs/CURRENT_WORK_QUEUE.md
  - lib/services/review-upload.js
  - docs/atlas/dataverse-akoya-request.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
---

# Reviewer Lifecycle Automation — Historical Staff Proposal

> **Historical product proposal.** This document preserves the staff-facing
> workflow vision and its 2026-05-08 status snapshot. It is not a current
> implementation contract or source of truth. Use
> `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` for the Reviews-tab boundary,
> `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md` for the external-reviewer flow, and
> `docs/CURRENT_WORK_QUEUE.md` for remaining work. In particular, automatic
> synthesis readiness is not implemented: the target is “all reviews are in,”
> while participating invitation states remain undecided.

## Historical status snapshot (2026-05-08)

Originally written as a forward-looking proposal; large parts have shipped. Quick reality check:

| Phase | Status |
|---|---|
| **A. CRM email sending** | **SHIPPED** — `/api/review-manager/send-emails` sends through Dynamics; emails appear on the request as activities with audit trail |
| **B. Dashboard + smart reminders** | Partial — Review Manager surfaces invitation status; bulk-reminder UX still pending |
| **C. Reviewer portal** | **SHIPPED (external-reviewer surface)** — magic-link `/external/review/[token]/*` endpoints live; reviewer can view proposal, upload review/COI; auto-files to SharePoint `Reviewer_Uploads/`. Billing-info collection still pending. See `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md`. |
| **D. SharePoint auto-filing** | **SHIPPED** — `lib/services/review-upload.js writeReviewFiles` is the canonical write path for both staff and reviewer-self uploads |
| **E. Conversational interface** | Not started — Review Manager-specific chat UI deferred; Dynamics Explorer covers some of this for ad-hoc queries |

Sections below describe the original vision; treat the *future-tense* phrasing as historical and refer to the table above for what's live. Detail on what Phase A/C/D actually look like in production lives in:

- `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md` (token primitive, magic-link landing, SharePoint upload flow)
- `docs/atlas/dataverse-akoya-request.md` and `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` (data model)

---

## What This Document Is

We're planning to automate much of the reviewer management workflow that currently involves manual email sending, file management, and tracking. This document describes what we're proposing, how it would work, and what changes staff would see. We'd like your feedback before we start building.

---

## The Problem

Managing peer reviewers today involves a lot of manual steps:

- **Sending emails** requires downloading files, opening them in Outlook, and sending individually
- **Tracking responses** (who accepted, who declined, who hasn't responded) is done manually
- **Sending reminders** to late reviewers is a manual process with no system support
- **Collecting completed reviews** means receiving them via email, downloading, and filing to the correct SharePoint folder
- **Collecting COI forms and billing information** requires separate email exchanges

Each step is small, but across dozens of reviewers and multiple proposals per cycle, the cumulative effort is significant. Things can fall through the cracks, and staff spend time on logistics rather than substance.

---

## What We're Proposing

We plan to build this in phases, starting with the simplest and most impactful change first.

### Phase A: Send Emails Through the CRM (First Priority)

**What changes:** Instead of downloading email files and opening them in Outlook, you'll be able to send reviewer emails directly from the app. Emails will be sent through our Dynamics 365 CRM, which means:

- Emails appear in the CRM record for each proposal (audit trail)
- The system knows exactly when an email was sent (not just when it was generated)
- You still write and customize the email before sending — it's not a faceless form letter
- You can still download the email file and send manually if you prefer (both options available)

This applies to all email types: invitations, materials, reminders, and thank-yous.

**What stays the same:** You still choose which reviewers to email. You still edit the template. The personal touch remains — the system just handles the sending and record-keeping.

### Phase B: Dashboard and Smart Reminders

**What changes:** The Review Manager becomes a command center for each grant cycle. At a glance, you'd see:

- How many reviewers you've invited, how many accepted, how many are pending
- Whether you've hit your target number of reviews for each proposal
- Which reviewers are overdue (materials sent but no review returned)
- Suggested actions: "3 reviewers are 2 weeks past deadline — send reminder?"

Reminders would be one-click: select the overdue reviewers, review the reminder message, and send. The system would flag items that need attention based on configurable timing (e.g., "remind after 14 days" — adjustable per staff member).

**What stays the same:** You decide when and whether to send reminders. The system suggests; you act.

### Phase C: Reviewer Portal

**What changes:** Instead of multiple email exchanges to collect documents from reviewers, each accepted reviewer would receive a link to a simple, temporary web page. On this page, they can:

- View the proposal abstract and download the full proposal
- Download forms (review template, COI form)
- Upload their completed review
- Upload their signed COI form
- Provide billing/payment information

Uploaded files would automatically be routed to the correct locations (SharePoint folders, database records). You'd see in your dashboard when each item has been submitted.

**What stays the same:** The invitation and acceptance process. The portal is for document exchange after a reviewer has already agreed to review.

**Important:** Reviewers would not need to create an account or log in. The link itself serves as secure, time-limited access to only their specific assignment. They cannot see other proposals, other reviewers, or any internal data.

### Phase D: Review Filing Automation

**What changes:** When reviews come in (either through the portal or uploaded by staff), they would automatically be filed to the correct SharePoint folder with the proper naming convention. No more dragging files between folders.

### Phase E: Conversational Interface

**What changes:** Staff could ask the system questions in natural language, similar to our existing Dynamics Explorer chatbot:

- "Are all reviews in for proposal 1002266?"
- "Who hasn't responded to their invitation yet?"
- "Send a reminder to Dr. Smith about her review"

This would be especially useful for quick status checks without navigating through multiple screens.

---

## How This Affects Different Roles

### Program Directors

- **Invitations:** Choose reviewers from the candidate list, customize the email, click send. System tracks who was invited and when.
- **Monitoring:** Dashboard shows reviewer coverage per proposal. See at a glance whether you need to invite more candidates.
- **Reviews:** Get notified when reviews come in. All reviews for your proposals are in one place.
- **Synthesis:** When all reviews are in, feed them directly into the Peer Review Summarizer (already built).

### Program Coordinators

- **Materials:** Send proposal packages to accepted reviewers with one click. System attaches the right documents automatically.
- **Reminders:** Dashboard shows who's overdue. Send reminders individually or in bulk.
- **Document collection:** Portal handles COI forms, reviews, and billing info. Dashboard shows what's been received and what's missing.
- **Filing:** Documents auto-file to SharePoint. No more manual folder management.

### Management

- **Visibility:** See the status of all active grant cycles and proposals. No need to ask staff for updates.
- **Default view shows your assignments, but you can browse everything.**

---

## Flexibility Across Programs

While we're building this with the Research programs (Science & Engineering, Medical Research) in mind first, the system is designed to work for all programs:

- **Grant cycle configuration** defines what steps are required, what forms to use, and what deadlines apply
- **Different programs can have different workflows** without requiring system changes
- **SoCal and special programs** can be added when ready, using the same tools with different configurations

---

## What We Need From You

1. **Does this workflow match how you actually work?** Are there steps we're missing or getting wrong?
2. **What would make the biggest difference for you?** If you could automate one thing first, what would it be?
3. **Are there edge cases we should know about?** Unusual situations that come up during reviewer management?
4. **For the reviewer portal:** Would reviewers be comfortable using a web link instead of email attachments? Any concerns?

---

## Workflow Overview

The diagram below shows the full reviewer lifecycle. Items marked with a star are currently manual steps that would be automated.

```
                           REVIEWER LIFECYCLE
                           ==================

    DISCOVERY                    INVITATION                   RESPONSE
    =========                    ==========                   ========

 Upload Proposal          Select Candidates             Reviewer Responds
       |                        |                             |
       v                        v                             v
  AI Finds Candidates     Customize Email            +--------+--------+
       |                        |                    |        |        |
       v                        v                    v        v        v
  COI Screening           Send via CRM *          Accept   Decline   No Response
       |                        |                    |        |        |
       v                        v                    |        v        v
  Save Candidates         Track Send Date *          |   Log Referral  Auto-Remind *
  (+ Manual Adds)         Update Status *            |   Suggestions     after N days
                                                     |        |
                                                     v        v
                                                Enter Referral
                                                into Pipeline *

          |                                          |
          |   +--------------------------------------+
          |   |
          v   v

       MATERIALS                  REVIEW                    CLOSING
       =========                  ======                    =======

   Send Proposal +           Reviewer Works         All Reviews In?
   Forms via CRM *                |                       |
        |                         v                       v
        v                   Upload to Portal *      Notify Staff *
   Track Materials               |                       |
   Sent Date *                   v                       v
        |                   Auto-File to            Synthesize Reviews
        v                   SharePoint *            (Peer Review Summarizer)
   Send Reminders *              |                       |
   (if overdue)                  v                       v
        |                   Update Dashboard *      Send Thank-You
        v                   (review received)       via CRM *
   COI Form via                                          |
   Portal *                                              v
        |                                           Process Payment
        v                                           (Bill.com)
   Billing Info
   via Portal *


   * = Currently manual, proposed for automation

   Legend:
   - "via CRM" = Email sent through Dynamics 365 (with audit trail)
   - "via Portal" = Reviewer uses a secure, temporary web link
   - "Auto-File" = Documents routed to correct SharePoint folder automatically
```

---

## Implementation Timeline

We plan to build this incrementally:

| Phase | What | Impact |
|-------|------|--------|
| **A** | CRM email sending | Eliminates manual email file workflow. Creates audit trail. |
| **B** | Dashboard + reminders | Gives staff a clear picture of status. One-click reminders. |
| **C** | Reviewer portal | Eliminates multi-email document exchange. Auto-filing. |
| **D** | SharePoint auto-filing | Eliminates manual file management. |
| **E** | Conversational interface | Quick status checks and actions via natural language. |

Each phase builds on the previous one. Phase A is the foundation — once emails flow through the CRM, everything else becomes possible.

---

*Please share any feedback, questions, or concerns. Your input will directly shape what we build.*
