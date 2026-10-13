# System Overview refresh — editorial evidence

Date: 2026-10-12 (America/Los_Angeles).

## Scope

Sweep mode: **A — changed overview snapshot**. Replace the February inventory with a
leadership-facing account of the suite at main commit `3092206363a9532cbfb58ceb3ec1c6eef4570745`.
`git fetch origin` completed; local main and origin/main matched. The checkout was clean.
This is an editorial refresh, not a production certification or a whole-system audit.

In scope: `docs/SYSTEM_OVERVIEW.md`, its generated catalogue entry, and references describing
that document. Historical audits and the historical AI prompt overview remain historical.
The source registry and operational contracts remain authoritative; the overview remains
`canonical: false`. No runtime, configuration, production data, or release changes.

## Claim evidence

| Overview claim | Producer / source | Persistence and consumer | Evidence and boundary |
|---|---|---|---|
| Current app inventory and retired upload tools | `shared/config/appRegistry.js`: `APP_REGISTRY`, `APP_LIFECYCLE_REGISTRY` | Registry feeds navigation, home and app grants | VERIFIED via current source: 14 active entries; older batch/writeup upload apps are excluded. Registry presence does not prove operational acceptance. |
| Connected Workbench workflow | `pages/workbench/[requestId].js`; field-primer and grantee generation routes; `StaffDeliberationsPanel` source exploration | Grant/reviewer state in Dataverse; working files in SharePoint; Workbench tabs consume them | VERIFIED source mounting and route contracts, supported by DEVELOPMENT_LOG release entries for Initial Assessment, reviewer lifecycle, staff deliberations and group review. Human handoffs remain explicit. |
| Leadership review and notifications | Final Writeup lifecycle; DEVELOPMENT_LOG Sessions 580–584 | Dataverse writeup/review state; Postgres email ledgers; dashboards and recipients | Recorded production release evidence; notification scope is Research. First actual leadership digest was not observed at the release checkpoint. The overview does not assert observed delivery to every recipient. |
| Recording and Board presentation workflow | DEVELOPMENT_LOG Sessions 586–595; `lib/services/post-presentation-materials/presentation-page-service.js` | SharePoint documents/video, Dataverse artifact references, operational job state; staff and external pages | VERIFIED source allowlist excludes full recording and discussion artifacts. Recorded acceptance is request-bounded. Current page permits only bound presentation artifacts plus applicant materials/proposal. |
| Review Panel supplements human review | `lib/services/review-panel-rollout.js`; `docs/atlas/postgres-review-panel.md` current lifecycle section | Postgres run/attempt state, private report files; standalone page and permission-gated Workbench tab | Source supports access mode. Recorded production activation and completed smoke panels on September 13; not misclassified as an unbuilt plan or the retired legacy panel. |
| Proposal Ranking readiness | Registry; `docs/audits/PROPOSAL_RANKING_PRODUCTION_RELEASE_2026-10-07.md`; current SESSION_PROMPT | Ranking records and participant/facilitator page | Recorded production activation and read-only pool/access check. Multi-person acceptance remains pending; further work paused. Not described as an already-completed live ranking round. |
| Shared records, document storage and permissions | CLAUDE.md source-of-truth pointers; inspected routes, registry and sharing service; Application State Atlas references in release records | Dataverse, SharePoint, operational Postgres/private storage; authenticated staff and scoped external surfaces | Source/repository evidence only. Avoided blanket claims that every app is AI-powered, every record is per-user, or every route has identical security controls. No new external-state probe. |
| Selective automation and remaining scope | Reviewer-reminder hold gate; SYSTEM_MODEL capabilities; current SESSION_PROMPT | Configured workers and offline operations | Hold gate passed; intake replacement parked; honorarium payment automation not claimed. Admin prompt/model editability is supported by Session 598 release evidence and later main commits. |

## Restatement reconciliation and falsification

- **STALE:** old overview header, historical frontmatter, retired app table, Claude-only wording,
  codebase statistics, technology versions, and blanket isolation/security assertions. Replaced
  structurally rather than leaving conflicting paragraphs below an update banner.
- **STALE:** generated `DOCS_CATALOG.md` entry. Regenerated from the new frontmatter.
- **AGREE:** SYSTEM_MODEL calls this a dated inventory, not a live authority. Still accurate:
  the new overview is a dated leadership snapshot and remains noncanonical.
- **HISTORICAL:** prior audit references under `docs/archive/`, dated S154 audits, the July
  semantic inspection, and the S166 retirement note in
  `.claude-memory/project-app-roadmap-2026-04-25.md`. No operational direction changed there.
- **UNRELATED:** SECURITY_ARCHITECTURE's own “System Overview” heading.

Disconfirming checks: compared every app-table member with the current registry; read the
lifecycle exclusions; checked the Board artifact allowlist for full-recording/discussion exposure;
checked Review Panel access-mode source and recorded activation; checked Proposal Ranking's
acceptance boundary instead of treating its active registry entry as completed adoption.

## Validation and limits

All 70 `check:*` scripts in package.json ran sequentially at startup and returned zero; the
additional factory-ledger `--allow-unreachable` invocation also returned zero. This includes
self-tests, documentation gates, type checking and the reminder-hold check. No additional gate
was missing from the start skill's list. Memory-router output was below its routine-audit trigger.

After editing, regenerated the document catalogue and reran documentation currency, scalar
consistency, canonical pointers, catalogue parity, symbol references and build-claim freshness
(with their defined self-tests), plus whitespace checks. These validate repository consistency,
not production behavior or the quality of AI output.

Verdict: **RECONCILED within the overview-refresh scope.** No remaining live stale overview
restatements identified. Current external configuration, all-user acceptance, usage volume,
quantified time savings and portfolio-wide reliability were not independently measured;
those claims are excluded. The leadership text explicitly retains ranking, media acceptance,
automation and intake boundaries.
