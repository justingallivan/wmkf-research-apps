/**
 * App Registry - Single source of truth for all application definitions
 *
 * Used by Layout.js (navigation), index.js (home page), and access control.
 * App keys match the page path minus the leading slash.
 */

export const APP_REGISTRY = [
  // Concept Evaluator deprecated 2026-04-25 (Session 110). Concept-stage
  // screening workflow superseded; intake AI work moves to backend automation
  // post-cycle. Page + API + prompt archived to /_archived. Existing
  // user_app_access grants for 'concept-evaluator' are left in place — they
  // simply have no app to grant access to. A later cleanup pass can drop
  // those rows; not blocking.
  // Obsolete standalone tools are recorded in APP_LIFECYCLE_REGISTRY below.
  {
    key: 'review-panel',
    name: 'Review Panel',
    href: '/review-panel',
    icon: '⚖️',
    description: 'Virtual Review Panel Phase A — narrative-only AI seat reviews (Claude + OpenAI) synthesized by a Claude chair, blind and separate from the D26 Scientific dossier',
    categories: ['phase-ii'],
    features: ['Server-Scoped Roster', 'Blind Seat Reviews', 'Chair Synthesis', 'Private DOCX/PDF Editions'],
  },
  {
    key: 'reviewers',
    name: 'Workbench',
    href: '/workbench',
    icon: '🗂️',
    description: 'Request Workbench — per-request reviewer dashboard consolidating finding, inviting, tracking, and completing peer reviews across the review lifecycle (successor to Reviewer Finder + Review Manager)',
    categories: ['phase-ii'],
    features: ['Cycle Dashboard', 'Find + Invite + Track', 'Applicant Reviewers', 'Work-Remaining Cues'],
  },
  {
    key: 'meeting-tracker',
    name: 'Meeting Tracker',
    href: '/meeting-tracker',
    icon: '🗓️',
    description: 'Plan proposal discussion sessions, attendees, Zoom links, and the order of proposals',
    categories: ['phase-ii'],
    features: ['Session Planning', 'Proposal Schedule', 'Attendee Directory', 'Zoom Links'],
  },
  {
    key: 'proposal-ranking',
    name: 'Proposal Ranking',
    href: '/proposal-ranking',
    icon: '↕️',
    description: 'Prepare private proposal assessments, reveal the group starting order, and build a shared recommendation by funding cycle',
    categories: ['phase-ii'],
    features: ['Private Preparation', 'Combined Assessments', 'Group Discussion', 'Shared Facilitation'],
  },
  {
    key: 'expense-reporter',
    name: 'Expense Reporter',
    href: '/expense-reporter',
    icon: '💰',
    description: 'Extract and organize expense data from receipts and invoices with automated categorization',
    categories: ['other'],
    features: ['Receipt OCR', 'Image Processing', 'Auto-Categorization', 'Excel/CSV Export'],
  },
  {
    key: 'dynamics-explorer',
    name: 'Dynamics Explorer',
    href: '/dynamics-explorer',
    icon: '💬',
    description: 'Chat with your CRM data using natural language. Query, explore, and export Dynamics 365 records with AI-powered assistance',
    categories: ['other'],
    features: ['Natural Language Queries', 'Schema Discovery', 'Data Export', 'Multi-Turn Chat'],
  },
  {
    key: 'integrity-screener',
    name: 'Applicant Integrity Screener',
    href: '/integrity-screener',
    icon: '🔍',
    description: 'Screen grant applicants for research integrity concerns using automated Retraction Watch and news checks, with a manual PubPeer link',
    categories: ['phase-i', 'phase-ii'],
    features: ['Retraction Watch DB', 'Manual PubPeer Link', 'News Analysis', 'AI Summarization'],
  },

  {
    key: 'dataverse-bulk-export',
    name: 'Dataverse Bulk Export',
    href: '/dataverse-bulk-export',
    icon: '📤',
    description: 'Plain-English structured filter builder over akoya_request that emits a generous, trust-bounded, honestly-characterized Excel chunk with a baked-in reproducible Methods sheet — true FetchXML totals (never the /$count 5,000 undercount), forced era/type/amount/program choices, and fail-loud disclosure',
    categories: ['other'],
    features: ['Structured Filter Builder', 'True FetchXML Count', 'Forced Fan-Out Choices', 'Era + Disclosure Sentinels', 'Methods/Provenance Sheet', 'Confirm-Gated Run'],
  },
];

