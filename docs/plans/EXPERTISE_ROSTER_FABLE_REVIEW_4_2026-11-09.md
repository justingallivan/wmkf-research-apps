# Expertise roster migration — final plan review

Claude Fable 5.2, approved OAuth review of plan revision `6c7e1a9c8`. Session `4e6b9a24-039d-441c-bee0-f099a2ee14eb`. Read-only review; no live provisioning or implementation validation.

Final check done (prompt lookup is exact-match); here is the verdict.

## Verdict: READY

Both N1 and N2 are resolved as a plan at `6c7e1a9c8`. No named repairs are needed.

## N1 — inert routine DDL versus freeze-gated operational steps: resolved

- **Boundary rule (§5C, plan line 134):** files in `lib/db/migrations` may hold only inert additive table/index DDL. It names every prohibited item: bridge population, an ID-allocating default or trigger, FK retarget, source freeze and sequence advancement. It also states that running every pending migration must leave old Production behaviour unchanged.
- **Operational steps kept out of the runner's path (line 134):** population, high-water synchronisation, FK retarget and allocator enablement live in a committed cutover script outside the auto-discovered directory. This holds against source: `scripts/apply-migrations.js:75-80` is a flat `readdirSync` of that one directory filtered to `.sql`, so a script elsewhere cannot be picked up.
- **Separate freeze gate (line 134):** the script requires exact target acknowledgement, a verified writer freeze, drained requests and an explicit phase argument. It records resumable phase receipts, and normal migration bookkeeping never marks its phases complete.
- **Tests (line 134):** routine migration application with an old-code writer still active must prove the original FK and sequence stay authoritative, and cutover must refuse without a freeze.
- **Rehearsal (§5B, lines 126 and 130):** the normal runner is used only for inert DDL, and the gated cutover/rollback procedure is rehearsed separately.
- **Consistency:** this agrees with §3 line 82 (no bridge allocation or FK change on shared Postgres before cutover), §5C line 142 ("only AFTER the freeze and an exact high-water capture") and §7 item 5.

## N2 — separate prompt names and denied/drained old deployments: resolved

- **Name split (§5C, line 136):** a new row, proposed `expertise-finder.match.roster-v2`, gets its own bundled fallback/manifest and new-code-only destination registration. The legacy `expertise-finder.match` row is never overwritten, and both are kept for rollback.
- **Old code cannot resolve v2:** `match.js:106` and `batch-match-service.js:167` pass the bundled constant `'expertise-finder.match'` (`expertise-finder-dynamics.js:113`). The lookup is strict equality plus `iscurrent` (`lib/dataverse/adapters/ai-prompt.js:78,96`), so the shared prefix in the v2 name causes neither a collision nor a duplicate-current error.
- **Admission/drain gate (line 138):** it covers the three gaps N2 named.
  - **Inventory:** both single and batch endpoints, and every Production/Preview deployment URL that can reach the Production Dataverse/Postgres pair.
  - **Mechanism old code honours:** deployment-scoped platform access/routing denial, including direct URLs, explicitly not a flag only new code understands.
  - **Verification and drain:** HTTP probes from an ordinary allowed user, then a drain for maximum runtime with confirmed completion before any data changes.
  - **Fail-closed:** cutover is blocked if the platform cannot enforce and verify this, and old Previews stay denied for matching and roster writes afterwards.
- **Rehearsal (§5B, line 130):** proves old code still resolves only the legacy name while v2 exists, and exercises admission/drain on both endpoints including direct old deployment URLs.

## Limits

This is a plan-text verdict only. Whether the platform can actually enforce the deployment-scoped denial, and whether the migration files as eventually written are truly inert, remain the implementation/release prerequisites the plan itself declares (line 170). I read the plan from the working tree, which the session snapshot showed clean at `6c7e1a9c8`; I could not re-confirm HEAD with read-only tools.
