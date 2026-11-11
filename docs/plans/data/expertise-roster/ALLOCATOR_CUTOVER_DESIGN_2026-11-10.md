# Roster allocator and operational rehearsal design

Status: revision 3, addressing both historical Fable plan reviews. Owner authorized
unattended implementation and switched this continuation's future plan/build reviews
to OAuth Opus 5.5. No Production writes,
push/deployment, shared-database mutation, new server or paid inference is authorized.

## Scope and sequencing

**Slice A:** runtime numeric allocation plus sandbox-only prepare/freeze, activate,
pause, resume and abort. **Slice B:** rollback reconciliation, separately reviewed
after A passes. Production rollout, deployment admission, legacy-mode consumer
migration and direct-CRM writer control remain outside this implementation.
No runtime allocation canary will touch the populated public full-import fixture.
Real SQL rehearsals use synthetic data in a disposable schema on the existing pinned
local database; public before/after snapshots must match. Public receives no phase
transition, FK change, binding, allocation or sequence change from these tests.

Historical pre-implementation source baseline: the GUID editor performs keyed create/readback but does
not bind IDs; numeric consumers read target-scoped bridge rows. The importer uses
exclusive old/identity/binding table locks and manual high-water allocation. Existing
legacy writes use normal INSERT/UPDATE/DELETE statements. No operational command
or runtime allocator exists. Existing full-import receipts remain immutable evidence.

## Implementation checkpoint

[VERIFIED via source and isolated SQL tests] Slice A runtime and operational commands
are source-built. Ten allocator and eight phase tests pass against disposable schemas
with unchanged public fingerprints. The combined 97-test run and production build
passed at the checkpoint. Historical Fable runtime/phase review attempts exited
with "out of usage credits" without completing. The subsequent owner-authorized
OAuth Opus 5.5 source review returned READY with no material blockers; it did not
rerun tests or the build. Its four low-severity findings and receipt-fsync nit are
fixed; the final 109-test/five-suite run, isolated SQL/public-fingerprint checks,
types and scoped lint passed. The coordinating session reviewed the final diffs and
closed the review loop without another Opus cycle. The prior full build predates
these fixes; no fresh full build is claimed.
See [the archived review and disposition](SLICE_A_OPUS_5_5_REVIEW_2026-11-11.md).
Slice B planning is underway; its implementation remains unbuilt. No public phase or runtime allocation canary ran.

## Invariants

| Invariant | Enforcement / test |
|---|---|
| Normal mode unchanged | Existing literal rehearsal flag; service already rehearsal-only; Vercel SQL path unchanged |
| Exact local/sandbox target | Existing guard, connected database/user, explicit namespace check before SQL |
| One numeric binding | Control-row serialization, inverse lookup, existing unique constraints |
| No guessed save success | Keyed Dataverse verification and confirmed binding before success; uncertain result retryable |
| No ambiguous remote write at rollback | Durable per-attempt intent committed before remote mutation; unresolved intent blocks phase changes |
| Old writers frozen after activation | Verified BEFORE STATEMENT guard, including TRUNCATE; default-sequence rejection test |
| Feedback FK races fenced | Operational ACCESS EXCLUSIVE locks include consultant_feedback before checking/swapping FK |
| No source links lost in rollback | Original source plus verified import baseline; field deltas rather than wholesale target copy |
| Failed restore remains frozen | One SQL transaction for reconciliation/FK/sequence/guard removal |

## Storage and isolation

One control table: target_host primary key; phase prepared/active/paused/legacy;
generation UUID; baseline SHA-256; high_water INTEGER; pending JSONB object default
empty. Pending values hold only attempt UUID, operation kind, creation key or profile
GUID, and expected ETag where applicable; no roster text. Active counter is greatest
reserved/allocated ID. Preserve bridge identity/binding constraints.

Rehearsal fixture DDL is explicit, outside auto-discovered migrations, and not
applied to public. Before any durable public/schema promotion, add the inert numbered
migration, manifest and fresh-install shape required by the repository database rule.
No allocator defaults, trigger, population, FK or sequence mutations belong in that
migration. The rehearsal is not a claim that those promotion gates are implemented.