/** All app keys for convenience */
export const ALL_APP_KEYS = APP_REGISTRY.map(app => app.key);

/** App keys granted to new users by default */
export const DEFAULT_APP_GRANTS = ['dynamics-explorer'];

/**
 * App lifecycle registry — historical / non-active app keys and their state.
 *
 * SEPARATE from APP_REGISTRY on purpose. APP_REGISTRY is the single source of
 * truth for ACTIVE, navigable, grantable apps, and its consumers (Layout nav,
 * home page, app-access grant validation, ALL_APP_KEYS) must keep reading ONLY
 * APP_REGISTRY. This map exists so docs / CI / agents can explain historical
 * keys (consolidated, deprecated, direct-URL legacy) without re-adding them to
 * APP_REGISTRY.
 *
 * CONTRACT: every APP_REGISTRY key is implicitly `active` and is intentionally
 * NOT duplicated here. This registry covers ONLY keys whose lifecycle is
 * something other than "active + present in APP_REGISTRY". Never add an entry
 * for a key that already lives in APP_REGISTRY — that would create a second
 * source of truth for active apps that silently drifts.
 *
 * GATE NOTE: any future check that needs full app coverage (e.g. a
 * check:nomenclature-lifecycle gate) must union APP_REGISTRY (active) with
 * APP_LIFECYCLE_REGISTRY (non-active) — iterating this map alone silently
 * misses all active apps.
 *
 * See docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md and
 * docs/NOMENCLATURE_GLOSSARY.md.
 *
 * status values:
 *   'consolidated-into' — former identity now served by a successor app key
 *   'deprecated'        — retired and archived to _archived/
 *   'sunset-candidate'  — not navigable but still routable; archive pending a usage check
 *   'direct-url-test'   — live direct-URL / test surface, intentionally not in nav
 */
