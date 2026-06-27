# Start Skill Rationale

This sidecar preserves the history behind the startup checklist without placing
that history in the normal skill prompt.

The startup gate list is intentionally complete because omitted gates have
previously stayed red across sessions. Gate/self-test pairs run sequentially
because several self-tests write synthetic fixtures into paths scanned by their
main gate.

The symlink checks protect the shared Claude/Codex instruction surface and the
durable memory store from per-machine divergence.
