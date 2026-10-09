---
title: Stage 4 separate-audio mapping and capacity results
domain: transcription
kind: report
status: active
summary: "Local generated-media offset, pause/gap, drift and capacity cases pass their bounded checks; full Stage A remains NOT PASSED. No cloud or real media accessed."
owner: product-engineering
related:
  - docs/plans/STAGE4_SYNTHETIC_RESULTS_2026-10-09.md
  - docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md
---

# Separate M4A mapping and capacity follow-up

**[VERIFIED via local generated-media receipts, 2026-10-09] The requested bounded mapping and capacity cases passed. Full Stage A remains NOT PASSED / incomplete.** No cloud run, real recording, SharePoint/Zoom access or Board registration occurred. This report extends the earlier padding/synchronization results; it does not certify a production mapper or output verifier.

## Mapping a separate M4A onto the MP4 clock

[VERIFIED via `scripts/benchmarks/stage4-mapping-check.py`] A generated 120-second source has two distinct seeded, band-limited noise channels. It is independently encoded into an H.264/AAC MP4 and separate AAC M4As. The mapper receives decoded waveforms, not the generating offsets or drift. Both audio timelines are checked for contiguous decoded frame timestamps from zero. This fixture uses 16 kHz stereo and highly matchable 150–1,000 Hz noise; it is not a speech recording.

Twelve anchors span M4A seconds 5–115. Six fit the model, and six validate/select among constant, affine and one-forward-gap models. Each 250 ms window searches within ±4 seconds on the MP4 clock; both channels must agree within two samples, with a strong, unambiguous correlation peak. Three additional anchors at 109, 110 and 111 seconds are withheld until model selection and audit the proposed boundary at 110. Positive slopes and ordered segments are required. The mapper does not extrapolate outside anchored support or across the unanchored gap bracket.

| Generated difference | Recovered mapping (MP4 seconds from M4A seconds t) | Mapped boundary at t=110 | Bounded result |
|---|---|---:|---|
| Unknown constant origin difference | t + 0.731 | 110.731 s | Pass |
| Two-second pause/gap: MP4 seconds 50–52 removed from M4A | t + 0.731 before gap; t + 2.731 after gap | 112.731 s | Pass; boundary inside unresolved gap blocked |
| Slow drift of 800 ppm plus origin difference | 1.0008 × t + 0.731 | 110.819 s | Pass |

[VERIFIED] All three proposed boundary mappings agree with the generated ground truth within one 16 kHz sample (62.5 microseconds). The largest independent boundary-anchor residual was 12.5 microseconds in the drift case. The gap location is only bracketed between M4A seconds 45 and 55; a boundary at 50 is blocked. This is detection of removed audio, not a test of every possible container timestamp discontinuity or recording-pause implementation.

**[ASSUMED limitation] The measured residual plus two samples is an empirical test margin, not a certified uncertainty bound.** It produces candidate endpoints 0.125–0.1375 ms earlier in these fixtures. These numbers are not recommended production trim margins. Sparse anchors cannot rule out arbitrary timing changes between them. The experimental 5 ms model-residual ceiling is a mismatch detector, not permission to include 5 ms of discussion. Real-media uncertainty still needs a defensible bound; Justin's rule remains earlier trimming by measured uncertainty up to 2 seconds, otherwise block. The mapping experiment does not yet feed its candidate endpoint through the complete privacy-marked encode and export-verification pipeline.

### Wrong mappings and ambiguous matches

[VERIFIED via assertions and receipt] All intended negative controls were rejected:

| Fault | Evidence causing rejection |
|---|---|
| Constant offset deliberately wrong by 100 ms | Validation residual 100 ms |
| Two-second gap ignored | Validation residual up to 2 seconds |
| Drift ignored; constant offset fitted to early anchor | Validation residual up to 88 ms |
| Hidden 100 ms local timing change between regular anchors near cut | Regular model anchors support a constant mapping, but the untouched boundary audit rejects it |
| Silent unmatched input | Insufficient/silent anchor |
| Repeating 440 Hz waveform | Ambiguous correlation peaks; matcher-level control, not another encoded M4A case |

The boundary audit was added after review identified that regular widely spaced anchors alone could miss a local timing change. The test establishes rejection of this injected fault, not every possible unobserved warp. Multiple gaps, larger/negative offsets, drift over full meeting lengths, noisy speech, differing channel mixes, lossy source pre-echo and real source identity matching remain untested.

## Capacity and failure handling

