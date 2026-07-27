---
name: sweep
description: Evidence-first whole-repo truth audit and reconciliation for code, live external state, docs, memory, wiki, and instructions. Use after a fact changes, when implementation status is disputed, when documentation may have drifted, or before relying on a roadmap/current-state claim. Establishes truth from authoritative sources before reconciling every live restatement; also detects semantic omissions and mixed historical/current guidance.
allowed-tools: Read, Edit, Bash(codegraph:*, grep:*, rg:*, git diff:*, git log:*, git status:*, npm run check:*, node scripts/*)
---

# /sweep — Evidence-First Truth Audit and Reconciliation

## Purpose

Prove or falsify a material claim from authoritative evidence, then reconcile every live
restatement and consumer of that claim across the repository.

Do not treat a plan, memory entry, prior sweep assertion, or newer annotation beside older
text as proof. Source, live-state probes, persisted schema, and enforced runtime behavior
outrank prose.

## Modes

Choose one explicitly:

- **Mode A — Changed fact:** one known fact changed and all restatements must be reconciled.
- **Mode B — Domain truth audit:** implementation state or product behavior is uncertain;
  build an evidence-backed inventory, falsify unsupported claims, and reconcile the durable
  surfaces for that domain.

If the user asks whether documentation matches code, whether a roadmap is current, what
actually exists, or for a deep audit, use Mode B. Do not reduce it to one convenient grep
claim.

## Blocking rules

Do not say `reconciled`, `current`, `verified`, `complete`, or `sweep passed` unless:

1. authoritative truth was established independently of the prose being checked;
2. source → persistence → consumer was traced where the claim describes behavior;
3. all in-scope durable surfaces were searched and classified;
4. semantic contradictions and omissions were checked, not only matching strings;
5. every live stale statement was structurally corrected;
6. the same searches and relevant gates were rerun; and
7. the report records the evidence and zero remaining live stale claims.

If any step is incomplete, report `AUDIT INCOMPLETE` or `CLAIM NOT RECONCILED`.

## Step 0 — Define scope and claims

Write:

```text
Mode:
Domain/change surface:
Claims to verify or falsify:
Authoritative sources expected:
Durable surfaces in scope:
Excluded surfaces and reason:
```

For Mode B, start with a claim inventory rather than one sentence. Include at least:

- what exists;
- what is live, partial, planned, retired, or blocked;
- who/what writes the state;
- where it persists;
- who/what consumes it;
- dependencies and recommended next steps asserted by current plans.

## Step 1 — Establish truth before searching prose

For every material claim, find the strongest applicable evidence:

1. **Runtime/source:** use CodeGraph before grep/read; trace entry point → service/helper →
   persistence → response → consumer. Read every relevant branch, not only imports or names.
2. **Live external state:** use a read-only probe for Dataverse schema/rows, Postgres schema,
   Blob/SharePoint state, prompt rows, deployment configuration, or other external facts.
   A checked-in schema snapshot is supporting evidence, not a substitute when live state is
   safely probeable.
3. **Tests/gates:** identify what behavior they prove and what they do not cover. A green
   bounded gate is not evidence for claims outside its registry or scan roots.
4. **Product intent:** use explicit current owner decisions. Label older plans and memories
   as evidence of past intent, never as proof of current behavior.

Use these labels in the evidence matrix:

- **VERIFIED** — directly supported by cited source or probe.
- **PARTIAL** — some required contract hops exist; name the missing hops.
- **PLANNED** — intended but not built/provisioned.
- **ASSUMED** — plausible but not yet proven.
- **STALE/CONFLICT** — contradicted by stronger evidence or another current instruction.
- **UNKNOWN** — evidence is unavailable; identify the required probe or decision.

Absence requires evidence too: search likely symbols, routes, fields, and callers before
claiming something does not exist.

## Step 2 — Build the contract/evidence matrix

For each claim, record:

| Claim | Producer/entry point | Persistence/source of truth | Consumer | Strongest evidence | Status |
|---|---|---|---|---|---|

Mark a hop `N/A` explicitly. If the claim is a count or list, derive it from the authoritative
registry/source rather than hand-counting prose.

For a planned feature, distinguish independently:

- product purpose decided;
- input contract decided;
- persistence/schema provisioned;
- prompt/configuration provisioned;
- implementation present;
- consumer/UI present;
- tests and operational verification present.

Do not collapse “a design document exists” into “planned and ready.”

## Step 3 — Search every durable restatement

Create search terms only after Step 1 exposes real symbols, old names, statuses, and likely
contradictions. Search at least:

- `docs/**` excluding clearly archived/generated evidence;
- `.claude-memory/**`;
- `docs/agent-wiki/**`;
- `CLAUDE.md`, `AGENTS.md`, `SESSION_PROMPT.md`, and relevant rules/skills;
- `pages/**`, `shared/**`, `lib/**`, `scripts/**`, `modules/**`, and tests;
- registries, schemas, migrations, prompts, route matrices, Atlas pages, and service catalogs
  implicated by the claim.

Use literal symbols plus semantic qualifiers and opposites:

- current and former names;
- `live`, `shipped`, `built`, `partial`, `planned`, `future`, `deferred`, `blocked`,
  `placeholder`, `retired`, `not built`;
- counts and list members;
- persistence field/entity names;
- asserted dependencies and recommendations.

Read the whole target durable file before classifying or editing it. Read surrounding source
and callers/consumers before using a code hit as evidence.

## Step 4 — Run the semantic contradiction pass

Grep cannot detect all drift. Compare the evidence matrix against prose for:

- a purpose that names inputs the described data flow never supplies;
- a shipped component still listed as a future dependency or build step;
- a field/entity said to be required when an existing source may already serve it;
- an architecture described as decided when its schema/prompt/config is unprovisioned;
- “open” and “resolved” decisions coexisting in current guidance;
- a current summary appended above a stale table, dependency list, or recommended order;
- counts corrected in one paragraph while named members remain wrong elsewhere;
- a producer documented without its actual consumer, or a consumer with no real producer;
- tests/gates cited beyond their registered facts or scan scope.

Record semantic omissions as findings even when no matching stale sentence exists.

## Step 5 — Classify every hit

Use exactly:

| Classification | Meaning | Action |
|---|---|---|
| **AGREE** | Reflects authoritative current truth | Leave |
| **STALE** | Contradicted, unsupported, or misleading as current guidance | Fix |
| **HISTORICAL** | Preserves a dated state inside an explicit historical boundary | Leave and cite boundary |
| **UNRELATED** | Search collision | Note |

`HISTORICAL` is allowed only when the file or section is visibly marked historical and is not
also presented as a current roadmap, dependency, recommendation, source of truth, or next
step. “As of S###” inside a living section may explain old text but does not neutralize
contradictory current instructions below it.

If a line mixes current and stale assertions, classify it `STALE`.

## Step 6 — Fix structurally

When stale hits cluster in a file or section, rewrite the section around current truth. Do not:

- append another update banner beside contradictory text;
- fix only the count while leaving the named list/table/order stale;
- preserve a shipped phase as a current recommendation;
- use a historical label to avoid repairing a document that still claims current authority.

Move implementation history into a clearly historical section/document when it remains useful.
Keep one visible current-state summary and one forward plan.

After editing a durable fact, sweep every restatement in the same pass.

## Step 7 — Re-run and falsify

Re-run:

1. the same term searches;
2. symbol/caller/consumer searches;
3. live probes used to establish external state;
4. relevant gate followed by its self-test, sequentially; and
5. `git diff` to inspect the entire reconciliation.

For each conclusion, name one disconfirming check and its result. Example: “To falsify
‘field absent,’ queried live attribute metadata by logical name; received 404.”

Green gates do not close the audit unless their documented registry and scan roots cover the
claims in the matrix.

## Step 8 — Report and retain evidence

Report:

```text
Sweep mode:
Domain/claim:
Authoritative evidence:
Claims: N → VERIFIED n / PARTIAL n / PLANNED n / ASSUMED n /
             STALE-CONFLICT n / UNKNOWN n
Restatement hits: N → AGREE n / STALE n / HISTORICAL n / UNRELATED n
Structural fixes:
Semantic omissions found:
Gates/probes run and bounded scope:
Remaining live STALE: 0
Remaining UNKNOWN/ASSUMED:
Verdict: RECONCILED | CLAIM NOT RECONCILED | AUDIT INCOMPLETE
```

For a substantial Mode B audit, persist the evidence matrix and report in the repository’s
appropriate durable audit/planning surface so a later session can inspect what was actually
verified. A conversation claim that “a sweep was run” without the report or a linked durable
artifact is not auditable evidence.

## Relationship to other workflows

- Use `/contract-reconcile` for detailed caller → persistence → consumer safety analysis; this
  skill owns repo-wide truth and durable-restatement reconciliation.
- Use relevant Atlas, route-security, migration, and CI workflows when their surfaces enter the
  matrix.
- Historical records may remain historical, but current operating guidance must not require a
  reader to mentally subtract superseded paragraphs.

## Limits

This process can prove only the claims and surfaces listed in its report. It is not a guarantee
that every sentence in the repository is true. Missing probes, excluded surfaces, and unresolved
owner decisions must remain visible as `UNKNOWN` or `ASSUMED`.
