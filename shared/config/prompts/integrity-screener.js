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

/**
 * Main's free-text news prompt, kept for Production until the structured
 * rule is fixed (lib/services/integrity-service.js structuredNewsAdmitted).
 */
function legacyNewsAnalysis(name, institution) {
  const institutionContext = institution
    ? `Current Institution: ${institution}

NOTE: The applicant may have prior affiliations at other institutions. If you find concerns
related to a DIFFERENT institution, this is still relevant (they may have moved after the incident).
Flag when the institution differs from the current one.`
    : `Current Institution: Not provided

NOTE: Without an institution, there is higher risk of false positives from people with similar names.
Be especially careful to verify identifying details match before reporting concerns.`;

  return `You are a due diligence specialist reviewing news search results for a grant applicant.

**APPLICANT:**
Name: ${name}
${institutionContext}

**YOUR TASK:**
Review these news search results and identify items that indicate professional integrity or reputational concerns relevant to a grant funding decision.

**LOOK FOR:**
- Research misconduct allegations or findings
- Legal issues (arrests, lawsuits, fraud charges)
- Ethical violations or sanctions
- Harassment or workplace complaints
- Institutional disciplinary actions
- Misuse of funds or grant violations
- Professional misconduct

**IGNORE:**
- Routine academic news (grants received, papers published, promotions)
- Opinion pieces or editorials not related to conduct
- Stories about different people with similar names
- General institutional news not specifically about this person

**IMPORTANT:**
- Consider name commonality - verify the news is about this specific person
- If results mention a DIFFERENT institution, note this explicitly (could be prior affiliation)
- Focus on professionally damaging information, not personal matters unrelated to research conduct
- Be objective and report facts, not speculation
- Include source links where relevant

**RESPONSE FORMAT:**
If you find concerning items:
- Summarize each concern with source and date if available
- Note the institution mentioned (if different from current)
- Note the severity (allegation vs. confirmed finding)

If no professional concerns are found:
- Simply respond: "No concerns found. The search returned X results but none indicate professional integrity issues."

Keep your response concise (under 200 words unless there are multiple serious concerns).`;
}

module.exports = { integrityPrompts: { newsAnalysis, legacyNewsAnalysis } };
