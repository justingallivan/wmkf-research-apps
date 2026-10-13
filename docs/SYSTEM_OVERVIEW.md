---
title: "Keck Foundation Research Tools — System Overview"
domain: architecture
kind: spec
status: active
summary: "Plain-language leadership overview of the connected grant-review workflow, supporting applications, and rollout boundaries as of October 12, 2026."
canonical: false
cataloged: 2026-07-02
last_verified: 2026-10-12
owner: product-engineering
---

# Keck Foundation Research Tools — System Overview

*Leadership briefing · October 12, 2026*

## What the suite does

The W.M. Keck Foundation's app suite gives staff a connected workspace for reviewing research proposals, coordinating expert reviews and presentations, preparing recommendations, and collecting awardee materials. It brings together grant records, documents, correspondence, and AI assistance in a browser-based system linked to the Foundation's Microsoft environment.

Since February, the suite has grown from a collection of individual tools into a more integrated grant-review workflow. Its center is the **Request Workbench**, where staff can follow a proposal from initial assessment through peer review, staff deliberation, final writeup, and leadership review.

The intended benefit is less time finding information, assembling documents, and coordinating handoffs—and more time applying staff expertise to funding decisions. AI helps research, summarize, and draft; staff remain responsible for interpretation, review, and recommendations.

## The core workflow

| Stage | What staff can do |
|---|---|
| **Understand a proposal** | Open proposal documents and grant information together; generate a field primer and draft an initial assessment; record research-integrity screening and staff review. |
| **Organize peer review** | Find potential experts, consider applicant recommendations, send invitations, provide proposal materials, track responses and completed reviews, and manage closeout. External reviewers respond through dedicated links. |
| **Prepare for discussion and presentations** | Prepare and share a pre-site briefing; schedule deliberations and research presentations in Meeting Tracker; request and collect applicant slides and biographies. |
| **Capture what was learned** | Import Zoom recordings, prepare transcripts, and draft separate summaries of the presentation and the staff discussion. Staff can review and edit these materials and read them in the browser. |
| **Prepare and review the recommendation** | Develop the working Word writeup, hand it to colleagues for group review, track their sign-offs, and send it to leadership. Dashboards show review stages and outstanding work. Research-program handoff emails and leadership digests support this process. |
| **Collect awardee materials** | Draft an award abstract and invite the awardee to review it and provide an image and caption through a dedicated portal. |

**For leadership:** review dashboards provide access to final writeups and their review status. **For Board members:** a separate presentation page brings together the approved presentation video, summary, proposal, slides, and biographies when available. Staff confirm the presentation ending and approve the video cut before it is shared; the full recording and staff-discussion materials are excluded from that page.

## Applications available to staff

Access is assigned by role and application. Some tools also appear within the Workbench.

| Application | Purpose |
|---|---|
| **Workbench** | The central workspace for a request's documents, assessment, reviewers, deliberations, writeup, and awardee materials. |
| **Meeting Tracker** | Coordinates sessions, attendees, proposal schedules, presentation materials, recordings, transcripts, and summaries. |
| **Proposal Ranking** | Supports private Program Director rankings and a facilitated shared proposal order. See rollout note below. |
| **Review Panel** | Generates independent AI reviews of a proposal narrative and a combined chair's assessment using Claude and OpenAI. This supplements human peer review. |
| **Multi-Perspective Evaluator** | Examines a concept from optimistic, skeptical, and neutral viewpoints. |
| **Funding Analysis** | Examines federal funding evidence from NSF, NIH, and USAspending to inform funding-gap analysis. |
| **Summarize Peer Reviews** | Draws out themes in reviewer feedback and helps prepare questions for the research presentation. |
| **Applicant Integrity Screener** | Brings together potential concerns from retraction records, PubPeer, and news for staff assessment. |
| **WMKF Expertise** | Helps match proposals to the expertise of staff, consultants, and Board members. |
| **Grant Reporting** | Helps staff extract and review grantee reports, compare achievements with proposed goals, and prepare a Word report. |
| **Dynamics Explorer** | Lets staff ask questions about grant-management records in plain language and export results. |
| **Dataverse Bulk Export** | Produces structured Excel extracts of grant-request data with the selection criteria documented. |
| **Literature Analyzer** | Analyzes research papers and synthesizes their findings. |
| **Expense Reporter** | Extracts and organizes information from receipts and invoices for export. |

## How the pieces fit together

**Microsoft Dynamics 365 / Dataverse** holds shared grant and reviewer records. **SharePoint** holds proposal files and working documents. The apps connect these records with staff workflows, Microsoft email, Zoom recordings, and external research sources. They add capabilities around the existing grant-management environment; they have not replaced it in full.

Staff sign in with their Microsoft accounts. Application permissions and workflow rules control access and actions; external reviewers, applicants, awardees, and Board recipients use purpose-specific portals or links. AI services are selected for the task, including Claude and OpenAI for analysis and AssemblyAI for transcription. Administrators can maintain supported prompts, models, and email wording without a software release.

## Current delivery boundaries

- **Proposal Ranking has an agreed redesign awaiting implementation.** The [October 7 release receipt](audits/PROPOSAL_RANKING_PRODUCTION_RELEASE_2026-10-07.md) records activation and initial access checks; it did not establish a complete multi-person ranking and publication exercise. Source reviewed October 13 still implements separate MR/SE submission and publication. The [owner-agreed October 13 workflow](plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md) adds A/B/C assessment and confidence, a combined ranking from each PD, facilitator reveal when everyone is ready, and one collective recommendation with discussion sentiment and institutional history as context. That workflow is planned, not implemented; this update changes documentation only and does not reverify live deployment state.
- **New recording and Board-sharing features have been tested on selected requests.** Import, transcription, summaries, and an approved video cut have passed those checks. Broader day-to-day use will provide further feedback; staff checking and approval remain part of the workflow.
- **Automation is selective.** Some functions are limited to configured programs or cycles. Automatic reviewer reminder emails remain on hold, and honorarium payment processing remains an offline operations task.
- **A full applicant-intake replacement is parked.** The suite should not be presented as a completed replacement for GOApply or AkoyaGO.

*Basis: current main-branch source and recorded release/acceptance evidence reviewed October 12, 2026. The Proposal Ranking boundary was updated October 13 against source and owner decisions; the other sections retain their October 12 basis. This replaces the February overview. Supporting verification and remaining limits are recorded in the [editorial evidence note](audits/SYSTEM_OVERVIEW_REFRESH_2026-10-12.md).*
