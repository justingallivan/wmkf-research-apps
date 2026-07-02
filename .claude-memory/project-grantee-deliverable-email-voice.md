---
name: project-grantee-deliverable-email-voice
description: Grantee deliverable emails (abstract-review invite + reminder) are sent from the NAMED Program Director in an established PD voice — not a generic "The W. M. Keck Foundation" sign-off. Canonical structure provided by Justin (S271).
metadata:
  type: project
  status: active
  scope: global
  last_verified: S271 via owner-provided example email
---

## Recall Rule

Read this when drafting/defaulting the grantee-deliverables invitation or reminder
email copy (`email.grantee_invite.*`, AwardeeTab fill behavior, chunk-6 reminder body) or
the publish-image waiver wording.

## The facts (owner, S271)

- **From the Program Director, by name.** The email is signed by the named PD with
  title (e.g. "Justin Gallivan / Senior Program Director / W. M. Keck Foundation"),
  NOT "The W. M. Keck Foundation". The send already goes from the PD mailbox
  (build plan chunk 3c); the BODY/signature must match. PD identity is available as
  `ctx.programDirectorId` (resolve-request) — auto-populate the signature where
  possible; otherwise leave a clear placeholder for staff to fill.
- **Salutation:** "Dear Professor [Name]:" (the owner's example used "Professor",
  not "Dr.").
- **Canonical structure** (from the owner's real PD email, S271):
  1. Congratulations on the recent W. M. Keck Foundation grant.
  2. "We plan to post an abstract on the Foundation's website describing your award
     entitled '[title]'."
  3. Review-by-deadline with **implied concurrence**: "Please review … and let me
     know if you have any changes no later than COB [date]. If we have not heard
     from you by this date, we will assume that we have your concurrence to post the
     draft abstract on our website."
  4. Encourage a high-resolution project image (now handled IN the portal — the
     email points to the secure link instead of repeating format/caption/release
     mechanics, which the new interface subsumes).
  5. **Acknowledgment-of-support reminder** (KEEP — not subsumed by the portal):
     "in your application you and your institution agreed to acknowledge the
     Foundation's support … Please recognize the 'W. M. Keck Foundation' in
     publications and other scientific work related to this award, such as
     presentations and posters."
  6. "Please do not hesitate to contact me if you need additional information."
  7. "Thank you," + PD name + title.
- **Deadline model answers part of chunk-6 cadence:** there IS a hard deadline
  (COB a named date) and **non-response = implied consent to post the draft**.
- **Approved abstract-provenance line (owner edit S271):** "The draft abstract is
  based on information you provided in your proposal, lightly edited to conform to
  the style that the Foundation uses in its publications." (Replaces the earlier
  "…with your Phase II proposal" phrasing — drop "Phase II" and "below".)
- **Image format/caption/release paragraphs are REMOVED from the email** — the
  portal interface now collects the image, caption+credit, and the publish
  permission (the waiver checkbox IS the release form).

**Why:** stakeholder/grantee emails in the Foundation's real voice are personal,
PD-signed, and deadline-driven; a generic Foundation sign-off and portal mechanics
in the body read wrong to a grantee. **How to apply:** preserve the editable
`email.grantee_invite.*` defaults and `fillInviteBody` placeholder behavior in the
PD-voice structure above; keep the message staff-editable. Related:
[[feedback-stakeholder-email-tone]].
