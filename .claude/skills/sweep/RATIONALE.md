# Sweep Rationale

The original skill addressed a recurring “fix one visible line, leave nearby restatements
stale” problem. Its procedure started from an assumed post-fix fact, selected grep terms,
classified matching lines, and required zero stale textual restatements.

That was useful but narrower than the operational meaning users and agents attached to
“whole-repo reconcile.” A 2026-07 Workbench investigation demonstrated the gap:

- source comments and a living build plan retained obsolete tab counts;
- Reviews and Awardee were live while current-looking roadmap rows still called them future;
- a plan asserted new Site Visit storage even though live Dataverse already exposed readable
  and writable site-visit fields;
- proposed writeup URL fields and prompt names were described architecturally but were absent
  from live Dataverse;
- the Pre Site Visit purpose required returned reviews while its described generation flow did
  not specify a review input;
- bounded documentation gates remained green because those claims were outside their registries
  or scan roots.

The failure was both procedural and semantic. Appending a newer correction above a stale table
does not reconcile a living document, and grep cannot detect a missing contract hop.

The revised skill therefore has two modes:

1. changed-fact reconciliation; and
2. domain truth audit.

Both establish truth from code, live-state probes, persistence, and consumers before searching
prose. The skill tightens the historical exception, adds a semantic contradiction pass, requires
structural fixes for clustered drift, records the bounded scope of green gates, and requires a
durable evidence artifact for substantial audits.

Active procedure belongs in `SKILL.md`; this file preserves why those requirements exist.
