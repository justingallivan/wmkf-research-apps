---
title: "Executor Extensions Plan (post-cycle)"
domain: prompt-executor
kind: plan
status: active
summary: "Status: Design sketch (Session 110, 2026-04-25). Not yet implemented."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/services/execute-prompt.js
  - scripts/probe-picklist.js
---

# Executor Extensions Plan (post-cycle)

**Status:** Design sketch (Session 110, 2026-04-25). Not yet implemented.
**Scope:** Three extensions to `lib/services/execute-prompt.js` that unblock backend-automation use cases without changing the contract's overall shape.
**Why now (the doc, not the code):** locking in the design while context is fresh. Implementation is post-May-1.
**Trigger for implementation:** any of the following — Grant Reporting PA trigger, Integrity Screener PA trigger, `phase-i.intake-check` prompt authoring, or a second multi-output prompt request.

These extensions are listed in priority order — earliest is highest priority because it's a **correctness fix**, not a feature add.

---

## 1. Multi-output PATCH coalescing (correctness fix)

### Current behavior

`persistOutputs()` in `lib/services/execute-prompt.js` iterates outputs and PATCHes each independently using the same captured ETag. The first PATCH succeeds and bumps the row's ETag server-side. The second PATCH presents the now-stale ETag → server returns 412 → output marked `concurrent_edit`.

For prompts with multiple `akoya_request` field-targets, this means **only the first output is persisted**. Today's seeded prompt (`phase-i.summary`) has a single output so this never fires, but any future multi-output prompt will hit it immediately.

### Target behavior

All outputs targeting the same `akoya_request` row land in **one** PATCH:
1. Build a single payload object merging all field-target outputs (`{ wmkf_ai_summary: "...", wmkf_ai_compliancecheck: 682090000, ... }`)
2. For jsonPath outputs, do one GET per memo-field to read current contents, merge each declared `$.path` into the parsed JSON, serialize back, and add the merged string to the same payload (`{ wmkf_ai_dataextract: "{\"keywords\":[...],\"compliance\":{...}}" }`)
3. Single PATCH with `If-Match: <captured ETag>` from preflight (step 4)

### Edge cases

- **Two outputs target the same field with different `jsonPath`s** — both merge into the same memo (e.g., `$.keywords` and `$.summary` into `wmkf_ai_dataextract`). Merge in declaration order; later outputs win on key collisions. Document this.
- **Two outputs target the same field with no `jsonPath`** — programmer error in the prompt schema. Throw at preflight.
- **Mix of `akoya_request` and `wmkf_ai_run` targets** — run-row writes happen in step 9 (after the akoya PATCH), so no conflict. Document the order: outputs to `akoya_request` first, then run-row writes via the existing run-creation path.
- **`target.kind: "none"` outputs** — never persisted, only returned in `parsed`. Not part of the coalesced PATCH.

### Implementation sketch

```js
async function persistOutputs(outputs, parsed, requestId, etag) {
  const akoyaWrites = outputs.filter(o => o.target?.kind === 'akoya_request');
  if (akoyaWrites.length === 0) return { results: [], allOk: true };

  // Group by field
  const directWrites = {};       // { fieldName: stringValue }
  const jsonPathWrites = {};     // { fieldName: { '$.foo': value, ... } }
  for (const out of akoyaWrites) {
    const value = parsed?.[out.name];
    if (value === undefined) { /* mark missing in results */ continue; }
    if (out.target.jsonPath) {
      (jsonPathWrites[out.target.field] ??= {})[out.target.jsonPath] = value;
    } else {
      directWrites[out.target.field] = serialize(value);
    }
  }

  // For each jsonPath field, read current contents + merge
  const payload = { ...directWrites };
  for (const [field, paths] of Object.entries(jsonPathWrites)) {
    const fresh = await DynamicsService.getRecord(REQUESTS_ENTITY, requestId, { select: field });
    const current = parseMemoJson(fresh?.[field]);
    for (const [path, value] of Object.entries(paths)) {
      const m = path.match(/^\$\.(\w+)$/);
      current[m[1]] = value;
    }
    payload[field] = JSON.stringify(current);
  }

  try {
    await DynamicsService.updateRecord(REQUESTS_ENTITY, requestId, payload,
      etag ? { ifMatch: etag } : undefined);
    // mark all akoyaWrites as ok in results
  } catch (err) {
    const reason = err.status === 412 ? 'concurrent_edit' : 'writeback_failed';
    // mark all as failed with shared reason — single PATCH means single failure mode
  }
}
```

