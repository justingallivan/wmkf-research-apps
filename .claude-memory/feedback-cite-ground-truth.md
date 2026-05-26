---
name: Cite ground truth — never pass through unsourced
description: Every external fact stated to the user gets a source citation (URL, file path + line, Codex round + their citation, or explicit "unverified, from memory/training"). Pass-through citations from Codex must be retained.
metadata:
  type: feedback
---

**The rule:** Every external-fact claim in a user-facing response gets a citation. No exceptions.

Categories + the shape of the citation:

| Source of fact | Citation shape |
|---|---|
| Codex finding | "per Codex round N's check against `<URL Codex cited>`" — and preserve the URL Codex gave |
| WebFetch I ran | `[per webfetch of <url> in this session]` |
| File contents I read | `<path>:<line>` |
| Live Dataverse / Postgres probe | "I ran `<script/command>` and observed X" with the timestamp |
| Memory entry | `[[memory-entry-name]]` |
| General training / knowledge | **explicitly flag as unverified**, e.g., "I think X (general knowledge — not verified against current docs)" |
| Repo CLAUDE.md / docs | `<docfile>:<section>` |

**Why:** S188 — user asked about Neon Postgres billing after I claimed (in a doc, then by extension in conversation) "Free tier provides ~7 days of PITR." That claim was wrong on both fronts (Free is 6h, not 7d; AND Free has a "or 1 GB of data changes" cap I omitted). Codex caught it on review and cited `neon.com/pricing`. When I subsequently discussed the issue with the user, I stated the correct numbers but **without passing through the citation Codex gave me** — which the user explicitly called out as the pattern problem.

A user receiving unsourced platform-billing claims can be misled into a real-money decision. This is exactly the failure mode `feedback-verify-external-platform-claims` is about — but that entry covers the verification step BEFORE writing claims. This entry covers the citation step AT THE POINT of stating them.

**How to apply:**
- When pulling a fact from a Codex round, preserve the source URL Codex cited in your own response. Don't strip it.
- Before stating any platform-specific fact (pricing, retention, quota, API behavior, security model), check: do I have a citation handy? If not, either (a) WebFetch the authoritative source first, OR (b) explicitly flag as unverified.
- Tables of facts (especially numeric ones — prices, retention windows, limits) get a "Source:" line.
- "Per Codex's verification" or "per WebFetch of X" is the minimum acceptable citation form. Bare numbers like "6 hours" without provenance is the failure shape.
- Pair with [[feedback-verify-external-platform-claims]] (do the verify) and [[feedback-share-codex-verbatim]] (don't strip Codex output).
