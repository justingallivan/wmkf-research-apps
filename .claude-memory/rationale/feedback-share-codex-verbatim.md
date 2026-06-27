# feedback-share-codex-verbatim Rationale

This sidecar preserves the incident history behind the active memory without
placing that history in the normal recall rule.

The rule was added because Codex tool results are not visible to the user unless
the assistant relays them. Paraphrase, summary, re-ranking, omitted footers, and
acting on findings before delivery all prevent the user from seeing the
independent review artifact as returned. The durable correction is mechanical:
deliver the full stdout verbatim first, then do follow-up work in a later turn.
