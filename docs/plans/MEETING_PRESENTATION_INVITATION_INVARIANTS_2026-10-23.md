# Research-presentation invitation guardrails

[VERIFIED via source, isolated tests and controlled production release, 2026-10-24] Entry: visit workspace → request/visit-scoped preview/send/reconcile route. Persistence: separate Postgres frozen-email ledger and Dynamics email activity; existing Dataverse visit/attendee maps remain authoritative. Consumers: staff preview/history and the selected existing visit attendees. No calendar event, automatic reminder or new mail provider is added.

| Invariant | Surfaces | Verification |
|---|---|---|
| Preview freezes saved visit and resolved selected recipient groups | Service context/digest and ledger | Changed visit ETag, refs, attendee mailbox, sender/signature or message requires new preview |
| Empty groups stay empty | Saved required To / optional Cc refs | No defaults, organizer or applicant fallback; at least one selected recipient required |
| Actor stays authenticated and eligible | App/DAL route plus live staff profile/mailbox and request eligibility checks | Actor/profile/request mismatch refuses before side effects and immediately before transport |
| Only explicit Send dispatches | Frozen preview and leased operation | Preview creates no Dynamics email; duplicate Send uses same operation receipt |
| Uncertainty never automatically resubmits | Creating/send-requested/unknown states and correlation recovery | Crash/timeouts retain intent; reconcile reads only; a new operation cannot bypass unresolved send |
| Exact email proof survives content expiry | Stored payload and envelope digests, durable pre-send verification and reconciliation readback | Exact subject/body/envelope required before Send; later Dynamics body normalization is allowed only after durable verification, with exact activity/correlation/envelope; SQL redaction retains proof |
| Both Dynamics seams fail closed | Create and SendEmail arguments | Explicit impersonation enabled, actor and `noFallback:true` at each seam |
| Retention is bounded without forgetting uncertainty | Fifteen-minute preview expiry, thirty-day content retention | Admission-independent cleanup deletes expired previews and old resolved rows; redacts unresolved content but retains metadata fence; expired previews never send |
| Existing scheduling and applicant collection semantics remain separate | Visit details and collection card | Email describes saved meeting details; it does not create a calendar invitation or request applicant uploads |

Migration allocation evidence: the authorized production filenames-only tracker query returned 84 filenames, latest 085. Inspection of 355 local/remote refs found 085/086/087 and no higher number. That was the allocation baseline. Migration 088 was applied with the canonical runner and physically verified on 2026-10-24 before controlled production deployment. Admission is now `on` for eligible ordinary requests after owner-authorized activation and all green release checks on 2026-10-24; see [the release receipt](../audits/MEETING_CONTROLLED_DEPLOYMENT_2026-10-24.md). No real email was sent.
