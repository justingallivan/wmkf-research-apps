# Reviewer Finder Documentation

The Reviewer Finder is the flagship application for finding and contacting expert reviewers for grant proposals.

## Overview

Complete pipeline for finding and contacting expert reviewers:

1. **Claude Analysis** - Extract proposal metadata (title, abstract, PI, institution) and suggest reviewers
2. **Database Discovery** - Search 4 academic databases: PubMed, ArXiv, BioRxiv, ChemRxiv
3. **Contact Enrichment** - 5-tier system to find email addresses and faculty pages
4. **Email Generation** - Create .eml invitation files with optional AI personalization

## Key Features

- Institution/expertise mismatch warnings
- Google Scholar profile links for all candidates
- PI/author self-suggestion prevention
- Claude retry logic with Haiku fallback on rate limits
- Temperature control (0.3-1.0) and configurable reviewer count
- Save candidates to database with edit capability
- Multi-select operations (save, delete, email)

---

## Email Generation Workflow

### Setup (Before First Grant Cycle)

1. **Click the gear icon** next to the tab navigation to open Settings
2. **Configure Grant Cycle settings:**
   - Program Name (e.g., "W. M. Keck Foundation")
   - Review Deadline
   - Summary Pages - which page(s) to extract from proposals (default: "2")
   - Custom date fields (Proposal Due Date, Send Date, Commit Date, Honorarium)
3. **Upload Review Template** in Attachments section (PDF or Word document)
4. **Configure Sender Info:**
   - Your Name
   - Your Email
   - Signature block
5. **Customize Email Template** (optional - default is Keck Foundation format)

### Email Generation Process

1. **Upload Proposal** - Summary page(s) are automatically extracted based on settings
2. **Find Reviewers** - Run discovery to find candidates
3. **Enrich Contacts** - Get email addresses for selected candidates
4. **Save Candidates** - Store to My Candidates with summary attachment link
5. **Generate Emails:**
   - Select candidates in My Candidates tab
   - Click "Email Selected"
   - Review options (Claude personalization available)
   - Click Generate → Download .eml files
   - Open in email client and send

### Re-extracting Summaries

If you need to change which pages are extracted:
1. Update "Summary Pages" in Settings → Grant Cycle
2. Go to My Candidates tab
3. Click "Re-extract" or "Extract Summary" button on the proposal card
4. Upload the proposal PDF again
5. New summary will be extracted using updated settings

---

## Template Placeholders

Available placeholders for email templates:

| Placeholder | Description |
|-------------|-------------|
| `{{greeting}}` | "Dear Dr. LastName" |
| `{{recipientName}}` | Full name without honorific |
| `{{recipientFirstName}}` | First name |
| `{{recipientLastName}}` | Last name |
| `{{salutation}}` | "Dr." or detected honorific |
| `{{recipientAffiliation}}` | Institution |
| `{{proposalTitle}}` | Proposal title |
| `{{piName}}` | Principal Investigator name |
| `{{piInstitution}}` | PI institution |
| `{{coInvestigators}}` | Co-PI names (comma-separated) |
| `{{coInvestigatorCount}}` | Number of Co-PIs |
| `{{investigatorTeam}}` | Formatted PI + Co-PIs (e.g., "the PI Dr. Smith and 2 co-investigators...") |
| `{{investigatorVerb}}` | "was" (singular PI) or "were" (PI + Co-PIs) for verb agreement |
| `{{programName}}` | From Grant Cycle settings |
| `{{reviewDeadline}}` | Formatted deadline date |
| `{{signature}}` | Sender signature block |
| `{{customField:fieldName}}` | Custom field from Grant Cycle |

---

## Email Attachments

Each generated email can include:
- **Review Template** - Uploaded via Settings → Attachments
- **Project Summary** - Auto-extracted from proposal during analysis
- **Additional Attachments** - Optional files uploaded via Settings → Attachments

Attachments are encoded in MIME multipart/mixed format, compatible with all major email clients.

---

## Email Workflow Note

Generated .eml files open as "received" messages in email clients. To send:
1. Open the .eml file
2. **Forward** to the recipient and remove "Fwd:" from the subject line, OR
3. Copy the email content into a new message

This is a limitation of the .eml format - it's designed for message import/export, not drafts.

---

## Settings Storage

Reviewer Finder settings are stored per-profile in Dataverse (`wmkf_appuserpreferences`, via the `database-service.js` dispatcher) when a profile is selected, with localStorage fallback when no profile is active. (The Postgres `user_preferences` table was retired 2026-05-12 — see Behavior below.)

