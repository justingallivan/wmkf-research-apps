---
title: Stage 4 synthetic Vercel Sandbox pilot results
domain: transcription
kind: report
status: active
summary: "Synthetic Vercel Sandbox pilot (Session 591): the v1 cut recipe passed on a 60-minute 1080p generated fixture in iad1 at 2 vCPU (cut about 11.5 min for a 48-minute presentation), interruption and full-disk cases failed closed, and every sandbox was removed with no snapshots. Total compute about $0.22 of the $10 cap. Generated media only; the browser/SharePoint ending check and real input remain."
owner: product-engineering
related:
  - docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md
  - docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md
  - docs/plans/STAGE4_LOCAL_MATRIX_RESULTS_2026-10-09.md
---

# Stage 4 synthetic Vercel Sandbox pilot results

Session 591, 2026-10-09 PT. Owner-authorized under decision 10 ($10 incremental compute cap, persistence off, verified cleanup, US region). This is step 2 of "Next steps before the build plan" in `STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md`. Generated media only: no real recording, credential, Zoom read or upload. Script: `scripts/benchmarks/stage4-sandbox-pilot.py`; receipts: `STAGE4_SANDBOX_PILOT_EVIDENCE_2026-10-09.json`.

## Pre-dispatch checks [VERIFIED 2026-10-09]

- **Region:** the app's functions run in `iad1` (`vercel inspect` on a Production deployment; `vercel.json` sets no `regions`). Every sandbox was created with `--region iad1 --failover-regions none`.
- **Pricing (iad1, Pro):** $0.128 per active CPU-hour, $0.0212 per provisioned GB-hour; each vCPU includes 2 GB; data downloaded into a sandbox is free (vercel.com/docs/sandbox/pricing, last updated 2026-09-10). A 2-vCPU sandbox costs at most about $0.34 per hour.
- **Cap enforcement:** Vercel has no per-sandbox spend cap. Spend Management is account-wide (alerts or pausing projects), and Pro Sandbox usage first draws on the team's $20 monthly credit. The $10 cap was therefore enforced by our own per-sandbox ceilings (`--vcpus 2` × `--timeout`), recorded in a ledger before each create. Owner accepted this before dispatch.

## Environment [VERIFIED via the 3-minute probe]

Default image `vercel/sandbox/universal`: Ubuntu 26.04.1, x86_64, 2 CPUs, 4 GB, 61 GB free scratch; Python 3 (no NumPy) and Node; no FFmpeg and no fonts. FFmpeg 9.0.2 (the local Homebrew version) was installed from the pinned BtbN build `autobuild-2026-10-08-13-05` (`ffmpeg-n9.0.2-23-g27b46f0fbc-linux64-gpl-9.0.tar.xz`, SHA-256 `14020417…0902` from GitHub's asset digest), verified in the sandbox before use. DejaVu Sans 2.37 came from its GitHub release (SHA-256 recorded locally). Network was limited to `github.com` and `*.githubusercontent.com`.

**`vercel sandbox run` does not stop the sandbox** when its command finishes; every sandbox needs an explicit `stop` and `remove`.

## Recipe tested

v1 recipe after decision 12 (identity mapping, cut at T on the MP4 timeline): decode the audio on a zero-based clock, keep `floor(T × 48000)` samples in an isolated PCM file (length checked), encode AAC only from that file; re-encode only the first `floor(T × 25)` decoded video frames with libx264 (veryfast, CRF 20); mux exactly one H.264 and one AAC stream with metadata and chapters removed. The output is staged under a partial name and renamed only after acceptance.

**Acceptance checks:**
- exactly the two expected streams, with only the MP4 brand tags in the container;
- the frame count matches, and the last frame ends at or before T;
- the audio duration in samples is at most the samples kept;
- the audio packets equal an independent encode of the same PCM;
- no discussion marker at the end: the fixture switches from a light slide and a 440 Hz tone to a red frame and a 3 kHz tone at the private point.

A local negative control, cutting 1 s after the discussion starts, was rejected for both the discussion tone and the discussion frame.

## Results [VERIFIED; generated media]

| Run | Fixture | Cut at | Outcome | Cut time | Notes |
|---|---|---|---|---|---|
| Short | 150 s, 1080p25 | 120.437 s | accepted | ≈ 31 s | 3,010 frames; output copied out for the playback check |
| Long | 3,600 s, 1080p25 | 2,875.437 s | accepted | ≈ 690 s (audio 72 s, video 617 s) | 71,885 frames; 138,020,976 samples; 134,788 audio packets equal; 75 MB output; peak scratch 885 MB |

- **Speed:** the 48-minute presentation was cut in about 11.5 minutes, about 4.2× real time on 2 vCPU. The independent audio encode used for acceptance added 66 s. Making the fixture (745 s) is test-only. **Limitation:** a synthetic slide with one moving box compresses far more easily than real camera tiles or screen shares, so real recordings will encode more slowly. Only a real input measures that.
- **Readability:** the frame 0.2 s before the cut shows the 44 px and 20 px slide text clearly.
- **Interruption:** the encoder was killed with SIGKILL after 20 s. The partial file existed but did not play, and nothing was declared.
- **Disk full:** the scratch disk was filled to leave 40 MB. The result was a rejection with the reason `insufficient_scratch during audio_decode_trim`, and nothing was declared.
  - The first attempt left 300 MB, which turned out to be enough for a 10-minute cut. That was a mistake in the test, not a pass of the cut.
  - The second attempt crashed while writing its receipt to the full disk. The script now reports the outcome even when the receipt can't be written, and the third attempt passed.
- **Sandbox timeout mid-job:** a sandbox with a 4-minute timeout stopped itself during a 60-minute job, after 240.9 s and 463.9 CPU-seconds. Resuming it was refused ("no snapshot available"), so its files did not survive.
- **Cleanup:** each sandbox was stopped and removed. Afterwards `vercel sandbox list --all` and `vercel sandbox snapshots list` were both empty, and `exec` on a removed name returned 404. **Limit:** this shows that nothing remains reachable through the provider's APIs. It does not prove physical erasure or log retention, as `STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md` notes.

## Cost [VERIFIED usage; cost computed from list prices]

| Sandbox | Ceiling | Duration | Active CPU | Cost |
|---|---|---|---|---|
| s4-probe-1 | $0.017 | 12.6 s | 3.6 s | < $0.01 |
| s4-main-1 | $0.852 | 2,430 s | 3,832 s | ≈ $0.19 |
| s4-timeout-1 | $0.023 | 241 s | 464 s | ≈ $0.02 |
| **Total** | $0.89 | | | **≈ $0.22** |

## Not exercised

- **Partial or failed upload.** There was no upload target in a synthetic pilot.
- **Variable frame rate input.** The fixture is constant 25 fps, matching 1003222.
- **Zoom's `bin_data` data stream.** The fixture has none; the recipe maps only the selected video and audio streams.
- **Ending playback in a browser and in the SharePoint viewer.** Pending: the short output is saved locally for this check, outside the repo.
- **Real input.** 1003222's copied video waits on the owner's go (plan step 3). A Board-eligible cut also waits on Codex's provenance slice (decisions 13 and 14).
