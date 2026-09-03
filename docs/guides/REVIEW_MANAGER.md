# Review Manager Guide

> **Note (updated 2026-09-02):** Reviewer email sends go directly through Dynamics CRM and appear as activities on the request. Reviewers use a secure magic link to read materials and complete the structured review form. The current staff workflow deliberately separates materials release, reviewer reminders, automated thank-yous, and the combined staff export rather than presenting one generic action.

Manage the peer review lifecycle from sending materials through collecting completed reviews.

## Overview

The Review Manager picks up where the Reviewer Finder leaves off. Once reviewers have accepted an invitation, the Review Manager helps you:

1. **Send review materials** (proposal documents, review templates)
2. **Track reviewer status** through a pipeline
3. **Send reminders** to reviewers who haven't responded
4. **Confirm automated thank-yous** after reviews are submitted
5. **Enter a review manually** when a reviewer cannot use the portal
6. **Export submitted reviews** as one combined Word document

## Getting Started

### Select a Grant Cycle and Proposal

1. Choose a **Grant Cycle** from the dropdown at the top
2. Select a **Proposal** — the list shows proposals that have accepted reviewers in that cycle
3. The reviewer list loads with each reviewer's current status

## Status Pipeline

Each reviewer moves through these statuses:

| Status | Meaning |
|--------|---------|
| **Accepted** | Reviewer agreed to review — ready to send materials |
| **Materials Sent** | Review materials have been emailed to the reviewer |
| **Review Received** | The completed review has been uploaded |
| **Reminded** | A reminder email was sent |
| **Thanked** | A thank-you email was sent after receiving the review |

Track Reviewers and Reviews expose only the actions valid for the row's current status.

## Sending Materials

1. In **Track Reviewers**, optionally select one or more reviewers with **Accepted** status. Reviewers in other states do not have selection boxes.
2. Click **Release proposal to reviewers**. With no selection, the action targets all accepted reviewers.
3. Review the personalized materials messages and any configured attachments.
4. Confirm the release. Dynamics sends each message and the reviewer receives a fresh secure portal link.

## Sending Reminders

1. Find a reviewer with **Materials Sent** or **Under Review** who has not submitted.
2. Click **Send reminder** on that reviewer row.
3. Confirm or edit the available preview, then send. The dedicated route rechecks eligibility and records the reminder before attempting delivery.

## Sending Thank-You Emails

Thank-yous are sent by the daily fire-once sweep after `Review Received`. There is no separate batch **Send Thanks** action in Track Reviewers. The thank-you includes a courtesy Word copy of the review when that attachment can be produced.

## Exporting Submitted Reviews

When at least one review has been submitted, use **Export Word** on the Reviews
tab to download one combined, template-formatted document. The server rereads
the proposal and submitted reviews from Dataverse before rendering; the browser
does not supply the document content. The export is a download and is not filed
to SharePoint in the current release.

## Entering a Review Manually

When a reviewer cannot use the portal:

1. Open the proposal's **Reviews** tab.
2. Find the reviewer in **Outstanding reviews**.
3. Click **Enter review manually**.
4. Complete the same current question set used by the reviewer portal and submit it.
5. The structured answers and receipt status are recorded together.

## Notes and URLs

Each reviewer card has:
- A **Notes** field — add reminders, track communications, note conflicts
- A **URL** field — link to an external resource (e.g., a shared document)

Changes save automatically when you click outside the field.

## Tips

- The email templates use the same settings configured in the Reviewer Finder (sender info, signature, grant cycle details)
- Use the notes field to track phone calls, special arrangements, or deadline extensions
- Select only the accepted reviewers who should receive materials now; leave all boxes clear to release to every accepted reviewer.