**Settings stored per-profile:**

| Setting | Preference Key | Description |
|---------|---------------|-------------|
| Sender Info | `reviewer_finder_sender_info` | Name, email, signature |
| Grant Cycle Settings | `reviewer_finder_grant_cycle_settings` | Program name, deadline, attachments, summary pages |
| Email Template | `reviewer_finder_email_template` | Custom email subject and body |
| Current Cycle ID | `reviewer_finder_current_cycle_id` | Active grant cycle selection |

**Behavior:**
- When a user profile is active, settings are saved to Dataverse `wmkf_appuserpreferences` (via the `database-service.js` dispatcher; Wave 1 retired the Postgres `user_preferences` table 2026-05-12)
- When no profile is active, settings fall back to localStorage (base64 encoded)
- On first profile selection, localStorage data auto-migrates to profile preferences
- Profile switching loads that profile's saved settings

**Key Files:**
- `shared/config/reviewerFinderPreferences.js` - Preference key constants
- `shared/components/SettingsModal.js` - Main settings UI with dual storage
- `shared/components/EmailTemplateEditor.js` - Template editor with dual storage
- `shared/components/EmailGeneratorModal.js` - Loads settings from profile/localStorage

---

## ~~Database Tab~~ (RETIRED 2026-05-12, W6 step 1)

The Database tab and its Postgres-backed researcher CRUD (`pages/api/reviewer-finder/researchers.js` + the `researchers` / `researcher_keywords` Postgres tables) were retired in W6 of the Postgres→Dataverse migration. The UI is now a two-tab interface (Find Reviewers + My Candidates); saved-candidate state lives in Dataverse `wmkf_appresearcher` / `wmkf_potentialreviewer` / `wmkf_appreviewersuggestion`. An `add-candidate-manual` endpoint that replaces the in-place Add Researcher flow is spec'd as post-pilot work — see `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`.

---

## Future: Direct Email Sending

When this app is integrated with a CRM or email service, consider implementing direct email sending:

**Email Service Options:**
- SendGrid, AWS SES, Mailgun, Postmark

**CRM Integration:**
- Salesforce, HubSpot, or custom CRM APIs

**Benefits:**
- Skip the .eml workflow
- Send directly from the app with tracking

**Requirements:**
- SMTP credentials or API keys
- Sender verification
- Bounce handling

**Privacy:**
- Consider data handling implications when sending through third-party services

---

## Future: Microsoft Dynamics 365 Integration

The organization uses Microsoft Dynamics, making **Dynamics 365 Customer Insights - Journeys** the preferred future integration for email sending and tracking.

### How Dynamics Email Tracking Works

- Embeds a unique, transparent 1x1 tracking pixel in each email
- When recipient opens and loads images, the open is registered
- Tracks: opens, clicks, forwards, bounces, spam reports, unsubscribes

### Available Metrics from Dynamics

| Metric | Description |
|--------|-------------|
| Delivery rate | Successfully delivered vs. bounced |
| Open rate | Recipients who opened the email |
| Click rate | Recipients who clicked links |
| Click-to-open rate | Clicks relative to opens |
| Spam reports | Marked as spam count |
| Unsubscribes | Opt-out count |

### Integration Architecture

1. **Send emails via Dynamics** instead of generating .eml files
2. **Webhook endpoint** - Dynamics POSTs open/click events to this app
3. **Update tracking fields** - Populate `email_opened_at`, `response_type`, etc. automatically
4. **Dataverse API** - Query email interaction data programmatically

### Database Field Ready

Tracking-field equivalents (`wmkf_emailopenedat`, `wmkf_responsetype`, etc.) live on Dataverse `wmkf_appreviewersuggestion`, available for future webhook population. The legacy Postgres `reviewer_suggestions.email_opened_at` field is drain-only post-W3-W6.

### Limitations to Consider

- Apple Mail Privacy Protection (iOS 15+) auto-loads images, inflating open rates
- Privacy blockers increasingly prevent tracking pixels
- Data retention: 12 months for insights views, 2 years for Dataverse entities

### Resources

- [Email insights - Dynamics 365 Customer Insights](https://learn.microsoft.com/en-us/dynamics365/customer-insights/journeys/email-insights)
- [Use webhooks in Dynamics 365](https://learn.microsoft.com/en-us/dynamics365/customerengagement/on-premises/developer/use-webhooks)
- [Dataverse API reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview)
