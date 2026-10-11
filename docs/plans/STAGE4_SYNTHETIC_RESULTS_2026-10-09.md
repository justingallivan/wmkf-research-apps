---
title: Stage 4 local synthetic benchmark results
domain: transcription
kind: report
status: active
summary: "Local investigation closed as promising with documented limitations. Historical strict Stage A results remain non-pass; focused mapping, compatibility and production safeguards are the next steps. No cloud or real recording was accessed."
owner: product-engineering
related:
  - docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md
---

# Stage 4 local synthetic results

**[VERIFIED via local follow-up, 2026-10-09] All six padding/provenance and tested synchronization cases now pass.** The original four-millisecond tail was reproduced from physically isolated, already-cut audio: it was not newly encoded discussion. It was not digital silence either. The revised recipe inserts leading silence on the common clock before trimming, preserving the delayed audio's position. The subsequent separate-M4A mapping and capacity follow-up also passes its bounded cases; see `docs/plans/STAGE4_MAPPING_CAPACITY_RESULTS_2026-10-09.md`. The integrated mapping-to-cut, extended container and 1080p quality follow-up is recorded in `docs/plans/STAGE4_LOCAL_MATRIX_RESULTS_2026-10-09.md`. Justin has closed the local investigation as promising with documented limitations. The historical strict Stage A matrix remains non-pass; the small Apple tail omission is accepted as an unresolved quality limitation, not a standalone project blocker. Practical next steps and unchanged privacy gates are in the linked local-matrix report. No cloud job, SharePoint/Zoom read or Board registration occurred.

## Padding and synchronization follow-up — current result

[VERIFIED via `scripts/benchmarks/stage4-padding-check.py` and `docs/plans/STAGE4_PADDING_EVIDENCE_2026-10-09.json`] The follow-up uses generated media only and the existing bundled Python with NumPy 2.3.5; no additional package was installed. Run the follow-up script with a NumPy-capable Python interpreter. It imports the fixture harness; the original default harness remains a reproducible historical experiment. The optional seeded pilot gives each audio channel a nonperiodic reference waveform for alignment. The follow-up asserts bounded case/control success; neither script is a production verifier.

**What the four milliseconds contained.** The exact original source/output hashes were checked against the initial committed evidence. Encoding just its isolated pre-E PCM produced **identical AAC packet payloads** to the original output. Its extra 192 samples had peak 0.0144504 and RMS 0.00466483 on a normalized ±1 scale. This supports encoder ringing/padding derived from retained audio, not newly selected post-E source samples. A separate regenerated pilot fixture also reproduces the issue but has different hashes/amplitudes; its receipt is kept separate from the original-file recheck. Do not describe either tail as silence or generalize this result to arbitrary recordings.

**How the candidate recipe changed.** Decode onto the common zero-based clock using `aresample=first_pts=0`, preserving a late audio start by inserting leading silence. Trim on that clock, then write the selected samples to an isolated PCM file. The AAC encode reads only that file. Video retains its source-clock timestamps. This avoids independently resetting audio/video to their own first content samples. In the delayed-audio test, the new normal decoded audio ends at 12.250 seconds, rather than 12.254.

**How padding is accepted without allowing leakage.** Independently encode the isolated PCM into an audio-only reference, and require exact AAC packet-payload equality. Extract the output as elementary ADTS AAC, removing MP4 edit lists and skip/discard-padding metadata, and decode it completely. Require exact equality with the isolated reference decode; removing the recorded 1,024 priming samples and the measured tail must reproduce the normal decode exactly. Normal output endpoints must still pass. Normal/ignored-edit-list video pixels must match, and each frame timestamp must agree with its embedded source-frame number. The current synthetic guard allows 1 ms for the reference container clock; observed maximum error was below 0.4 microseconds. Every decoded audio frame must follow the cumulative sample clock from zero within one sample, so correlation cannot hide shifted timestamps.

