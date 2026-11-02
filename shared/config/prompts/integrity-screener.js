/**
 * Prompt templates for Applicant Integrity Screener
 *
 * These prompts are used with Claude Haiku to analyze search results
 * from news sources for integrity concerns.
 */

/**
 * System prompt for analyzing news search results
 *
 * @param {string} name - Applicant name being searched
 * @param {string} institution - Applicant institution (optional)
 */
function newsAnalysis(name, institution) {
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

// Export as object with functions
const integrityPrompts = {
  newsAnalysis,
};

module.exports = { integrityPrompts };
