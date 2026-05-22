# Security Architecture & Data Flow Report

**Prepared for:** IT Security Review
**Application:** Document Processing Multi-App System
**Date:** March 2026 (last significant update); status banner refreshed 2026-05-12.
**Version:** 3.5

---

> **2026-05-12 Wave 1 update note.** This document was authored when `user_app_access`, `user_preferences`, and `system_settings` were Postgres tables. Those three tables have been **migrated to Dataverse and dropped from Postgres on 2026-05-12.** Throughout this document:
>
> - `user_app_access` references now describe Dataverse `wmkf_appuserappaccesses` (entity-set name).
> - `user_preferences` references now describe Dataverse `wmkf_appuserpreferences`.
> - `system_settings` references now describe Dataverse `wmkf_appsystemsettings`.
>
> The dispatcher services (`lib/services/{settings,app-access,database}-service.js`) route all reads and writes to Dataverse by default. Application-level encryption of API keys (Section 5.4) is unchanged — values are still encrypted with AES-256-GCM at the application layer before persistence. Underlying-storage encryption is now Dataverse / SQL Server at-rest rather than Postgres at-rest; both meet the same compliance bar. CASCADE-DELETE semantics described in Section 7's tables are now enforced via Dataverse cascade-configured relationships rather than Postgres FKs. Schema-level scope (per-user vs global) is preserved.
>
> Specific sections that were keyed to the Postgres tables and still describe the at-rest encryption / FK / table-name mechanics (Sections 5.4, 7's data-classification tables, Section 8's encryption-key-rotation finding) should be read with the above substitution.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [External Service Inventory](#2-external-service-inventory)
3. [Data Flow Diagrams](#3-data-flow-diagrams)
4. [Vercel & Neon Infrastructure](#4-vercel--neon-infrastructure)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Microsoft Dynamics 365 Integration](#6-microsoft-dynamics-365-integration)
7. [Security Controls in Place](#7-security-controls-in-place)
8. [Security Findings & Recommendations](#8-security-findings--recommendations)
9. [Environment Variable Reference](#9-environment-variable-reference)
10. [Appendix: Database Table Summary](#10-appendix-database-table-summary)

---

## 1. System Overview

### Architecture Diagram

```
                                    EXTERNAL SERVICES
                         ┌──────────────────────────────────────┐
                         │                                      │
                         │  ┌──────────────┐  ┌──────────────┐  │
                         │  │  Claude API   │  │  Azure AD    │  │
                         │  │  (Anthropic)  │  │  (Entra ID)  │  │
                         │  └──────┬───────┘  └──────┬───────┘  │
                         │         │                  │          │
                         │  ┌──────┴───────┐  ┌──────┴───────┐  │
                         │  │  Literature   │  │  Dynamics    │  │
                         │  │  APIs (5)     │  │  365 CRM     │  │
                         │  └──────┬───────┘  └──────┬───────┘  │
                         │         │                  │          │
                         │  ┌──────┴───────┐  ┌──────┴───────┐  │
                         │  │  Federal      │  │  SerpAPI     │  │
                         │  │  Funding (3)  │  │  (Google)    │  │
                         │  └──────┬───────┘  └──────┬───────┘  │
                         │         │                  │          │
                         └─────────┼──────────────────┼──────────┘
                                   │                  │
                         ┌─────────┴──────────────────┴──────────┐
                         │         VERCEL PLATFORM                │
                         │                                        │
                         │  ┌──────────────────────────────────┐  │
                         │  │     Next.js Serverless Functions  │  │
                         │  │     (API Routes + SSR Pages)      │  │
                         │  └────────┬──────────────┬──────────┘  │
                         │           │              │              │
                         │  ┌────────┴───────┐ ┌───┴───────────┐  │
                         │  │  Vercel Blob   │ │ Vercel Postgres│  │
                         │  │  (File Store)  │ │ (Neon)         │  │
                         │  └────────────────┘ └───────────────┘  │
                         │                                        │
                         └────────────────┬───────────────────────┘
                                          │
                                    HTTPS (TLS 1.3)
                                          │
                         ┌────────────────┴───────────────────────┐
                         │            USER BROWSERS                │
                         │   (Azure AD SSO, React SPA frontend)    │
                         └─────────────────────────────────────────┘
```

### Application Inventory

| # | Application | Purpose | Primary External Services |
|---|-------------|---------|---------------------------|
| 1 | Concept Evaluator — _retired 2026-04-25; archived to `/_archived` (row kept for numbering stability; not a live attack surface)_ | Pre-Phase I screening (historical) | Claude, PubMed, Google Scholar |
| 2 | Multi-Perspective Evaluator | 3-perspective proposal evaluation | Claude |
| 3 | Batch Phase I Summaries | Batch Phase I processing | Claude |
| 4 | Batch Phase II Summaries | Batch Phase II processing | Claude |
| 5 | Phase I Writeup | Single Phase I writeup | Claude |
| 6 | Phase II Writeup | Single Phase II writeup with Q&A | Claude |
| 7 | Reviewer Finder | Expert reviewer discovery | Claude, PubMed, ArXiv, BioRxiv, ChemRxiv, ORCID, SerpAPI |
| 8 | Review Manager | Post-acceptance review lifecycle | Claude |
| 9 | Peer Review Summarizer | Peer review analysis | Claude |
| 10 | Funding Analysis | Federal funding gap analysis | Claude, NSF, NIH, USAspending |
| 11 | Expense Reporter | Receipt/invoice processing | Claude |
| 12 | Literature Analyzer | Research paper synthesis | Claude |
| 13 | Integrity Screener | Research integrity screening | Claude, SerpAPI |
| 14 | Dynamics Explorer | Natural language CRM queries | Claude, Dynamics 365 |

### Deployment Topology

- **Platform:** Vercel (serverless)
- **Runtime:** Node.js serverless functions (no persistent server process)
- **Frontend:** Next.js 14, React 18 — server-side rendered, served via Vercel CDN
- **Region:** Vercel auto-selects region (typically US East)
- **Scaling:** Auto-scaled by Vercel per request; no fixed instance count

---

## 2. External Service Inventory

### 2.1 Claude API (Anthropic) — AI Processing

| Attribute | Detail |
|-----------|--------|
| **Endpoint** | `https://api.anthropic.com/v1/messages` |
| **Auth** | API key in `x-api-key` header |
| **Env Var** | `CLAUDE_API_KEY` (centralized server-side; users do not provide their own) |
| **Execution** | Server-side only (API routes) |
| **Data sent** | Proposal text, document content, user prompts, researcher names, CRM query results |
| **Data received** | AI-generated analysis, summaries, structured data, tool-use responses |
| **Used by** | Application-specific routes |
| **Models** | Claude Sonnet 4 (most apps), Claude Haiku 4.5 (expense reporter, Dynamics Explorer, contact enrichment); per-app overrides via `baseConfig.js` `getModelForApp()` |
| **Rate handling** | Retry with exponential backoff (1s initial, 10s max, 2 retries), then fallback to cheaper model |

### 2.2 PubMed / NCBI E-utilities — Literature Search

| Attribute | Detail |
|-----------|--------|
| **Endpoints** | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` (search), `efetch.fcgi` (fetch) |
| **Auth** | Optional API key in query parameter (`api_key`) |
| **Env Var** | `NCBI_API_KEY` (optional — improves rate limit from 3 to 10 req/sec) |
| **Execution** | Server-side only |
| **Data sent** | Research keywords, publication search queries |
| **Data received** | Article IDs (PMIDs), publication metadata (title, authors, journal, abstract, DOI) |
| **Used by** | Reviewer Finder _(Concept Evaluator was also a consumer; retired 2026-04-25)_ |
| **Rate handling** | 350ms delay without key, 100ms with key; batches of 200 articles |

### 2.3 ArXiv — Preprint Repository

| Attribute | Detail |
|-----------|--------|
| **Endpoint** | `http://export.arxiv.org/api/query` |
| **Auth** | None |
| **Execution** | Server-side only |
| **Data sent** | Research keywords mapped to ArXiv categories |
| **Data received** | Preprint metadata (title, authors, abstract, categories) |
| **Used by** | Reviewer Finder |
| **Rate handling** | 3-second mandatory delay between requests |

### 2.4 BioRxiv — Life Sciences Preprints

| Attribute | Detail |
|-----------|--------|
| **Endpoint** | `https://api.biorxiv.org/details/biorxiv/{startDate}/{endDate}/{page}/json` |
| **Auth** | None |
| **Execution** | Server-side only |
| **Data sent** | Date ranges; keyword filtering done client-side |
| **Data received** | Preprint metadata (title, authors, abstract, institution) |
| **Used by** | Reviewer Finder |
| **Rate handling** | 5-second delay between requests |

### 2.5 ChemRxiv — Chemistry Preprints

| Attribute | Detail |
|-----------|--------|
| **Endpoint** | `https://chemrxiv.org/engage/chemrxiv/public-api/v1/items` |
| **Auth** | None |
| **Execution** | Server-side only |
| **Data sent** | Search keywords, date range |
| **Data received** | Preprint metadata (title, authors with institutions, abstract) |
| **Used by** | Reviewer Finder |
| **Rate handling** | 429 retry with 5-second wait |

### 2.6 ORCID — Researcher Identification

| Attribute | Detail |
|-----------|--------|
| **Endpoints** | `https://orcid.org/oauth/token` (auth), `https://pub.orcid.org/v3.0/` (data) |
| **Auth** | OAuth 2.0 Client Credentials |
| **Env Vars** | `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET` |
| **Execution** | Server-side only |
| **Data sent** | Researcher names, affiliations |
| **Data received** | ORCID IDs, public emails, affiliations, publication lists |
| **Used by** | Reviewer Finder (contact enrichment) |
| **Token caching** | ~20 minutes (refreshed 60s before expiry) |
| **Scope** | `/read-public` only (minimal permissions) |

### 2.7 SerpAPI — Google/Scholar Web Search

| Attribute | Detail |
|-----------|--------|
| **Endpoint** | `https://serpapi.com/search.json` |
| **Auth** | API key in query parameter (`api_key`) |
| **Env Var** | `SERP_API_KEY` |
| **Execution** | Server-side only |
| **Data sent** | Researcher names, institution names, search queries |
| **Data received** | Web search results, email addresses, faculty page URLs |
| **Used by** | Reviewer Finder (contact enrichment), Integrity Screener (PubPeer/news search) |

### 2.8 NSF Awards API — Federal Funding

| Attribute | Detail |
|-----------|--------|
| **Endpoint** | `https://api.nsf.gov/services/v1/awards.json` |
| **Auth** | None |
| **Execution** | Server-side only |
| **Data sent** | PI name, state code, active awards flag |
| **Data received** | Award metadata (title, PI, funding program, amount, dates) |
| **Used by** | Funding Analysis |
| **Rate handling** | 200ms delay between requests |

### 2.9 NIH RePORTER API — Federal Funding

| Attribute | Detail |
|-----------|--------|
| **Endpoint** | `https://api.reporter.nih.gov/v2/projects/search` (POST) |
| **Auth** | None |
| **Execution** | Server-side only |
| **Data sent** | PI name (first/last), institution, fiscal years, keywords |
| **Data received** | Project metadata (title, PI, organization, award amount, mechanism) |
| **Used by** | Funding Analysis |
| **Rate handling** | 650ms delay (100 req/min limit) |

### 2.10 USAspending.gov API — Federal Funding

| Attribute | Detail |
|-----------|--------|
| **Endpoint** | `https://api.usaspending.gov/api/v2/search/spending_by_award/` (POST) |
| **Auth** | None |
| **Execution** | Server-side only |
| **Data sent** | Institution name, award type codes, date range |
| **Data received** | Federal awards by institution (ID, amount, description, agency) |
| **Used by** | Funding Analysis |

### 2.11 Microsoft Dynamics 365 CRM — see [Section 6](#6-microsoft-dynamics-365-integration)

### 2.12 Microsoft Azure AD (Entra ID) — see [Section 5](#5-authentication--authorization)

### 2.13 Microsoft Graph API — SharePoint & Email

| Attribute | Detail |
|-----------|--------|
| **Endpoint** | `https://graph.microsoft.com/v1.0/` |
| **Auth** | OAuth 2.0 Client Credentials (reuses Dynamics app registration) |
| **Scope** | `https://graph.microsoft.com/.default` |
| **Env Vars** | `DYNAMICS_TENANT_ID`, `DYNAMICS_CLIENT_ID`, `DYNAMICS_CLIENT_SECRET`, `SHAREPOINT_SITE_URL` (optional, has default) |
| **Execution** | Server-side only |
| **Data sent** | SharePoint site/library paths, file IDs |
| **Data received** | Document listings, file content downloads |
| **Used by** | Dynamics Explorer (`list_documents` tool), Notification Service (email sending — future) |
| **Token caching** | In-memory module-level cache; separate from Dynamics token cache |
| **SharePoint library allowlist** | 13 document libraries; requests for unlisted libraries are rejected |
| **Path validation** | Blocks path traversal (`..`) and absolute paths |
| **SharePoint permission note** | We requested `Sites.Selected` (scoped to akoyaGO only). IT granted access on March 11, 2026; testing shows all 37 site libraries visible, suggesting a broader permission (possibly `Sites.Read.All`) was granted. Application-layer allowlist enforces the 13-library restriction regardless. |

### Summary: All External Domains Contacted

| Domain | Purpose | Auth | Protocol |
|--------|---------|------|----------|
| `api.anthropic.com` | Claude AI | API Key | HTTPS |
| `eutils.ncbi.nlm.nih.gov` | PubMed literature | Optional API Key | HTTPS |
| `export.arxiv.org` | ArXiv preprints | None | HTTP* |
| `api.biorxiv.org` | BioRxiv preprints | None | HTTPS |
| `chemrxiv.org` | ChemRxiv preprints | None | HTTPS |
| `pub.orcid.org` | ORCID researcher data | OAuth 2.0 | HTTPS |
| `orcid.org` | ORCID token endpoint | OAuth 2.0 | HTTPS |
| `serpapi.com` | Google/Scholar search | API Key | HTTPS |
| `api.nsf.gov` | NSF awards | None | HTTPS |
| `api.reporter.nih.gov` | NIH grants | None | HTTPS |
| `api.usaspending.gov` | Federal awards | None | HTTPS |
| `login.microsoftonline.com` | Azure AD / Dynamics / Graph OAuth | OAuth 2.0 | HTTPS |
| `wmkf.crm.dynamics.com` | Dynamics 365 CRM | OAuth 2.0 Bearer | HTTPS |
| `graph.microsoft.com` | Microsoft Graph API (SharePoint, email) | OAuth 2.0 Bearer | HTTPS |
| `appriver3651007194.sharepoint.com` | SharePoint site (redirect target for file downloads) | Via Graph token | HTTPS |

*ArXiv API uses HTTP; responses are public research metadata only.

---

## 3. Data Flow Diagrams

### 3.1 Authentication Flow

```
┌──────────┐     1. Redirect to      ┌─────────────────────┐
│  Browser  │ ──────────────────────► │  Azure AD           │
│           │     Azure AD login      │  (Entra ID)         │
└──────────┘                          │  login.microsoft    │
      ▲                               │  online.com         │
      │                               └─────────┬───────────┘
      │                                         │
      │  5. Set httpOnly                 2. User authenticates
      │     JWT cookie                      (org credentials)
      │     (session)                           │
      │                               ┌─────────▼───────────┐
      │                               │  Azure AD returns    │
      │                               │  auth code + profile │
┌─────┴────┐   3. Exchange code       │  (oid, email, name)  │
│  NextAuth │ ◄──────────────────────  └─────────────────────┘
│  API Route│
│  (server) │   4. Create/link user_profiles row
│           │ ──────────────────────► ┌─────────────────────┐
└──────────┘                          │  Vercel Postgres     │
                                      └─────────────────────┘
```

**Session details:**
- Strategy: JWT (encrypted, not database-stored)
- Max age: 8 hours
- Idle timeout: 2 hours (tracked via `lastActivity` JWT claim)
- Cookie: httpOnly, Secure, SameSite=Lax (set by NextAuth automatically)
- JWT contains: azureId, azureEmail, profileId, profileName, avatarColor, needsLinking, lastActivity
- Signed/encrypted with: `NEXTAUTH_SECRET`

### 3.2 Document Processing Flow (Summarizers, Evaluators)

```
┌──────────┐  1. Upload file     ┌──────────────────┐
│  Browser  │ ─────────────────► │  /api/upload-     │
│           │    (PDF/TXT/DOCX)  │  handler          │
└─────┬────┘                     └────────┬──────────┘
      │                                   │
      │                          2. Store file
      │                                   │
      │                          ┌────────▼──────────┐
      │                          │  Vercel Blob       │
      │                          │  (S3-like storage)  │
      │                          └────────┬──────────┘
      │                                   │
      │  3. Submit for              3. Return blob URL
      │     processing                    │
      │                          ┌────────▼──────────┐
      ├────────────────────────► │  /api/process      │
      │                          │  (API route)       │
      │                          └────────┬──────────┘
      │                                   │
      │                          4. Send document text
      │                             + system prompt
      │                                   │
      │                          ┌────────▼──────────┐
      │                          │  Claude API        │
      │  5. SSE stream           │  (Anthropic)       │
      │     (progress +          └────────┬──────────┘
      │      results)                     │
      ◄──────────────────────────────────-┘
```

**Data sensitivity:** Proposal text (potentially pre-decisional) is sent to Claude API. Claude's data retention policy applies. No proposal text is stored in the local database — only metadata (blob URLs, search terms) persisted.

### 3.3 Reviewer Discovery Flow

```
┌──────────┐  1. Upload proposal   ┌──────────────────────┐
│  Browser  │ ───────────────────► │  /api/reviewer-finder │
└─────┬────┘                       │  /analyze             │
      │                            └──────────┬────────────┘
      │                                       │
      │                              2. Extract keywords
      │                                 via Claude API
      │                                       │
      │                            ┌──────────▼────────────┐
      │                            │  /api/reviewer-finder  │
      │                            │  /discover (SSE)       │
      │                            └──────────┬────────────┘
      │                                       │
      │                              3. Parallel searches:
      │                                       │
      │              ┌──────────┬─────────────┼─────────────┬──────────┐
      │              ▼          ▼             ▼             ▼          ▼
      │         ┌────────┐ ┌────────┐  ┌──────────┐  ┌─────────┐ ┌────────┐
      │         │ PubMed │ │ ArXiv  │  │ BioRxiv  │  │ChemRxiv │ │Database│
      │         └───┬────┘ └───┬────┘  └────┬─────┘  └────┬────┘ └───┬────┘
      │             └──────────┴────────────┴──────────────┘          │
      │                        │                                      │
      │               4. Deduplicate + rank                           │
      │                  candidates                                   │
      │                        │                                      │
      │               5. Save to database ────────────────────────────┘
      │                        │                                (Vercel Postgres)
      │                        │
      │               6. Contact enrichment (optional, 4 tiers):
      │                        │
      │              ┌─────────┼──────────┐
      │              ▼         ▼          ▼
      │         ┌────────┐ ┌───────┐ ┌────────┐
      │         │ ORCID  │ │SerpAPI│ │Database│
      │         └───┬────┘ └───┬───┘ └───┬────┘
      │             └──────────┴─────────┘
      │                        │
      │  7. SSE stream         │
      ◄────────────────────────┘
      │     (candidates + contacts)
```

**Contact enrichment tiers:**
- Tier 0: Affiliation string parsing (local)
- Tier 1: PubMed corresponding author lookup (free)
- Tier 2: ORCID public email/affiliation (OAuth)
- Tier 3: Claude web search (paid, ~$0.015/search)
- Tier 4: SerpAPI Google search (paid, ~$0.005/search)

**Data sent externally:** Research keywords and PI names are sent to literature APIs and SerpAPI. Researcher names and affiliations are sent to ORCID. No proposal full-text is sent to these services — only extracted keywords.

### 3.4 Dynamics Explorer Flow

```
┌──────────┐  1. Natural language  ┌────────────────────────┐
│  Browser  │ ───────────────────► │  /api/dynamics-explorer │
│           │     question         │  /chat (SSE)            │
└─────┬────┘                       └──────────┬─────────────┘
      │                                       │
      │                              2. Check user role
      │                                 + load restrictions
      │                                       │
      │                            ┌──────────▼─────────────┐
      │                            │  Vercel Postgres        │
      │                            │  (dynamics_user_roles,  │
      │                            │   dynamics_restrictions) │
      │                            └──────────┬─────────────┘
      │                                       │
      │                              3. Set restrictions on
      │                                 DynamicsService +
      │                                 send to Claude
      │                                       │
      │                            ┌──────────▼─────────────┐
      │                            │  Claude API (Haiku 4.5) │
      │                            │  (agentic tool-use loop) │
      │                            └──────────┬─────────────┘
      │                                       │
      │                              4. Claude requests tool calls
      │                                 (up to 15 rounds)
      │                                       │
      │                    ┌──────────────────┼──────────────────┐
      │                    ▼                  ▼                  ▼
      │        ┌───────────────────┐ ┌───────────────┐ ┌────────────────┐
      │        │ Dynamics OData    │ │  Dataverse    │ │  Dynamics      │
      │        │ Web API v9.2     │ │  Search API   │ │  Schema API    │
      │        │ (wmkf.crm.      │ │  (full-text)  │ │  (EntityDefs)  │
      │        │  dynamics.com)   │ │               │ │                │
      │        └────────┬─────────┘ └───────┬───────┘ └───────┬────────┘
      │                 └───────────────────┼─────────────────┘
      │                                     │
      │                            5. Log query to audit table
      │                                     │
      │                            ┌────────▼──────────────┐
      │                            │  Vercel Postgres       │
      │                            │  (dynamics_query_log)  │
      │                            └───────────────────────┘
      │                                     │
      │  6. SSE stream                      │
      ◄─────────────────────────────────────┘
      │     (tool results + final answer)
```

**Key security boundaries:**
- Restrictions enforced at two layers: chat handler (user-facing DENIED messages) and DynamicsService (defense-in-depth throws on direct service usage)
- The Dynamics service account authenticates via OAuth Client Credentials (server-to-server) — user credentials never touch Dynamics
- All CRM queries pass through `DynamicsService.checkRestriction()` before execution

### 3.5 Funding Analysis Flow

```
┌──────────┐  1. PI name +       ┌──────────────────────┐
│  Browser  │     institution    │  /api/analyze-       │
│           │ ─────────────────► │  funding-gap (SSE)   │
└─────┬────┘                     └──────────┬───────────┘
      │                                     │
      │                            2. Parallel API queries:
      │                                     │
      │              ┌──────────────────────┼──────────────────────┐
      │              ▼                      ▼                      ▼
      │    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
      │    │  NSF Awards API  │  │  NIH RePORTER    │  │  USAspending.gov │
      │    │  (api.nsf.gov)   │  │  (api.reporter.  │  │  (api.usa        │
      │    │                  │  │   nih.gov)        │  │   spending.gov)  │
      │    └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
      │             └─────────────────────┼──────────────────────┘
      │                                   │
      │                          3. Aggregate results
      │                             + Claude synthesis
      │                                   │
      │                          ┌────────▼──────────┐
      │                          │  Claude API        │
      │  4. SSE stream           │  (Anthropic)       │
      │     (awards +            └────────┬──────────┘
      │      analysis)                    │
      ◄──────────────────────────────────-┘
```

### 3.6 API Key Lifecycle

```
┌──────────┐  1. Enter key     ┌──────────────────────┐
│  Browser  │ ───────────────► │  POST /api/user-     │
│  (input)  │   (HTTPS POST)   │  preferences         │
└──────────┘                   └──────────┬────────────┘
                                          │
                                 2. Detect encrypted key type
                                    (api_key_claude, etc.)
                                          │
                               ┌──────────▼────────────┐
                               │  lib/utils/encryption  │
                               │  AES-256-GCM encrypt:  │
                               │  - Random IV (16 bytes) │
                               │  - Auth tag (16 bytes)  │
                               │  - Base64(IV+tag+cipher)│
                               └──────────┬────────────┘
                                          │
                               ┌──────────▼────────────┐
                               │  user_preferences      │
                               │  (is_encrypted=true)    │
                               └──────────┬────────────┘
                                          │
              ┌───────────────────────────┼────────────────────────┐
              ▼                           ▼                        ▼
   ┌──────────────────┐      ┌──────────────────┐    ┌──────────────────┐
   │  GET (display)    │      │  GET (use)        │    │  API route       │
   │  → masked value   │      │  ?includeDecrypted│    │  receives key    │
   │  "sk-a••••skey"   │      │  → decrypt AES    │    │  in request body │
   └──────────────────┘      │  → plaintext key   │    │  → x-api-key hdr │
                              └──────────────────┘    │  → Claude API     │
                                                      └──────────────────┘
```

---

## 4. Vercel & Neon Infrastructure

### Vercel Serverless Platform

| Component | Detail |
|-----------|--------|
| **Compute** | Serverless functions (Node.js); no persistent processes |
| **CDN** | Vercel Edge Network serves static assets and SSR pages |
| **TLS** | Automatic HTTPS with TLS 1.3; HTTP auto-redirected |
| **HSTS** | `Strict-Transport-Security: max-age=31536000; includeSubDomains` via `next.config.js` (all routes) |
| **Domains** | Custom domain configured in Vercel dashboard |
| **Environment secrets** | Stored encrypted in Vercel dashboard; injected at build/runtime |
| **Build** | `next build` triggered on git push to main |
| **Scaling** | Auto-scales per request; cold starts possible |

### Vercel Postgres (Neon)

| Attribute | Detail |
|-----------|--------|
| **Provider** | Neon (managed PostgreSQL), accessed via Vercel integration |
| **Connection** | `POSTGRES_URL` env var (auto-set by Vercel) |
| **Client library** | `@vercel/postgres` — serverless-optimized connection pooling |
| **Encryption in transit** | TLS required (enforced by Neon) |
| **Encryption at rest** | Neon encrypts data at rest (AES-256) |
| **Region** | US East (co-located with Vercel functions) |
| **Backups** | Neon automated point-in-time recovery |

**Application-level encryption:** API keys stored in `user_preferences` are encrypted with AES-256-GCM before database insertion (see [Section 5.4](#54-api-key-encryption)).

**Database schema overview:**

| Category | Tables | Sensitivity | Scoping |
|----------|--------|-------------|---------|
| User identity | `user_profiles` | Medium — Azure IDs, emails | Per-user |
| User settings | `user_preferences` *(now Dataverse `wmkf_appuserpreferences`)* | High — encrypted API keys | Per-user |
| App access | `user_app_access` *(now Dataverse `wmkf_appuserappaccesses`)* | Medium — per-user app grants | Per-user |
| System config | `system_settings` *(now Dataverse `wmkf_appsystemsettings`)* | Medium — model overrides, settings | Global |
| API usage | `api_usage_log` | Medium — model, tokens, cost per request | Per-user |
| Researcher data | `researchers`, `publications`, `researcher_keywords` *(all Postgres drain-only post-W6 2026-05-12; live reviewer/researcher state is in Dataverse `wmkf_appresearcher` / `wmkf_potentialreviewer`)* | Low — public academic data | Shared/global |
| Search results | `proposal_searches` *(Postgres drain-only; writer dead, `extract-summary` endpoint retired)* | Medium — proposal metadata, blob URLs | Per-user |
| Reviewer candidates | `reviewer_suggestions` *(Postgres drain-only post-W3-W6; live reviewer-suggestion state is in Dataverse `wmkf_appreviewersuggestion`)* | Medium — reviewer-proposal matches | Per-user |
| Grant cycles | `grant_cycles` *(Postgres drain-only post-W3 2026-05-12; live cycle state is in Dataverse `wmkf_appgrantcycle`)* | Low — organizational metadata | Shared/global |
| Integrity data | `retractions` | Low — public Retraction Watch data | Shared/global |
| Integrity results | `integrity_screenings`, `screening_dismissals` | Medium — screening outcomes | Per-user |
| CRM access control | `dynamics_user_roles`, `dynamics_restrictions` | Medium — access policies | Per-user / global |
| CRM audit log | `dynamics_query_log` | Medium — query parameters, timing | Per-user |
| Monitoring | `system_alerts`, `health_check_history`, `maintenance_runs` | Low — operational metrics, alert history | Global |
| API cache | `search_cache` | Low — cached literature search results | Shared |

### Vercel Blob Storage

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Uploaded documents (proposals, receipts, images) |
| **Client library** | `@vercel/blob/client` |
| **Max file size** | 50 MB |
| **Allowed types** | PDF, DOC, DOCX, TXT, Markdown, PNG, JPG |
| **Naming** | Random suffix appended (prevents URL guessing) |
| **Retention** | No automatic deletion; files persist until manually removed |
| **Access control** | Blob URLs accessed via authenticated proxy (`/api/blob-proxy`) |
| **Proxy validation** | URL hostname verified against pattern `[a-z0-9]+\.public\.blob\.vercel-storage\.com`, HTTPS enforced |
| **Upload auth** | File uploads require authenticated session via `requireAuth()` |
| **Upload endpoints** | Single endpoint: `/api/upload-handler` (client-side token flow). The legacy server-multipart `/api/upload-file` was retired 2026-05-21 (security audit A5) after `SettingsModal` — its last caller — migrated to the token flow. Uploaded blobs are still `access: 'public'`; migrating to private blobs + proxied downloads is the open residual of security-audit P2. |

### Environment Variable Management

- **Production:** All secrets stored in Vercel dashboard (encrypted at rest)
- **Local development:** `vercel env pull .env.local` to download secrets
- **`.env.local`:** Gitignored — never committed to repository
- **Build-time vs runtime:** `NEXT_PUBLIC_*` vars exposed to browser; all others server-only
- **No `NEXT_PUBLIC_` prefixed secrets exist** — all sensitive vars are server-side only

---

## 5. Authentication & Authorization

### 5.1 Azure AD OAuth 2.0 Flow

| Attribute | Detail |
|-----------|--------|
| **Provider** | Microsoft Azure AD (Entra ID) |
| **Library** | NextAuth.js with `next-auth/providers/azure-ad` |
| **Grant type** | Authorization Code (user-interactive) |
| **Scopes** | `openid email profile User.Read` |
| **Endpoints** | `login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize` and `/token` |
| **Env vars** | `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` |
| **Callback URL** | `{NEXTAUTH_URL}/api/auth/callback/azure-ad` |

### 5.2 Session Management

| Attribute | Detail |
|-----------|--------|
| **Strategy** | JWT (encrypted, not stored in database) |
| **Max age** | 8 hours |
| **Idle timeout** | 2 hours — tracked via `lastActivity` JWT claim; enforced in both the `jwt` callback and edge middleware |
| **Signing secret** | `NEXTAUTH_SECRET` (32-byte random value) |
| **Cookie flags** | httpOnly, Secure, SameSite=Lax (set by NextAuth automatically) |
| **JWT payload** | azureId, azureEmail, profileId, profileName, avatarColor, needsLinking, lastActivity |
| **Session refresh** | `SessionProvider` configured with `refetchOnWindowFocus` — refreshes `lastActivity` when the user returns to the tab, but does not poll in the background (which would defeat idle timeout) |
| **Debug mode** | `debug: process.env.NODE_ENV === 'development'` — disabled in production |
| **Session revocation** | Setting `user_profiles.is_active = false` blocks requests within 2-minute cache TTL. Checked in `requireAppAccess()` (cached, parallel query) and `requireAuthWithProfile()` (direct query). Disabled accounts are blocked before superuser bypass. |

### 5.3 Three-Layer Auth Enforcement

Authentication is enforced at three levels — the server-side proxy, API route middleware, and client-side guards:

**Layer 1: Server-side Proxy (`proxy.js`)**

| Attribute | Detail |
|-----------|--------|
| **Runtime** | Node.js runtime (Next 16 `proxy` convention default; the `runtime` config option is not available for proxy files) |
| **Library** | `next-auth/middleware` `withAuth` (function form) + `jose` for JWT validation |
| **Scope** | All routes except `_next/static`, `_next/image`, `favicon.ico`, `apple-touch-icon*`, `/api/auth/*`, `/api/cron/*` |
| **Behavior** | Validates JWT cookie; checks `token.azureId` (rejects empty tokens from idle expiry); checks `lastActivity` for 2-hour idle timeout (defense-in-depth); redirects unauthenticated/idle users to `/auth/signin`. Generates per-request CSP nonce (see [Section 7.4](#74-security-headers)). |
| **Kill switch** | `AUTH_REQUIRED=false` disables edge auth check entirely |
| **Stateless** | No database access; crypto-only validation + timestamp check |

**Layer 2: API Route Auth Functions (`lib/utils/auth.js`)**

| Function | Behavior | Used by |
|----------|----------|---------|
| `requireAppAccess(req, res, ...appKeys)` | CSRF origin check + auth + profile + `is_active` check + app grant (OR logic). Returns `{ profileId, session }` or sends 401/403. Uses in-memory cache with 2-minute TTL (includes `isActive` flag). Disabled accounts blocked before superuser bypass. | App-specific API endpoints |
| `requireAuthWithProfile(req, res)` | Auth + linked profile + `is_active` check (direct DB query, fail-open). Returns `profileId` or sends 401/403. Blocks request-body `profileId` injection in production. | User-scoped infrastructure (admin, preferences, app-access) |
| `requireAuth(req, res)` | CSRF origin check + auth. Returns session or sends 401. | System endpoints (health, file upload, blob proxy) |
| `optionalAuth(req, res)` | Returns session or null; no error response. | Public-optional routes |
| `clearAppAccessCache([profileId])` | Invalidates cached app access; called on grant/revoke changes. | App access management endpoints |

**Layer 3: Client-Side Guards**

| Component | Purpose |
|-----------|---------|
| `AppAccessContext` | React context; fetches `/api/app-access` on mount; exposes `hasAccess(appKey)`, `isSuperuser`. Deny-by-default during loading; fail-closed on fetch error. |
| `RequireAppAccess` | Page-level wrapper on all [17](CANONICAL_COUNTS.md#app-definition-count) app pages; shows "Access Not Available" if denied. |
| `Layout.js` | Filters navigation links by app access. |

**Auth kill switch:** Setting `AUTH_REQUIRED=false` disables authentication at all layers. Intended for emergency access or local development.

**Production safeguards:**
- `isAuthRequired()` logs a console warning if auth is disabled in production
- `requireAuthWithProfile()` returns 403 if auth bypass is attempted in production — refuses to accept `userProfileId` from request body/query, preventing profile impersonation
- Development fallback to `userProfileId` parameter preserved for local dev only

**Profile linking:**
- New Azure AD users auto-create or link to existing `user_profiles` rows
- `signIn` callback detects unlinked profiles whose `azure_email` matches the caller's Azure email and flags them for manual linking (`needs_linking = true`)
- The manual linking flow (`/api/auth/link-profile`) is gated by three checks:
  1. `session.user.needsLinking` must be `true` — only first-login users can use this endpoint
  2. Identity (`azureId`, `azureEmail`) derived from the server-side session, never from request body
  3. Target profile's `azure_email` must match the caller's Azure email — prevents claiming another user's profile
- The `signIn` callback only enters the linking flow when email-matching unlinked profiles exist; otherwise it creates a new profile directly
- `signIn` callback blocks sign-in if DB profile creation fails (fail-closed — returns `false`)

### 5.4 App-Level Access Control

| Attribute | Detail |
|-----------|--------|
| **Registry** | `shared/config/appRegistry.js` — single source of truth for all [17](CANONICAL_COUNTS.md#app-definition-count) app definitions (keys, names, routes, icons, categories) |
| **Database** | Dataverse `wmkf_appuserappaccesses` (per-user app grants). The Postgres `user_app_access` table that previously enforced this via a `(user_profile_id, app_key)` unique constraint was dropped 2026-05-12 at the Wave 1 cutover. |
| **Default grants** | New users receive only `dynamics-explorer`; all other apps require explicit superuser grant |
| **Superuser bypass** | Users with `role = 'superuser'` in `dynamics_user_roles` bypass all app checks |
| **Caching** | In-memory `Map` with 2-minute TTL; invalidated on grant/revoke via `clearAppAccessCache()` |
| **Admin UI** | Checkbox grid on `/admin` — superusers manage per-user app grants |
| **Always-accessible paths** | `/`, `/admin`, `/guide`, `/profile-settings`, `/auth/signin`, `/auth/error` |

### 5.5 API Key Encryption

User-provided API keys (Claude, ORCID, NCBI, SerpAPI) are stored encrypted:

| Attribute | Detail |
|-----------|--------|
| **Algorithm** | AES-256-GCM (authenticated encryption) |
| **IV** | 16 bytes, randomly generated per encryption |
| **Auth tag** | 16 bytes (integrity verification) |
| **Key source** | `USER_PREFS_ENCRYPTION_KEY` env var (64-char hex = 32 bytes) |
| **Key derivation** | Direct hex decode if 64-char hex; otherwise SHA-256 hash to 32 bytes |
| **Storage format** | Base64(IV &#124;&#124; AuthTag &#124;&#124; Ciphertext) in `wmkf_appuserpreferences.wmkf_preferencevalue` (Dataverse). Postgres `user_preferences.preference_value` was retired 2026-05-12. |
| **Encrypted keys** | `api_key_claude`, `api_key_orcid_client_id`, `api_key_orcid_client_secret`, `api_key_ncbi`, `api_key_serp` |
| **Flag** | `wmkf_appuserpreferences.wmkf_isencrypted = true` marks encrypted rows |
| **Masking** | Display uses `maskValue()` — shows first 3 and last 3 characters only |
| **Production guard** | `getEncryptionKey()` throws if `USER_PREFS_ENCRYPTION_KEY` is unset in production |
| **Dev fallback** | SHA-256 of `'dev-fallback-key-not-for-production'` with console warning |

### 5.6 User Data Scoping

Postgres-resident entities scope per-user via `user_profile_id` foreign key. Wave 1 Dataverse-resident entities scope via the `_wmkf_user_value` lookup to `user_profiles`'s Dataverse counterpart (system user) or via `_ownerid_value` for User-owned rows. The dispatcher services (`lib/services/{settings,app-access,database}-service.js`) apply the appropriate scoping per backend.

| Entity | Backend | Scoping | Mechanism |
|--------|---------|---------|-----------|
| `wmkf_appuserpreferences` | Dataverse | Per-user | User-owned (`ownerid`); cascade follows Dataverse relationship config |
| `wmkf_appuserappaccesses` | Dataverse | Per-user | `_wmkf_user_value` lookup to system user |
| `wmkf_appsystemsettings` | Dataverse | Global | Superuser-managed model overrides + secret-expiration metadata |
| `wmkf_appreviewersuggestion` | Dataverse | Per-user (PD scope) | `wmkf_appreviewersuggestion` migrated from Postgres `reviewer_suggestions` (W3-W6 / 2026-05-12); PG table is script-only drain. |
| `wmkf_appgrantcycle` | Dataverse | Shared | Migrated from Postgres `grant_cycles` at W3 cutover (2026-05-12); PG table is drain-only. |
| `proposal_searches` *(Postgres drain-only; no live app readers per Atlas)* | Postgres | Per-user | `WHERE user_profile_id = ?` (SET NULL on profile delete) |
| `reviewer_suggestions` *(Postgres drain-only; superseded by Dataverse `wmkf_appreviewersuggestion`)* | Postgres | Per-user | `WHERE user_profile_id = ?` (SET NULL on profile delete) |
| `integrity_screenings` | Postgres | Per-user | `WHERE user_profile_id = ?` |
| `screening_dismissals` | Postgres | Indirect per-user | FK to `integrity_screenings`; API does not enforce ownership check on `screeningId` — see note below |
| `dynamics_query_log` | Postgres | Per-user | `WHERE user_profile_id = ?` |
| `api_usage_log` | Postgres | Per-user | `WHERE user_profile_id = ?` |
| `researchers` *(Postgres drain-only post-W6 2026-05-12)* | Postgres | Shared | All users see same pool |
| `publications` *(Postgres drain-only)* | Postgres | Shared | Linked to researchers |
| `grant_cycles` *(Postgres drain-only; Dataverse `wmkf_appgrantcycle` is source of truth)* | Postgres | Shared | Organization-wide |
| `retractions` | Postgres | Shared | Read-only import |

**Note on `screening_dismissals`:** This table has no direct `user_profile_id` column — it references `screening_id` (FK to `integrity_screenings`). The `/api/integrity-screener/dismiss` endpoint does not verify that the `screeningId` belongs to the authenticated user before creating or reading dismissals. An authenticated user with `integrity-screener` access could dismiss matches on another user's screening by enumerating `screeningId` values. Low risk (all users share the same dismissal intent for false positives), but should be hardened for defense-in-depth.

---

## 6. Microsoft Dynamics 365 Integration

### 6.1 OAuth Authentication (Server-to-Server)

| Attribute | Detail |
|-----------|--------|
| **Grant type** | Client Credentials (no user interaction) |
| **Token endpoint** | `https://login.microsoftonline.com/{DYNAMICS_TENANT_ID}/oauth2/v2.0/token` |
| **Scope** | `{DYNAMICS_URL}/.default` |
| **Env vars** | `DYNAMICS_URL`, `DYNAMICS_TENANT_ID`, `DYNAMICS_CLIENT_ID`, `DYNAMICS_CLIENT_SECRET` |
| **Token caching** | In-memory module-level cache; refreshed 60s before expiry |
| **Token storage** | Memory only — not persisted to database or disk |

**Important:** This is a service principal (application) authentication, not user-delegated. All CRM queries run under a single application identity regardless of which user initiated the request. User-level access control is enforced at the application layer, not by Dynamics.

#### Token Trust Chain & Exposure Audit

Three files acquire and hold service principal access tokens:

| File | Scope | Token Variable |
|------|-------|----------------|
| `lib/services/dynamics-service.js` | `{DYNAMICS_URL}/.default` | `tokenCache` (module-level) |
| `lib/services/graph-service.js` | `https://graph.microsoft.com/.default` | `tokenCache` (module-level) |
| `lib/services/notification-service.js` | `https://graph.microsoft.com/.default` | Local variable (no cache) |

**Token lifecycle:**

```
Azure AD token endpoint
        |
        v
getAccessToken() --> tokenCache (module variable, in-memory only)
        |
        v
buildHeaders() --> { Authorization: 'Bearer <token>' }
        |
        v
fetch() --> HTTPS request to Microsoft API
        |
        v
Response processed --> CRM records / SharePoint files returned
        |
Token stays in tokenCache until function instance recycles
```

**Verified non-exposure paths (audited March 2026):**

| Path | Status |
|------|--------|
| Console logging | Clean — zero `console.log/error/warn` calls output token values |
| API responses | Clean — no endpoint returns the token to the browser |
| Error messages | Clean — failure paths log status codes and Azure AD error descriptions, never the token |
| Database storage | Clean — token never written to any table |
| Session cookie | Clean — JWT contains only identity claims, no Microsoft tokens |
| Claude API | Clean — only parsed CRM data flows into AI conversations, never the token |
| Third-party libraries | Clean — no APM/telemetry that captures outbound HTTP headers |
| Health check | Clean — uses `data.access_token ? 'ok' : 'error'` (truthiness only) |

**Automated enforcement:** `.semgrep/token-audit.yaml` defines 9 rules that detect token leakage patterns: console logging, API responses, database writes, SSE events, secret/credential exposure (both Azure client secrets and other high-sensitivity env vars like `CLAUDE_API_KEY`, `NEXTAUTH_SECRET`, `POSTGRES_URL`, `CRON_SECRET`), error messages, third-party sends, token-into-object copying, and Authorization header serialization. Rules cover both `getAccessToken()` and `getGraphToken()` call sites. These rules run on every PR and push to main via `.github/workflows/security-scan.yml`.

**Code-level guardrails:** All three `getAccessToken()` / `getGraphToken()` methods carry a `SECURITY` JSDoc comment documenting that the token must never be logged, returned, stored, or sent to third parties.

### 6.2 CRM Data Access

**API endpoints used:**

| Endpoint | Purpose |
|----------|---------|
| `{DYNAMICS_URL}/api/data/v9.2/{entitySet}` | OData v4 entity queries |
| `{DYNAMICS_URL}/api/data/v9.2/{entitySet}({id})` | Single record retrieval |
| `{DYNAMICS_URL}/api/data/v9.2/EntityDefinitions` | Schema discovery (cached 24h) |
| `{DYNAMICS_URL}/api/search/v1.0/query` | Dataverse full-text search |

**Request headers:** `Authorization: Bearer {token}`, `OData-Version: 4.0`, `Prefer: odata.include-annotations="*",odata.maxpagesize=100`

**Timeout:** 30 seconds per request.

**Operations:** Read-and-write. Generic `createRecord` / `updateRecord` are implemented in `lib/services/dynamics-service.js` and used across the codebase. Write privileges on the service principal were granted and verified 2026-04-14. Specific write paths include reviewer-suggestion lifecycle updates, AI run audit rows (`wmkf_ai_run`), AI field writeback on `akoya_request` (Field Sets A/B/C/D + workflow-chaining fields, deployed 2026-05-07), policy publish flow (`wmkf_policy` / `wmkf_policyversion`, S145), and email activity operations (`createEmailActivity`, `addEmailAttachment`, `sendEmail`, `createAndSendEmail`).

**Query safety limits:**
- `$top` capped at 100 records per query
- Queries without `$filter` limited to 25 records (prevents table scans)
- Dataverse Search capped at 100 results
- `_formatted` fields auto-stripped from `$select` (sanitizeSelect function)
- `$skip` is never used (unsupported by Dynamics CRM)

**CRM tables accessed:** `akoya_requests`, `akoya_requestpayments`, `contacts`, `accounts`, `emails`, `annotations`, `wmkf_potentialreviewers`, `akoya_programs`, `akoya_phases`, `akoya_concepts`, and various lookup tables.

### 6.3 Role-Based Access Control

| Role | Capabilities |
|------|-------------|
| **`superuser`** | Full CRM query access; can manage roles and restrictions for other users |
| **`read_only`** (default) | Query access subject to global restrictions; cannot modify access rules |
| **`read_write`** | Reserved for future write operations (currently no distinction from `read_only`) |

Roles stored in `dynamics_user_roles` table. Default role (no row) = `read_only`.

**Table/field restrictions (dual-layer enforcement):**

- Stored in `dynamics_restrictions` table
- Can block entire tables or specific fields
- **Layer 1 (chat handler):** Checks restrictions before each tool execution; returns user-friendly `DENIED` message to Claude
- **Layer 2 (DynamicsService):** `checkRestriction()` called inside `queryRecords`, `getRecord`, `countRecords`, `searchRecords`, and `getEntityAttributes`; throws `Error` on violation
- Field matching uses exact split-and-match on comma-separated `$select` fields (not substring matching)
- Managed by superusers via `/api/dynamics-explorer/roles` and `/api/dynamics-explorer/restrictions`

### 6.4 Agentic Tool Loop

| Parameter | Value |
|-----------|-------|
| **Max rounds** | 15 tool-use rounds per request |
| **Tools** | 9: `search`, `get_entity`, `get_related`, `describe_table`, `query_records`, `count_records`, `find_reports_due`, `list_documents`, `export_csv` |
| **Result char limits** | 16KB default; 12KB for composite tools (search, get_related, find_reports_due, describe_table); 8KB for list_documents; 4KB for export_csv |
| **Conversation trimming** | Last 4 messages kept; older rounds compacted to one-line summaries |
| **Claude model** | Haiku 4.5 (cost-optimized for agentic loops), with fallback model on overload |
| **Rate limit handling** | 429 → wait up to 60s + retry; 529 → fall back to alternate model |

### 6.5 Audit Logging

Every Dynamics tool execution is logged to `dynamics_query_log`:

| Field | Content |
|-------|---------|
| `user_profile_id` | Which user ran the query |
| `session_id` | Chat session identifier |
| `query_type` | Tool name (search, query_records, get_entity, etc.) |
| `table_name` | CRM table queried |
| `query_params` | Sanitized JSONB of query parameters |
| `record_count` | Number of records returned |
| `execution_time_ms` | Query duration |
| `was_denied` | Whether the query was blocked by a restriction (BOOLEAN, default false) |
| `denial_reason` | Restriction message if denied (TEXT, null if allowed) |
| `created_at` | Timestamp |

**Logging is non-fatal:** failures are caught and logged to console but do not block the query. Restriction violations are logged with `was_denied = true` for compliance tracking (partial index enables efficient queries on denied rows).

### 6.6 Data Residency

- **No CRM data is stored locally.** Records are fetched on-demand, returned to the Claude model as tool results, then streamed to the user via SSE and discarded.
- Only metadata is persisted: user roles, restrictions, and audit log entries.
- Schema definitions (table/field metadata) are cached in serverless function memory with a 6–24 hour TTL. This cache is lost when the function cold-starts.

---

## 7. Security Controls in Place

### 7.1 Transport Security

| Control | Implementation |
|---------|---------------|
| **HTTPS enforcement** | Vercel platform auto-redirects HTTP → HTTPS, TLS 1.3 |
| **HSTS** | `Strict-Transport-Security: max-age=31536000; includeSubDomains` via `next.config.js` (all routes) |
| **Database TLS** | Neon enforces TLS for all Postgres connections |
| **Dynamics TLS** | All Dynamics API calls over HTTPS |
| **External API calls** | All server-side, all HTTPS (except ArXiv which uses HTTP for public metadata) |

### 7.2 Authentication

| Control | Implementation |
|---------|---------------|
| **User authentication** | Azure AD SSO via NextAuth.js (OAuth 2.0 Authorization Code) |
| **Server-side proxy** | `withAuth`/`jose` JWT validation in `proxy.js` (Next 16 `proxy` convention) — unauthenticated users never see the app |
| **API route protection** | `requireAppAccess()` on app-specific endpoints; `requireAuthWithProfile()` on infrastructure endpoints; `requireAuth()` on system endpoints |
| **App-level access control** | Per-user app grants via Dataverse `wmkf_appuserappaccesses` *(formerly Postgres `user_app_access`, dropped 2026-05-12)*; new users get only `dynamics-explorer` by default |
| **Superuser bypass** | Users with `role = 'superuser'` in `dynamics_user_roles` bypass all app access checks |
| **CRM authentication** | OAuth 2.0 Client Credentials, server-side only |
| **ORCID authentication** | OAuth 2.0 Client Credentials (`/read-public` scope), server-side only |
| **CSRF protection** | Origin header validation on state-changing methods (POST/PUT/PATCH/DELETE) in `requireAuth()` and `requireAppAccess()` |
| **Session revocation** | `is_active` check on `user_profiles` in `requireAppAccess()` (cached, 2-min TTL) and `requireAuthWithProfile()` (direct query) |
| **Kill switch** | `AUTH_REQUIRED=false` disables user auth (emergency use only) |
| **Production guard** | Auth bypass returns 403 in production for profile-scoped routes |

### 7.3 Encryption

| Control | Implementation |
|---------|---------------|
| **Encryption in transit** | TLS for all connections (Vercel, Neon, external APIs) |
| **Database encryption at rest** | Neon AES-256 (platform-managed) |
| **API key encryption** | AES-256-GCM with per-value random IV and auth tag |
| **Session encryption** | NextAuth JWT encrypted with NEXTAUTH_SECRET |
| **Production key guard** | `getEncryptionKey()` throws in production if `USER_PREFS_ENCRYPTION_KEY` unset |

### 7.4 Security Headers

**Static headers** set by `next.config.js` on all routes (`/:path*`):

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Powered-By` | Suppressed (`poweredByHeader: false`) |
| `X-Robots-Tag` | `noindex, nofollow, noarchive` |

**Dynamic Content Security Policy** set per-request by the proxy (`proxy.js`):

The middleware generates a unique cryptographic nonce for each request via `crypto.randomUUID()` → Base64. The nonce is passed to `pages/_document.js` via the `x-nonce` request header, which propagates it to `<Head>` and `<NextScript>` so Next.js applies it to all framework-injected `<script>` tags.

**Production CSP directives:**

| Directive | Value |
|-----------|-------|
| `default-src` | `'self'` |
| `script-src` | `'self'`, `'nonce-{per-request}'`, `https://va.vercel-scripts.com` |
| `style-src` | `'self'`, `'unsafe-inline'` |
| `img-src` | `'self'`, `data:`, `https:` |
| `font-src` | `'self'` |
| `connect-src` | `'self'`, `https://vercel.com`, `https://*.vercel-insights.com` |
| `frame-ancestors` | `'none'` |
| `upgrade-insecure-requests` | (enforces HTTPS for all subresources) |

**Key security properties:**
- **No `'unsafe-inline'` in script-src** — injected `<script>` tags are blocked unless they carry the per-request nonce
- **No `'unsafe-eval'`** — `eval()` and related functions are blocked
- `'self'` allows same-origin script chunks (`/_next/static/...`); the nonce covers any inline scripts on SSR pages
- `'unsafe-inline'` is retained only for `style-src` (standard practice; no script execution vector)
- `https://va.vercel-scripts.com` is explicitly allowed for Vercel Web Analytics

**Development mode differences:** `script-src` includes `'unsafe-inline'` and `'unsafe-eval'` (required by Turbopack HMR); `connect-src` adds `https://*.public.blob.vercel-storage.com`, `ws://localhost:3000`, and `ws://127.0.0.1:3000` for blob access and WebSocket hot reload; `upgrade-insecure-requests` is omitted (localhost is HTTP).

**Note:** Pages are statically generated (SSG) at build time, so `'strict-dynamic'` is not used — it would override `'self'` per the CSP spec and block same-origin script chunks that lack nonce attributes. The `connect-src` allowlist covers Vercel Analytics; blob access goes through the authenticated proxy (`/api/blob-proxy`) which is same-origin. All Claude API calls are server-side and not subject to CSP.

### 7.5 Input Validation

| Control | Implementation |
|---------|---------------|
| **SQL injection prevention** | All database queries use parameterized `sql` template literals via `@vercel/postgres` |
| **React XSS prevention** | React's default JSX escaping prevents XSS in rendered output |
| **CSP frame protection** | `frame-ancestors 'none'` blocks clickjacking |
| **File upload validation** | Whitelist of allowed types (PDF, TXT, MD, DOCX, PNG, JPG); 50MB limit |
| **Blob proxy validation** | URL hostname pattern matching prevents SSRF |
| **SSRF protection** | `safeFetch()` wrapper (`lib/utils/safe-fetch.js`) restricts outbound requests to an allowlisted set of HTTPS hosts |
| **Request size limit** | Configurable max (100MB body default) |

### 7.5.1 Centralized Fetch Wrapper (`safeFetch`)

All new server-side outbound HTTP requests should use `safeFetch` from `lib/utils/safe-fetch.js` instead of the global `fetch()`. This wrapper:

1. **Requires HTTPS** — rejects `http://` URLs
2. **Allowlists hosts** — only permits requests to known, trusted hostnames (Microsoft services, research APIs, Vercel platform, Anthropic)
3. **Blocks SSRF vectors** — cloud metadata endpoints (`169.254.169.254`), localhost, internal IPs, and arbitrary external hosts are rejected

**Allowed hosts** (defined as RegExp patterns in `ALLOWED_HOSTS`):

| Category | Hosts |
|----------|-------|
| Microsoft | `graph.microsoft.com`, `login.microsoftonline.com`, `wmkf.crm.dynamics.com`, `appriver3651007194.sharepoint.com` |
| Vercel | `*.public.blob.vercel-storage.com`, `api.vercel.com` |
| Anthropic | `api.anthropic.com` |
| Research | `eutils.ncbi.nlm.nih.gov`, `pub.orcid.org`, `api.openalex.org`, `export.arxiv.org`, `api.biorxiv.org`, `api.semanticscholar.org`, `serpapi.com`, `chemrxiv.org` |
| Federal | `api.nsf.gov`, `api.reporter.nih.gov` |

**Migration status:** `fetchAttachment()` in `generate-emails.js` and `send-emails.js` migrated. Other services will be migrated incrementally. The companion `isAllowedUrl()` helper enables pre-validation without fetching.

### 7.6 Rate Limiting

**Application-level (`nextRateLimiter` middleware):**

| Tier | Window | Max Requests | Usage |
|------|--------|--------------|-------|
| `standard` | 60s | 60 | General API calls |
| `strict` | 60s | 10 | Expensive operations |
| `hourly` | 3600s | 1000 | Hourly limit |
| `upload` | 60s | 30 | File uploads |
| `aiProcessing` | 60s | 20 | AI API calls |

**Route-level enforcement:** Rate limiting is applied to all AI-processing routes and streaming endpoints via per-route `nextRateLimiter()` calls with custom limits (e.g., `max: 3` for expensive Opus routes, `max: 10` for standard routes).

**External service rate limiting:**

| Service | Rate Control |
|---------|-------------|
| **Claude API** | Exponential backoff: 1s → 2s → 4s (max 10s), 2 retries, then fallback model |
| **PubMed** | 100ms delay (with key) / 350ms (without); max 10/3 req/sec |
| **ArXiv** | 3-second mandatory delay |
| **BioRxiv** | 5-second delay |
| **ChemRxiv** | 429 retry with 5-second wait |
| **NIH RePORTER** | 650ms delay (100 req/min) |
| **NSF** | 200ms delay |
| **Dynamics** | 30-second timeout per request |

**Implementation note:** Rate limiter uses in-memory `Map()` storage, which resets on deployment and does not distribute across serverless function instances.

### 7.7 Access Control

| Control | Implementation |
|---------|---------------|
| **App-level access** | `requireAppAccess()` with per-user grants via Dataverse `wmkf_appuserappaccesses` *(formerly Postgres `user_app_access`, dropped 2026-05-12)*; OR logic for multi-app endpoints |
| **User data scoping** | All user-specific queries filter by `user_profile_id` derived from session (never from request params in production) |
| **Dynamics RBAC** | `superuser` / `read_only` / `read_write` roles with table/field restrictions |
| **Dynamics restriction enforcement** | Dual-layer: chat handler (user-facing) + DynamicsService (defense-in-depth) |
| **Dynamics audit trail** | Every CRM query logged with user, session, parameters, timing |
| **Dynamics write access** | Granted + verified 2026-04-14. Generic write paths active; specific writes are auditable via `wmkf_ai_run` rows for AI-driven writes and `policy_publish_audit` for policy publishes. |
| **Upload auth** | File uploads require authenticated session |
| **Blob proxy auth** | Blob downloads require authenticated session + URL validation |
| **Admin endpoints** | Superuser-only access enforced in-handler for admin stats, model management, role management, and app access management |

### 7.8 Error Handling & Information Disclosure

| Control | Implementation |
|---------|---------------|
| **NODE_ENV error guarding** | Outer API catch blocks return `error.message` only when `NODE_ENV === 'development'`; generic messages in production |
| **Inner helper functions** | Return static generic messages (e.g., `'An error occurred during evaluation'`, `'Tool execution failed'`), never `error.message` |
| **Re-thrown errors** | Inner-to-outer throws use generic messages (e.g., `'Failed to generate summary'`); outer catch is NODE_ENV-guarded and logs the full error server-side |
| **Health endpoint** | Service check errors guarded with `isDev` flag — production shows `'Service check failed'`, development shows full `error.message` |
| **Server-side logging preserved** | All catch blocks `console.error()` the full error before returning the generic client message |
| **Standardized error messages** | `BASE_CONFIG.ERROR_MESSAGES` provides generic constants (e.g., `PROCESSING_FAILED`, `DATABASE_ERROR`, `EMAIL_GENERATION_FAILED`) |

### 7.9 API Usage Logging

| Attribute | Detail |
|-----------|--------|
| **Table** | `api_usage_log` |
| **Fields** | user_profile_id, app_name, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, estimated_cost_cents, latency_ms, request_status, error_message |
| **Scope** | All Claude API calls across all apps (currently 16 in `shared/config/appRegistry.js`) |
| **Admin dashboard** | `/admin` — aggregated usage stats, per-app breakdowns, cost tracking (superuser only) |
| **Non-blocking** | Logging failures do not affect API response |

---

## 8. Security Findings & Recommendations

### Critical

#### C1: Client-Side API Key Storage Uses Base64 Encoding

**Finding:** When the encrypted database storage path fails or is unavailable, API keys fall back to `localStorage` with Base64 encoding (`btoa(apiKey)`). Base64 is encoding, not encryption — it is trivially reversible with `atob()` in browser dev tools or by any XSS payload.

**Location:** `shared/components/ApiKeyManager.js`

**Risk:** If an XSS vulnerability exists anywhere in the application, stored API keys can be exfiltrated.

**Recommendation:** Remove the localStorage fallback entirely, or use the Web Crypto API (`SubtleCrypto`) for client-side encryption. Prefer server-side-only key storage via the `user_preferences` encrypted path.

**Status: REMEDIATED.** localStorage fallback removed from `ApiKeyManager.js`, `ApiSettingsPanel.js`, `expense-reporter.js`, and `reviewer-finder.js`. API keys now require a user profile for storage (encrypted in database). Migration flow cleans up any legacy localStorage entries. Note: legacy Base64-encoded keys may still exist in users' browsers until they trigger the migration prompt.

#### C2: Blob Storage URLs Are Publicly Accessible

**Finding:** Vercel Blob URLs are accessible to anyone who knows the URL. While URLs include a random suffix (making guessing impractical), they are stored in the database and could be exposed through application vulnerabilities.

**Location:** `pages/api/upload-handler.js`, blob URLs stored in `proposal_searches` table (historical; this table is now drain-only post-W3-W6 cutover) <!-- drain-table:ignore reason=historical-finding -->

**Risk:** Proposal documents (potentially pre-decisional) could be accessed without authentication if URLs leak.

**Recommendation:** Implement a server-side proxy endpoint that validates authentication before serving blob content, or use Vercel Blob's signed URL feature for time-limited access.

**Status: REMEDIATED.** Added `/api/blob-proxy` endpoint that requires authentication, validates Vercel Blob URL format (hostname pattern matching + HTTPS enforcement), and streams content. All API responses now return proxied URLs instead of raw blob URLs. Direct blob domain removed from CSP `connect-src`.

#### C3: Dynamics Service Account Should Be Scoped

**Finding:** The Dynamics service principal (`DYNAMICS_CLIENT_ID`) likely has broad permissions in Dynamics 365. If `DYNAMICS_CLIENT_SECRET` is compromised, the attacker gains whatever permissions the service principal holds.

**Risk:** A leaked secret could allow unauthorized CRM data access or modification beyond what the application supports.

**Recommendation:** Create a dedicated Dynamics security role with read-only permissions on only the specific tables the application accesses. Assign this role to the service principal in Dynamics 365 admin. Audit the current permissions granted.

**Status: PENDING — requires Dynamics 365 admin action.** Create a custom security role `App - Document Processing (Read Only)` with Organization-level Read on the ~19 tables the app queries. Assign to the service principal and remove any broader roles. See implementation plan for full table list and step-by-step instructions.

### Medium

#### M1: Encryption Key Dev Fallback

**Finding:** If `USER_PREFS_ENCRYPTION_KEY` is not set, the encryption utility falls back to a hardcoded development key and logs a console warning. If this reaches production, all stored API keys would be encrypted with a publicly known key.

**Location:** `lib/utils/encryption.js`

**Recommendation:** Fail hard (throw/exit) if the env var is missing in production (`NODE_ENV=production`).

**Status: REMEDIATED.** `getEncryptionKey()` in `lib/utils/encryption.js` now throws in production if `USER_PREFS_ENCRYPTION_KEY` is unset. Dev fallbacks remain for local development.

#### M2: Dynamics Restrictions Are Application-Layer Only

**Finding:** CRM access restrictions (table/field blocks) were enforced only in the chat API handler. The `DynamicsService` class itself had no restriction awareness — any code that imports the service directly could bypass restrictions.

**Location:** `pages/api/dynamics-explorer/chat.js` (restriction check), `lib/services/dynamics-service.js`

**Recommendation:** Move restriction enforcement into the `DynamicsService` class so all code paths are protected.

**Status: REMEDIATED.** `DynamicsService` now has `setRestrictions()`, `checkRestriction()`, and `resolveLogicalName()` static methods. Restriction checks are enforced in `queryRecords`, `getRecord`, `countRecords`, `searchRecords`, and `getEntityAttributes`. The chat handler sets restrictions on the service via `DynamicsService.setRestrictions(restrictions)` at request start. Field-level matching bug (substring `includes` → exact split-and-match) also fixed in `chat.js`.

#### M3: Auth Bypass Allows Profile Switching

**Finding:** When `AUTH_REQUIRED=false`, the `requireAuthWithProfile()` function accepts `userProfileId` from the request body or query parameters. Any user can access any other user's data by passing a different profile ID.

**Location:** `lib/utils/auth.js`

**Recommendation:** This is acceptable for development but must never be enabled in production. Add a startup check that fails if `AUTH_REQUIRED=false` in a production environment.

**Status: REMEDIATED.** `isAuthRequired()` now logs a warning when auth is disabled in production. `requireAuthWithProfile()` returns 403 if `authBypassed` is true in production, preventing request-body profile ID impersonation.

#### M4: No HSTS Header

**Finding:** The application relied on Vercel's platform-level HTTPS redirect but did not set the `Strict-Transport-Security` header.

**Location:** `next.config.js`

**Recommendation:** Add `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

**Status: REMEDIATED.** HSTS header added to `next.config.js` `headers()` function, applied to all routes (`/:path*`).

#### M5: CORS Wildcard on SSE Streaming Routes

**Finding:** Server-Sent Events (SSE) streaming responses set `Access-Control-Allow-Origin: *` in the response handler (`shared/api/handlers/responseStreamer.js`). The `BASE_CONFIG.SECURITY.ALLOWED_ORIGINS` also defaults to `['*']` if the `ALLOWED_ORIGINS` env var is not set.

**Location:** `shared/api/handlers/responseStreamer.js`, `shared/config/baseConfig.js`

**Risk:** Overly permissive CORS allows any origin to make requests to API endpoints. While authentication still provides access control, a browser-based attack from a malicious site could make API calls on behalf of authenticated users.

**Status: REMEDIATED.** The `Access-Control-Allow-Origin: *` header was removed from `next.config.js` global headers and 10 inline SSE endpoints (Session 62), and from the shared `ResponseStreamer` class (Session 66). All SSE requests are same-origin and do not require CORS headers.

#### M6: Internal Error Messages Leaked to Clients

**Finding:** ~19 catch blocks across 8 API endpoints returned `error.message` directly to clients without guarding behind `NODE_ENV === 'development'`. <!-- fact-consistency:ignore fact=requireappaccess-endpoint-count reason=historical --> This included inner helper functions in evaluators, tool execution errors in Dynamics Explorer, email generation errors, re-thrown errors in document processors, and all service checks in the health endpoint. Leaked messages could expose database connection details, API error bodies, or stack-level information.

**Location:** `pages/api/evaluate-concepts.js`, `pages/api/evaluate-multi-perspective.js`, `pages/api/dynamics-explorer/chat.js`, `pages/api/reviewer-finder/generate-emails.js`, `pages/api/process.js`, `pages/api/process-phase-i.js`, `pages/api/process-phase-i-writeup.js`, `pages/api/health.js`

_(Historical as-of-finding paths. `evaluate-concepts.js` was later archived to `/_archived` when Concept Evaluator was retired 2026-04-25 — it is no longer a live route.)_

**Risk:** Internal implementation details could aid attackers in crafting targeted attacks against specific services or dependencies.

**Recommendation:** Use generic error messages in production; show detailed errors only in development. Ensure full errors are still logged server-side for debugging.

**Status: REMEDIATED.** Inner helper functions now return generic messages (e.g., `'An error occurred during evaluation'`, `'Tool execution failed'`). Re-thrown errors in document processors stripped of `error.message` interpolation (outer catch blocks were already NODE_ENV-guarded). Health endpoint service error messages guarded with `isDev` check — production returns `'Service check failed'`. All ~66 outer API catch blocks were already correctly guarded. Server-side `console.error()` logging preserved in all cases.

#### M7: Reviewer Suggestion Records Created with Wrong User Profile ID

**Finding:** Two API endpoints created `reviewer_suggestions` records with incorrect `user_profile_id` values, making the records invisible to the user who created them: <!-- drain-table:ignore reason=historical-finding -->

1. `save-candidates.js` accepted `userProfileId` from the request body. The ResearcherDetailModal's "Add to Proposal" flow did not send this field, resulting in `user_profile_id = NULL`. Since the my-candidates query filters on `user_profile_id = ${profileId}`, NULL records were invisible to all users.
2. `researchers.js` `handleCreate` copied `user_profile_id` from an existing `reviewer_suggestions` record for the same proposal. If the existing record belonged to a different user, the new association was invisible to the user who created it. <!-- drain-table:ignore reason=historical-finding -->

**Location:** `pages/api/reviewer-finder/save-candidates.js`, `pages/api/reviewer-finder/researchers.js` (historical; the `researchers.js` endpoint was retired W6 2026-05-12) <!-- drain-table:ignore reason=historical-finding -->

**Risk:** Data created by authenticated users was silently lost (invisible in their view). Additionally, `save-candidates.js` accepting `userProfileId` from the request body is the same class of vulnerability as M3 — a user could create records attributed to another user's profile.

**Status: REMEDIATED.** `save-candidates.js` uses `access.profileId` from the authenticated session as the source of truth for `user_profile_id` (falls back to the request body value only when auth is bypassed in dev mode). The `researchers.js` endpoint was retired entirely 2026-05-12 in W6 step 1 of the Postgres→Dataverse migration; the second leg of this finding therefore no longer has a live surface.

#### M8: No CSRF Protection Beyond SameSite Cookies

**Finding:** No explicit CSRF protection on POST/DELETE API routes beyond SameSite=Lax cookies. While SameSite=Lax mitigates most CSRF vectors (blocks cross-origin POST), it does not protect against attacks from subdomains or certain browser edge cases.

**Location:** `lib/utils/auth.js`

**Recommendation:** Add Origin header validation for state-changing methods (POST, PUT, PATCH, DELETE).

**Status: REMEDIATED.** Added `validateOrigin()` helper in `lib/utils/auth.js` that compares the `Origin` header (or `Referer` fallback) against `NEXTAUTH_URL` for state-changing methods. Called in both `requireAuth()` and `requireAppAccess()` after the auth kill switch check. GET/HEAD/OPTIONS are exempt. Missing headers are allowed through (covers cron jobs and server-to-server calls). Dev mode (`AUTH_REQUIRED=false`) bypasses the check entirely.

#### M9: Session Revocation for Disabled Accounts

**Finding:** Setting `is_active = false` on `user_profiles` blocks new logins but existing JWTs remained valid for up to 7 days.

**Location:** `lib/utils/auth.js`

**Recommendation:** Check `is_active` status during request authorization.

**Status: REMEDIATED.** `requireAppAccess()` now includes an `is_active` query in its parallel fetch (zero additional latency), cached alongside `apps` and `isSuperuser` with 2-minute TTL. Disabled accounts are blocked before the superuser bypass. `requireAuthWithProfile()` performs a direct `is_active` check (wraps in try/catch — session still valid if DB fails). Revocation effective within 2-minute cache window.

### Low

#### L1: No Blob Retention Policy — REMEDIATED

**Finding:** Uploaded files persist indefinitely in Vercel Blob. There is no cleanup process for old or orphaned files.

**Remediation:** Daily maintenance cron (`/api/cron/maintenance`) runs `MaintenanceService.cleanupBlobs()` which cross-references all blob URLs in Dataverse `wmkf_appgrantcycle.wmkf_reviewtemplateurl` and `wmkf_appreviewersuggestion` (`wmkf_summarybloburl` + `wmkf_reviewbloburl`, the latter historical-only post-2026-05-03 SharePoint cutover) against blob storage, and deletes orphaned files older than the configured retention period (default 90 days). Retention is configurable via Dataverse `wmkf_appsystemsettings`. (Post-W5 cutover; previously cross-referenced Postgres `proposal_searches`, `grant_cycles`, `reviewer_suggestions` with retention from `system_settings`.)

#### L2: No Encryption Key Rotation Mechanism — REMEDIATED

**Finding:** There is no current automated tooling to rotate `USER_PREFS_ENCRYPTION_KEY`. Rotation requires re-encrypting all values where `wmkf_isencrypted=true` in Dataverse `wmkf_appuserpreferences`.

**Status (2026-05-12):** The legacy CLI `scripts/rotate-encryption-key.js` operated against the Postgres `user_preferences` table and was archived to `scripts/archive/` when the Wave 1 tables were dropped. A Dataverse rewrite is pending; see `docs/CREDENTIALS_RUNBOOK.md` "Pending tooling" note. Manual rotation procedure: read all encrypted rows via the Dataverse adapter, decrypt with old key, re-encrypt with new key, PATCH back via the dispatcher. Secret expiration tracking in the admin dashboard and daily cron alerts still provide rotation reminders.

#### L3: Dynamics Audit Log Unbounded Growth — REMEDIATED

**Finding:** `dynamics_query_log` grows with every CRM query and has no archival or cleanup mechanism.

**Remediation:** Daily maintenance cron (`/api/cron/maintenance`) runs `MaintenanceService.cleanupQueryLog()` to delete records older than the configured retention period (default 365 days). Retention is configurable via Dataverse `wmkf_appsystemsettings` *(formerly Postgres `system_settings`, dropped 2026-05-12)*.

#### L4: Debug Information in Development

**Finding:** NextAuth debug mode is enabled in development (`debug: process.env.NODE_ENV === 'development'`). Error responses include detailed messages in development mode only.

**Location:** `pages/api/auth/[...nextauth].js`

**Recommendation:** Verify these are disabled in production builds (they are, via environment check).

#### L5: CSP Allows unsafe-inline and unsafe-eval

**Finding:** The Content Security Policy includes `'unsafe-inline'` for styles and scripts, and `'unsafe-eval'` for scripts. This weakens XSS protection.

**Location:** `next.config.js`

**Recommendation:** Migrate to nonce-based CSP when feasible. Note: Next.js requires `unsafe-eval` in development mode; consider a stricter policy for production only.

**Status: REMEDIATED.** CSP is now generated dynamically per-request in `proxy.js` with a unique cryptographic nonce. Production `script-src` no longer includes `'unsafe-inline'` or `'unsafe-eval'` — only `'self'`, the per-request nonce, and `https://va.vercel-scripts.com` (Vercel Analytics). The nonce is propagated to framework scripts via `pages/_document.js`. `'unsafe-inline'` is retained only in `style-src` (no script execution vector). Development mode retains `'unsafe-inline'` and `'unsafe-eval'` for Turbopack HMR compatibility. Static CSP removed from `next.config.js`.

#### L6: Rate Limiter Uses In-Memory Storage

**Finding:** Rate limiting state is stored in an in-memory `Map()` which resets on each serverless function cold start and does not distribute across function instances. This makes rate limiting ineffective for persistent abuse patterns.

**Location:** `shared/api/middleware/rateLimiter.js`

**Recommendation:** Migrate to a shared store (Redis, database-backed) if abuse becomes a concern. Current approach is acceptable for low-traffic internal tool.

#### L7: ArXiv API Uses HTTP

**Finding:** The ArXiv API is contacted over HTTP (`http://export.arxiv.org/api/query`) rather than HTTPS. Data transmitted is public research metadata only (titles, authors, abstracts).

**Location:** `lib/services/arxiv-service.js`

**Risk:** Minimal — data is already public. However, responses could theoretically be tampered with in transit.

**Recommendation:** Switch to `https://export.arxiv.org/api/query` if ArXiv supports HTTPS.

#### L8: Dynamics Restriction Violations Not Logged to Database — REMEDIATED

**Finding:** When a restriction blocks a CRM query, the denial is sent to the user via SSE and logged to console, but not persisted in the `dynamics_query_log` audit table.

**Location:** `pages/api/dynamics-explorer/chat.js`, `scripts/setup-database.js`

**Recommendation:** Log restriction violations (table, field, user, timestamp) to the audit table or a dedicated violations table for compliance tracking.

**Status: REMEDIATED.** V20 migration adds `was_denied` (BOOLEAN) and `denial_reason` (TEXT) columns to `dynamics_query_log` with a partial index on denied rows. The `logQuery()` function now accepts `wasDenied` and `denialReason` parameters. Restriction violations are logged with `wasDenied: true` and the restriction message. Denied queries are queryable via `SELECT * FROM dynamics_query_log WHERE was_denied = true`.

#### L9: Legacy NULL User Profile Data Visibility — REMEDIATED

**Finding:** `reviewer_suggestions` and `proposal_searches` rows with `user_profile_id = NULL` (created before the user profile system) are visible to all users via queries like `WHERE user_profile_id IS NULL OR user_profile_id = ${profileId}`. <!-- drain-table:ignore reason=historical-finding -->

**Location:** `pages/api/reviewer-finder/my-candidates.js`

**Risk:** Low — legacy data is organizational, not individually sensitive. But violates least-privilege principle.

**Recommendation:** Run a one-time migration to assign NULL records to a default profile, then remove the `IS NULL` fallback from queries.

**Status: REMEDIATED.** The two code paths that were creating new records with NULL or incorrect `user_profile_id` were fixed in M7 (all new records use `access.profileId`). For existing legacy NULL records, `scripts/assign-orphan-records.js` provides a CLI tool to assign them to a specified profile. Supports `--dry-run` for preview and `--profile-id <N>` for target assignment. Idempotent — re-running finds 0 orphans.

#### L10: API Usage Log Unbounded Growth — REMEDIATED

**Finding:** `api_usage_log` grows with every Claude API call across all apps ([17](CANONICAL_COUNTS.md#app-definition-count) in current registry) and has no archival or cleanup mechanism.

**Remediation:** Daily maintenance cron (`/api/cron/maintenance`) runs `MaintenanceService.cleanupUsageLog()` to delete records older than the configured retention period (default 90 days). Retention is configurable via Dataverse `wmkf_appsystemsettings` *(formerly Postgres `system_settings`, dropped 2026-05-12)*.

### Cron Job Security

Four Vercel Cron jobs run automated maintenance, monitoring, and analysis:

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| `/api/cron/maintenance` | Daily 3:00 AM UTC | Database/blob cleanup |
| `/api/cron/health-check` | Every 15 minutes | Service health monitoring |
| `/api/cron/secret-check` | Daily 8:00 AM UTC | Secret expiration alerts |
| `/api/cron/log-analysis` | Every 6 hours | Vercel error log analysis |

**Authentication:** Cron endpoints are excluded from the proxy JWT check (`proxy.js` matcher skips `/api/cron/*`) since Vercel cron requests carry `CRON_SECRET`, not a session cookie. Each handler verifies `Authorization: Bearer <CRON_SECRET>` via `lib/utils/cron-auth.js`. In development mode, auth is bypassed for local testing. Vercel automatically sends the `CRON_SECRET` header for configured cron jobs.

**Audit trail:** Maintenance jobs record results in `maintenance_runs` table. Health checks store results in `health_check_history`. All crons create alerts in `system_alerts` for dashboard visibility.

---

## 9. Environment Variable Reference

| Variable | Sensitivity | Required | Purpose | Rotation |
|----------|-------------|----------|---------|----------|
| `CLAUDE_API_KEY` | **High** | Yes | System default Claude API key | Per Anthropic policy |
| `POSTGRES_URL` | **High** | Yes | Database connection string (auto-set by Vercel) | Managed by Vercel |
| `NEXTAUTH_SECRET` | **High** | Yes (prod) | JWT session signing/encryption | Rotate if compromised |
| `NEXTAUTH_URL` | Low | Yes | Application base URL | Change on domain change |
| `AZURE_AD_CLIENT_ID` | Medium | Yes (prod) | Azure app registration ID | N/A (stable identifier) |
| `AZURE_AD_CLIENT_SECRET` | **High** | Yes (prod) | Azure OAuth secret | Every 90 days |
| `AZURE_AD_TENANT_ID` | Low | Yes (prod) | Azure organization tenant | N/A (stable identifier) |
| `AUTH_REQUIRED` | Low | No | Auth kill switch (`true`/`false`) | N/A |
| `DYNAMICS_URL` | Low | For CRM | Dynamics instance URL | N/A |
| `DYNAMICS_TENANT_ID` | Low | For CRM | Azure tenant for Dynamics | N/A |
| `DYNAMICS_CLIENT_ID` | Medium | For CRM | Dynamics app registration ID | N/A |
| `DYNAMICS_CLIENT_SECRET` | **High** | For CRM | Dynamics OAuth secret | Every 90 days |
| `SHAREPOINT_SITE_URL` | Low | Optional | SharePoint site URL for document access (has hardcoded default) | N/A |
| `USER_PREFS_ENCRYPTION_KEY` | **High** | Yes (prod) | AES-256 key for API key storage (64-char hex) | With re-encryption |
| `SERP_API_KEY` | Medium | Optional | SerpAPI Google search | Annually |
| `NCBI_API_KEY` | Low | Optional | PubMed higher rate limits | Annually |
| `ORCID_CLIENT_ID` | Medium | Optional | ORCID OAuth client | N/A |
| `ORCID_CLIENT_SECRET` | Medium | Optional | ORCID OAuth secret | Annually |
| `BLOB_READ_WRITE_TOKEN` | **High** | Yes | Vercel Blob access (auto-set) | Managed by Vercel |
| `CRON_SECRET` | **High** | Yes (prod) | Vercel cron endpoint authentication | Rotate periodically |
| `VERCEL_API_TOKEN` | **High** | Optional | Vercel REST API for log analysis cron | Per Vercel policy |
| `VERCEL_PROJECT_ID` | Low | Optional | Target project for log analysis | N/A |
| `NOTIFICATION_EMAIL_FROM` | Low | Optional | System-alert email sender (Dynamics transport). Recipients are the active superuser roster, queried at send time. | N/A |

**Key generation commands:**
```bash
# NEXTAUTH_SECRET
openssl rand -base64 32

# USER_PREFS_ENCRYPTION_KEY
openssl rand -hex 32
```

---

## 10. Appendix: Database Table Summary

| Table | Sensitivity | Scoping | Records | Content |
|-------|-------------|---------|---------|---------|
| `user_profiles` | Medium | Per-user | ~10s | Azure ID, email, display name |
| `user_preferences` *(now Dataverse `wmkf_appuserpreferences`)* | **High** | Per-user | ~50s | Encrypted API keys, settings |
| `user_app_access` *(now Dataverse `wmkf_appuserappaccesses`)* | Medium | Per-user | ~100s | Per-user app grants (app_key + granted_by) |
| `system_settings` *(now Dataverse `wmkf_appsystemsettings`)* | Medium | Global | ~10s | Model overrides, system configuration |
| `api_usage_log` | Medium | Per-user | Growing | Model, tokens, cost, latency per API call |
| `researchers` *(Postgres drain-only post-W6 2026-05-12)* | Low | Shared | ~1000s | Public academic profiles |
| `publications` *(Postgres drain-only; writer dead)* | Low | Shared | ~5000s | Public paper metadata |
| `researcher_keywords` *(Postgres drain-only; folded into Dataverse `wmkf_appresearcher.wmkf_keywords` for new rows)* | Low | Shared | Variable | Expertise areas for researchers |
| `grant_cycles` *(Postgres drain-only post-W3 2026-05-12; Dataverse `wmkf_appgrantcycle` is source of truth, ~10 rows)* | Low | Shared | ~10s | Cycle names, dates, templates |
| `proposal_searches` *(Postgres drain-only; `extract-summary` endpoint retired)* | Medium | Per-user | ~100s | Proposal metadata, blob URLs |
| `reviewer_suggestions` *(Postgres drain-only post-W3-W6; live state is Dataverse `wmkf_appreviewersuggestion`)* | Medium | Per-user | ~1000s | Reviewer-proposal matches, outreach status |
| `search_cache` | Low | Shared | Variable | Cached literature search results (6-month expiry) |
| `retractions` | Low | Shared | ~63,000 | Retraction Watch public data |
| `integrity_screenings` | Medium | Per-user | ~100s | Screening results |
| `screening_dismissals` | Low | Indirect per-user (via screening FK) | ~10s | False positive dismissals |
| `dynamics_user_roles` | Medium | Per-user | ~10s | CRM access roles |
| `dynamics_restrictions` | Medium | Global | ~10s | Table/field access blocks |
| `dynamics_query_log` | Medium | Per-user | Growing | CRM query audit trail |
| `system_alerts` | Low | Global | Growing | Operational alerts (severity, status, auto-resolve) |
| `health_check_history` | Low | Global | Growing | Health check trend data (services, response time) |
| `maintenance_runs` | Low | Global | Growing | Cleanup job audit trail (records processed/deleted) |

**Total tables: 21**

**SQL injection prevention:** All database queries across the entire codebase use parameterized `sql` template literals via `@vercel/postgres`. No string interpolation in SQL was found during audit.

**Foreign key integrity:** All per-user tables reference `user_profiles(id)` with appropriate cascade behavior (CASCADE DELETE for preferences and app access, SET NULL for suggestions/searches).

---

*Report generated from comprehensive codebase audit. All findings verified against source code as of March 2026.*
