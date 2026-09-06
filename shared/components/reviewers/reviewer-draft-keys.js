// Stage 6B3b: the modal session's membership key, by VALUE, over the fields
// the rendered draft body actually consumes for a given reviewer (see
// email-generator.js buildTemplateContext: candidate.name, candidate.email,
// candidate.affiliation — candidate.expertiseAreas is also read there, but
// the reviewers-service projection this panel's rows come from
// (lib/services/review-manager/reviewers-service.js) never sets an
// expertiseAreas/expertise field, so there is nothing to fold in for it).
// A same-id change to any of these after a preview leaves the rendered body
// (sent verbatim; the server only re-resolves the destination address)
// showing a stale greeting/affiliation, so it must invalidate the session
// exactly like a membership change. Per-reviewer strings are sorted (not
// keyed by array order) and joined with U+0001 (a control character that
// cannot appear in these fields), each field within a reviewer's string
// joined with U+0000 (same non-collision rationale as the settings key
// below) — so no combination of name/email/affiliation values across two
// different reviewers can collide into the same overall key. An empty
// `reviewers` array must still produce '' (the completion exemption's
// `nextKey === ''` check depends on it). Used both by the committed-session
// effect below AND by handleSend's `priorKey` capture (which reads
// sessionContextRef.current.key, always assigned from this same function's
// output — see the effect), so there is only one computation to keep in
// sync.
// Field/row separators built at runtime (String.fromCharCode) rather than
// written as literal control characters in this source file: U+0000 cannot
// appear in name/email/affiliation, and U+0001 cannot appear in any
// suggestionId GUID, so no combination of per-reviewer field values or
// per-reviewer joined strings can collide across the separators.
const MEMBERSHIP_KEY_FIELD_SEP = String.fromCharCode(0);
const MEMBERSHIP_KEY_ROW_SEP = String.fromCharCode(1);

export function membershipKeyFor(reviewers) {
  return reviewers
    .map(r => [r.suggestionId, r.name || '', r.email || '', r.affiliation || ''].join(MEMBERSHIP_KEY_FIELD_SEP))
    .slice()
    .sort()
    .join(MEMBERSHIP_KEY_ROW_SEP);
}

// Stage 6B3c: a third Codex review found the rendered body also embeds
// PROPOSAL fields (title, abstract, PI/authors, institution — see
// render-emails-service.js buildTemplateContext) and send transmits the body
// verbatim, so a same-requestId proposal edit after preview leaves stale
// proposal text just like a stale membership/settings field would. Keyed by
// VALUE over exactly the four proposal fields the panel carries (see the
// `proposal` prop contract in reviewers-service.js / reviewer-follow-up.js /
// ReviewersTab's synthetic fallback) — co-investigators are NOT carried by
// any host, so there is nothing to fold in for them. Joined with the same
// MEMBERSHIP_KEY_FIELD_SEP (no row separator needed: this is a fixed
// four-field record, not a per-reviewer array). A null/undefined proposal
// (e.g. a host reviewers-fetch failure) yields the four-empty join, same
// shape as an empty membership key.
export function proposalKeyFor(proposal) {
  return [
    proposal?.proposalTitle,
    proposal?.proposalAbstract,
    proposal?.proposalAuthors,
    proposal?.proposalInstitution,
  ].map(v => v || '').join(MEMBERSHIP_KEY_FIELD_SEP);
}