### Test coverage

Add a test prompt `test.multi-output` with two field-target outputs and one jsonPath output, run it via the existing smoke-test harness, verify all three land. Same prompt with `forceOverwrite: false` and pre-populated targets verifies block aggregation works.

---

## 2. Native PDF input (`preprocess: pdf_native`)

### Current behavior

The `sharepoint` source kind supports `preprocess: pdf_to_text` only. A PDF is fetched, `pdf-parse` extracts text, the text becomes the variable's value (a string). All structural information — tables, columns, layout — is lost.

For the deferred `phase-i.intake-check` prompt this matters: the budget check needs to read line items, totals, and percentages, which are inherently table-shaped. Text extraction mangles them. Justin chose Option B (extend Phase 0) over rephrasing the prompt for text input.

### Target behavior

A new preprocess hint `pdf_native` causes the variable resolver to:
1. Fetch the PDF buffer (existing path via Graph)
2. Skip text extraction
3. Base64-encode the buffer
4. Return a structured object instead of a string: `{ kind: 'pdf', base64: '...', mediaType: 'application/pdf' }`

`composeMessages()` then changes: instead of always interpolating `{{var}}` slots into a flat string, it must support **mixed content** (text + document blocks) in the user message:

```js
{
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Project description: ' + descriptionText },
      { type: 'document', source: { type: 'base64', data: pdfB64, media_type: 'application/pdf' } },
      { type: 'text', text: 'Please analyze the budget and project description above.' }
    ]
  }]
}
```

Anthropic's API supports document content blocks natively (since 2024). PDF token cost is computed on the server side; we just send bytes.

### Where this gets messy

