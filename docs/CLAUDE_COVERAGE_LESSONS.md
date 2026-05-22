# Coverage Lessons — patterns I keep missing in coverage tools

**Created:** 2026-05-07 (S137) after a Codex stress-test cycle where each round caught a slightly different syntactic pattern the previous round didn't search for.

**Audience:** future-Claude. Read this before modifying any coverage tool (`scripts/check-*.js`).

**Update rule:** when Codex (or any external review) catches a structural pattern that an existing coverage tool missed, **update this file before patching the tool**, then patch the tool, then add a self-test fixture. The order is load-bearing.

---

## Why this file exists

I keep building coverage tools (grep gates, schema lookups, audit scripts) by enumerating patterns I happen to remember. Codex reads the codebase fresh and finds patterns I forgot to search for. Each round is a one-line miss, but they aggregate.

The structural problem: I anchor on the convention I just patched ("now the gate covers `DynamicsService.*`") and stop looking for parallels. Every coverage tool needs a **parallel-pattern check** before being claimed complete.

---

## Patterns the Atlas CI gate (`scripts/check-application-state-atlas.js`) detects

Every entry includes:
- The pattern in regex form
- An example call site (`file:line`) so the next reader can grep for parallels
- Why I missed it the first time

### A. `DynamicsService.<method>('<entitySet>')`
- **Methods:** `queryRecords`, `queryAllRecords`, `getRecord`, `createRecord`, `updateRecord`, `deleteRecord`, `countRecords`, `aggregateRecords`, `searchRecords`, `logAiRun`
- **Example:** `lib/services/execute-prompt.js:194` (`queryRecords(PROMPTS_ENTITY, ...)`)
- **First miss:** The original gate only listed CRUD verbs. Codex caught `countRecords/aggregateRecords/searchRecords` in `pages/api/dynamics-explorer/chat.js:464,473,716`. **Lesson: when listing methods on a service object, grep `<ServiceName>\.\w+` and inspect the unique method set, don't enumerate from memory.**

### B. Raw client calls — `client.<verb>('/<entitySet>'`
- **Verbs:** `get`, `post`, `patch`, `put`, `delete`, **`delete_`** (trailing underscore — `delete` is a JS reserved word; some clients alias it)
- **Example:** `lib/services/dataverse-app-access-service.js:34` (`client.get('/wmkf_appuserappaccesses?...')`)
- **First miss:** Wave 1 dispatch services use a Dataverse client wrapper, not `DynamicsService`. The original gate missed all 3 Wave 1 entities. **Lesson: when a project has multiple ways to talk to the same backend, enumerate ALL of them. Grep for `\w+\.\w+\(['"\`]/` to find URL-prefixed calls.**
- **Sub-miss:** First fix included `delete` but not `delete_`. **Lesson: reserved-word JS method aliases (`delete_`, `class_`, `import_`, `default_`) need to be checked explicitly.**

### C. OData URL fragments — `/api/data/v9.X/<entitySet>`
- **Example:** `lib/dataverse/client.js` constructs URLs as `${baseUrl}${pathOrUrl}` where `baseUrl = ${resourceUrl}/api/data/v9.2`
- **Why it's covered defensively:** even if a custom helper builds URLs differently, the path fragment usually contains the entity name.

### D. Constant-named entity sets — `<NAME>_ENTITY = '<entitySet>'`
- **Pattern:** `(?:const|let)\s+(?:[A-Z][A-Z0-9_]*_ENTITY|ENTITY_SET)\s*=\s*['"]([a-z_][a-z0-9_]*)['"]`
- **Examples:**
  - `lib/dataverse/adapters/researcher.js:11` (`const ENTITY_SET = 'wmkf_appresearchers'`)
  - `lib/services/execute-prompt.js:30-32` (`const PROMPTS_ENTITY = ...`, `REQUESTS_ENTITY`, `RUNS_ENTITY`)
- **First miss:** original regex matched only the literal name `ENTITY_SET`, missing the parallel `*_ENTITY` naming scheme. **Lesson: when a regex matches a specific identifier, ask "is there a naming family this is part of?" Grep for `[A-Z_]*ENTITY` and `ENTITY_*` to see what other constants exist.**