export const APP_LIFECYCLE_REGISTRY = {
  'batch-phase-i-summaries': {
    name: "Batch Phase I Summaries",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/batch-phase-i-summaries',
    archivedTo: '_archived/pages/batch-phase-i-summaries.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation.",
    lastVerified: '2026-11-19',
  },
  'batch-proposal-summaries': {
    name: "Batch Phase II Summaries",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/batch-proposal-summaries',
    archivedTo: '_archived/pages/batch-proposal-summaries.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation.",
    lastVerified: '2026-11-19',
  },
  'phase-i-writeup': {
    name: "Create Phase I Writeup Draft",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/phase-i-writeup',
    archivedTo: '_archived/pages/phase-i-writeup.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation.",
    lastVerified: '2026-11-19',
  },
  'phase-ii-writeup': {
    name: "Create Phase II Writeup Draft",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/phase-ii-writeup',
    archivedTo: '_archived/pages/phase-ii-writeup.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation.",
    lastVerified: '2026-11-19',
  },
  'phase-i-dynamics': {
    name: "Phase I (Dynamics)",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/phase-i-dynamics',
    archivedTo: '_archived/pages/phase-i-dynamics.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation.",
    lastVerified: '2026-11-19',
  },
  'multi-perspective-evaluator': {
    name: "Multi-Perspective Evaluator",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/multi-perspective-evaluator',
    archivedTo: '_archived/pages/multi-perspective-evaluator.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation.",
    lastVerified: '2026-11-19',
  },
  'funding-gap-analyzer': {
    name: "Funding Analysis",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/funding-gap-analyzer',
    archivedTo: '_archived/pages/funding-gap-analyzer.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation.",
    lastVerified: '2026-11-19',
  },
  'peer-review-summarizer': {
    name: "Summarize Peer Reviews",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/peer-review-summarizer',
    archivedTo: '_archived/pages/peer-review-summarizer.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation.",
    lastVerified: '2026-11-19',
  },
  'grant-reporting': {
    name: "Grant Reporting",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/grant-reporting',
    archivedTo: '_archived/pages/grant-reporting.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation. Preserve goals assessment, regeneration and archived editing logic; Word-based reporting is obsolete. Shared file classification stays active for Workbench.",
    lastVerified: '2026-11-19',
  },
  'literature-analyzer': {
    name: "Literature Analyzer",
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    pagePath: '/literature-analyzer',
    archivedTo: '_archived/pages/literature-analyzer.js',
    grantsRetained: true,
    notes: "Standalone interface retired; page and API implementations archived. Authenticated API stubs return 410. Prompts, services and historical data retained for future adaptation.",
    lastVerified: '2026-11-19',
  },
  'expertise-finder': {
    name: 'WMKF Expertise',
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-11-19',
    archivedTo: '_archived/pages/expertise-finder.js',
    grantsRetained: true,
    notes: 'Standalone matching retired. Admin owns roster editing; shared roster consumers remain live. Backend matching is separate. Existing grants confer no executable matching route.',
    lastVerified: '2026-11-19',
  },
  'cycle-dossier': {
    name: 'Scientific dossier',
    status: 'direct-url-test',
    pagePath: '/cycle-dossier',
    notes: 'D26 superuser pilot. Explicit superuser-only navigation and page/API authorization; not grantable through the active app registry.',
    lastVerified: '2026-09-07',
  },
  'reviewer-finder': {
    name: 'Reviewer Finder',
    status: 'consolidated-into',
    successorKey: 'reviewers',
    notes:
      'Consolidated into the Request Workbench (key: reviewers, /workbench). Infrastructure is still live under the /api/reviewer-finder/* namespace and existing user_app_access grants are still honored variadically — see ROUTE_NAMESPACE_LIFECYCLE.',
    lastVerified: '2026-06-26',
  },
  'review-manager': {
    name: 'Review Manager',
    status: 'consolidated-into',
    successorKey: 'reviewers',
    notes:
      'Consolidated into the Request Workbench (key: reviewers, /workbench). Infrastructure is still live under the /api/review-manager/* namespace and grants are honored variadically — see ROUTE_NAMESPACE_LIFECYCLE.',
    lastVerified: '2026-06-26',
  },
  'concept-evaluator': {
    name: 'Concept Evaluator',
    status: 'deprecated',
    successorKey: null,
    deprecatedAt: '2026-04-25',
    archivedTo: '_archived/pages/concept-evaluator.js',
    grantsRetained: true,
    notes:
      'Deprecated S110. Page / API / prompt archived to _archived/. Existing concept-evaluator grants left in place (no app to grant). multi-perspective-evaluator reuses some prompt content but is a distinct, separately retired app, not the successor.',
    lastVerified: '2026-06-26',
  },
  'phase-ii-writeup-legacy': {
    name: 'Phase II Writeup (legacy)',
    status: 'deprecated',
    successorKey: 'phase-ii-writeup',
    deprecatedAt: '2026-06-26',
    archivedTo: '_archived/pages/phase-ii-writeup-legacy.js',
    pagePath: '/phase-ii-writeup-legacy',
    notes:
      'Archived S291 (2026-06-26). Direct-URL legacy variant of phase-ii-writeup, which later became a sunset candidate in S344; not in nav and confirmed not in active use by the owner. Page + its API (/api/process-legacy) + prompt (proposal-summarizer-legacy) moved to _archived/. No dedicated grant key — the legacy page reused the phase-ii-writeup grant, so existing grants are unaffected.',
    lastVerified: '2026-06-26',
  },
  'virtual-review-panel': {
    name: 'Virtual Review Panel (legacy multi-LLM)',
    status: 'deprecated',
    successorKey: 'review-panel',
    deprecatedAt: '2026-10-04',
    archivedTo: '_archived/pages/virtual-review-panel.js',
    pagePath: '/virtual-review-panel',
    grantsRetained: true,
    notes:
      'Retired S573 by owner decision 2026-10-04 (supersedes Phase A decision D5 "unchanged"). Page, SSE API route, panel-review-service, literature-search-service, prompt file and output schema archived to _archived/. Successor is the source-built Review Panel (key review-panel, Executor-governed seats/chair). Postgres tables panel_reviews / panel_review_items retained with their history; existing user_app_access grants left in place. multi-llm-service.js and vrp-providers.js stay live for the successor\'s provider vocabulary.',
    lastVerified: '2026-10-04',
  },
  'test-email': {
    name: 'Test Email',
    status: 'direct-url-test',
    pagePath: '/test-email',
    notes: 'Live test surface (/test-email + /api/test-email). NOT an orphan; do not archive.',
    lastVerified: '2026-06-26',
  },
};

