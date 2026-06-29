---
name: reference-dataverse-altkey-lookup-upsert-url
description: Dataverse alternate-key upsert URL whose key includes a LOOKUP must address the lookup by `_<lookup>_value=<guid>` (the value attribute), NOT the bare logical name or nav property — else 400 0x80060888. Verified in prod S302.
metadata:
  type: reference
  status: active
  scope: dataverse
  last_verified: S302 (2026-06-28) via scripts/probe-altkey-upsert-changeset.mjs --execute against prod
---

## Recall Rule

Read before building any Dataverse upsert/PATCH/DELETE addressed by an **alternate
key that includes a lookup column**. The intuitive URL forms fail; only one works.

## The fact (verified S302, 2026-06-28)

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
- Live use: the reviewer `/submit` route (`pages/api/external/review/[token]/submit.js`,
  `ANSWER_KEY_LOOKUP_ATTR`) upserts the answer-snapshot child rows this way inside one
  atomic changeset; `0x80060888` from a changeset means the key URL form is wrong, not
  that `$batch`/the key is broken.
- The probe `scripts/probe-altkey-upsert-changeset.mjs` re-validates the form (and
  `executeChangeset` end-to-end) in prod; it self-cleans its `__probe_uk*` rows.

Related: [[project-dataverse-batch-changeset-available]], [[feedback-verify-external-platform-claims]].