Runtime opens a dedicated pg Client, not a lease from the three-slot consumer pool.
The client factory is roster-specific and accepts an explicit schema for tests/CLI;
runtime always selects public. Every operational mutation phase hard-refuses public;
only the generated rehearsal-schema pattern is executable in slice A. Negative tests
prove prepare/activate/pause/resume/abort refuse public before any DDL/DML. Schema allowlist is public or
`roster_rehearsal_<32 lowercase hex>`; it must already exist; disposable schemas must belong to the current
user (public ownership is not restricted). Execute SET search_path with a validated quoted identifier and no public
fallback, then prove current_schema and relation namespaces before DDL/DML. Tests
create their disposable schema explicitly and qualify cleanup; no IF NOT EXISTS may
silently resolve a public fixture table. Connection URL target/alias guard stays
unchanged. Fixture user_profiles and all FK targets are local stand-ins; assert no
fixture FK references public. Public fingerprint covers the relation list, row-content
hashes, sequences, FK metadata, and enabled trigger definitions/functions on the four
roster tables, so stray DDL or altered values cannot pass as unchanged. Lifecycle advisory lock uses one signed BIGINT key derived from a fixed namespace
plus the schema OID (BigInt arithmetic, never a signed-int32 cast), preventing
disposable rehearsals from locking public. Client connect/query/lock waits are bounded; dedicated-client concurrency is not
globally capped in this low-volume local rehearsal (not a Production capacity claim).

Operational DDL and prepared row are atomic. Under the lifecycle lock use to_regclass:
only a truly absent table with no known freeze/identity-FK residue means preparation
mode. A present table with absent/wrong/corrupt target state fails closed. Never catch
arbitrary undefined-table errors as permission to write. Legacy is terminal for this
slice; importer stays refused after a control table has existed. Re-preparation needs
a later explicit operation, not deletion of control state.

## Runtime contract (slice A)

Acquire shared session lifecycle lock on the dedicated client before state admission.
Absent control permits the existing GUID-only preparation behavior. Prepared, paused
and legacy refuse writes; active admits them. Same-client liveness is checked after
remote work. Unlock/end always run; errors discard/end the connection. No pooled
consumer connection is retained, and no SQL transaction spans network calls.

For active writes, persist a unique server-generated pending attempt before issuing
Dataverse mutation; if intent commit is unknown, send no remote mutation. Callback
receives explicit before-write/confirmed-completion hooks. Validation/read-only replay
does not need a new intent. Confirmed create/update requires idempotent ensure-binding,
including previously GUID-only profiles saved by GUID. Keep editor member.id as GUID;
there is no need to introduce a new client DTO field.

Binding transaction: BEGIN; lock control row FOR UPDATE; verify active/generation;
look up target/GUID; return existing ID or increment high_water and insert identity +
binding; clear the confirmed intent in that same transaction; COMMIT. Initialize
high_water from the maximum of old sequence last_value, old row max and identity max.
Check exhaustion before increment to avoid INTEGER overflow. A lost COMMIT is unknown;
return retryable 503 and retain stable creation identity for retry.

Intent additions use one atomic `pending || jsonb_build_object(attempt_id, value)`
UPDATE; removals use one atomic `pending - attempt_id` UPDATE, conditional on active
phase and generation, with exact row-count checks. Never app-side read/modify/write.
Binding and any multi-intent removal happen under the control-row transaction lock.

| Dataverse outcome | Intent handling |
|---|---|
| Confirmed applied | Ensure binding and clear own attempt atomically; any confirmed save/replay can clear older **create** intents for the row's trusted stored creation key once binding is confirmed, even if fields have since changed |
| Definitely rejected | Clear only this attempt, then return/recover the original rejection |
| Unknown | Retain; no force clearing; block phase transitions |

Definite rejection requires the actual structured Dynamics error shape:
`serviceName === 'dataverse'`, `noResponse !== true`, `isTransient !== true`, and
status in 400/401/403/404/409/412/422. `buildServiceError` constructs this from a real
HTTP or atomic changeset-operation response; network errors use `buildNoResponseError`.
No message matching. 408/429/5xx, missing/200 status, arbitrary errors, and uncertain
SQL outcomes remain unknown. Definite-error cleanup failure also leaves the intent.