- **Interpolation collapse.** Today's `interpolate(template, vars)` substitutes string-only. With native PDFs, a single variable produces a non-text content block — the template must declare boundaries for where the PDF goes. Approach: use the **same `{{var}}` slot syntax**, but at compose time, if any variable resolves to a non-string, split the template at those slots and emit a content array. Variables that are strings stay inline.
- **Cache control placement.** Today, the user message is one text block with `cache_control` on system. With multiple content parts in user, we may want `cache_control` on the document block specifically (since it's the heavy/static part) — Anthropic supports this. Decision: add `cache_control` to any content block whose source variable is `cacheable: true`, in addition to the existing system-block marker. Verify cache hits empirically.
- **Size limits.** Anthropic accepts PDFs up to ~32MB and ~100 pages per document. Add a guard in the resolver: if `buffer.length > 32_000_000` or page count > 100 (need pdf-parse for the count, ironically), throw. Surface as a normal Executor failure.
- **Token cost surprise.** A PDF with images can balloon to 10–30K input tokens. Update the run-row notes to capture that context.

### Implementation phases

1. Add `pdf_native` to the allow-list in the sharepoint source-kind resolver. Throw on unknown preprocess hint as today.
2. Refactor `composeMessages()` to detect non-string variables and emit content arrays.
3. Update interpolation: regex-split the template on `{{var}}` slots, interleave text fragments and resolved values, collapse adjacent strings into single `text` blocks.
4. Add the size guard in the resolver.
5. Add a test prompt that takes a small known PDF and asserts the response includes layout-aware extraction.

### Backwards compatibility

All existing prompts use string-only variables → `composeMessages()` produces today's flat-string user content as the degenerate case. No prompt-row changes needed unless a prompt opts in to `pdf_native`.

---

## 3. Picklist target output type

### Current behavior

`target.kind: "akoya_request"` writes whatever value is in `parsed[outputName]` directly to the field. This works for Memo (string) and integer fields. **Picklist fields require numeric option-set values** (e.g., `wmkf_ai_compliancecheck`: `682090000` for "pass"). Today the prompt would have to ask Claude to return a magic number, which is unreadable in the prompt body and brittle (option-set values can theoretically change).

### Target behavior

Output schema can declare a `valueMap`:

```json
{
  "name": "clerical_status",
  "type": "string",
  "target": { "kind": "akoya_request", "field": "wmkf_ai_compliancecheck" },
  "valueMap": {
    "pass":    682090000,
    "fail":    682090001,
    "review":  682090002
  },
  "guard": "always-overwrite"
}
```

Claude returns string label (`"pass"`); Executor maps to `682090000` before PATCH. Unknown labels (Claude hallucinates `"approved"`) → fail the run with an explicit error.

### Implementation sketch

In `persistOutputs` (within the multi-PATCH coalesced path from #1), per output:
```js
let writeValue = parsed[out.name];
if (out.valueMap) {
  const mapped = out.valueMap[writeValue];
  if (mapped === undefined) {
    throw new Error(`Output "${out.name}" returned "${writeValue}" — not in valueMap`);
  }
  writeValue = mapped;
}
// then merge into payload as before
```

### Adjacent decision: `valueMap` for *inputs* too?

A `dynamics` source variable that pulls a Picklist field value gets the numeric value today (e.g., `682090000`). Prompts then have to know the magic number means "pass". Could symmetrically support a `valueMap` on input variables: declare the inverse map, Executor substitutes the string label before interpolation. Defer until a real prompt needs it; the `_formatted` annotation Dataverse already returns gives us the string label for free if we want it (`processAnnotations` already exposes it as `<field>_formatted`).

Phase 1 of this extension: **output side only**. Phase 2: input side, if needed.

### Schema-probe utility — shipped Session 110

`scripts/probe-picklist.js` (Session 110) takes `<entity>.<field>` arguments and dumps the option-set with both numeric values and labels, ready to paste into a prompt-row JSON.

```bash
node scripts/probe-picklist.js akoya_request.wmkf_ai_compliancecheck
node scripts/probe-picklist.js akoya_request.wmkf_ai_fitassessment
```

Probed values for the two picklists relevant to `phase-i.intake-check` (probed 2026-04-25):

```json
"wmkf_ai_compliancecheck": {
  "Compliant":     682090000,
  "Non-Compliant": 682090001,
  "Human Review":  682090002
}

"wmkf_ai_fitassessment": {
  "Fit":       682090000,
  "Not a Fit": 682090001,
  "Unclear":   682090002
}
```

Note: Connor's labels for `wmkf_ai_compliancecheck` are **"Compliant" / "Non-Compliant" / "Human Review"** (not "pass" / "fail" / "review" as casually written elsewhere). Match these labels exactly when authoring the prompt body or the `valueMap` keys.

---

## Sequenced implementation

When the post-cycle window opens, do them in this order:

1. **Multi-PATCH coalescing** — correctness fix; small; unblocks any multi-output prompt. ~2 hours including tests.
2. **Picklist target type + probe utility** — small surface area; needed for `phase-i.intake-check` and any future Picklist-writing prompt. ~2 hours.
3. **Native PDF input** — biggest. Needs careful interpolation work and cache verification. ~half a day to a day.

After all three: author `phase-i.intake-check` (clerical + keywords + priority-fit), test against a real Phase I proposal, and hand the prompt-row + parent flow to Connor for the PA-trigger build.

## Updates to EXECUTOR_CONTRACT.md

When each extension lands, update the contract doc:
- §"Metadata shapes" → `wmkf_ai_promptvariables` table → add `pdf_native` to "Preprocess hints (Phase 0)"
- §"Metadata shapes" → `wmkf_ai_promptoutputschema` → add `valueMap` to the example + describe in target-kinds section
- §"The 10 steps" → step 8 narrative → describe the coalesced PATCH and the merge order

The contract is the spec; this doc is the implementation-side rationale and edge-case catalog. Keep them in sync.