| Fixture | Normal audio endpoint | Extra samples exposed by elementary AAC decode | Bounded result |
|---|---:|---:|---|
| Mid-GOP | 12.250 s | 800 | Pass |
| Before keyframe | 11.966 s | 96 | Pass |
| At keyframe | 12.000 s | 512 | Pass |
| After keyframe | 12.033 s | 976 | Pass |
| Delayed audio | 12.250 s | 800 | Pass |
| VFR + extra source audio track | 12.250 s | 800 | Pass |

[VERIFIED] Both channels matched the known reference at 1.5, 6.5 and 10.5 seconds: **36/36 measured lags were zero samples**. Correlation and timestamp/provenance checks are separate requirements. Raw AAC tails were sometimes nonzero; they were accepted only because they exactly matched the independently encoded safe input. No generic “allow a few milliseconds” exception was added.

**Deliberately bad controls:**

- Four milliseconds of private tone substituted inside an otherwise correct-duration file: rejected for private audio and safe-payload mismatch, with no endpoint failure required.
- Four milliseconds of private audio appended past E, with MP4 movie/track/edit durations deliberately shortened to report exactly 12.250 seconds: rejected. All AAC packets remained present; the duration fields did not authorize the payload.
- Video shifted about 20 ms while still ending before E: ordinary endpoint checks passed, but source-frame clock verification rejected it.
- Right audio channel shifted 10 ms: measured lag was 480 samples on that channel and zero on the other; synchronization rejected it.
- Audio remuxed with a 50 ms timestamp offset: rejected by the cumulative audio-clock check, independently of waveform content.

[ASSUMED limits] These are known-input tests using the same pinned encoder for output and isolated reference. Payload equality is strong bounded evidence about the input used, not an independent codec implementation or a generic speech-privacy classifier. AAC source pre-echo and arbitrary edit schedules remain untested. Separate M4A offset/gap/drift now have bounded tests in the linked mapping/capacity report; production generalization remains unproven. The fixture's 100 ms margin is prescribed ground truth, not measured production uncertainty. The owner's <=2-second earlier-trim rule is unchanged. This local follow-up does not authorize real-media access or claim the entire Stage A matrix passed.

## Authorization and environment

[VERIFIED via latest owner instruction] FFmpeg installation through Homebrew and generated-media Stage A were authorized. Future Sandbox use has a $10 incremental compute cap, persistence off, verified cleanup and the app functions' US region; first report Stage A. Under the closure decision, real-media progression requires the focused synthetic safety checks in the local-matrix report to pass and a fresh question to Justin before reading request 1003222's already-copied video. Outputs belong in an isolated staff-only test folder; a longer real recording follows only after that passes. Document applicable Vercel data-processing terms before real media. None of those later steps was exercised here.

[VERIFIED via installation/version/hardware commands] Homebrew installed FFmpeg/ffprobe **9.0.2**, including libx264 and AAC encoding, on **Apple M3, 16 GiB RAM**. Homebrew installed dependencies and upgraded ca-certificates/xz; its dependency installation also unlinked openssl@3 while installing openssl@4. No application dependency or runtime configuration changed. Encoding used two libx264 threads, **not** a two-vCPU resource allocation. This cannot establish Sandbox timing or memory sufficiency.

## Reproduction and evidence

- Harness: `scripts/benchmarks/stage4-synthetic.py`. Run `python3 scripts/benchmarks/stage4-synthetic.py` for short cases; add `--long` for the performance fixture. It accepts no external-media path and uses generated frames/audio only. No credentials or network APIs are used.
- Content-free receipt: `docs/plans/STAGE4_SYNTHETIC_EVIDENCE_2026-10-09.json`, including command arguments, build version, hashes, sizes, measured endpoints, marker detections and durations.
- Generated media/logs remain in uniquely named local temporary directories printed by the harness; they were not committed or uploaded. The harness only removes its exact generated raw intermediate files; it does not claim all scratch is cleaned. No Sandbox cleanup receipt exists because no Sandbox was created.
- A zero script exit means the experiment completed, **not** that Stage A acceptance passed. The receipt/report records the non-pass explicitly.

