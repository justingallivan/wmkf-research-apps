# Meeting preparation and consumption interaction guardrails

Change surface: saved transcript review, consultant attendee selection, session agenda ordering and PD Workbench hierarchy. Entry points: RecordingAndTranscriptCard, PreparationPanel, SessionEditor, SiteVisitEditor, StaffDeliberationsTab. Persistence: existing correction version/attendance, durable preparation, Dataverse attendee maps and slot ETags; no new schema in this increment. Consumers: preparation worker, invitation defaults, staff Workbench and agenda readback.

| Invariant | Surfaces | Verification |
|---|---|---|
| Human attendance survives Save and prepare before dispatch | Correction PATCH → returned version → preparation POST | Exact newly saved version queued; no synchronous publication or Board approval |
| Names/boundary changes cannot reuse stale attendance | Existing dirty guards and attendance refresh | Save those changes first; review new attendance before queue admission |
| Failed or stale saves never queue work | Hook generation/editor identity plus panel generation guard | Failed save, request navigation and delayed result tests |
| Failure feedback stays visible after status refresh | PreparationPanel mutation recovery read | Review save failure remains displayed without a preparation POST |
| Existing consultants resolve through the maintained roster | Both directory projections, strict/lenient validators and pickers | Consultants accepted; unrelated roles rejected; no third directory |
| Intentionally empty groups stay empty | Defaults, saved maps, Workbench invitation seed | Saved empty default has no missing-configuration notice; empty session does not inherit visit recipients |
| Agenda moves preserve full ID/ETag set | Existing reorder route + library callbacks | Unit exact-ETag assertions; actual browser keyboard reorder |
| Changed agenda invalidates an in-progress move | Drag snapshot includes scope, IDs, ETags, request, order and minutes | Changed ETag, membership or session refuses; browser concurrent-ETag check |
| Writeup/review remains the PD's primary task | StaffDeliberationsTab composition | Writeup/review precede supporting briefing/presentation outputs; logistics disclosed separately |

Browser checks use synthetic local rows and the actual drag library. They perform no live scheduling, email or provider processing. Production promotion remains separate. Research-presentation invitations and rare manual source pairing are still planned and must not be inferred from these interaction changes.
