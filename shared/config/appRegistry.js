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
  {
    key: 'multi-perspective-evaluator',
    name: 'Multi-Perspective Evaluator',
    href: '/multi-perspective-evaluator',
    icon: '🎭',
    description: 'Evaluate concepts using three AI perspectives (Optimist, Skeptic, Neutral) with integrated synthesis and recommendations',
    categories: ['concepts'],
    features: ['3 AI Perspectives', 'Consensus Analysis', 'Disagreement Resolution', 'Framework Selection'],
  },
  // Sunset 2026-07-08 (S344): batch-phase-i-summaries, batch-proposal-summaries,
  // phase-i-writeup, and phase-ii-writeup are no longer used in their current
  // (PDF-upload) format. Removed from APP_REGISTRY so they leave nav/home/admin
  // grant UI; pages + API routes remain routable and the code is intentionally
  // retained as the reference for a planned Dataverse-native migration (e.g.
  // Phase I writeup elements moving into the Request Workbench). See
  // APP_LIFECYCLE_REGISTRY (status: sunset-candidate) below and
  // docs/PROMPT_LEGACY_AUDIT.md.
  {
    key: 'funding-gap-analyzer',
    name: 'Funding Analysis',
    href: '/funding-gap-analyzer',
    icon: '💵',
    description: 'Analyze federal funding landscapes for research proposals using NSF, NIH, and USAspending.gov data',
    categories: ['phase-i', 'phase-ii'],
    features: ['NSF Awards API', 'NIH RePORTER', 'USAspending.gov', 'Funding Gap Analysis'],
  },
  {
    key: 'reviewers',
    name: 'Reviewers',
    href: '/workbench',
    icon: '🗂️',
    description: 'Request Workbench — per-request reviewer dashboard consolidating finding, inviting, tracking, and completing peer reviews across the review lifecycle (successor to Reviewer Finder + Review Manager)',
    categories: ['phase-ii'],
    features: ['Cycle Dashboard', 'Find + Invite + Track', 'Applicant Reviewers', 'Work-Remaining Cues'],
  },
  {
    key: 'peer-review-summarizer',
    name: 'Summarize Peer Reviews',
    href: '/peer-review-summarizer',
    icon: '📝',
    description: 'Analyze peer review feedback and generate site visit questions',
    categories: ['phase-ii'],
    features: ['Review Analysis', 'Common Themes', 'Action Items', 'Response Templates'],
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
    key: 'literature-analyzer',
    name: 'Literature Analyzer',
    href: '/literature-analyzer',
    icon: '📖',
    description: 'Comprehensive analysis and synthesis of research papers and academic literature',
    categories: ['other'],
    features: ['Paper Synthesis', 'Theme Extraction', 'Cross-Paper Synthesis', 'Export Reports'],
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
    description: 'Screen grant applicants for research integrity concerns using Retraction Watch, PubPeer, and news sources',
    categories: ['phase-i', 'phase-ii'],
    features: ['Retraction Watch DB', 'PubPeer Search', 'News Analysis', 'AI Summarization'],
  },
  {
    key: 'expertise-finder',
    name: 'WMKF Expertise',
    href: '/expertise-finder',
    icon: '🧠',
    description: 'Match grant proposals to internal staff, consultants, and board members using AI-powered expertise analysis',
    categories: ['phase-i', 'phase-ii'],
    features: ['Staff Assignment', 'Consultant Matching', 'Board Interest', 'Roster Management'],
  },
  {
    key: 'virtual-review-panel',
    name: 'Virtual Review Panel',
    href: '/virtual-review-panel',
    icon: '🧑‍⚖️',
    description: 'Multi-LLM review panel that evaluates grant proposals against WMKF reviewer criteria with claim verification and structured review synthesis',
    categories: ['phase-ii'],
    features: ['Multi-LLM Panel', 'Claim Verification', 'Structured Review', 'Panel Synthesis', 'Cost Tracking'],
  },
  {
    key: 'grant-reporting',
    name: 'Grant Reporting',
    href: '/grant-reporting',
    icon: '📊',
    description: 'Extract grantee progress/final reports into an editable form, compare goals vs. achievements against the original proposal, and export a Word doc matching the Keck final report template',
    categories: ['phase-ii'],
    features: ['PDF + DOCX Input', 'Dynamics Auto-Fill', 'SharePoint Proposal Lookup', 'Goals Assessment', 'Editable Form', 'Word Export'],
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
      'Deprecated S110. Page / API / prompt archived to _archived/. Existing concept-evaluator grants left in place (no app to grant). multi-perspective-evaluator reuses some prompt content but is a distinct active app, not the successor.',
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
      'Archived S291 (2026-06-26). Direct-URL legacy variant of the active phase-ii-writeup app; not in nav and confirmed not in active use by the owner. Page + its API (/api/process-legacy) + prompt (proposal-summarizer-legacy) moved to _archived/. No dedicated grant key — the legacy page reused the active phase-ii-writeup grant, so existing grants are unaffected.',
    lastVerified: '2026-06-26',
  },
  'phase-i-dynamics': {
    name: 'Phase I (Dynamics)',
    status: 'direct-url-test',
    pagePath: '/phase-i-dynamics',
    notes: 'Live direct-URL surface, intentionally not in home nav. NOT an orphan; do not archive.',
    lastVerified: '2026-06-26',
  },
  'test-email': {
    name: 'Test Email',
    status: 'direct-url-test',
    pagePath: '/test-email',
    notes: 'Live test surface (/test-email + /api/test-email). NOT an orphan; do not archive.',
    lastVerified: '2026-06-26',
  },
  // Sunset S344 (2026-07-08): the four PDF-upload document-processing apps are no
  // longer used in their current format. Removed from APP_REGISTRY (out of nav /
  // home / admin grant UI) but pages + API routes are intentionally LEFT ROUTABLE
  // and the code is retained as the reference for a planned Dataverse-native
  // migration (e.g. Phase I writeup elements → Request Workbench, an unbuilt
  // feature). NOT 'deprecated' — nothing was archived to _archived/. Existing
  // user_app_access grants are retained (honored on read by requireAppAccess;
  // only NEW grants are blocked since the keys left ALL_APP_KEYS). The structured
  // extraction all four share (proposal-summarizer.createStructuredDataExtractionPrompt,
  // formerly the phase-ii.extract-structured prompt) is the surface the S343
  // prompt-legacy audit flagged for Dataverse-native re-scope — see
  // docs/PROMPT_LEGACY_AUDIT.md.
  'batch-phase-i-summaries': {
    name: 'Batch Phase I Summaries',
    status: 'sunset-candidate',
    successorKey: null,
    sunsetAt: '2026-07-08',
    pagePath: '/batch-phase-i-summaries',
    apiRoute: '/api/process-phase-i',
    grantsRetained: true,
    notes:
      'Sunset S344. PDF-upload batch Phase I summarizer. Page + /api/process-phase-i retained/routable; code kept for Dataverse-native migration. Shares createStructuredDataExtractionPrompt.',
    lastVerified: '2026-07-08',
  },
  'batch-proposal-summaries': {
    name: 'Batch Phase II Summaries',
    status: 'sunset-candidate',
    successorKey: null,
    sunsetAt: '2026-07-08',
    pagePath: '/batch-proposal-summaries',
    apiRoute: '/api/process',
    grantsRetained: true,
    notes:
      'Sunset S344. PDF-upload batch Phase II summarizer. Page + /api/process retained/routable (/api/process is also used by phase-ii-writeup). Code kept for Dataverse-native migration. Shares createStructuredDataExtractionPrompt.',
    lastVerified: '2026-07-08',
  },
  'phase-i-writeup': {
    name: 'Create Phase I Writeup Draft',
    status: 'sunset-candidate',
    successorKey: null,
    sunsetAt: '2026-07-08',
    pagePath: '/phase-i-writeup',
    apiRoute: '/api/process-phase-i-writeup',
    grantsRetained: true,
    notes:
      'Sunset S344. PDF-upload Phase I writeup drafter. Page + /api/process-phase-i-writeup retained/routable; code kept as the direct reference for the planned Dataverse-native Phase I writeup feature in the Request Workbench (unbuilt). Shares createStructuredDataExtractionPrompt.',
    lastVerified: '2026-07-08',
  },
  'phase-ii-writeup': {
    name: 'Create Phase II Writeup Draft',
    status: 'sunset-candidate',
    successorKey: null,
    sunsetAt: '2026-07-08',
    pagePath: '/phase-ii-writeup',
    apiRoute: '/api/process',
    grantsRetained: true,
    notes:
      'Sunset S344. PDF-upload Phase II writeup drafter. Page + /api/process retained/routable (/api/process is shared with batch-proposal-summaries). Code kept for Dataverse-native migration. Shares createStructuredDataExtractionPrompt.',
    lastVerified: '2026-07-08',
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
