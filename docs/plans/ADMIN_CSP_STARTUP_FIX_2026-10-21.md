---
title: Admin CSP Startup Failure and Fix
domain: security
kind: decision
status: active
summary: Request-time rendering supplies matching CSP nonces after Next 16.4.2 introduced inline startup for static Pages routes; production promotion remains pending.
canonical: false
owner: product-engineering
---

# Admin startup failure — 2026-10-21

## Evidence and cause

[VERIFIED via live Chrome console] A fresh authenticated Admin load showed Loading and Checking indefinitely. Chrome blocked the inline startup script under script-src. The executable script had an empty nonce while the response policy required a generated nonce. No business-record writes or permission changes were used to diagnose this.

[VERIFIED via isolated version comparison] The same minimal Pages Router Admin component and repository Document, built with Turbopack on Next 16.3.8 and then 16.4.2, produced zero versus one executable inline startup scripts respectively. The latter carried `nonce=""`. This isolates the framework-version trigger; the missing request nonce was a latent static-rendering mismatch. Dependency commit `79c20aa0a` updated Next from 16.3.8 to 16.4.2 on October 19 and its Production deployment was created at 12:20 p.m. Pacific. Today's refactoring release need not edit Admin itself to preserve the failure. Earlier access through an already-hydrated document or client-side navigation is plausible but the owner's exact earlier navigation path is UNKNOWN.

[VERIFIED via local production builds] Before the fix, Admin and the external reviewer portal appeared as static routes. The new browser regression failed on the original 16.4.2 build because the inline script carried an empty nonce. After the fix both routes render on demand; the portal hydrates under the unchanged script policy, and authenticated synthetic Admin requests have distinct matching nonces.

## Fix and contract

`pages/_app.js` delegates its App initial-props hook to Next's standard App loader. This disables automatic static optimization for Pages routes without changing existing page props or page-level server-side loaders. Source census found no page-level getStaticProps/getStaticPaths exports; introducing those later requires a separate CSP review. Static framework error documents are outside this page-startup acceptance claim.

The flow is request → existing proxy auth and nonce/CSP headers → request-rendered App/Document → Head/NextScript nonce → browser startup → existing session/API loading. No database, API payload, authorization, CSP allowlist, mail or storage contract changes. Partial-success, background-state and enum/persistence fan-out audits are N/A. The App hook returns Next's initial-props promise without client state writes or additional requests. The rendering tradeoff is server work on each initial load instead of pre-rendered page HTML; static assets stay cacheable.

Playwright now builds with deployed Turbopack rather than webpack. Its new CSP regression checks browser hydration, the script policy, nonce-bearing inline startup, and fresh authenticated Admin HTML. Existing staff tests and the new test use only the same throwaway local JWT secret. Shared App, Document and proxy edits now trigger the browser CI job.

## Verification and release boundary

- Original Turbopack production build: reproduced empty-nonce failure in the new regression.
- Fixed canonical production build: passed; Admin and reviewer portal are dynamic.
- Focused App/nonce/auth/security/Admin unit coverage: 4 suites, 43 tests passed.
- Full browser suite against fixed Turbopack production server: 36 passed. An initial local full-suite attempt used a different throwaway server secret from the existing staff fixtures; that setup was corrected before the successful full run.
- Scoped lint and relevant type, architecture, API-security, prompt-tagging and secret gates passed. Documentation gates and final recheck are recorded in the commit/PR evidence.

[PLANNED] Production promotion requires the owner's explicit merge/push decision under Tier 2 of `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Before promotion, use the PR's integrated local evidence and review its final diff. After promotion, verify a fresh authenticated Admin load, People & Access roles, and absence of startup CSP errors. Last observed Production deployment before this fix: GitHub deployment 7239988158 at `301eaedc8`; it exhibits the incident and is not a claimed working rollback. The immediately preceding refactoring release was `73c5fb36f`, deployment 7238690219. No safe pre-upgrade production deployment has been re-verified. Code rollback to either retains the defect; no business writes are introduced by this fix.

## Bounded changed-fact reconciliation

Mode A covers rendering and the browser-harness bundler. Authority is source, isolated builds, live console and regression results. Producer/consumer chain is described above; persistence is none. Active harness README, memory, wiki, config comments and CI comments were reconciled; dated historical build evidence remains historical. Searches for the old webpack-only harness instruction were repeated. This is not a general security or documentation audit, nor proof of production recovery before promotion.
