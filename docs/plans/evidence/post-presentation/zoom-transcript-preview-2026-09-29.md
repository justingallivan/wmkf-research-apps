# Zoom link and transcript Preview acceptance — 2026-09-29 PT

## Scope and result

**[VERIFIED via signed-in Chrome, sandbox Dataverse, Microsoft Graph, and Vercel readback]** Staff saved one synthetic Zoom recording link and one synthetic 203-byte VTT transcript through the Meeting Tracker Site Visit page on a Ready Preview redeployment of `codex/feature-request` at `e777c4b05`. The card displayed both current materials after a full page reload. The Graph download of the transcript matched the source byte count and SHA-256; the Request Document registry hash matched as well. [Screenshot](zoom-transcript-preview-2026-09-29.jpg).

## Isolated sandbox fixture

- Factory source: previously marked sandbox Request `1000341`, read only.
- New marked Request: `1000350` / `4424f6e5-7409-45ad-a96e-5f7d89896ce5`, title `TEST: ZoomLinkTranscript20260929`; reminders disabled. The guarded factory receipt reports successful Request/folder verification and GoVerify restored active after the approved one-create bypass.
- Request `1000350` was set to Advancing and given one active synthetic Site Visit `80a066f6-2ad9-45a5-a329-564f8484f9b8`. No email or external meeting was created.
- The first create attempt, with GoVerify left active, failed HTTP 400. Its preallocated Request GUID `3dd7428b-20e6-47f4-a723-2201314b1d6d` read back 404 before a new manifest was prepared. The successful attempt used a separate GUID and receipt; no ambiguous create was retried.

## Producer and persistence readback

| Material | Result |
|---|---|
| Recording | Synthetic `https://us02web.zoom.us/rec/share/WMKFSANDBOXTEST20260929?pwd=WMKFSANDBOXTEST` saved as current external Recording, slot version 1, Request Document `44899a5b-66bc-f111-aaad-70a8a5b1c1c6`; no SharePoint item. |
| Transcript | Synthetic `WEBVTT` file saved as current SharePoint-backed Transcript, slot version 1, Request Document `ed1cc369-66bc-f111-aaad-70a8a5b1c1c6`; 203 source and downloaded bytes with matching SHA-256 and registry hash. |

The Zoom URL is deliberately synthetic. This acceptance proves input, persistence, and staff readback; it does **not** prove that Zoom playback works or that a real passcode is valid. No Board presentation link was generated in this producer run, so its external consumer was not tested then. No MP4 upload, Cancel, Retry, Production deployment, Production runtime-configuration change, or Production Dataverse write occurred. The transcript-staging path used the shared Preview/Production Postgres database; the Request Documents and transcript file were retained in sandbox Dataverse and its governed SharePoint folder.

## Preview cleanup

The branch-scoped Preview access was set to `test:4424f6e5-7409-45ad-a96e-5f7d89896ce5` only for the test and read back as `off` afterward. The registered `wmkfresearchapps-preview.vercel.app` alias was restored to its observed prior deployment `dpl_cgM9vNTVdC1DAUMR55ZQSBdt9Nt2`; the branch alias was restored to `dpl_8C7qZ4XqvZp64DPUTb2QeqtXAa9d`. Exact temporary deployment `dpl_AjEzBj7ZzLNMopZa2DBn7k2s3sBv` was removed after neither alias pointed to it, and inspection confirmed it absent. The synthetic Request, Site Visit, two Request Documents, and transcript file are retained as test evidence. Retained Request `1000334` and its materials were untouched.
