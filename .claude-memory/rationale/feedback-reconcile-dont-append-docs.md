# feedback-reconcile-dont-append-docs Rationale

This sidecar preserves the incident history behind the active memory without
placing that history in the normal recall rule.

The rule was added after long-lived docs accumulated contradictory current-state
claims through incremental append-patching. The effective correction was to read
the whole file, search for all restatements of the changed fact, edit every live
restatement in one pass, and run the relevant drift gate before claiming
completion.
