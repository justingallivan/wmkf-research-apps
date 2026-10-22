---
name: reference-dataverse-altkey-lookup-upsert-url
description: Historical S302 evidence and current source pointer for the reviewer-answer alternate-key URL; lookup component uses `_<lookup>_value=<guid>`, with no current production re-probe implied
metadata:
  type: reference
  status: active
  scope: dataverse
  last_verified: 2026-10-22 via current source-pointer review; S302 production probe remains historical evidence
---

## Recall Rule

Read before changing or using the `wmkf_appreviewanswer` alternate key described
below. The S302 probe tested this specific key and URL form; do not generalize its
result to other Dataverse keys without evidence.

## Historical probe evidence (S302, 2026-06-28)

For the `wmkf_appreviewanswer` alt key `wmkf_appreviewanswer_suggestion_question_key`
on `(wmkf_appreviewersuggestion, wmkf_questionkey)` — where `wmkf_appreviewersuggestion`
is a **lookup** — only this URL form CREATEs/UPDATEs a row:

```
wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=<guid>,wmkf_questionkey='<key>')
```

Tried, all in one prod probe run:
- `_wmkf_appreviewersuggestion_value=<guid>` → **WORKS** (creates on first upsert, UPDATEs idempotently on retry, no dupe).
- `wmkf_AppReviewerSuggestion=<guid>` (nav property, schema casing) → **400 `0x80060888`** ("The key in the request URI is not valid…").
- `wmkf_appreviewersuggestion=<guid>` (bare logical name, the form `keyAttributes` reports) → **400 `0x80060888`**.

The lookup must be addressed by its **value attribute** (`_<lookup>_value`), even
though `EntityDefinitions…/Keys` reports the key attribute as the bare logical name.
On upsert-create, Dataverse binds the lookup from the URL key — no `@odata.bind` in
the body needed.

## How to apply

- Build the alt-key upsert URL with `_<lookup>_value=<guid>` for the lookup component
  and `field='<value>'` for scalar string components. No leading slash (it's a path
  relative to the v9.2 data root, as [[project-dataverse-batch-changeset-available]]'s
  `executeChangeset` expects).
- Current source pointer: `ANSWER_KEY_LOOKUP_ATTR` and URL builders are in
  `lib/dataverse/adapters/review-answer.js:58,262-279` and
  `lib/external/review-answer-snapshot.js:70,79-84`. The external `/submit` route
  (`pages/api/external/review/[token]/submit.js`) delegates to `submitReview`; it is
  not the URL-builder location. This pointer update does not change the wire contract
  or assert current production metadata/state.
- `scripts/probe-altkey-upsert-changeset.mjs` records the historical S302 production
  probe only; do not treat this note as authorization or an instruction to re-probe
  production.

Related: [[project-dataverse-batch-changeset-available]], [[feedback-verify-external-platform-claims]].
