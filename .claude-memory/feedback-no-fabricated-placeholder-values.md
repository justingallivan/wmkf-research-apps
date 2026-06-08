---
name: feedback-no-fabricated-placeholder-values
description: "Never ship fabricated placeholder external values (emails, URLs, IDs, contacts); verify they're real, prefer env config"
metadata: 
  node_type: memory
  type: feedback
  status: active
  scope: global
  last_verified: S232 (lived incident — apps@wmkeck.org shipped to prod, caught by Justin)
  originSessionId: 48076d95-6a2c-4203-a24b-df71abb5d833
---

When code (especially Codex-generated code) contains an external-facing identifier
— a contact email, callback URL, account/tenant ID, "from" address, sample data —
**do not assume it is real.** It is often an invented placeholder. In S232 the
OpenAlex polite-pool contact shipped as `apps@wmkeck.org`, a mailbox that does not
exist: Codex fabricated it, and Claude propagated it into `CREDENTIALS_RUNBOOK.md`
without checking, then committed + pushed it to prod. Justin caught it after the
fact. The real value was `alerts@wmkeck.org`, which he then set as a non-sensitive
Vercel env var (`OPENALEX_POLITE_MAILTO`).

**Why:** a fake external identifier is worse than none — a bogus polite-pool email
defeats the purpose (the service can't reach anyone) and violates API etiquette;
the same class of bug applies to any fabricated URL/ID/address. Tests and builds
pass on fabricated values (they're just strings), so CI never catches it — only a
human who knows the real value does.

**How to apply:**
- In review, flag every external identifier literal and ask "is this a REAL value
  or an invented placeholder?" Verify (hit the live endpoint, ask Justin) before
  shipping. Treat Codex-generated emails/URLs/IDs as suspect by default.
- For non-secret external contacts (polite-pool email, support address), prefer an
  **env var with no fabricated default** — unset → degrade safely (common pool / no
  contact sent), never send a fake one. Keep the literal out of source; let it live
  in Vercel config + the runbook.
- Never invent a plausible-looking placeholder to "fill in" a required field; leave
  it null/unset and surface the gap.

Related: [[feedback-verify-external-platform-claims]], [[feedback-falsify-not-confirm]],
[[feedback-cite-ground-truth]].
