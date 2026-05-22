---
name: Cycle gating vs. Executor scope — don't conflate
description: The "cycle" only gates work that needs Connor (backend/PA/permissions); Executor contract is a backend-automation spec, not a universal pattern; user-facing apps like Reviewer Finder are independent of both.
type: feedback
originSessionId: 223c47bb-55ef-4adb-bab2-c2616bfa5311
---
Don't treat "cycle is N days out" as a general code freeze, and don't assume every Claude-using app belongs on the Executor track.

**Why:** Justin corrected this framing at the start of Session 113. The cycle only matters because Connor (Foundation staff, AkoyaGO/PowerAutomate expert) is heads-down on it; anything needing his collaboration — PA flow construction, Dynamics permissions, shared prompt-storage decisions — should wait. Pure-frontend or pure-Vercel work has no such constraint. Separately, the Executor contract exists so PA and Vercel can both run the same prompt rows under backend automation. User-facing apps (e.g., Reviewer Finder) that read from Dynamics and write to our DB but have **no automation plan** don't need to be filed under "post-cycle Executor work" — they're regular refactors gated only by available time.

**How to apply:**
- When proposing post-cycle work, ask: does this actually need Connor? If no, it's not cycle-gated.
- When categorizing app refactors, ask: is there a planned PA trigger / backend automation? If no, it's a regular user-facing refactor. `executePrompt()` is still usable if convenient, but the full Executor *contract* (declarative wrappers, dual implementations) is overkill.
- Reviewer Finder specifically: user-facing only, no PA plan — refactor it whenever, on its own schedule.
- Phase I summary, intake-check, and other backend-automation-bound prompts: those *are* on the Executor track and *do* coordinate with Connor.
