# Keck Foundation Research Tools — System Overview

*February 2026 | v1.0*

## What This System Does

This is a suite of web-based tools built for the W.M. Keck Foundation staff. The tools use AI to automate time-intensive research administration tasks: evaluating grant proposals, finding expert peer reviewers, screening applicants for research integrity, analyzing funding landscapes, and querying CRM data in plain English. Staff access the tools through a web browser — no software installation required.

## Application Suite

| Application | What It Does |
|-------------|-------------|
| Multi-Perspective Evaluator | Evaluates proposals from three independent viewpoints and synthesizes a consensus |
| Batch Phase I Summaries | Summarizes multiple Phase I proposals at once with customizable length |
| Batch Phase II Summaries | Summarizes multiple Phase II proposals at once with customizable length |
| Phase I Writeup Generator | Drafts standardized Phase I writeups from uploaded PDFs |
| Phase II Writeup Generator | Drafts Phase II writeups with interactive Q&A follow-up |
| Funding Analyzer | Maps federal funding landscapes using NSF, NIH, and USAspending data |
| Reviewer Finder | Discovers qualified peer reviewers by searching publication databases and verifying expertise |
| Peer Review Summarizer | Analyzes peer review feedback and extracts common themes |
| Expense Reporter | Extracts expense data from receipts and invoices |
| Literature Analyzer | Synthesizes findings across multiple research papers |
| Integrity Screener | Screens applicants against retraction databases and public records |
| Dynamics Explorer | Lets staff query CRM data in plain English |

> _Concept Evaluator was retired 2026-04-25 (Session 110) — page/API/prompt archived to `/_archived`. Removed from this suite list; retained only as reference material in the AI-prompt docs._

All applications are AI-powered, using Anthropic's Claude models. _(This list is illustrative, not exhaustive; `CLAUDE.md` is the authoritative app catalogue.)_

## Data Sources & Integrations

- **AI**: Claude (Anthropic) — powers all applications
- **CRM**: Microsoft Dynamics 365 — grant tracking, contacts, proposals
- **Literature**: PubMed, ArXiv, BioRxiv, ChemRxiv — published research
- **Researcher profiles**: ORCID — researcher identity and contact info
- **Federal funding**: NSF Awards API, NIH RePORTER, USAspending.gov
- **Search**: Google Scholar via SerpAPI — web and academic search
- **Integrity**: Retraction Watch (63,000+ records), PubPeer
- **Authentication**: Azure Active Directory — single sign-on

## Codebase at a Glance

| Metric | Value |
|--------|-------|
| Applications | 17 |
| API route files | 95 |
| Source files | 144 |
| Service modules | 14 |
| External integrations | 8 services |
| Database tables | 12 |
| Package dependencies | 44 |
| Git commits | 266 |
| Development period | Sep 2025 – present (~5 months) |

## Security Highlights

- Single sign-on via Azure Active Directory
- All stored API keys encrypted at rest (AES-256)
- Role-based access control on CRM queries
- HTTPS enforced with HSTS headers
- Input validation and rate limiting on all endpoints

---

## Technical Appendix

**Stack**: Next.js 14, React 18, and Tailwind CSS, deployed as serverless functions on Vercel. Database: Vercel Postgres. File storage: Vercel Blob.

**AI Models**: Three tiers optimized by task complexity — Opus for deep evaluation, Sonnet for general analysis, and Haiku for simple extraction and tool-use. Model selection is per-application and configurable.

**Streaming**: Five applications use Server-Sent Events (SSE) to deliver real-time progress during long-running operations such as batch processing and multi-database searches.

**Authentication**: NextAuth.js with Azure AD provider. Production enforces authentication with per-user data isolation. A development bypass exists for local testing.

**Database**: 12 tables spanning user management, researcher profiles, screening history, and CRM access control. User-specific data (saved candidates, proposal analyses, screening results) is isolated per profile.