## Initial short-case results — historical, before the follow-up

[VERIFIED via initial-run final short receipt] Each reference is 24 seconds, 320×180, nominal 30 fps, stereo 48 kHz. Lossless FFV1/PCM reference precedes H.264/AAC source encoding. Video contains a binary frame-number strip and turns red at the synthetic private boundary; each audio channel switches to a distinct private tone (3.5/4.1 kHz). This is simpler than the proposed pseudorandom watermark and human-readable timecode. Source scenecut is disabled and keyframes are probed. The VFR case drops alternate frames after six seconds and adds a second audio track to the source; output contains only the selected video/audio pair.

[ASSUMED fixture input] Every positive case supplies a **100 ms uncertainty** and cuts at `E = B − 0.1`. This is prescribed synthetic ground truth, **not measured waveform alignment** or a recommended fixed production margin. Owner policy tests accept 0, 0.1 and exactly 2 seconds and block 2.001 seconds. Real uncertainty must be measured; above 2 seconds or unbounded, block for staff boundary/mapping review. Staff issue resolution cannot approve a failed generated video.

| Case | Safe endpoint E | Normal decoded video end | Normal decoded audio end | Normal check | Edit-list-ignoring check |
|---|---:|---:|---:|---|---|
| Mid-GOP | 12.250 s | 12.200 s | 12.250 s | Pass within fixture checks | Unresolved video/audio endpoint shift |
| Before keyframe | 11.966 s | 11.900 s | 11.966 s | Pass within fixture checks | Unresolved video/audio endpoint shift |
| At keyframe | 12.000 s | 11.967 s | 12.000 s | Pass within fixture checks | Unresolved video/audio endpoint shift |
| After keyframe | 12.033 s | 11.967 s | 12.033 s | Pass within fixture checks | Unresolved video/audio endpoint shift |
| Audio offset +350 ms in reference | 12.250 s | 12.200 s | **12.254 s** | **Reject: about 4 ms beyond E** | Unresolved video endpoint shift |
| VFR + extra audio track | 12.250 s | 12.133 s | 12.250 s | Pass within fixture checks | Unresolved audio endpoint shift |

[VERIFIED via packet/stream inspection] In the offset case, the source MP4's encoded audio start is 0.328667 s, and the output's is 0.307333 s, rather than blindly preserving the nominal 0.350 s reference offset. AAC priming and MP4 edit-list handling need explicit treatment. The normal output's audio stream duration plus start reaches 12.250 s, yet decoded frame sample intervals reach 12.254 s. That is a concrete example of duration metadata failing to establish decoded-sample bounds.

[VERIFIED via marker/provenance checks] No positive candidate exposed a private red frame or private-tone block. That does **not** prove semantic privacy or that all padding is silence. Ignoring edit lists changes timeline origins and priming treatment: raw timestamp excess was then an unresolved verifier/clock issue, **not evidence that discussion content leaked**. A valid verifier must map both decode paths to the same source clock and classify padding before accepting or rejecting on those timestamps. Do not normalize audio and video independently and thereby erase their relative offset.

[VERIFIED via inspected source keyframes] Constant-rate cases have keyframes at 0, 2, 4, …, 22 seconds; the named keyframe cases refer to **E**, not B. Whole-frame interval rounding is deliberately conservative: the at/after-keyframe outputs actually retain only through source frame 358 and end at 11.966666 s; neither is claimed to retain the keyframe itself. VFR keyframe spacing differs and is retained in the receipt. These fixtures do not exercise arbitrary open-GOP dependencies.

## Initial negative controls and checker limits — historical

