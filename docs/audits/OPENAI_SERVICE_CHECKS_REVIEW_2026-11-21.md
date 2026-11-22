# OpenAI manual service checks — review and release prerequisites

Status: branch implementation; not published or applied to production.

Owner scope: manual checks for OpenAI model availability, recent local usage/pricing coverage, and official retirement notices. Organization billing and prepaid-credit checks are excluded by owner direction. No inference, provider mutation, automatic schedule, or automatic human review.

## Contract verification

- Existing superuser POST → allowlisted OpenAI claim → independent bounded collectors → fenced latest snapshot → Admin results / unsaved review draft.
- Migration 109 expands the service-ID check from three to four providers. Scratch PostgreSQL tests prove pre-migration rejection, existing-snapshot preservation, post-migration OpenAI persistence, and continued rejection of unsupported providers. No new table, route, or credential.
- Model metadata uses only fixed GET `/v1/models`; private fine-tuned IDs and account metadata are excluded. At most 500 public-family IDs of 100 characters each are retained for named additions/removals, including comparison against the original pending baseline. Request counts do not change pricing fingerprints.
- Local telemetry excludes unrecognized families and fine-tuned IDs. Executor OpenAI runs only appear when callers log usage; zero rows is not proof of no usage. The real SQL was exercised against synthetic recent/old/OpenAI/Claude/fine-tuned rows in scratch Postgres.
- Retirement notices are provider-wide, bounded evidence, not automatic matching to configured models. No source failure is represented as an unchanged successful check. Pending findings survive failures and remain until the existing explicit review acknowledgment path clears them.
- Unknown/empty source sets fail and release the claim. Changed findings remain fully visible and are copied into review drafts. Provider content stays React plain text.

## Claude Opus OAuth review

Two ordinary Claude Code Opus subscription reviews ran through the host Keychain-backed OAuth session with provider API-key overrides removed. Reported model: `claude-opus-5-5`. No Ultrareview or direct model API was used. Reviewer had read-only tools and did not independently execute tests or git diffs.

Round one requested named change evidence beyond the model-list preview and explicit disclosure of missing Executor telemetry. Both were fixed. Unpriced rows were moved first and empty-source handling hardened. Round two approved conditional on tests passing; the rerun passed. Its nonblocking reverted-change clarity suggestion was then implemented and tested: a pending A → B → A list explicitly states no net difference while preserving the review requirement. Remaining cosmetic limitation: previous evidence can include earlier change labels; current added/removed evidence remains authoritative and dated.

## Verification

- 133 focused tests passed across eight suites, including 23 scratch PostgreSQL integration tests and 16 UI tests.
- Production build, configured type check, and scoped ESLint passed. Build preceded the final explanatory string/test-only refinement.
- Migration manifest, Atlas, API-route, documentation-symbol, and documentation-currency gates passed; each available self-test ran sequentially after its gate. Existing unrelated API guard-recognition warnings remain warnings.
- No hosted OpenAI check or production migration was performed. The official deprecations Markdown was inspected during research, but the application's deployed fetch/credentials remain unverified.

## Before release

Apply `109_openai_service_checks.sql` using the canonical existing-database migration runner before deploying the OpenAI runtime. Then verify signed-in Admin: run OpenAI Check for updates, inspect independent source outcomes and source links, reload the stored result, and confirm no service/review mutation. Missing credentials or changed source formats must remain explicit unavailable results. Code rollback can leave the expanded constraint in place; do not delete saved snapshots.
