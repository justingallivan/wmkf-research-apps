---
title: Stage 4 integrated local matrix results
domain: transcription
kind: report
status: active
summary: "Local investigation closed as promising with documented limitations by owner decision. Historical strict matrix remains non-pass; tiny Apple tail omissions are a quality limitation, not a standalone project blocker. Practical mapping, compatibility, cloud and publication checks remain before production."
owner: product-engineering
related:
  - docs/plans/STAGE4_SYNTHETIC_RESULTS_2026-10-09.md
  - docs/plans/STAGE4_MAPPING_CAPACITY_RESULTS_2026-10-09.md
  - docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md
---

# Integrated local matrix — investigation closed, promising with limitations

**[VERIFIED via Justin's closure decision, 2026-10-09] The local investigation is closed as promising with documented limitations.** The evidence supports proceeding to focused validation and implementation planning, not production certification. The original strict Stage A matrix and immutable receipts remain **NOT PASSED**; this decision changes which open items block progress, not the recorded test outcomes.

[VERIFIED via local receipts] Four mapping-to-cut cases pass the bounded FFmpeg checks. No private marker appeared in positive outputs; deliberate privacy and synchronization faults were rejected. The Apple probe intermittently omits approximately 4–21 ms of retained presentation audio. Another Apple audio API returns complete counts but records EOF on a subsequent read. Actual player behavior and the root cause remain unknown. **[Owner-accepted limitation]** Treat this as a minor unresolved playback-quality issue, not a standalone project blocker. Stop investigating it unless representative playback exposes an objectionable ending or a materially different failure. Staff listening addresses ending quality; it does not override a failed privacy check.

No cloud, real-media, SharePoint/Zoom or Board operation was performed. No runtime application code or acceptance script changed for this closure. No generic tolerance for private content, unexplained timing errors or materially truncated files is authorized.

## Results matrix

| Area | Evidence actually exercised | Result and limit |
|---|---|---|
| Full mapping → cut → export checks | Positive/negative offsets, gap and drift; 48/44.1 kHz separate M4As; isolated PCM; exported AAC payload and frame-clock checks | Four bounded cases pass with FFmpeg; independent-native completeness does not consistently pass |
| Long drift | 85-minute generated MP4/M4A, 80 ppm drift, offset, distributed anchors and near-boundary audit | Recovered within one 16 kHz sample; ignored drift rejected |
| Unsupported/ambiguous mappings | Heavy noise, swapped channels, two gaps, an anchor straddling a gap | Rejected; no guessed mapping |
| Extra streams and hidden bytes | Extra audio, subtitle, timecode data, private metadata, top-level and nested private payload controls | Bounded stripping/rejection tests pass; not every codec/container payload is parsed |
| Independent decode | Initial AVFoundation tests plus original/packet-aligned copies through two Apple APIs | **Non-pass:** initial 5/12 reads short; packet-aligned follow-up still short in 2/16 reader trials. See separate API/error accounting below |
| Changed input/output | Source/audio hash, revision, boundary, mapping mutation; actual altered output bytes | In-memory eligibility simulation rejects all; no production transaction/await fencing tested |
| Quality/resources | Two 120-second 1080p variants, three encodes each, full decode, SSIM, visual inspection | Readable sampled frames; local bounded timings/resources, not a cloud or full-meeting guarantee |

## Complete mapping-to-cut test

[VERIFIED via `scripts/benchmarks/stage4-integrated-check.py`] The generated 120-second source contains source-frame numbers, red private frames after 92.350 seconds, independent band-limited pilot noise and private 3.5/4.1 kHz tones. The source is first checked to prove both private markers are actually present. A synthetic staff-reviewed point is placed at 92.250 seconds, 100 ms before the private markers. That prescribed safe-side point is fixture ground truth, not a measured production speech margin.

The mapper receives independently encoded waveforms without the generating transform. Twelve anchors select/validate its model; three additional anchors just before the reviewed point audit it. Decoded input audio timestamps are checked at their actual sample rate before sample indices are used as clocks. Mapping comparisons use low-pass-filtered 16 kHz audio. The measured mapping drives the earlier endpoint, rounded down to a 48 kHz sample. Only the pre-endpoint decoded PCM reaches the AAC encoder, and only whole safe video-frame intervals are selected. An independent encode of the isolated PCM must match the exported AAC packet payload and raw elementary decode. All normal/ignored-edit-list content and source-frame clock checks must pass.

| Case | Separate-audio transform | Sample rate | Encoded endpoint |
|---|---|---:|---:|
| Offset | MP4 = M4A + 0.731 s | 48 kHz | 92.249854167 s |
| Pause/gap | Two source seconds removed; offsets 0.731 / 2.731 s | 48 kHz | 92.249854167 s |
| Drift | MP4 = 1.0008 × M4A + 0.731 s | 44.1 kHz | 92.249812500 s |
| Negative offset | MP4 = M4A − 0.517 s, with generated leading silence | 44.1 kHz | 92.249854167 s |

[VERIFIED] Each mapped review point is within one 16 kHz sample of its generated truth. All four FFmpeg-based export checks pass. A deliberately wrong 100 ms mapping is rejected before encoding. A deliberately bypassed mapping gate producing a late cut is rejected by actual private video/audio markers and safe-payload mismatch. The empirical alignment margin remains **not a certified bound between anchors**, and these signals are not speech.

## Long drift and multiple gaps

[VERIFIED via `scripts/benchmarks/stage4-long-mapping-check.py`] A separate 85-minute generated source uses 16 kHz stereo, AAC 64 kbit/s and a tiny 1 fps video solely to establish the MP4 clock. Both decoded audio clocks are checked. Thirteen anchors span seconds 35–5,075; a final audit uses 4,799, 4,800 and 4,801. At M4A second 4,800, the true MP4 time is **4,800.815 s**; the recovered time differs by about **4.17 microseconds**. The maximum boundary-audit residual is about **21.67 microseconds**. Audit residuals are included in the empirical margin. Ignoring the 80 ppm drift causes up to **369.563 ms** error on validation anchors and is rejected.

A short two-gap M4A is also encoded. An anchor directly straddling a gap is rejected as weak/ambiguous. With anchors moved away from both gaps, the one-gap mapper still rejects the incompatible two-gap relationship. This is fail-closed behavior, not support for solving arbitrary multi-gap recordings. No presentation export was made from the long fixture; the four short integrated cases exercise the export path.

## Container and changed-state controls

[VERIFIED via integrated and `scripts/benchmarks/stage4-container-check.py` receipts] The contaminated source really includes two audio tracks, a subtitle track, a timecode data track and private metadata. Explicit stream mapping and metadata removal produce the expected one-video/one-audio output, which passes the bounded checks. Separate exported-file controls add raw trailing bytes, an unknown top-level box, unreferenced `mdat` bytes, a nonempty `free` box, private nested metadata and private bytes in a nested `moov/free` box. All are rejected. The nested-free control still passes the earlier top-level/packet-extent check and reports the same duration, demonstrating why the added nested inspection matters.

**[ASSUMED limits]** The nested scan allows the observed recipe's box types and rejects unsupported structures. It does not fully interpret sample-entry extensions, every allowed box field, codec side data or arbitrary concealed payload. Passing these controls is not a universal MP4 sanitization proof.

[VERIFIED bounded simulation] Twenty changed-binding controls cover source hash, audio hash, transcript revision, boundary and mapping across the four cases. A file actually changed after acceptance also fails its output-hash binding; failed acceptance cannot become eligible. These are local equality/eligibility simulations. They do not exercise application awaits, concurrent database transactions, staff approval, publication or Board readers, which are outside these benchmark scripts. There is no implemented Stage 4 runtime enforcement claim.

## Independent Apple decode: retained audio omitted, not padding

[VERIFIED via `scripts/benchmarks/stage4-native-check.py` and `scripts/benchmarks/stage4-native-decode.swift`] AVFoundation decodes every video/audio sample, checks source-frame numbers and both-channel private markers, and requires the same positive frame/sample counts as the integrated receipt. A five-second truncated file is rejected even though it contains no private markers and ends early. The leaky control is rejected for actual private markers. Each control runs three times.

All twelve positive reads returned the expected **2,766 video frames**, with no private video or audio marker. However, **five reads returned 215 or 217 fewer audio samples** than FFmpeg/the expected isolated input: about **4.479–4.521 ms early**, not extra discussion. Other reads of the same hash returned the complete expected audio. Therefore the strict native check remains non-pass. The cause of the intermittent omission remains unknown. The follow-up below rules out treating the missing interval as disposable padding. This evidence does not establish an Apple player defect or a privacy leak; the exact-count completeness check remains unchanged.

### Tail-forensics follow-up: padding exemption ruled out

**[VERIFIED via `scripts/benchmarks/stage4-tail-forensics.py` and `docs/plans/STAGE4_NATIVE_TAIL_EVIDENCE_2026-10-09.json`] The missing 215–217 samples belong to the retained encoder input.** They precede the actual AAC trailing padding. The two distinct output hashes cover all four integrated cases.

| Measurement | Offset output (also gap/negative-offset hash) | Drift output |
|---|---:|---:|
| Isolated input / normal decoded samples per channel | 4,427,993 | 4,427,991 |
| Samples in a short native read | 4,427,776 | 4,427,776 |
| Retained samples omitted | 217 (4.521 ms) | 215 (4.479 ms) |
| Actual post-input padding, separately accounted | 807 samples | 809 samples |
| Missing source interval RMS, normalized ±1 scale | 0.107401 | 0.107810 |
| Correlation between omitted native tail and retained input tail | 0.998696 | 0.997967 |

[VERIFIED] The presentation MP4 and isolated encoder input match the prior committed hashes. A fresh independent AAC encode of that isolated input reproduces the output's complete AAC packet payloads. Elementary AAC decoding contains exactly **1,024 priming + retained input + 807/809 trailing samples**; removing only priming and trailing samples reproduces the normal decode exactly. The MP4 audio time base is explicitly checked as 1/48,000 before comparing packet timestamps with sample indices. The short reads stop at the beginning of the last AAC packet's **valid** 215/217-sample interval, not at the beginning of post-input padding.

[VERIFIED] Each missing source sample is nonzero in both channels, and the omitted decoded waveform strongly correlates with that retained input. A short native read is **bit-identical to the corresponding complete native read throughout the entire shared prefix**. Eight fresh native reads reproduced four complete and four short reads; all shared prefixes remained bit-identical. The retained historical native PCM artifacts were matched to the previously recorded counts and newly hashed during this investigation; they did not have prior committed PCM hashes. The MP4 and isolated-input hash bindings, plus the fresh repeated reads, are separate evidence.

[VERIFIED scope] Small size or low energy alone cannot authorize a padding exemption. Classification controls distinguish removal of only the proven post-input padding from removal of even one retained sample, and reject a changed earlier prefix. The classifier is a forensic aid, not a new playback acceptance rule. **No acceptance check was relaxed.** This is a tiny loss of retained synthetic presentation audio, not detected private content. The investigation does not determine whether a listener would notice it, whether an actual player behaves identically, or why the native probe intermittently omits it.

[VERIFIED background via Apple documentation] AAC uses overlapping transforms and separate priming/remainder samples; a final packet can therefore be needed to recover retained source audio. Padding and retained samples must be distinguished by their position and provenance, not packet byte size. See [Apple's AAC encoding background](https://developer.apple.com/documentation/quicktime-file-format/background_aac_encoding). This explains the investigation method; the local receipts establish this fixture's result. The complete-packet experiment below tests that hypothesis without granting a blanket short-tail allowance.

Native decoded video buffers supplied no individual duration. For these CFR fixtures, the probe instead requires all adjacent native timestamps to agree with native minimum frame duration, and the last interval to agree with native track end. It does not substitute zero for missing duration. This method is not yet a VFR playback proof. It is an independent decoder exercise, not a browser/VLC listening session.

## Earlier complete-packet cut: not a reliable fix

**[VERIFIED via `scripts/benchmarks/stage4-packet-boundary-check.py` and `docs/plans/STAGE4_PACKET_BOUNDARY_EVIDENCE_2026-10-09.json`] Re-encoding at an earlier complete AAC packet did not eliminate the intermittent short read. The historical strict matrix remains NOT PASSED.** This is a bounded diagnostic, not a production recipe change.

The experiment reuses only source/output/isolated-PCM bytes matching the committed integration hashes. It truncates the encoder input to **4,427,776 samples/channel**, ending at **92.245333333 s**: 217 samples (4.521 ms) earlier for offset/gap/negative-offset, or 215 samples (4.479 ms) earlier for drift. It re-encodes from that isolated prefix; it does not drop a compressed packet from an existing file. Offset and drift produce the **same aligned output hash**, so these are repeated reads of one aligned file, not two distinct format cases. The video remains 2,766 frames ending at 92.200 s.

[VERIFIED] Final assertions check the exported audio time base is **1/48,000**, its last packet begins at sample **4,426,752**, lasts **1,024 samples**, and ends exactly at the chosen endpoint. Elementary decode has 1,024 priming samples and **zero trailing padding**. The isolated input is byte-for-byte the earlier prefix of the original safe input. Packet equality with the independently encoded reference, raw/normal/ignored-edit-list provenance, private-marker checks, video source clocks and audio timestamp continuity all pass. Both-channel waveform anchors at 1.5, 45 and 91.5 seconds pass. Thus packet alignment was actually established, not inferred solely from an input-length multiple.

Two completed batches each read both original files and both aligned copies four times through each API. The first batch's observations are preserved; the final batch adds explicit packet assertions, uses the aligned output's own expected frame count and records a combined strict status.

| Apple path | Original files: complete reads | Aligned file: complete reads | Terminal behavior |
|---|---:|---:|---|
| Existing AVAssetReader probe | 13/16 | **14/16** | Reports completion even on short reads |
| New AVAudioFile audio-only diagnostic | 16/16 | 16/16 | All 32 reads deliver the expected samples, then the next read raises EOF (-39), with zero frames in the error buffer |

[VERIFIED] Three original reader trials omit 215 retained samples. **Two aligned reader trials omit an entire final 1,024-sample packet (21.333 ms)**. Every observed PCM output is bit-identical over its shared prefix to the corresponding complete AVAudioFile read. No positive private marker appears. All reader video intervals/clocks and tested audio clocks/anchors pass; exact audio completeness still rejects the short reads. No numerical shortfall allowance was added.

[VERIFIED scope] The AVAudioFile diagnostic uses a separate read loop and records declared length, final position, actual byte/sample count, final chunk sizes and terminal error. Its initial exploratory run surfaced EOF as an uncaught error; the diagnostic was revised to retain that error in the receipt. It does not count a buffer returned alongside an error, and all observed error buffers contain zero frames. **It is not a replacement acceptance checker:** the final strict status does not waive any terminal error. These results narrow the discrepancy to the tested read paths but do not identify its root cause or prove actual browser/player behavior. Inspection of the existing reader found that it already checks successful completion, every buffer's byte count and sample clock; none of those checks was removed.

[VERIFIED controls, repeated in each completed batch] Four milliseconds of private tone placed inside the aligned endpoint is rejected by the marker and isolated-payload checks. A 10 ms shift of the right channel is rejected at early/middle/late waveform anchors. A 50 ms audio timestamp shift is rejected by the cumulative clock check. These new controls exercise the FFmpeg/provenance/sync verifier; the original Apple leaky/truncated controls remain separate historical evidence. No claim is made that the new AVAudioFile diagnostic itself has a complete acceptance/control matrix.

**[Owner decision — diagnostic deferred]** Do not pursue another Apple reader implementation or progressively earlier cuts solely to resolve this small omission. Preserve the evidence. Reopen only if representative playback shows an objectionable ending, material truncation, synchronization failure or a privacy concern. Packet alignment is not adopted as a proven fix.

## 1080p quality and resource probes

[VERIFIED via `scripts/benchmarks/stage4-quality-check.py`] Both generated variants are 1920×1080/30 fps, 120 seconds, H.264/AAC. One has static text and a small moving tile; the other adds scrolling rows and a much larger moving tile. Source generation is excluded from encoding timing. Output uses libx264 `veryfast`, CRF 23, two threads and AAC 128 kbit/s. Each variant is encoded three times sequentially, then fully decoded. Other local benchmark activity overlapped parts of these runs; CPU allocation was not isolated.

| Measurement | Static text/small tile | Scrolling/large tile |
|---|---:|---:|
| Encode duration, three runs | 19.643 / 19.468 / 20.335 s | 29.372 / 38.044 / 34.799 s |
| Output size | 6,294,471 bytes | 18,139,940 bytes |
| Full-image SSIM vs decoded source | 0.998445 | 0.995453 |
| Maximum encoder process RSS | 303,890,432 bytes | 302,776,320 bytes |

[VERIFIED via viewing extracted frames at 60 seconds] Titles, budget figures, small alphabet/digit text and scrolling rows were readable in both outputs. Partial rows at the scrolling viewport edges are present by design. This is a two-frame visual inspection, not full-video human quality or listening approval. SSIM is supporting evidence, not a legibility guarantee. Peak process RSS across all recorded quality commands was 408,174,592 bytes; peak sampled logical scratch was 63,957,403 bytes. These are local process/sampled-file measurements, not isolated-container peaks. The two-minute tests cannot replace full-length performance testing or narrow the cloud runtime envelope.

## Practical next steps and release requirements

[VERIFIED owner direction; PLANNED execution] Close local research now. Do not require every theoretical matrix case to pass before the project can advance. Prioritize the following bounded work:

1. **Update the separate Stage 4 workflow plan.** Carry this closure decision into its acceptance/release criteria: privacy and correct-file publication remain hard gates; the observed Apple tail omission is a documented quality limitation. Keep historical exact-count diagnostics available without turning their known small discrepancy into a universal processing blocker. This report does not implement a new production tolerance or change that separate plan.
2. **Validate representative mapping and compatibility.** Exercise noisy/speech-like audio, realistic pauses, variable frame rate and delayed audio using generated material first. Check several distinct anchors, including near the cut, and verify a conservative endpoint. Reject ambiguous mappings rather than guess. Keep the owner rule: trim earlier by measured uncertainty up to 2 seconds; larger or unbounded uncertainty requires staff boundary/mapping resolution. Check actual intended playback and ending quality; do not make this contingent on solving the Apple probe's internals. This is the remaining material media/privacy validation, not an exhaustive codec research program.
3. **Run a bounded synthetic Sandbox pilot when resumed.** Confirm the app's actual US region, current pricing and enforcement of the authorized $10 incremental-compute cap before dispatch. Use persistence off, no media snapshots, and independently verified cleanup. Measure a representative full-length presentation, readability, ending quality, runtime and scratch use. Test interruption, insufficient disk, failed/partial uploads and cleanup failure; failed or incomplete results must remain unpublished. Cloud limits and cleanup are later-stage checks, not reasons to reopen this local investigation.
4. **Build and test correct-file publication safeguards during application implementation.** Bind source identity/hash, transcript/boundary revision, mapping, output hash/version, automated acceptance and staff approval. Invalidate an output if those inputs change during processing. Test retries, concurrent changes, upload reconciliation, approval and Board listing/direct-open paths. Existing equality simulations do not prove these production behaviors. These safeguards are required before Board use, not before encoder research can close.
5. **Obtain fresh permission before the first real input.** After the focused synthetic safety checks and cloud preflight, present their results and ask Justin before reading request 1003222's already-copied video; explicitly scope any paired audio. Note applicable Vercel data-processing terms beforehand. Use an isolated staff-only test folder, no new Zoom read and no Board registration. A longer recording follows only after that case passes. This documentation closure is not permission to access real media or start a cloud run in this turn.

[Owner-accepted scope] Validate the controlled re-encode recipe: selected H.264/AAC streams only, removal of extra tracks/metadata, isolated pre-endpoint input, complete decode, and the tested hidden-content/provenance checks. Unsupported output structures remain rejected. A universal proof over every possible MP4 field or codec payload is **not** a prerequisite to moving forward. Representative full-length quality and resource failure handling belong in the pilot; they are operational requirements, not evidence of a current privacy leak.

[Unchanged privacy/release contract] Automated privacy/mapping acceptance must pass before an output is offered for staff ending review. Staff approval cannot override failed privacy checks, and Board eligibility must refer to the exact approved file. Keep the full Recording staff-only until the Stage 5 deadline, then retain only the presentation video. The historical universal Stage A pass is no longer the sole progression criterion; the focused checks and explicit access/release gates above replace that open-ended research requirement.

## Evidence and contract reconciliation

[VERIFIED] `docs/plans/STAGE4_LOCAL_MATRIX_EVIDENCE_2026-10-09.json` stores content-free receipts, command arguments, build information, hashes, observed counts and resource results. Independent/native/container receipts are bound to byte-identical final integration outputs by hash. Generated media, native binaries and decoded intermediates remain in unique local temporary folders; no complete scratch cleanup is claimed. NumPy/Pillow came from the existing bundled Python; no new package was installed. Native probe compilation uses the installed Apple toolchain; it emits API-deprecation warnings but succeeds.

[VERIFIED scope] Contract-reconcile surface: benchmark scripts → generated files → content-free receipts → these research reports. Auth/routes/schema/production stores: N/A. Partial successes remain per-case; the aggregate Stage A status never becomes pass. Changed-state behavior is explicitly simulated. Fresh read-only review required complete native counts, valid video intervals, explicit long-input clocks and audit-inclusive margins; those changes are incorporated. The full startup gate set passed sequentially. Final scoped documentation/safety gates are required before commit. The tail investigation leaves all existing privacy and completeness gates unchanged; its new forensic assertions check sample provenance rather than accepting a duration tolerance.

[VERIFIED reconciliation scope] Sweep Mode A covers the Stage 4 research reports and their live restatements, using executed receipts as authority. Earlier initial results remain historical; current summaries and remaining-work lists point here. Main's separate workflow implementation/release history is excluded because this is an isolated benchmark branch. No claim of whole-repository or Production reconciliation is made.

[VERIFIED packet follow-up reconciliation] Sweep Mode A: generated test scripts → hash-bound local files → content-free packet evidence → four Stage 4 research reports. The packet experiment records the failed packet-alignment remedy; prior numerical results remain historical observations. Search collisions in unrelated operational documents are excluded. No new runtime/persistence status, auth route, schema or production consumer is introduced (N/A). Fresh read-only review required explicit exported-packet proof, aligned frame counts and separate completeness/error accounting; the final rerun includes these. Remaining unknowns are native-reader root cause and the broader matrix, not a waived privacy check. Scoped documentation gates do not certify nested plan facts or media behavior.

[VERIFIED closure reconciliation] Sweep Mode A: Justin's explicit closure decision → this report and three linked research summaries → Claude's separate workflow-plan handoff. Historical receipts and benchmark scripts are unchanged; original non-pass observations remain evidence, not a current instruction to continue open-ended local research. Current next steps distinguish material privacy/publication gates from accepted quality limitations and deferred exhaustive checks. No runtime, schema, approval binding or deployment is implemented by this documentation change. The separate workflow plan still needs updating; production readiness remains unproven.
