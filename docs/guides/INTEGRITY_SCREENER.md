# Integrity Screener Guide

Screen grant applicants for research integrity concerns using multiple data sources and AI analysis.

**Source status (2026-11-02):** The accuracy changes below are built on `codex/integrity-screening-discussion` and are not deployed. Managed monthly refresh is also source-built, disabled and unscheduled; no production dataset was updated. See [refresh operating guide](RETRACTION_WATCH_REFRESH.md).

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
- **Name evidence** — what matched, with identity explicitly unverified
- **Source summaries** — PubPeer and news searches can include AI-written summaries for that source
- **Individual matches** — expandable details for each hit

#### Understanding name evidence

- **Exact name match**, **Initials match**, and **Name variant** describe name compatibility only; identity remains unverified.
- **Possible namesake** identifies an ambiguous candidate. Identical names alone do not establish the person.
- Explicit conflicting given/middle names are excluded. An absent middle name or different current institution alone is not an exclusion.
- Older runs say **Earlier matching rules · identity not established**; their saved results and decisions are unchanged.
- Paper-wide affiliation is not proof of affiliation for the matched author. A correction or retraction alone does not establish misconduct.
- PubPeer results must be HTTPS links on the accepted PubPeer hosts. Off-domain, mixed-domain, malformed, failed or unsearched sources are incomplete, never a clean search. A successful empty indexed search is not a direct search of PubPeer's complete database.

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
- PDF, JSON, and Markdown exports include name evidence, source errors, and available summaries. Human-readable exports omit identity percentages. JSON describes any retained numeric confidence as a heuristic similarity score, never an identity probability
- Dismissal records are not included because the current dismissal UI is not
  persistently wired

## Important Caveats

- **Name ambiguity** — Common names may produce false positives. Always review matches carefully before drawing conclusions.
- **Coverage gaps** — Not all retractions or concerns appear in these databases. A clean screening does not guarantee no issues exist.
- **Context matters** — A retraction doesn't necessarily indicate misconduct. Papers can be retracted for honest errors, journal issues, or administrative reasons. Read the retraction notice.
- **Timeliness** — Retraction Watch uses the locally imported dataset. Its current freshness is unverified; managed monthly refresh is source-built but remains disabled pending migration, initial publication approval and separate schedule activation. Indexed PubPeer results and news can also have coverage gaps.
- **Use as a starting point** — Screening results should inform further investigation, not serve as a final determination.