[VERIFIED via initial-run final receipt] The leaky remux produced **17 private video frames** and **27 private-tone blocks on each channel**; the wrong-offset encode produced **13 private frames** and **26 blocks on each channel**. Both also exceeded E, but explicit assertions require both marker reasons, so timestamp failure alone cannot make the content-detector test pass. Naive presentation stream-copy exposed no private marker in this guarded fixture, yet retained source frames/intervals beyond E and was rejected. This supports rejecting a naive copy recipe; it is not proof that every possible stream-copy implementation leaks discussion.

[VERIFIED via review and rerun] Review found that the initial audio detector skipped its final partial block; the final short run examines it too. Source scenecut was disabled and named keyframe cases were moved to align the **cut endpoint** with the intended GOP positions. Detector thresholds remain fixture-specific: a low-level or short arbitrary speech leak could evade this tone detector. Its successful controls do not establish a generic production classifier.

## Long synthetic performance case

[VERIFIED via completed local long run] Generated an **85-minute, 1920×1080, 30 fps** H.264/AAC input of **500,693,604 bytes**. It repeats a generated one-minute static layout with a small moving test tile; it is not a realistic slide/text/motion distribution. Input generation was excluded from encoding timing. The 60-minute presentation used source resolution, libx264 `veryfast`, CRF 23, two encoder threads, AAC 128 kbit/s and MP4 faststart.

| Measurement | Observed local result |
|---|---:|
| Encode 60-minute presentation | **829.612 s (13.83 min)** |
| Encode throughput | **4.34× real time** |
| Complete output decode | **82.475 s (1.37 min)** |
| Encode + decode | **15.20 min** |
| Output size | **180,132,754 bytes** |
| Container duration | **3600.000000 s** |

[VERIFIED scope] Encode and full decode exited successfully. This is **one exploratory local measurement**, not a distribution or a cloud estimate. Short-case reruns, repository checks and host activity overlapped encoding. Peak memory/disk and isolated CPU allocation were not measured. The long fixture has no private tail; it tests throughput and decodability, not boundary privacy. A visual check confirmed its simple static layout/moving tile, not text legibility. Source/output hashes and exact commands are in the evidence JSON. No transfer, Sandbox startup, cloud cleanup or SharePoint cost was measured.

[ASSUMED conclusion] Keep the cloud 0.5–3× sensitivity envelope unvalidated rather than replacing it with this local 4.34× point. A representative motion/slide fixture, repeated runs and target Sandbox hardware are still needed to narrow it.

## Local closure and practical follow-up

[VERIFIED via owner decision] Local investigation is **closed as promising with documented limitations**, not certified production-ready. The original strict matrix/receipts remain non-pass. Stop investigating the small Apple tail omission unless representative playback reveals a material problem; no private-content tolerance is introduced.

[PLANNED] Follow the practical sequence in `docs/plans/STAGE4_LOCAL_MATRIX_RESULTS_2026-10-09.md`: update the separate workflow plan, perform focused representative mapping/compatibility checks, run a bounded synthetic cloud pilot with region/cap/cleanup verification, and implement/test exact-file publication safeguards. Validate the controlled export recipe rather than every possible MP4 structure. Obtain fresh permission before any real recording and retain automated privacy acceptance before staff approval. These are phased validation/release obligations, not an open-ended requirement to finish every hypothetical local case.

## Review and checks

[VERIFIED via fresh read-only review] The reviewer checked short-case arithmetic, control detections, endpoint interpretation and the explicit non-pass. Review corrections were incorporated and short cases rerun; exact offset stream metadata is preserved. Long-run values were read directly from the completed receipt. Documentation/reference gates, available self-tests, secret/scaffolding checks and Python syntax validation passed within their registered scopes; none proves production privacy acceptance.

[VERIFIED via follow-up review] Fresh review required both-channel correlation, frame-to-source timestamp checks, explicit duration-preserving negative controls, and separate original-file evidence; these are now included. Audio continuity checks also cover every decoded frame. Full Stage A and production readiness remain unclaimed.
