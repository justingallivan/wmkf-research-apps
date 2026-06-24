---
name: project-reviewer-web-discovery-abandoned
description: "Reviewer web-discovery (Perplexity /search leads AND a sonar reviewer-agent) was evaluated on real proposals S230 and ABANDONED — verified hallucination of reviewers + affiliations. Web search option removed from the reviewer-finder UI. Don't re-attempt the ungrounded version."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-06
---

## Recall Rule
Read before re-attempting any web/LLM-grounded reviewer DISCOVERY (Perplexity, or "have an LLM search the web and return reviewers"). This was tried twice and abandoned S230. Don't rebuild the naive version.

## What was tried (S225–S230)
- **Shipped v1.1:** Perplexity `/search` (retrieval) → Claude name-extraction → read-only "Web suggestions" panel in `ReviewerSearchSection` (toggle `searchWeb`, route `/api/reviewer-finder/web-suggestions`, `lib/services/web-discovery-service.js`). A live run was mostly noise — faculty-directory pages scraped into junk leads, raw page-dump snippets, a Co-PI surfaced as a reviewer. S230 hardened it (COI filter via `partitionByExcluded` + looser surname/initial match, per-URL cap, per-person rationale, model-override warming) — commits `62445ec`, `35b8b03` — but quality stayed poor. <!-- doc-symbol-refs:ignore reason=abandoned -->
- **Probe (not in app):** `scripts/probe-perplexity-reviewer-agent.mjs` — one `sonar-pro` chat call that searches + reasons and returns finished reviewer JSON (the prompt Perplexity itself proposed). Read-only; `--request <num|GUID>` pulls title/abstract/PI from Dynamics.

## Why abandoned (verified, not suspected)
Ran the agent on three real proposals and ground-checked every name against PubMed (author + topic) and ORCID:
- **1002794** (attosecond physics, mainstream): ~7/7 real & on-topic; ~5 plausible-but-unverified emails.
- **1002238** (fungal electrophysiology, niche): 3 real (Bowman, Beasley, Shabala); **2 confirmed fabricated** (a UT-Austin "Neurospora Michael Levine" + invented email — actually a neuroscience namesake; "Adam Pawluk" — no record); 1 unconfirmed.
- **1002204** (RNA intronic thermosensors): 2 strong (Mayr, Kinney) + 1 weak (Hawley); **2 confirmed conflations — REAL people given FALSE affiliations/fields** (DasGupta→"Berkeley"; Frische→"Copenhagen"); 1 unsubstantiated.

Failure modes: invented people; invented institutional emails (inconsistent — present 1002238, absent 1002204, so "no email" is NOT a safety signal); and **real researchers given fabricated affiliation + expertise** (worst — passes a naive "does this name exist?" check, would mis-route a real email). Self-reported `confidence` is unreliable (perfect match rated "low"; fabrication "medium"). Fabrication rate scales with topic obscurity.

**Why:** ungrounded LLM web discovery is unsafe for reviewer selection — confident fabrications + fabricated affiliations are exactly the failure a foundation that emails reviewers cannot tolerate.

**How to apply:** if reviewer web-discovery is ever revisited, treat the LLM as a discovery source ONLY and **ground every name through PubMed/ORCID** — verify a TOPICAL publication record (not mere existence), derive affiliation + contact from the verified record (never the model), drop anything ungroundable. Until then, the existing Claude + PubMed candidate pipeline stands alone. Full design history: `docs/REVIEWER_WEB_DISCOVERY_PLAN.md` (OUTCOME banner). Topic lineage: [[project-reviewer-finder-next-topics]] §3.
