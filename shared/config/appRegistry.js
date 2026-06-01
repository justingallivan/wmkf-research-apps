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
  {
    key: 'batch-phase-i-summaries',
    name: 'Batch Phase I Summaries',
    href: '/batch-phase-i-summaries',
    icon: '📑',
    description: 'Process multiple Phase I proposals simultaneously with customizable summary length',
    categories: ['phase-i'],
    features: ['Batch Processing', 'Phase I Specific', 'Custom Length', 'Bulk Export'],
  },
  {
    key: 'batch-proposal-summaries',
    name: 'Batch Phase II Summaries',
    href: '/batch-proposal-summaries',
    icon: '📑',
    description: 'Process multiple Phase II proposals simultaneously with customizable summary length',
    categories: ['phase-ii'],
    features: ['Batch Processing', 'Custom Length', 'Multi-File Upload', 'Bulk Export'],
  },
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
    key: 'phase-i-writeup',
    name: 'Create Phase I Writeup Draft',
    href: '/phase-i-writeup',
    icon: '✍️',
    description: 'Generate Keck Foundation Phase I writeup drafts with standardized formatting',
    categories: ['phase-i'],
    features: ['PDF Analysis', '1-Page Format', 'Institution Detection', 'Export Options'],
  },
  {
    key: 'phase-ii-writeup',
    name: 'Create Phase II Writeup Draft',
    href: '/phase-ii-writeup',
    icon: '✍️',
    description: 'Generate Keck Foundation Phase II writeup drafts with standardized formatting',
    categories: ['phase-ii'],
    features: ['PDF Analysis', 'Claude AI Drafts', 'Q&A Chat', 'Export Options'],
  },
  {
    key: 'reviewer-finder',
    name: 'Reviewer Finder',
    href: '/reviewer-finder',
    icon: '🎯',
    description: 'Find qualified peer reviewers using Claude AI analysis combined with real database verification (PubMed, ArXiv, BioRxiv, ChemRxiv)',
    categories: ['phase-i', 'phase-ii'],
    features: ['Claude AI Analysis', 'Database Verification', 'Publication Links', 'Reasoning Explanations'],
  },
  {
    key: 'review-manager',
    name: 'Review Manager',
    href: '/review-manager',
    icon: '📋',
    description: 'Manage the peer review lifecycle: send materials, track progress, send reminders, and collect completed reviews',
    categories: ['phase-i', 'phase-ii'],
    features: ['Review Tracking', 'Email Templates', 'Status Pipeline', 'Document Upload'],
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

/** Paths that are always accessible (no app grant required) */
export const ALWAYS_ACCESSIBLE = ['/', '/admin', '/guide', '/profile-settings', '/auth/signin', '/auth/error'];

/** App keys granted to new users by default */
export const DEFAULT_APP_GRANTS = ['dynamics-explorer'];
