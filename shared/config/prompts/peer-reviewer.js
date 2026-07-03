/**
 * Prompt templates for the Peer Review Summarizer app
 * Used for analyzing and synthesizing peer review feedback
 */

/**
 * Main peer review analysis prompt
 * @param {Array<string>} reviewTexts - Array of review text documents
 * @returns {string} - The formatted analysis prompt
 */
export function createPeerReviewAnalysisPrompt(reviewTexts) {
  return `Please analyze these peer review documents and provide a comprehensive summary in markdown format. I will provide you with ${reviewTexts.length} peer review document(s).

**INSTRUCTIONS:**

Please create TWO separate markdown outputs:

**OUTPUT 1 - SUMMARY:**

1. **Review Count**: Start with "We received ${reviewTexts.length} review${reviewTexts.length > 1 ? 's' : ''}"

2. **Grade Summary**: Write a sentence summarizing the grades/ratings from the reviews. Look for ratings like Excellent, Very Good, Good, Fair, Poor, or numerical scores. If reviewers provide mixed ratings (like "Excellent/Very Good"), note those. Example: "The proposal received two reviews of Excellent, one of Very Good, and one mixed rating of Good/Fair."

3. **Reviewer Details**: Start with "The reviewers were " and list each reviewer's name underlined using <u>Name</u> format, followed by their institutional affiliation in parentheses. If names/affiliations cannot be determined, state "could not be determined from the review documents." After each reviewer, include their general area of expertise if it can be inferred (e.g., "has expertise in bioinformatics").

4. **Overall Tone & Themes**: Provide 2-3 sentences about the overall tone of the reviews and general themes that emerged across reviewers.

5. **Key Quotations**: Provide relevant quotations from each reviewer, ordered from most positive to most critical. Format as:
   - "The most positive reviewer said: '[quote]'"
   - "Another reviewer noted: '[quote]'" 
   - Continue for each reviewer...
   - "The most critical reviewer noted: '[quote]'"

**OUTPUT 2 - QUESTIONS:**

Create a separate section listing all questions, concerns, or issues raised by the reviewers. Format as a bulleted list.

---

**PEER REVIEW TEXTS:**

${reviewTexts.map((text, index) => `**Review ${index + 1}:**\n${text}\n\n---\n`).join('')}

Please provide both outputs as separate markdown sections.`;
}

/**
 * Extract questions and concerns from peer reviews
 * @param {Array<string>} reviewTexts - Array of review text documents
 * @returns {string} - The question extraction prompt
 */
export function createPeerReviewQuestionsPrompt(reviewTexts) {
  return `Please extract all questions, concerns, issues, and points requiring clarification that were raised by the peer reviewers in these ${reviewTexts.length} review document(s).

**INSTRUCTIONS:**
- Extract any explicit questions asked by reviewers
- Include concerns or issues that imply questions need to be addressed
- Include requests for clarification or additional information
- Format as a bulleted list in markdown
- Group similar questions/concerns together if appropriate
- If no clear questions are found, note "No specific questions were identified in the peer reviews"

**PEER REVIEW TEXTS:**

${reviewTexts.map((text, index) => `**Review ${index + 1}:**\n${text}\n\n---\n`).join('')}

Please provide the questions list in markdown format.`;
}

/**
 * Synthesize common themes from peer reviews
 * @param {Array<string>} reviewTexts - Array of review text documents
 * @returns {string} - The theme synthesis prompt
 */
export function createThemeSynthesisPrompt(reviewTexts) {
  return `Analyze these ${reviewTexts.length} peer review(s) and identify common themes, patterns, and areas of agreement or disagreement among reviewers.

**INSTRUCTIONS:**
1. Identify 3-5 major themes that appear across multiple reviews
2. For each theme, note:
   - How many reviewers mentioned it
   - Whether reviewers agreed or disagreed on this point
   - Key quotes or examples
3. Highlight any areas of strong consensus
4. Note any significant disagreements between reviewers
5. Summarize the overall assessment trajectory (unanimous enthusiasm, mixed reception, etc.)

**PEER REVIEW TEXTS:**

${reviewTexts.map((text, index) => `**Review ${index + 1}:**\n${text}\n\n---\n`).join('')}

Please provide a structured analysis of the common themes and patterns.`;
}

/**
 * Generate action items from peer review feedback
 * @param {Array<string>} reviewTexts - Array of review text documents
 * @returns {string} - The action items prompt
 */
export function createActionItemsPrompt(reviewTexts) {
  return `Based on these ${reviewTexts.length} peer review(s), generate a prioritized list of action items that the proposal authors should address.

**INSTRUCTIONS:**
1. Extract all suggestions, recommendations, and required changes from the reviews
2. Categorize them as:
   - **Critical (Must Address)**: Issues that could lead to rejection if not addressed
   - **Important (Should Address)**: Significant improvements that would strengthen the proposal
   - **Minor (Consider Addressing)**: Small improvements or clarifications
3. For each item, note which reviewer(s) raised it
4. Provide specific, actionable recommendations
5. If reviewers disagree on an item, note the disagreement

**PEER REVIEW TEXTS:**

${reviewTexts.map((text, index) => `**Review ${index + 1}:**\n${text}\n\n---\n`).join('')}

Please provide a structured list of prioritized action items in markdown format.`;
}

/**
 * Extract reviewer information from review text
 * @param {string} reviewText - Single review document text
 * @returns {Object} - Extracted reviewer information
 */
export function extractReviewerInfo(reviewText) {
  const info = {
    name: null,
    institution: null,
    expertise: null,
    rating: null
  };
  
  // Look for reviewer name patterns
  const namePatterns = [
    /Reviewer:\s*([^\n,]+)/i,
    /Name:\s*([^\n,]+)/i,
    /Reviewed by:\s*([^\n,]+)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = reviewText.match(pattern);
    if (match) {
      info.name = match[1].trim();
      break;
    }
  }
  
  // Look for institution patterns
  const institutionPatterns = [
    /Institution:\s*([^\n]+)/i,
    /Affiliation:\s*([^\n]+)/i,
    /University:\s*([^\n]+)/i
  ];
  
  for (const pattern of institutionPatterns) {
    const match = reviewText.match(pattern);
    if (match) {
      info.institution = match[1].trim();
      break;
    }
  }
  
  // Look for rating patterns
  const ratingPatterns = [
    /Overall\s+Rating:\s*([^\n]+)/i,
    /Grade:\s*([^\n]+)/i,
    /Score:\s*([^\n]+)/i
  ];
  
  for (const pattern of ratingPatterns) {
    const match = reviewText.match(pattern);
    if (match) {
      info.rating = match[1].trim();
      break;
    }
  }
  
  return info;
}