[VERIFIED via `scripts/benchmarks/stage4-capacity-check.py`] The byte-stress fixture is an 85-minute, physically written MP4 containing repeated 320×180/25 fps generated video, AAC audio and constant-bitrate filler. It is **1,949,649,480 bytes** (97.48% of the 2,000,000,000-byte input cap), with 1,962,938,368 allocated bytes reported by the filesystem. It is not a sparse placeholder. The generated 60-minute presentation deliberately uses a higher bitrate to exceed the input size and experimental output limit.

| Case | Observed result | Experimental decision |
|---|---|---|
| Near-cap input | 1,949,649,480 bytes | Admitted by input/space checks |
| Larger complete output | 2,190,280,943 bytes; encode and complete decode succeeded | Rejected by experimental 2 GB output cap |
| Actual oversized file used as input-admission control | Same 2.19 GB file | Rejected by input cap |
| FFmpeg `-fs 64000000` | Exit 0; 64,302,101-byte file, only 105.952 seconds instead of 3,600 | Rejected as truncated despite successful encoder exit |
| Actual OS per-file limit of 32 MiB | Process exit −25; partial file 33,554,432 bytes | Rejected as encoder failure |
| Exact cap / cap plus one byte | Arithmetic admission controls | Exact cap admitted; one byte over rejected |
| Insufficient free scratch | Injected free-space value of 100 bytes | Preflight rejection; no encoder launched for this branch |

[VERIFIED scope] The complete oversized output was independently fully decoded with FFmpeg, then removed. Each limited output was removed by its exact owned path and absence checked. Source/seed media and local logs remain in the unique temporary directory; complete scratch cleanup is not claimed. The capacity decision function checks process exit, size and container duration. It is **not a privacy/stream-validity verifier**; only the complete oversized output receives the additional full decode in this experiment. The 2 GB output cap is experimental, not an owner-approved production output policy.

### Local resource observations

[VERIFIED via macOS `/usr/bin/time -l` and 50 ms file-size sampling] Host remains Apple M3 / 16 GiB; FFmpeg 9.0.2, two libx264 threads. This is not CPU or memory isolation.

| Measurement | Observed |
|---|---:|
| Complete 60-minute byte-stress encode | 19.728 s |
| Complete output decode | 5.220 s |
| Maximum process RSS across recorded commands | 51,789,824 bytes (49.39 MiB) |
| Peak sampled logical size of owned scratch files | 4,162,880,103 bytes (4.16 GB) |
| Free space before run | 76,525,707,264 bytes |
| Owned scratch remaining before final receipt write | 1,972,600,750 bytes |

These unusually short timings reflect low resolution and filler bytes, not realistic presentation complexity. They must not replace the earlier 1080p result or narrow the cloud runtime envelope. Scratch is a sampled sum of logical file sizes, not an instantaneous allocated-volume peak. RSS is process memory reported by macOS, not a cloud/container memory guarantee. The OS file-limit failure is real; volume exhaustion (ENOSPC) was not induced, and the free-space branch is a mock. No cloud quota, timeout/reaper, transfer, retry, upload or production cleanup behavior was exercised.

## Evidence, reproduction and remaining matrix

[VERIFIED] The content-free receipt is `docs/plans/STAGE4_MAPPING_CAPACITY_EVIDENCE_2026-10-09.json`. It contains the exact commands, source/output hashes, harness hashes, anchor observations, model/control results, file probes and resource readings. Media were neither committed nor uploaded. Run the mapping harness with a NumPy-capable Python (this run used the existing bundled Python and NumPy 2.3.5); run the capacity harness with Python 3 on macOS. Capacity reproduction requires at least 8 GB free scratch and writes several GB locally. Both harnesses accept no real-media path and make no network calls.

[VERIFIED via fresh read-only review] Review checked model validation/audit separation, monotonicity, the hidden-warp control, capacity rejection semantics and resource-claim limits. Findings were incorporated before the final mapping rerun. The report deliberately keeps empirical mapping margins and capacity checks separate from production acceptance.

**[ASSUMED engineering follow-up; Stage A NOT PASSED]** Remaining local matrix work includes integrated mapped-boundary encoding with privacy markers; broader codec/offset/gap/drift combinations; arbitrary caption/data/unreferenced payload and all-track checks; a second independent playback path; stale-input/revision behavior; and a motion-heavier, legible-slide quality/performance fixture with representative resource measurements. Cloud lifecycle and upload/cleanup/region/cap enforcement remain later-stage obligations. No cloud or real media is authorized by these partial results. Staff retain the full Recording until Stage 5, then only the presentation video.
