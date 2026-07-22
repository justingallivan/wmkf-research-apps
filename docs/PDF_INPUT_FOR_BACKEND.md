---
title: "PDF Input to Claude — Findings for Backend Architecture"
domain: architecture
kind: history
status: historical
summary: "2. PDF prompt-caching cuts subsequent calls by 90% and is verified working. The staged 3-pass pipeline drops from $0.39 → $0.20 per proposal and..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/find-2025-phase-i.js
  - scripts/list-all-pdfs-for-candidates.js
  - scripts/compare-phase-i-v1-v2.js
  - scripts/test-files-api.js
---

# PDF Input to Claude — Findings for Backend Architecture

**Audience:** Connor (backend / PowerAutomate work)
**Date:** 2026-04-21
**Context:** Session 105 measured the cost, latency, and quality of three approaches to feeding PDF proposals to Claude. Findings inform the upcoming PA flow design where Dynamics status changes trigger AI processing.

---

## TL;DR

1. **Native PDF input works and costs ~3× more per call than text-only**, but in absolute terms that's **$0.09 extra per Phase I summary** (about $13/year at our volume on Batch API). For a foundation that funds millions in research grants, that's not a budget conversation — it's a quality conversation.
2. **PDF prompt-caching cuts subsequent calls by 90%** and is verified working. The staged 3-pass pipeline drops from $0.39 → $0.20 per proposal **and** from 120s → 60s total latency.
3. **Don't build a PDF→image rendering pipeline.** Anthropic does it server-side. PA just sends the PDF blob.
4. **For backend, prefer the Files API over base64 inline** when (a) PDFs > 24 MB raw, or (b) you'll run multiple Claude passes on the same PDF.
5. **Place `cache_control` on the document block, not just the system prompt** — easy thing to miss.

---

## What we tested

### Approach A — text-only (current production)
Extract text via `pdf-parse`, send as a normal user message. No vision. 19 pages of SUNY Stony Brook proposal → 9.8K input tokens.

### Approach B — native PDF document block
Send the whole PDF as a `document` content block (base64 inline). Claude server-side renders pages as images + extracts text, then processes both. Same SUNY proposal → 38.4K input tokens (3.91×).

### Approach C — selective figure-page rendering
Detect which pages have substantive figures, render only those as PNGs, attach as image blocks alongside text. **We did NOT build this.** Reason: requires `pdfjs-dist` + canvas in Vercel runtime (or Encodian / Adobe / Azure Function in PA). High infra cost relative to the marginal win over Approach B.

---

## Per-proposal cost (Sonnet 4.6 list pricing)

Measured on SUNY Stony Brook (1001507), 14.6 MB PDF, 19 pages, 1 image-heavy section:

| Approach | Input tokens | Output tokens | **Per-call cost** | Latency |
|----------|------:|------:|------:|------:|
| A — text only | 9,809 | 1,157 | **$0.0468** | 26s |
| B — native PDF | 38,393 | 1,264 | **$0.1342** | 41s |
| B + cache (warm) | 38,334 cached + 28 new | 307 | **$0.0162** | 12s |

### Annual cost at Keck volume (~300 Phase I proposals/year)

| Approach | Annual cost | With Batch API (50% off) |
|----------|------:|------:|
| Text only | $14 | $7 |
| Native PDF | $40 | $20 |
| **Vision premium** | **$26** | **$13** |

**Even with no caching at all, the upgrade to full-vision processing costs $13/year extra at our volume.**

---

## Caching mechanics — verified

We sent the same SUNY PDF twice within 5 minutes with `cache_control: ephemeral` on the document block. Results:

| | Call 1 (cold) | Call 2 (warm) |
|---|---:|---:|
| `cache_creation_input_tokens` | **38,334** | 0 |
| `cache_read_input_tokens` | 0 | **38,334** |
| `input_tokens` (uncached) | 22 | 28 |
| Output tokens | 1,094 | 307 |
| **Cost** | $0.16 | **$0.016** |
| Latency | 38s | **12s** |

Two takeaways:

- **The cached prefix covers BOTH the system prompt AND the PDF.** The cache_control tag on the document block makes Anthropic treat everything before the user's text question as cacheable. A follow-up question on the same PDF only pays for output + a tiny per-call uncached input portion.
- **Cache reads also bypass page rendering.** That's where the 38s → 12s latency drop comes from. The PDF was already rendered when the cache was written; subsequent reads serve the rendered pages directly.

