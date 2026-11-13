/** News evidence classification for the Applicant Integrity Screener. */
function newsAnalysis(name, institution) {
  return `Review the numbered news search results for professional integrity concerns relevant to research funding.

Applicant: ${name}
Current institution: ${institution || 'Not provided'}

Use the supplied headlines and excerpts as evidence. Look for reported research misconduct, grant or funds misuse, professional misconduct, institutional discipline, sanctions, or legal matters relevant to professional conduct. Separate a reported allegation from an established finding. Routine academic news, unrelated personal matters, and stories clearly about a different person do not qualify.

A shared name is insufficient. Look for an affiliation, discipline, prior position, or other distinctive detail linking the story to this applicant. An institution mismatch requires corroborating evidence of a connection, such as an identified former affiliation. Treat potentially relevant conduct with uncertain identity or unclear evidence as inconclusive.

Return a single JSON object with "outcome" and "findings". Choose:
- "flag_for_review" when at least one result reports relevant conduct and supports the identity link.
- "clear" when the supplied results contain only routine or unrelated news, clear namesakes, or no relevant evidence.
- "inconclusive" when the evidence is insufficient to assess a potentially relevant item.

For "flag_for_review", include up to three findings. Each finding must have:
- "sourceIndex": the 1-based number of the result containing both excerpts.
- "kind": "allegation" or "confirmed_finding". Use "confirmed_finding" only when the source reports an official finding.
- "identityEvidence": a short verbatim excerpt from that result showing a distinctive detail beyond the applicant's name.
- "conductEvidence": a short verbatim excerpt from that result describing the reported conduct or finding.

Copy each excerpt from the headline or snippet. Do not paraphrase or provide URLs. Return an empty "findings" array for "clear" and "inconclusive". Return the JSON object only, without Markdown fences or additional explanation.`;
}

module.exports = { integrityPrompts: { newsAnalysis } };
