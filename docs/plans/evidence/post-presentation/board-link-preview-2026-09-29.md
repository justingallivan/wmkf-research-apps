# Board presentation link Preview acceptance — 2026-09-29 PT

## Scope and result

**[VERIFIED via signed-in Chrome, Safari Private Browsing, the downloaded transcript, and Vercel readback]** On `codex/feature-request` at `f43251cf8`, an owner-approved bounded Preview run used marked sandbox Request `1000350` (`4424f6e5-7409-45ad-a96e-5f7d89896ce5`) and its existing synthetic Zoom Recording and VTT Transcript. Meeting Tracker generated one 60-day materials-only link, expiring 2026-11-28. No token or bearer URL is retained in this receipt.

- The external page in signed-in Chrome displayed the sandbox institution and Request title, exactly one current Recording with **Watch on Zoom**, and exactly one current Transcript with **Download** and a 203-byte size. It did not show the full deliberation briefing or other material.
- **Watch on Zoom** redirected to the saved synthetic `us02web.zoom.us` recording URL with its `pwd` query parameter. Zoom reported that the synthetic recording does not exist. This verifies redirect wiring, not real Zoom playback or passcode validity.
- **Download** delivered `1000350-Transcript-3690d9dd-d5ec-40e0-a384-73051f9e72db.vtt` to the browser. The downloaded file measured 203 bytes and SHA-256 `0a525bd7eb47860347350a2c637502db246826d3fe52ace30660b6aa050306dd`. The earlier [producer receipt](zoom-transcript-preview-2026-09-29.md) separately verified the source, SharePoint, and registry hashes.
- Meeting Tracker issued a replacement link. The new bearer URL differed from the first; reloading the old URL showed **This presentation link is unavailable or has expired**. The new URL displayed the same two current materials.

**[PARTIAL private-window check]** Safari Private Browsing was confirmed by its window title, but Vercel Deployment Protection redirected the recipient URL to Vercel sign-in before the application page loaded. Deployment Protection was not changed. The signed-in Chrome run establishes the application consumer path; unauthenticated private-window viewing remains unproved on this protected Preview deployment. No MP4 Watch, long seek, or real Zoom playback was exercised by this fixture.

## Target and cleanup

The linked Vercel project was `justin-gallivans-projects/wmkf_research_apps`. Branch-scoped Preview `POST_PRESENTATION_MATERIALS_SCHEMA_READY` read `on` and `POST_PRESENTATION_MATERIALS_ACCESS` read `off` before the run. Access was temporarily `test:4424f6e5-7409-45ad-a96e-5f7d89896ce5`; redeployment `dpl_wzudtJ6a3SDWiaA9apRD6cZkoZDQ` reached Ready and the registered `wmkfresearchapps-preview.vercel.app` alias was moved only for this test.

**[VERIFIED cleanup]** The registered alias again resolves to prior deployment `dpl_cgM9vNTVdC1DAUMR55ZQSBdt9Nt2`; the feature branch alias remained on `dpl_8C7qZ4XqvZp64DPUTb2QeqtXAa9d`. Branch-scoped Preview access was read back as `off`. The temporary deployment was removed with alias safety and a subsequent inspect returned not found. A final browser visit through the restored alias displayed **Presentation materials are temporarily unavailable** for the replacement link. Production deployment, runtime configuration, Dataverse, and SharePoint were untouched. The first link insert and its transactional reissue wrote two sandbox-scoped rows to `presentation_material_links` in the shared Preview/Production Postgres database: the first was revoked by reissue, and the replacement remains the current row. Retained Request `1000334` was untouched. The downloaded synthetic VTT remains in the local Downloads folder.

## Contract and documentation check

| Claim | Producer and persistence | Consumer evidence | Status |
|---|---|---|---|
| Generate and reissue one 60-day materials link | Meeting Tracker presentation-link route and durable `presentation_material_links` store | Staff controls showed a new URL; the old URL failed after replacement and the new one worked | VERIFIED for the bounded sandbox Request |
| Serve current Zoom and transcript materials | Request Document winners and presentation context/resolver | Recipient page showed two materials; Zoom redirect and transcript download succeeded | VERIFIED with synthetic media |
| Open anonymously in a private window | Vercel Deployment Protection precedes the application | Safari Private Browsing reached Vercel sign-in | PARTIAL; requires a reachable release target |

Current restatements in `SESSION_PROMPT.md`, the presentation-materials plan, the PC Meeting Tracker plan, and the Request Document Atlas were updated. The earlier producer receipt remains an explicitly dated historical result. Atlas, doc-currency, fact-consistency, doc-symbol-refs, and build-claim-freshness gates and their self-tests passed; the docs catalog and `git diff --check` passed. The remaining disconfirming check is a real, accessible recipient run with a valid Zoom recording and the Production MP4 Watch/long-seek/Download gate.
