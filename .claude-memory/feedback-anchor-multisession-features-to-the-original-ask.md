---
name: feedback-anchor-multisession-features-to-the-original-ask
description: "Owner, S546 (2026-09-27): the Test Request Factory ran 8 days / ~20 sessions (S527–S546) of safety machinery without a usable deliverable, and the early-cycle seed requests aged out meanwhile. Every multi-session feature session must restate the original ask and whether the owner can use anything yet."
metadata:
  type: feedback
  status: active
---

## Recall Rule
Read at `/start` and before planning the next slice of any feature that has run more than two sessions.

Do: quote the original ask (source + date) and say plainly whether the owner can use anything yet; if not after two sessions, stop and propose the smallest cut that gives the owner a usable result before adding any safety or fidelity work; present each new gate as a scope choice with its cost in sessions, not as a settled prerequisite.
Do not: chain review rounds, probes and invariant hardening across sessions without that check; treat "close every risk first" as the default.
Ground truth: the owner's own words (Codex session logs under `~/.codex/sessions/`, handoffs); `docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md` *Owner decisions* (MVP scope).

**Why:** the ask (2026-09-19, Codex session): "It is very hard for me to create requests from scratch for testing. Could you design a system that could create a new request based on an existing one?" — admin-only. Later that day the practical need was test requests populated with SharePoint files. By S546 the Factory had a ledger, marker schema waves, four sandbox recipes, synthetic reviewers, DOCX attestation and a thrice-reviewed production plan, but no production clone and no admin button; the existing test Requests (1003220–1003224) had moved past reviewer invite, so early-cycle testing needed a new seed. Owner: "We've worked essentially nonstop for 8 days and still don't have a minimal viable product." Same failure chain as [[feedback-latency-plan-scope-accretion-postmortem]].

**How to apply:** at session start on such a feature, lead the summary with the ask and the owner-usable state; weigh findings as safety vs fidelity ([[feedback-factory-safe-not-full-fidelity]]) and prefer the owner-decided simpler rule (for example the S546 recipient allowlist over a per-email binding contract).