### E. Source-file extension traversal — the walker must read `.mjs`/`.cjs`, not just `.js`
- **Pattern:** `if (!file.endsWith('.js')) continue;` — a *file-traversal* filter, not a code pattern. Any entity referenced **only** from a non-`.js` source file is invisible to the gate even though its directory is in `SCAN_DIRS`.
- **Example:** `scripts/check-application-state-atlas.js` had this filter at **two** scan loops (the `DynamicsService`/client/OData detector and the `*_ENTITY` constant detector). The repo already ships 6 `.mjs` scripts referencing real entities — `scripts/enable-suggestion-audit.mjs` / `scripts/extend-responsetype-picklist.mjs` → `wmkf_appreviewersuggestion`; `scripts/extend-apprequestperson-role-picklist.mjs` / `scripts/probe-slice0-attr-collision.mjs` → `wmkf_apprequestperson`, `akoya_request` — all silently skipped while `scripts/` was nominally being scanned.
- **Traversal ≠ detection (precision, Codex S164):** the fix makes `.mjs`/`.cjs` files *traversable* so entities referenced via the gate's **existing detector call-shapes** (`DynamicsService.<m>('set')`, `client.<v>('/set')`, `/api/data/v9.x/set`, `*_ENTITY`/`ENTITY_SET` consts) in those files are now caught. It does **not** add a new detector: a `.mjs` that names an entity only as an `EntityDefinitions(LogicalName=…)` metadata string is still undetected — but that was equally undetected in `.js` (the gate strips `entitydefinitions`), so it is not a regression and is out of scope here. The self-test fixture binds `.mjs` traversal for an existing call-shape (pattern A), which is the property that regressed.
- **Severity nuance:** no *current* missing-coverage incident — the entities those `.mjs` use via detected call-shapes are also redundantly referenced from `.js`/`lib`, so `check:atlas` stayed green. The gap is **latent**: an entity referenced *only* from a `.mjs`/`.cjs` (via a detected call-shape) would pass undocumented.
- **First miss:** anchored on `.js` because it's the dominant extension; never asked "what other executable source extensions does the repo actually run?" Caught by Codex S164 (2026-05-18). **Lesson: a file-extension filter is itself a coverage dimension. Enumerate every executable source extension the repo uses (`.js`, `.mjs`, `.cjs`) and make the walker accept all of them — grep the walker for `endsWith('.js')` / `\.js'` filters before claiming a coverage tool complete.**

### F. File-granular `content.includes(marker)` masks an unhardened sibling in the same file

- **Pattern:** a gate that asserts "this file references marker X" via `content.includes(X)`. If the file holds **multiple call sites** (e.g. several prompt-builder functions), one hardened call satisfies the file-level check while an unhardened sibling in the same file rides through invisibly.
- **Example:** `scripts/check-prompt-injection-tagging.js` originally checked, per A7 surface, that the *union of its files* referenced `wrapUntrustedContent` + `buildUntrustedContentPreamble`. `shared/config/prompts/virtual-review-panel.js` exports 8 prompt builders; `createPanelSynthesisPrompt` had **no** preamble at all, but the 7 sibling builders' preamble calls kept the file-level check green. Same class of false-green hit `multi-perspective-evaluator.js` (#8). Caught by Codex's A7 re-audit (S176).
- **Fix (S177):** the gate added a **call-site-granular** layer — a surface may declare a `builders` list; the gate slices the prompt file at top-level `export function NAME` boundaries and asserts **each** declared builder carries `buildUntrustedContentPreamble(` in its *own* segment, and that every `create*Prompt`/`build*Prompt` export is declared (a new sibling builder cannot escape). The preamble is the marker that is uniformly checkable per builder — it is called directly in each builder's return template. A builder whose preamble is injected at the route/service call site instead is declared `{ name, routePreamble: true }` — exempt from the in-body check but still drift-tracked, so a *new* builder must still be explicitly classified. The check requires the **call form** (`marker(`), not a bare token, so a comment/string mention cannot satisfy it. The **wrap** marker stays file-level on purpose: builders wrap via per-file helper indirection (`wrapVrpBlock`, `wrapConceptAnalysis`) and via shared context helpers placed *between* builders, so a per-builder body slice cannot see the wrap call. Making wrap per-builder would require call-graph analysis; file-level union is the honest granularity for it.
- **First miss:** anchored on "the file imports/uses the helper" as the unit of coverage; never asked "how many independent call sites live in this file, and does the check bind each one?" **Lesson: when a gate uses `content.includes()` on a file that can hold multiple independent call sites, the file is the wrong unit — bind each call site. At minimum, slice the file into per-function segments for the marker that each call site must carry directly.**

---

## Patterns to search for in any new coverage tool (checklist)

Before claiming a coverage tool is complete, run these greps and confirm each is either covered, allowlisted, or genuinely absent:

1. **All call shapes against the target object/service:**
   - `<TargetClass>\.\w+\s*\(\s*['"\`]<thing>['"\`]` — class method calls
   - `<targetInstance>\.\w+\s*\(\s*['"\`]/<thing>['"\`]` — instance URL calls
   - `<targetClass>\.\w+_?\s*\(` — reserved-word aliases
2. **All naming conventions for constants holding the target value:**
   - `ENTITY_SET`, `*_ENTITY`, `<NAME>_TABLE`, `*_NAME`, `*_ID` — list every shape that holds an identifier
3. **All paths an identifier might appear in:**
   - String literals
   - Template strings
   - URL builders (concatenation, template, `URL` API)
   - Imports / requires (when the identifier is a file or module name)
   - Config files (JSON, YAML)
4. **Reserved-word aliases:** `delete_`, `class_`, `import_`, `default_`, `interface_`, `let_`, `const_`, `function_`
5. **Plural/singular variants:** Dataverse entity sets are usually plural with quirks (`wmkf_potentialreviewerses`, `accountses`); the entity name is singular. Both can appear in code depending on context.
6. **File extensions the walker traverses:** does the directory walker read every executable source extension the repo runs (`.js`, `.mjs`, `.cjs`)? An `endsWith('.js')` filter silently drops `.mjs`/`.cjs` entity references even when their directory is scanned. Grep the walker for extension filters; assert a `.mjs` fixture is detected in the self-test.
7. **Call-site granularity:** if the gate uses `content.includes(marker)` on a file that can hold multiple independent call sites (multiple prompt builders, multiple endpoints), the file is the wrong unit — one hardened call site masks an unhardened sibling. Slice the file per call site (e.g. per top-level `export function`) and bind each one to the marker it must carry directly. See lesson F.

When in doubt, **write a deliberately-broken synthetic example** for each pattern variation and verify the tool catches it. Add the synthetic to the self-test fixture set.

---

## How LESSONS gets updated

When a Codex stress-test (or other review) finds a new structural pattern an existing coverage tool missed:

1. **Add an entry to the relevant section above** — pattern, example call site, why it was missed.
2. **Add a fixture to `scripts/check-coverage-self-test.js`** that exercises the new pattern.
3. **Patch the tool.**
4. **Run the self-test** — confirm the new fixture is caught AND every prior fixture still passes.
5. **Commit all three changes together.**

If you skip step 1 you'll forget and rebuild the same gap next time. The order matters: the lesson predates the fix.
