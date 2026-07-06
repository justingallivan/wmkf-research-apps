---
name: feedback-behavior-freeze-passthrough-no-default
description: In a behavior-freeze extraction, a pass-through param must have NO default — a default masks an explicit undefined and diverges from the original this.CONST read.
metadata:
  node_type: memory
  type: feedback
  status: active
---

When extracting a method out of a class as a behavior-freeze (pure code motion), and the method
read a runtime-mutable static via `this.CONST`, the facade wrapper passes `this.CONST` into the
extracted function as a parameter (the C1 pass-through). **That parameter must NOT carry a default
value** (`function f(..., minPublications)`, not `function f(..., minPublications = CONST)`).

**Why:** a default parameter is applied when the argument is *omitted OR explicitly `undefined`*. The
original in-class body read `this.CONST` verbatim, so if the static were ever `undefined`, the gate
saw `undefined`. A defaulted param silently substitutes the constant for that `undefined` — a real
behavior divergence under the C1 "runtime override still applies" contract. Codex caught exactly this
in the DiscoveryService Stage-5 `verifyClaudeSuggestions` extraction (S335): `minPublications =
MIN_PUBLICATIONS` masked an `undefined` override. Fix = drop the default so the param mirrors the
facade static exactly. Safe because the facade is the sole caller (verify: grep for other importers).

**How to apply:** when threading a runtime-mutable static through a pass-through param during an
extraction, give it no default; confirm the facade always supplies it and no other module imports the
extracted function directly. Related: the decomposition playbook + constraints C1/C7 live in
`docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md`; caller-census discipline is [[feedback-symbol-consumer-fanout]].
