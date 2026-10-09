---
title: Stage 4 local synthetic benchmark results
domain: transcription
kind: report
status: active
summary: "Local generated-media Stage A is not passed: offset audio and edit-list clock/padding checks remain unresolved. No cloud or real recording was accessed."
owner: product-engineering
related:
  - docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md
---

# Stage 4 local synthetic results

**[VERIFIED via local experiment, 2026-10-09] Stage A is NOT PASSED.** This was a local exploratory experiment, not production verification. Five of six short full-reencode candidates passed the normal fixture-specific checks. The delayed-audio candidate failed its decoded endpoint check. All six have unresolved results when decoded without MP4 edit lists. Deliberately leaky remux and wrong-offset controls were rejected, with both private-video and private-audio markers independently detected. No cloud job ran, no SharePoint/Zoom recording was read, and nothing was registered for the Board.

## Authorization and environment

[VERIFIED via latest owner instruction] FFmpeg installation through Homebrew and generated-media Stage A were authorized. Future Sandbox use has a $10 incremental compute cap, persistence off, verified cleanup and the app functions' US region; first report Stage A. Real-media progression requires synthetic checks to pass and a fresh question to Justin before reading request 1003222's already-copied video. Outputs belong in an isolated staff-only test folder; a longer real recording follows only after that passes. Document applicable Vercel data-processing terms before real media. None of those later steps was exercised here.

[VERIFIED via installation/version/hardware commands] Homebrew installed FFmpeg/ffprobe **9.0.2**, including libx264 and AAC encoding, on **Apple M3, 16 GiB RAM**. Homebrew installed dependencies and upgraded ca-certificates/xz; its dependency installation also unlinked openssl@3 while installing openssl@4. No application dependency or runtime configuration changed. Encoding used two libx264 threads, **not** a two-vCPU resource allocation. This cannot establish Sandbox timing or memory sufficiency.

## Reproduction and evidence

- Harness: `scripts/benchmarks/stage4-synthetic.py`. Run `python3 scripts/benchmarks/stage4-synthetic.py` for short cases; add `--long` for the performance fixture. It accepts no external-media path and uses generated frames/audio only. No credentials or network APIs are used.
- Content-free receipt: `docs/plans/STAGE4_SYNTHETIC_EVIDENCE_2026-10-09.json`, including command arguments, build version, hashes, sizes, measured endpoints, marker detections and durations.
- Generated media/logs remain in uniquely named local temporary directories printed by the harness; they were not committed or uploaded. The harness only removes its exact generated raw intermediate files; it does not claim all scratch is cleaned. No Sandbox cleanup receipt exists because no Sandbox was created.
- A zero script exit means the experiment completed, **not** that Stage A acceptance passed. The receipt/report records the non-pass explicitly.

## Short-case results

[VERIFIED via final short run] Each reference is 24 seconds, 320×180, nominal 30 fps, stereo 48 kHz. Lossless FFV1/PCM reference precedes H.264/AAC source encoding. Video contains a binary frame-number strip and turns red at the synthetic private boundary; each audio channel switches to a distinct private tone (3.5/4.1 kHz). This is simpler than the proposed pseudorandom watermark and human-readable timecode. Source scenecut is disabled and keyframes are probed. The VFR case drops alternate frames after six seconds and adds a second audio track to the source; output contains only the selected video/audio pair.

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

[VERIFIED via marker/provenance checks] No positive candidate exposed a private red frame or private-tone block. That does **not** prove semantic privacy or that all padding is silence. Ignoring edit lists changes timeline origins and priming treatment: raw timestamp excess is an unresolved verifier/clock issue, **not evidence that discussion content leaked**. A valid verifier must map both decode paths to the same source clock and classify padding before accepting or rejecting on those timestamps. Do not normalize audio and video independently and thereby erase their relative offset.

[VERIFIED via inspected source keyframes] Constant-rate cases have keyframes at 0, 2, 4, …, 22 seconds; the named keyframe cases refer to **E**, not B. Whole-frame interval rounding is deliberately conservative: the at/after-keyframe outputs actually retain only through source frame 358 and end at 11.966666 s; neither is claimed to retain the keyframe itself. VFR keyframe spacing differs and is retained in the receipt. These fixtures do not exercise arbitrary open-GOP dependencies.

## Negative controls and checker limits

[VERIFIED via final run] The leaky remux produced **17 private video frames** and **27 private-tone blocks on each channel**; the wrong-offset encode produced **13 private frames** and **26 blocks on each channel**. Both also exceeded E, but explicit assertions require both marker reasons, so timestamp failure alone cannot make the content-detector test pass. Naive presentation stream-copy exposed no private marker in this guarded fixture, yet retained source frames/intervals beyond E and was rejected. This supports rejecting a naive copy recipe; it is not proof that every possible stream-copy implementation leaks discussion.

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

## What remains before a synthetic pass

[ASSUMED engineering follow-up] Resolve the delayed-audio sample/priming issue and normalize the edit-list-ignoring path to a proved common source clock, without hiding samples through metadata. Then rerun the positive cases and controls. Also implement and test the remaining acceptance coverage:

- Waveform alignment across separate M4A origins, pauses/discontinuities and multiple distinct anchors; the current harness supplies known timing rather than estimating it.
- Pseudorandom/tail-local audio controls, independent video-only/audio-only faults, and representative codec/offset combinations. Tiny thresholded tone checks are not sample-level exclusion proof.
- Unexpected caption/data streams, arbitrary trailing/unreferenced payload, all-track inspection, a second independent playback path and stale-input binding behavior.
- Near-2 GB input/output-cap failure, peak memory/disk measurements and the proposed motion-heavier/legible-slide quality fixture. The long repeating pattern below is only a timing probe.
- Cloud dispatch, timeout/crash cleanup, snapshots, upload failure/reconciliation and region/cap enforcement remain separate cloud-stage obligations.

[VERIFIED scope] Stage A was run far enough to expose blocking correctness gaps; it does not satisfy the complete proposed synthetic acceptance matrix. No real recording should be requested/read on the strength of these results. The full staff Recording retention policy is unchanged: retain until Stage 5, then retain only the presentation video.

## Review and checks

[VERIFIED via fresh read-only review] The reviewer checked short-case arithmetic, control detections, endpoint interpretation and the explicit non-pass. Review corrections were incorporated and short cases rerun; exact offset stream metadata is preserved. Long-run values were read directly from the completed receipt. Documentation/reference gates, available self-tests, secret/scaffolding checks and Python syntax validation passed within their registered scopes; none proves production privacy acceptance.
