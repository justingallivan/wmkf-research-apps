# Reviewer Engagement Plan Interpretation

## Mermaid Flowchart

```mermaid
flowchart TD
  subgraph PD["PD Actor"]
    PD1["Send invite [LIVE TODAY]"]
    PD2["Re-invite [LIVE TODAY]"]
    PD3["Release materials button [TO-BUILD]"]
    PD4["Send materials manually [LIVE TODAY]"]
    PD5["Receives quota notice [TO-BUILD]"]
    PD6["Withdraws pending reviewer [TO-BUILD]"]
  end

  subgraph Reviewer["Reviewer Actor"]
    R1["Opens portal [LIVE TODAY]"]
    R2["Accepts with acks [LIVE TODAY]"]
    R3["Provides address [LIVE TODAY]"]
    R4["Sits tight [LIVE TODAY]"]
    R5["Receives materials [LIVE TODAY]"]
    R6["Submits review [LIVE TODAY]"]
    R7["Declines invite [LIVE TODAY]"]
    R8["Sees no longer needed [LIVE TODAY]"]
    R9["Gets respond reminder [TO-BUILD]"]
    R10["Gets due reminder [TO-BUILD]"]
  end

  subgraph System["System / Crons / State"]
    S1["Persist config [TO-BUILD]"]
    S2["Mint 90d token [LIVE TODAY]"]
    S3["Mint due-grace token [TO-BUILD]"]
    S4["Stamp emailSentAt [LIVE TODAY]"]
    S5["Verify reused token [LIVE TODAY]"]
    S6["Dispatch Stage2a [LIVE TODAY]"]
    S7["Write accepted [LIVE TODAY]"]
    S8["Capture honorarium info [LIVE TODAY]"]
    S9["Extend token 90d [TO-BUILD]"]
    S10["Count accepted [TO-BUILD]"]
    S11["Quota threshold? [TO-BUILD]"]
    S12["Notify PD once [TO-BUILD]"]
    S13["Write withdrawn sufficient [TO-BUILD]"]
    S14["Cancel respond reminder [TO-BUILD]"]
    S15["Send materials email [LIVE TODAY]"]
    S16["Mark materials sent [LIVE TODAY]"]
    S17["Write review received [LIVE TODAY]"]
    S18["Respond reminder cron [TO-BUILD]"]
    S19["Review due cron [TO-BUILD]"]
    S20["Stop if responded [TO-BUILD]"]
    S21["Sweep no response [LIVE TODAY]"]
  end

  PD1 --> S1
  PD1 --> S2
  PD1 --> S3
  S2 --> S4
  S3 --> S4
  PD2 --> S2
  PD2 --> S4

  S4 --> R1
  R1 --> S5
  S5 --> S6
  S6 --> R2
  R2 --> R3
  R3 --> S7
  S7 --> S8
  S8 --> S9
  S9 --> R4
  S9 --> S10
  S10 --> S11
  S11 --> S12
  S12 --> PD5

  PD5 --> PD6
  PD6 --> S13
  S13 --> S14
  S13 --> R8

  S18 --> S20
  S20 --> R9
  R9 --> R1

  R2 --> R7
  R7 --> S20

  R4 --> PD3
  R4 --> PD4
  PD3 --> S15
  PD4 --> S15
  S15 --> S16
  S16 --> R5

  S19 --> R10
  R10 --> R6
  R5 --> R6
  R6 --> S17

  S21 --> S5
  S21 --> S13
```

## Open Questions / Ambiguities / Gaps

1. Quota counting needs exact semantics: count only currently accepted reviewers, or include materials-sent, submitted, held, opted-out, withdrawn, and later-flipped reviewers?

2. Quota notification race handling is unclear: simultaneous accepts could cross the threshold twice unless the "notify PD once" state is persisted atomically.

3. Respond-by reminder behavior after the deadline is ambiguous: should a missed lead window still send late, or should reminders stop once the response deadline passes?

4. Respond-by reminder persistence needs a separate marker because today's `wmkf_remindersentat`/count are used for review follow-up reminders.

5. Token extension timing is underspecified: a signed JWT's expiry cannot truly be extended in place, so accepting likely requires minting a replacement token and deciding how the reviewer receives or navigates to it.

6. Multi-wave re-invite rules need detail: re-stamped `emailSentAt` should re-arm respond reminders, but it is unclear whether it also re-mints tokens, resets prior reminder markers, or preserves campaign config.

7. Campaign config editability is undefined after invite send: the plan needs where PDs edit respond offset, review due, reminder settings, and desired count, plus whether edits affect already-invited reviewers.

8. `withdrawn_sufficient` and honorarium interaction is unclear: it should target pending reviewers, but the plan should state whether it blocks honorarium/payment work if applied to an already accepted row by mistake.

9. `sweep-stale-invites` may conflict with new token TTL policy: meeting-date-based no-response closure and review-due-based token expiry can disagree unless one becomes authoritative.

10. Materials release needs a server-side accepted-only gate: the new PD button wraps the live manual materials send, but the plan should specify whether non-accepted selected reviewers are skipped or rejected.

11. Review-due reminders need target refinement: "accepted but not submitted" could include accepted-pre-materials reviewers who have not yet received materials.

12. The plan does not specify the durable schema for campaign config, quota-notified state, respond-reminded state, or per-request desired count.

13. Existing render behavior can mint a fresh external link whenever `{{externalLink}}` appears, so reminder templates must be constrained if the intended model is one reused engagement token.

14. `scripts/cron/` was [NOT FOUND]; live cron code is under `pages/api/cron/`, so the implementation target should be named consistently.