Create recovery clears only attempts for the same trusted stored creation key after
confirmed binding; alternate-key uniqueness and create-only transport mean delayed
creates cannot alter an existing row. This includes a create followed by an edit by
GUID: the key is read from Dataverse, never the request. Inactive create is one atomic
create/deactivate changeset; retry never PATCHes an existing profile.

Unknown updates, abandoned unknown creates, and confirmed remote updates whose SQL
clear fails are an **explicitly accepted, tested dead end in a disposable schema**
for slice A if no safe subsequent create-key recovery applies. They block pause and
there is no force/repair command in slice A. They are not a production-ready lifecycle;
a safe operator repair protocol must be designed before public activation (which this
CLI refuses). Do not add speculative repair machinery to close this pilot gate.
A confirmed update with binding/intent failure returns saved-but-reconciliation-required
warning, not fully usable numeric success; create binding failure returns retryable
503 and preserves mutation identity. Consumers explicitly exclude unbound profiles.

Pending intent is necessary because losing the pg session releases its advisory lock
while a remote write might still be running. Census alone cannot prove that write is
settled. Participating active writes are fenced durably; older/GUID-only builds, including new-build absent-control saves, and
direct CRM writers still require external quiescence before prepare. No Production
fencing claim is made from this local Client-based implementation.

Importer change: after its existing exclusive table locks, use to_regclass and refuse
if the operational control table exists. Prepare takes those same locks before creating
the control table, so the check is race-free. No extra importer lifecycle lock. Import
transport never updates existing target profiles. Verify binding/profile consistency
again after acquiring prepare locks so a concurrent import cannot be missed.

## Operational command and phase machine

Dry-run is default. Execution requires exact registered sandbox acknowledgement,
explicit phase, private manifest path and new receipt path. Manifest paths must be
outside the worktree, wx mode0600; receipts follow existing fsync/private patterns.
No app request supplies target/schema/phase. Namespace verified on every connection.

Lock order: lifecycle exclusive, then old roster, identity, binding, consultant_feedback
ACCESS EXCLUSIVE in that order, then control row. Use bounded lock_timeout. Remote
census is under lifecycle lock but before table locks; repeat/compare before commit
where necessary. Control-row changes/DDL/FK changes are atomic per phase. Catalog
checks verify column identities, validated nondeferrable NO ACTION original FK,
exactly one inbound roster FK and no unhandled inbound identity FKs. Refuse unfamiliar
schema, defaults, constraints or triggers instead of broadening the tool.

| Start | Command | Result |
|---|---|---|
| absent | prepare | prepared + frozen, original FK unchanged |
| prepared | activate | active + identity FK, counter initialized, guard retained |
| prepared | abort | legacy, original FK/source unchanged, guard removed |
| active | pause | paused, only with no pending intents |
| paused | resume | active after guard/schema/generation/pending checks |
| paused | rollback (slice B) | legacy after full reconciliation |
| legacy | any mutation phase | refuse; terminal in these slices |

Same-phase reruns require matching manifest hash/generation and verified actual
trigger/FK/state; then return an observed receipt. Unknown COMMIT recovery inspects
actual catalog/control state with the same manifest; never allocates a new generation
or overwrites the prior manifest. Resume after failed rollback keeps the freeze and
identity FK intact. Pending intents refuse pause/activate/resume/abort/rollback;
a refused pause stays active so exact create retries can finish. Uncertain update
repair is an explicit remaining boundary, not an unsafe force switch.

Prepare validates a reviewed import manifest against current bound managed values
and bindings; pre-prepare editor drift refuses, rather than absorbing edits into a
new baseline. Record all unbound profile GUID/creation-key/ETag inventory separately;
existing synthetic canaries stay quarantined. Bound rows must be valid and complete.
Capture source rows, exact original FK metadata, old sequence metadata/high-water,
bindings and validated target baseline. Write private baseline (including its freshly chosen generation UUID) before commit and bind
its hash/generation in control. Reruns read that same generation from the manifest. A failed preparation file is reusable only if exact content and
live source/target proof still match. No silent overwrite or rebasing.

