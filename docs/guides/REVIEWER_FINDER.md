# Reviewer Finder Guide

> **Note (2026-05-19):** Saved candidates write directly to Dataverse (`wmkf_potentialreviewer` — incl. bibliometrics since the S213 collapse — + `wmkf_appreviewersuggestion`). Per-proposal picker and a "My Proposals" PD-filtered view are also available in the app. The "Database" tab and its underlying Postgres researcher pool were **retired in W6 (2026-05-12)** — researcher data now lives in Dataverse alongside the rest of reviewer state. The walkthrough below describes the user-facing flow; for the underlying data model see `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`.

Find qualified peer reviewers for grant proposals using AI analysis combined with academic database verification.

## Overview

The Reviewer Finder has two tabs:

| Tab | Purpose |
|-----|---------|
| **Find Reviewers** | Upload a proposal, run AI analysis, and discover candidates |
| **My Candidates** | View and manage saved reviewers, generate invitation emails |

## Step-by-Step: Finding Reviewers

### 1. Upload a Proposal

- Click **Upload PDF** or drag and drop a proposal document
- The system extracts metadata: title, abstract, PI name, institution, and co-investigators

### 2. Run Discovery

- Click **Find Reviewers** to start the search
- Claude AI analyzes the proposal and suggests reviewer candidates
- Each suggestion is verified against real academic databases (PubMed, ArXiv, BioRxiv, ChemRxiv)
- Results appear as candidate cards with publication counts, h-index, and relevance scores

### 3. Review Candidates

Each candidate card shows:
- **Name and affiliation** with a Google Scholar **search** link (name+institution pre-filled; not a deep profile link)
- **Expertise keywords** extracted from their publications
- **Relevance reasoning** — why this person is a good match
- **Warning badges** — institution overlap with the PI, or other potential conflicts

### 4. Save Candidates

- Check the box on candidates you want to keep
- Click **Save Selected** to store them in My Candidates
- Saved candidates persist in the database and are linked to the proposal

## My Candidates Tab

This tab shows all saved reviewers grouped by proposal. From here you can:

- **Edit** a candidate's contact info or notes
- **Delete** candidates you no longer need
- **Enrich Contacts** — run automated email/website lookup for candidates missing contact info
- **Generate Emails** — create invitation .eml files for selected candidates

### Enriching Contacts

Select candidates and click **Enrich Contacts** to search for their email addresses through a tiered lookup (free tiers first, paid tiers only on opt-in):
1. Existing database records / an email embedded in the affiliation string
2. PubMed author affiliations (free)
3. ORCID profiles (free)
4. Claude web search (paid — opt-in)
5. SerpAPI Google search (paid — opt-in)

### Generating Invitation Emails

1. Select candidates with email addresses
2. Click **Email Selected**
3. Choose whether to use Claude AI personalization (adds a paragraph referencing the reviewer's expertise)
4. Click **Generate** to create .eml files
5. Download the files and open them in your email client

> **Note:** .eml files open as received messages. To send, either **Forward** the message (removing "Fwd:" from the subject) or copy the content into a new email.

## Settings

Click the **gear icon** to configure:

### Grant Cycle
- **Program Name** — e.g., "W. M. Keck Foundation"
- **Review Deadline** — date shown in invitation emails
- **Summary Pages** — which page(s) to extract from proposals (default: page 2)
- **Custom Fields** — additional dates used in email templates (proposal due date, send date, etc.)

### Attachments
- **Review Template** — PDF or Word file included with invitation emails
- **Additional Attachments** — other files to include

### Sender Info
- **Your Name and Email** — appears in the email "From" field
- **Signature Block** — appended to each email

### Email Template
- Customize the subject line and body using template placeholders
- Common placeholders: `{{greeting}}`, `{{proposalTitle}}`, `{{piName}}`, `{{reviewDeadline}}`, `{{signature}}`
- See the full placeholder list in the template editor

## Tips

- Run discovery with different temperature settings (0.3 = focused, 1.0 = creative) to get diverse candidate pools
- Use the **Re-extract** button in My Candidates if you need to change which summary pages are extracted
- Settings are saved per user profile — switching profiles loads that profile's settings