### Implication for the 3-stage pipeline

If we run fit-screen → intelligence brief → virtual panel as 3 sequential Claude calls within the cache window:

| Approach | Per-proposal cost | Total latency |
|----------|------:|------:|
| 3 fresh calls (no cache) | $0.39 | ~120s |
| 1 cold + 2 warm (with cache) | $0.20 | ~60s |
| **Savings** | **48%** | **50%** |

For 300 proposals/year × 3 stages, caching saves ~$60/year and 5 hours of cumulative wall-clock time. Real for batch backend automation.

---

## System-prompt caching caveat (new — 2026-04-22)

**Historical observation (2026-04-22):** this test run observed no write at 2,019 tokens and a
write at 2,058 tokens for Sonnet 4.6. It is not current model guidance. Anthropic's current
[prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
lists a 1,024-token minimum for Sonnet 4.6; check the concrete model before applying a floor.

**What this means for the PA flow:**

- **PDF document blocks always clear the floor** — a typical 19-page Phase I proposal is ~38K tokens. Cache fires reliably.
- **System-prompt-only caching (without a PDF in the request) needs current-model verification.**
  The April test observed a ~1,419-token Phase I system prompt below its empirical threshold;
  use the official floor for the concrete model rather than treating that result as universal.
- **The recommended PA flow in this doc is unaffected.** The PDF is the cache anchor — system block piggybacks on it. That's fine and it works.

**If we ever add a chained "PDF once, small follow-up questions" pattern:** the follow-up calls without the PDF will lose cache unless we keep the PDF in the request (which is the Anthropic-recommended pattern anyway — cache reads on the PDF block cost 10% of base input).

## Anthropic PDF API constraints

Per Anthropic's [PDF support docs](https://docs.anthropic.com/en/docs/build-with-claude/pdf-support):

| Constraint | Limit | Affects us? |
|------------|------:|-------------|
| Max request payload | 32 MB | Only for PDFs > ~24 MB raw (base64 inflates ~33%) |
| Max pages per request | 600 (or 100 for 200K-context models) | Sonnet 4.6 has 1M context → 600 pages. Phase I proposals are 15-30 pages — no concern |
| Format | Standard PDF only | No encrypted/password-protected PDFs |
| Token cost | 1,500-3,000 tokens per page | Matches our SUNY measurement (~2K/page × 19 pages = 38K) |

### Three delivery methods

| Method | Best for | Notes |
|--------|----------|-------|
| **URL reference** | Public docs | PDF must be publicly accessible — won't work for SharePoint behind auth |
| **Base64 inline** | One-shot calls, PDF ≤ ~24 MB raw | Counts against 32 MB request cap after inflation |
| **Files API** (`anthropic-beta: files-api-2025-04-14`) | Backend, multi-pass workflows, large PDFs | Upload once → get `file_id` → reference in subsequent calls. Bypasses request-size limit, plays well with caching |

---

## Recommended PA flow for Phase I summary writeback

```
[Trigger: akoya_request status → "submitted"]
   │
   ▼
[PA: Dynamics → akoya_request lookup, get requestId + applicant info]
   │
   ▼
[PA: SharePoint → list akoya_request library + RequestArchive1/2/3
       for the request folder, find Research Phase I Application*.pdf]
   │
   ▼
[PA: SharePoint → download PDF as bytes]
   │
   ▼
[PA: HTTP POST to Anthropic /v1/messages
       - system: cached Phase I prompt (with cache_control)
       - messages[0].content[0]: document block with PDF base64 + cache_control
       - messages[0].content[1]: text "Produce Phase I summary..."]
   │
   ▼
[PA: parse response → write summary to akoya_request.wmkf_ai_summary]
   │
   ▼
[PA: log to wmkf_ai_run]
```

**Key choices for PA implementation:**

- **Don't render PDF pages in PA.** Send the whole PDF; Anthropic handles rendering.
- **Set `cache_control: { type: "ephemeral" }` on the document block** — pays off the moment any second call hits the same proposal within 5 min. For staged pipelines this is automatic savings.
- **Use base64 inline** for one-shot summaries (PDFs are ≤ 16 MB in our actual data). Switch to Files API only if you're chaining 3+ Claude calls on the same proposal AND want the cache to outlive the 5-min ephemeral window.
- **Skip the figure-extraction rabbit hole.** You don't need Encodian or Adobe PDF Services connectors. The native PDF block is already vision-aware.

---

## What's NOT solved by this approach

1. **Single-pass cost vs multi-pass cost.** If you only ever need ONE summary per proposal, caching doesn't help — there's no second call to read the cache. Native PDF input then costs $0.13/proposal vs $0.05 for text-only. Quality decision.

2. **PDF cache lifetime.** Ephemeral = 5 min. If your pipeline has > 5 min of human review between stages, the cache evaporates. Use 1-hour cache (`type: "ephemeral"` with `ttl: 3600` on Anthropic's roadmap; not currently widely available) or the Files API for longer-lived caching.

3. **Bromelkamp's PDF bloat (separate finding).** akoyaGO's `ABCpdf` PDF generator stores embedded images uncompressed — SUNY's 14.6 MB file is 91% just 4 large RGB images. Doesn't affect our processing (text extraction skips images), but worth knowing if file storage costs ever become a budget item.

---

## Test artifacts

All measurements above came from these scripts:

| Script | Purpose |
|--------|---------|
| `scripts/find-2025-phase-i.js` | Discover real Phase I candidates around the May 1, 2025 deadline |
| `scripts/list-all-pdfs-for-candidates.js` | Enumerate PDFs per candidate to identify true Phase I file naming |
| `scripts/compare-phase-i-v1-v2.js` | v1 vs v2 prompt comparison harness (8 May 2025 proposals) |

Comparison outputs (gitignored) under `tmp/phase-i-comparison/`.

---

## Open questions for Connor

### Resolved (2026-04-22)

1. ~~**Adobe PDF Services or Encodian connector**~~ — Licensed in the org but **not required for this flow**. Anthropic handles PDF rendering server-side; PA sends the raw PDF blob.
2. ~~**PA HTTP action max body size**~~ — Connor tested up to **75 MB** in the Keck tenant with no cap hit. Comfortably above our 14–25 MB Phase I PDFs (~32 MB base64-inflated).

### Resolved (2026-04-22, continued)

3. ~~**Files API beta header (`files-api-2025-04-14`)**~~ — **Confirmed working end-to-end.** `scripts/test-files-api.js` successfully uploaded → referenced → deleted a 14 MB PDF. All three calls return 200 with the custom beta header in place. Any PA failure from here is a PA / tenant HTTP-connector issue, escalatable without involving Anthropic. Retained for future multi-pass workflows; not needed for Phase 1.

4. ~~**Multi-pass pipeline timing**~~ — **Not a concern for Phase 1.** Backend automation will process single requests sequentially (one PA call per request, one prompt applied), so caching gives almost nothing in that mode — each call is a different PDF. The future use case (batch analysis across prior grant cycles: one prompt applied to many historical proposals) is a different regime — see "Future batch-analysis regime" below.

### Still open

5. **Historical 2048-token Sonnet 4.6 observation** — preserved from the April test record,
   but superseded as current guidance by Anthropic's documented 1024-token Sonnet 4.6 minimum.

---

## Future batch-analysis regime

Connor flagged (2026-04-22) a separate use case we'll hit later: **one prompt applied to many historical proposals** — e.g., "run this new evaluation criterion against every Phase I submission from the last three cycles." Different economics from Phase 1's sequential single-request flow.

| Optimization | Applies to Phase 1 (sequential singles)? | Applies to future batch? |
|---|---|---|
| **PDF caching** (`cache_control` on document block) | No — each request is a different PDF | No — each file is different |
| **System-prompt caching** (`cache_control` on a system block above the concrete model's floor) | Minimal — requests arrive minutes or hours apart, cache TTL expires | **Yes, significant.** All calls share the system prompt. One cold write + N−1 warm reads if calls fire within 5 min of each other |
| **Batch API** (`/v1/messages/batches`, async, 24h turnaround) | No — need synchronous writeback | **Yes, 50% off list price.** Ideal for "process last cycle's 300 proposals overnight." |

**Implications when the batch use case arrives:**

- Evaluate the v2 system prompt against the concrete model's current documented floor before treating padding as necessary for caching.
- Anthropic's Batch API is the correct tool for bulk historical analysis, not ephemeral caching — batches run async at 50% list, complete within 24h, and results come back as a downloadable JSONL. No PA HTTP polling concerns.
- Batch API + system-prompt caching stack: a batch of 300 proposals × cached system prompt = ~50% (batch) × ~90% (cache read on system tokens) = much cheaper than a naive loop.
