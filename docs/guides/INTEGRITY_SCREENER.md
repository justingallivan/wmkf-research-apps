# Integrity Screener Guide

Screen grant applicants for research integrity concerns using multiple data sources and AI analysis.

## Overview

The Integrity Screener searches for retractions, corrections, and integrity-related news for a list of applicant names. It combines database lookups with AI-powered analysis to surface potential concerns.

## Data Sources

| Source | What It Searches | Coverage |
|--------|-----------------|----------|
| **Retraction Watch** | Locally loaded Retraction Watch records | Retraction records and reasons present in the current database |
| **PubPeer** | Post-publication peer review comments | Community-flagged concerns about published papers |
| **News Search** | Google News via SerpAPI | Media coverage of research misconduct |

## Running a Screening

### 1. Enter Applicant Names

- Type or paste applicant names, one per line
- The system accepts various formats: "First Last", "Last, First", etc.
- You can screen multiple applicants in a single batch

### 2. Start Screening

- Click **Screen Applicants**
- Results stream in as each source is checked
- Progress indicators show which sources have been queried

### 3. Review Results

Each applicant gets a results card showing:

- **Match count** per source (Retraction Watch, PubPeer, News)
- **Confidence level** — how closely the match aligns with the applicant's name
- **Source summaries** — PubPeer and news searches can include AI-written summaries for that source
- **Individual matches** — expandable details for each hit

#### Understanding Confidence Levels

- **High** — Exact or near-exact name match with strong corroborating evidence
- **Medium** — Partial name match or common name with some supporting context
- **Low** — Weak match that may be a different person with the same name

### 4. Record False Positives

The current results page displays a **Dismiss** action, but that UI is not yet
connected to durable dismissal storage or future-screen suppression. Treat it as
a placeholder and record adjudication outside the screener until the workflow is
completed.

## Screening History

Completed screenings can be saved by the service, and authenticated history APIs
exist, but the current page does **not** provide a History tab. Do not rely on the
application UI to retrieve earlier runs.

## Exporting Results

- Click **Export** to download screening results
- PDF, JSON, and Markdown exports include the current run's matches, confidence
  values, and available PubPeer/news summaries
- Dismissal records are not included because the current dismissal UI is not
  persistently wired

## Important Caveats

- **Name ambiguity** — Common names may produce false positives. Always review matches carefully before drawing conclusions.
- **Coverage gaps** — Not all retractions or concerns appear in these databases. A clean screening does not guarantee no issues exist.
- **Context matters** — A retraction doesn't necessarily indicate misconduct. Papers can be retracted for honest errors, journal issues, or administrative reasons. Read the retraction notice.
- **Timeliness** — Retraction Watch and PubPeer are updated regularly but may lag behind recent events. News search provides the most current coverage.
- **Use as a starting point** — Screening results should inform further investigation, not serve as a final determination.
