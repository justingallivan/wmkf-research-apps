# Stop Skill Rationale

This sidecar preserves the history behind the stop-session handoff format
without placing that history in the normal skill prompt.

The status-labeled next-item sections exist because generic "Potential Next
Steps" lists can carry stale or already-closed work forward. The stop flow asks
the agent to verify each carryover item against current source, memory, Atlas,
or probes before presenting it as actionable.