Activate verifies frozen source hash, exact baseline/current target census, reference
completeness, bridge census and actual enabled trigger/function definitions. Trigger
name alone is insufficient: verify namespace, function body, BEFORE/STATEMENT event
mask and tgenabled. Rejected old INSERT must not advance sequence. Cover TRUNCATE
with an explicit statement guard. Retarget feedback FK only after taking its lock.

## Rollback reconciliation (slice B contract, review before build)

Only paused with no pending intents; preserve all Dataverse rows and bridge records.
Require exact private baseline and complete current census. Refuse every current
unbound profile absent from the baseline quarantine by exact GUID and creation key,
regardless of key type. Retain matching baseline quarantined rows outside reconciliation
while unbound. A baseline canary later bound without an original SQL row becomes an
insert. See the [reviewed Slice B design](ROLLBACK_RECONCILIATION_DESIGN_2026-11-11.md)
for the merge and verification contract.
Direct/older writers must be stopped separately; compare exact complete membership
and ETags again before committing. This detects drift, not a native CRM write fence.

Legacy field map is explicit: name, role_type/category, is_active/state plus all twelve
contract.TEXT fields (role, affiliation, orcid, preferred_email, primary_fields,
keywords, subfields_specialties, methods_techniques, distinctions, expertise,
keck_affiliation, keck_affiliation_details), and dataverse_contact_id/contact GUID.
For an existing original SQL row, compare normalized target fields to the reviewed
cutover target baseline; apply only changed values to the original SQL fields.
Unchanged original empty strings and Production Contact links remain verbatim.
Every current binding without an original source row is a new legacy row even if
present at prepare (Amy is the existing example). Missing profiles never mean delete.

Reject post-baseline changes to User fields. Accept baseline lead true to false
when the final profile is inactive and refuse other lead changes. For new legacy
rows reject nondefault unsupported values. Validate merged legacy rows against
actual lengths, known roles, GUID and linked-email rules and active Contact
uniqueness. Legacy can preserve a Contact across categories. On a linked-email
refusal, resume, revert the Dataverse edit, pause and retry. Validate all
feedback references including excluded identity-only source rows. Preserve created_by,
updated_by and timestamps for unchanged original rows. Changed original rows retain
created_by/created_at in place, set updated_by NULL, and use Dataverse modifiedon
for updated_at. Only final managed values that differ from original SQL count as a
change. New rows use NULL legacy audit actors and target createdon/modifiedon.
Bind valid UTC ISO text with explicit conversion into the SQL timestamp columns.
Preserve historical audit values verbatim, including original precision. Dataverse native actor history remains
intact and authoritative for the migration-era edits.

Under exclusive SQL locks remove only the owned freeze guard transactionally, apply
validated deltas/new rows, restore exact verified legacy FK, and transactionally
RESTART legacy sequence at max(old/counter/identity/row high waters)+1. Verify sequence
increment1, no cycle, expected integer range/cache semantics and interpolate only a
validated integer literal. Refuse exhaustion. Prove restart rollback with a
post-restart fault in the PostgreSQL test.
Rollback failure restores guard/data/FK/state by SQL rollback. No rows are deleted.
The old-code app/flags must be restored separately; this command proves SQL readiness,
not deployment completion or model/prompt admission.

## Verification and review stopping rule

Slice A uses real PG disposable-schema tests with synthetic profile transport:
concurrent same-GUID allocation; imported binding replay; create/bind unknown outcomes;
GUID-only update reconciliation; intent persistence/phase refusal; namespace/target
negative checks; old INSERT/UPDATE/DELETE/TRUNCATE refusal; sequence unchanged on
rejected insert; activate without guard refusal; abort and resume; lost receipt
recovery; unchanged public snapshots. Runtime unit tests cover actor, same-key retry,
post-update partial success and release on every failure. Then relevant gates/build
and OAuth Opus 5.5 adversarial build review. No public runtime allocation canary in this slice.

Review only changed contracts after named findings are fixed. Do not reopen the
accepted row-lock allocator algorithm. Begin slice B only after slice A is stable,
review its detailed reconciliation plan/build, and test changed/new profile rollback
and refusal paths. Stop iteration at passing relevant invariants and no material
blockers; record residual Production/SSO/external-writer gates.
