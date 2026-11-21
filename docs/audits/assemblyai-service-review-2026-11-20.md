# Service review 001: AssemblyAI

Review date: 2026-11-20 (America/Los_Angeles). Owner: Justin. Scope: Meeting Tracker recorded-audio transcription.

## Decision

[OWNER DECISION] Adopt `assemblyai-stt-3-7` for newly created transcription jobs. Do not reprocess existing recordings. Preserve cleaned text by explicitly setting `disfluencies: false` for this model. Keep speaker diarization enabled.

[VERIFIED via source and mocked unit tests] The implementation changes the server-selected model in `lib/services/transcription-pilot/runtime.js`; `provider.js` preserves cleaned-text behavior. Jobs persist `requested_model` at creation, and `worker.js` submits that stored value. Existing queued jobs retain their model; completed results are not rewritten. No database migration, backfill, or reprocessing command is part of this change. A deployment is required for the new default to take effect.

## Cost baseline

[PUBLIC PRICING, reviewed 2026-11-20] Published rates for Universal-3.5 and STT-3.7 were $0.21 per audio hour, plus $0.02 for speaker diarization: **$0.23 per audio hour** for this configuration. This is a quality upgrade, with no demonstrated unit-cost saving. Private account usage and spending figures are omitted from this public review.

The newsletter's Sync API price reduction concerns a different API from our asynchronous `/v2/transcript` integration. See public [pricing](https://www.assemblyai.com/pricing); actual account terms remain authoritative.

## Quality evidence

[VENDOR-REPORTED, not locally reproduced] AssemblyAI's [STT-3.7 research](https://www.assemblyai.com/blog/assemblyai-stt-3-7-research) compares recorded audio on seven English datasets. Lower is better:

| Model / diarization | Speaker-attributed word error (cpWER) | Diarization error (DER) |
|---|---:|---:|
| Universal-3.5 / old diarization | 29.3% | 14.7% |
| Universal-3.5 / new diarization | 26.8% | 10.5% |
| STT-3.7 / new diarization | 23.5% | 9.4% |

The new diarization system also applies to older models. The relevant incremental comparison is therefore 26.8 → 23.5 cpWER and 10.5 → 9.4 DER, approximately 12.3% and 10.5% relative improvements. The newsletter's 10.7% DER uses a different six-dataset comparison and should not be mixed into this table.

AssemblyAI's [benchmark page](https://www.assemblyai.com/benchmarks) reports clean-English WER of 5.0% for 3.5 versus 5.2% for 3.7, verbatim WER of 8.0% versus 6.5%, and accented-English WER of 7.1% for both. Thus improvement is not universal; our cleaned-text preference makes the slight clean-English regression relevant. Named-entity scores use changed scoring and are not directly comparable.

The checked [Coval provider page](https://benchmarks.coval.ai/providers/assemblyai) did not include STT-3.7. No independent head-to-head or WMKF-data quality evaluation was established. User declined rerunning existing audio; no metered transcription was performed for this review or the implementation tests.

## Compatibility and follow-up

The official [migration guide](https://www.assemblyai.com/docs/pre-recorded-audio/assemblyai-stt-3-7-migration-guide) documents the new model ID and the changed default for disfluencies. Explicitly disabling disfluencies preserves our previous cleanup preference. The guide distinguishes the December 8 default upgrade for unpinned accounts from eventual Universal-3.5 retirement, whose date was not announced. Our requests explicitly select a model.

Observe the next naturally requested transcription for speaker labels, cleaned text, returned model, and billed rate. Do not create an evaluation job or reprocess recordings without separate user direction. Rollback: restore the new-job default in a reviewed release; jobs already created retain their stored model. Revisit on a pricing/deprecation announcement or observed quality issue; recurring audit cadence is not yet chosen.

Service-review policy: inventory all external services, including hosting and storage. Microsoft, GitHub, and Zoom costs are excluded because corporate contracts cover them. Track integration compatibility and deprecations as relevant; automatic service updates do not prove that client integrations need no maintenance. No tracking feature or scheduled automation is introduced by this review.
