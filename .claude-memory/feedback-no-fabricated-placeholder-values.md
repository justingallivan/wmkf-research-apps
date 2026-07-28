---
name: feedback-no-fabricated-placeholder-values
description: "Never ship fabricated placeholder external values (emails, URLs, IDs, contacts); verify they're real, prefer env config"
metadata: 
  node_type: memory
  type: feedback
  status: active
  scope: global
  last_verified: S232 (lived incident — a fabricated organization mailbox shipped to production and was caught by the owner)
  originSessionId: 48076d95-6a2c-4203-a24b-df71abb5d833
---

## Recall Rule

Treat every external-facing email, URL, ID, and account literal as untrusted until
verified. Prefer an unset configuration value over a plausible fabricated default.

When code (especially Codex-generated code) contains an external-facing identifier
— a contact email, callback URL, account/tenant ID, "from" address, sample data —
**do not assume it is real.** It is often an invented placeholder. In S232 the
OpenAlex API-contact address shipped as a plausible-looking organization
mailbox that did not exist: Codex fabricated it, and Claude propagated it into
`CREDENTIALS_RUNBOOK.md` without checking, then committed and pushed it to
production. The owner caught it after the fact and configured the verified
address as a non-sensitive Vercel environment variable
(`OPENALEX_POLITE_MAILTO`). The literal addresses are intentionally omitted
from memory because the durable lesson is to verify and configure them, not to
retain their values.

**Why:** a fake external identifier is worse than none — a bogus API-contact email
defeats the purpose (the service can't reach anyone) and violates API etiquette;
the same class of bug applies to any fabricated URL/ID/address. Tests and builds
pass on fabricated values (they're just strings), so CI never catches it — only a
human who knows the real value does.

**How to apply:**
- In review, flag every external identifier literal and ask "is this a REAL value
  or an invented placeholder?" Verify (hit the live endpoint or ask the owner) before
  shipping. Treat Codex-generated emails/URLs/IDs as suspect by default.
- For non-secret external contacts (API contact email, support address), prefer an
  **env var with no fabricated default** — unset means no contact metadata is sent,
  never a fake value. This is separate from authentication: OpenAlex now requires
  `OPENALEX_API_KEY`; `OPENALEX_POLITE_MAILTO` provides no quota.
- Never invent a plausible-looking placeholder to "fill in" a required field; leave
  it null/unset and surface the gap.

Related: [[feedback-verify-external-platform-claims]], [[feedback-falsify-not-confirm]],
[[feedback-cite-ground-truth]].
