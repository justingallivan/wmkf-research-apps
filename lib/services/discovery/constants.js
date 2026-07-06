/**
 * DiscoveryService shared constants — Stage 0 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Two kinds of value live here, extracted VERBATIM from discovery-service.js as a
 * behavior-freeze:
 *
 *   1. The 10 domain constants that were `static` class properties on DiscoveryService.
 *      The facade re-exposes each as a `static X = C.X` property so existing external
 *      reads (DiscoveryService.MIN_PUBLICATIONS / .YEARS_LOOKBACK / .TRACK_B_ENABLED /
 *      .OPENALEX_PUB_BACKFILL_CONCURRENCY) keep resolving, AND so a test that mutates
 *      `DiscoveryService.MIN_PUBLICATIONS` still overrides the class's own property
 *      (the facade's delegating wrappers pass the live value in — plan constraint C1).
 *      The extracted per-cluster modules `require` these read-only values directly.
 *
 *   2. The 3 env-derived module constants (DEBUG / NCBI_API_KEY / PUBMED_DELAY). These
 *      were top-of-file `const`s in discovery-service.js; centralizing them here means
 *      every extracted module reads ONE evaluation of process.env rather than
 *      re-deriving it (plan constraint C7). They are NOT class statics and are never
 *      read as `DiscoveryService.X`, so the facade does not re-expose them.
 */

// ── Domain constants (were `static` props on DiscoveryService) ──────────────────────

// Minimum publications in last 5 years to be considered "active"
const MIN_PUBLICATIONS = 3;
const YEARS_LOOKBACK = 5;
// Coauthor-COI grading (S238): >= this many shared papers with ANY single proposal
// author marks a 'likely' (strong) conflict; fewer is 'possible' (may be incidental).
const COAUTHOR_COI_STRONG_MIN = 3;
const VERIFICATION_STATUSES = {
  UNRESOLVED: 'unresolved',
  AMBIGUOUS: 'ambiguous',
  PROBABLE: 'probable',
  VERIFIED: 'verified',
};
const VERIFICATION_SKIPPED_REASON = 'Verification skipped — PubMed off / no verifier for this field.';
const TRACK_B_IDENTITY_RESOLUTION_LIMIT = 25;
// Track B = DB keyword→author ORIGINATION (PubMed/arXiv/bioRxiv/chemRxiv search →
// authors as new candidates). ARCHIVED OFF (S248): it contributed ~0 to saved panels,
// added ~27s of latency, and surfaced off-organism/trainee/deceased noise on thin
// signal (see docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md + agent-wiki
// reviewer-origination "Track B — archived"). The code below is left INTACT and
// dormant for future repurposing — flip this one constant to re-enable. This switch
// is deliberately code-level, NOT `searchPubmed` (that flag also routes Track-A
// verification — see suggestionVerifierRouting) and NOT a user/admin toggle.
const TRACK_B_ENABLED = false;

// OpenAlex publication-backfill bounds (used by backfillOpenAlexPublications; the
// concurrency value is read directly by discovery-openalex-publications.test.js).
const OPENALEX_PUB_BACKFILL_LIMIT = 5;
const OPENALEX_PUB_BACKFILL_CONCURRENCY = 4;

const NICKNAME_MAP = {
  will: 'William',
  bill: 'William',
  bob: 'Robert',
  rob: 'Robert',
  mike: 'Michael',
  jim: 'James',
  joe: 'Joseph',
  tom: 'Thomas',
  dan: 'Daniel',
  dave: 'David',
  ed: 'Edward',
  ted: 'Edward',
  ben: 'Benjamin',
  matt: 'Matthew',
  chris: 'Christopher',
  alex: 'Alexander',
  nick: 'Nicholas',
  tony: 'Anthony',
  steve: 'Steven',
  tim: 'Timothy',
  sam: 'Samuel',
  andy: 'Andrew',
  drew: 'Andrew',
  pete: 'Peter',
  pat: 'Patrick',
  greg: 'Gregory',
  phil: 'Philip',
  ken: 'Kenneth',
  kate: 'Katherine',
  kathy: 'Katherine',
  cathy: 'Catherine',
  liz: 'Elizabeth',
  beth: 'Elizabeth',
  sue: 'Susan',
  jenny: 'Jennifer',
  jen: 'Jennifer',
  meg: 'Margaret',
  maggie: 'Margaret',
  peg: 'Margaret',
  sally: 'Sarah',
  vicky: 'Victoria',
  vic: 'Victoria',
  nicky: 'Nicole',
};

// ── Env-derived runtime config (were module-level `const`s in discovery-service.js) ──

// Enable verbose logging only in development with DEBUG_REVIEWER_FINDER env var
const DEBUG = process.env.DEBUG_REVIEWER_FINDER === 'true';

// PubMed rate limiting: 10 req/sec with API key, 3 req/sec without
const NCBI_API_KEY = process.env.NCBI_API_KEY;
const PUBMED_DELAY = NCBI_API_KEY ? 100 : 350;

module.exports = {
  MIN_PUBLICATIONS,
  YEARS_LOOKBACK,
  COAUTHOR_COI_STRONG_MIN,
  VERIFICATION_STATUSES,
  VERIFICATION_SKIPPED_REASON,
  TRACK_B_IDENTITY_RESOLUTION_LIMIT,
  TRACK_B_ENABLED,
  OPENALEX_PUB_BACKFILL_LIMIT,
  OPENALEX_PUB_BACKFILL_CONCURRENCY,
  NICKNAME_MAP,
  DEBUG,
  NCBI_API_KEY,
  PUBMED_DELAY,
};