/**
 * Route-namespace lifecycle — legacy / borrowed API namespaces and notable
 * cross-cutting routes whose name no longer matches their owner app.
 *
 * Route PATHS are contracts: they have in-repo callers AND possible external
 * callers (Power Automate, Dynamics, bookmarks) that the repo cannot disprove.
 * Default action for a borrowed namespace is LEAVE+DOCUMENT, never rename. See
 * docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md §4 and
 * docs/NOMENCLATURE_GLOSSARY.md.
 *
 * ownerAppKey is a SEMANTIC label (the owning app, for humans/docs). It must NOT
 * be used to derive auth/grants — ownership is not the same as the accepted grant
 * set. legacySurfaceKey, when present, names the non-active lifecycle key the
 * route is associated with.
 *
 * guardAppKeys is the AUTH contract: the full set of app keys the namespace's
 * route(s) accept via requireAppAccess (OR logic — see lib/utils/auth.js). It is
 * verified against live route source by check:route-lifecycle-auth (fail-closed).
 * Set it to an array ONLY when every handler in the namespace shares one accepted
 * set (the gate asserts every handler's requireAppAccess args equal that set).
 * Set it to null (with a guardNote) when guards are heterogeneous per route; the
 * gate then asserts every route still carries a parseable requireAppAccess guard
 * (fail-closed — an aliased/missing guard is not silently accepted) AND that the
 * accepted sets genuinely vary, rather than a uniform set you forgot to list.
 *
 * status values:
 *   'canonical'          — current, correctly-named namespace
 *   'legacy-live'        — legacy app name, but owned by a live app (borrowed-live-infra)
 *   'sunset-candidate'   — routable but archive-pending a usage check
 *   'live-cross-cutting' — live, persists/serves durable state across apps; recognize & skip
 */
export const ROUTE_NAMESPACE_LIFECYCLE = {
  '/api/proposal-ranking': {
    status: 'canonical',
    ownerAppKey: 'proposal-ranking',
    guardAppKeys: ['proposal-ranking'],
    notes: 'Private PD rankings and program meeting orders. Runtime activation requires explicit schema and feature readiness.',
    lastVerified: '2026-10-07',
  },
  '/api/admin/proposal-ranking-facilitator': {
    status: 'canonical',
    ownerAppKey: 'proposal-ranking',
    guardAppKeys: ['proposal-ranking'],
    notes: 'Default facilitator configuration additionally requires superuser authority and an explicit app grant.',
    lastVerified: '2026-10-07',
  },
  '/api/workbench': {
    status: 'canonical',
    ownerAppKey: 'reviewers',
    guardAppKeys: null,
    guardNote:
      'Heterogeneous per-route guards: most handlers accept ["reviewers"] only (e.g. dashboard.js, export-candidates.js); a few also accept "reviewer-finder" (manual-reviewer.js, orcid-lookup.js, reviewer-lookup.js, reviewer-roster.js). No single namespace-wide accepted set; check:route-lifecycle-auth asserts every route carries a parseable requireAppAccess guard (fail-closed) and that the accepted sets genuinely vary.',
    notes: 'Canonical successor namespace for the Request Workbench.',
    lastVerified: '2026-06-26',
  },
  '/api/reviewer-finder': {
    status: 'legacy-live',
    ownerAppKey: 'reviewers',
    guardAppKeys: ['reviewer-finder', 'reviewers'],
    migrationDecision: 'LEAVE+DOCUMENT',
    notes:
      'Borrowed-live-infra. Legacy app name; owned by reviewers (Workbench). Called in-repo from many reviewer components and possibly externally. Routes accept BOTH a legacy reviewer-finder grant and a reviewers grant via variadic requireAppAccess. Do not rename the path.',
    lastVerified: '2026-06-26',
  },
  '/api/review-manager': {
    status: 'legacy-live',
    ownerAppKey: 'reviewers',
    guardAppKeys: ['review-manager', 'reviewers'],
    migrationDecision: 'LEAVE+DOCUMENT',
    notes:
      'Borrowed-live-infra. Legacy app name; owned by reviewers (Workbench). Variadic grant accepts legacy review-manager AND reviewers. Do not rename the path.',
    lastVerified: '2026-06-26',
  },
  '/api/field-primer': {
    status: 'live-cross-cutting',
    ownerAppKey: 'reviewers',
    guardAppKeys: ['reviewer-finder', 'reviewers'],
    migrationDecision: 'LEAVE+DOCUMENT',
    notes:
      'NOT legacy. /api/field-primer/generate persists akoya_request.wmkf_ai_fieldprimer (called from the Workbench ProposalTab, read back via resolve-request) and is guarded by requireAppAccess(req, res, "reviewer-finder", "reviewers"). Recognize & skip — do not rename or deprecate.',
    lastVerified: '2026-06-26',
  },
};
