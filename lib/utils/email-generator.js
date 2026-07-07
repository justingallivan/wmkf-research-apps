/**
 * Email Generator Utilities
 *
 * Functions for generating .eml files and processing email templates
 * for the Expert Reviewer Finder email feature.
 */

const { ContactParser } = require('./contact-parser');

/**
 * Generate a unique MIME boundary string
 */
function generateBoundary() {
  return `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Generate EML file content with proper RFC 2822 headers (no attachments)
 *
 * @param {Object} options - Email options
 * @param {string} options.from - Sender email (or "Name <email>" format)
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject line
 * @param {string} options.body - Email body text
 * @param {Date} options.date - Optional date (defaults to now)
 * @returns {string} Complete .eml file content
 */
function generateEmlContent({ from, to, subject, body, date }) {
  // Format date according to RFC 2822
  const emailDate = date || new Date();
  const formattedDate = emailDate.toUTCString().replace('GMT', '+0000');

  // Encode subject if it contains non-ASCII characters
  const encodedSubject = containsNonAscii(subject)
    ? `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`
    : subject;

  return `From: ${from}
To: ${to}
Subject: ${encodedSubject}
MIME-Version: 1.0
X-Unsent: 1
X-Uniform-Type-Identifier: com.apple.mail-draft
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: 8bit

${body}`;
}

/**
 * Generate EML file content with attachments using MIME multipart/mixed
 *
 * @param {Object} options - Email options
 * @param {string} options.from - Sender email (or "Name <email>" format)
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject line
 * @param {string} options.body - Email body text
 * @param {Date} options.date - Optional date (defaults to now)
 * @param {Array} options.attachments - Array of attachment objects
 * @param {string} options.attachments[].filename - Attachment filename
 * @param {string} options.attachments[].contentType - MIME type (e.g., 'application/pdf')
 * @param {Buffer|Uint8Array} options.attachments[].content - Binary content as Buffer
 * @returns {string} Complete .eml file content with attachments
 */
function generateEmlContentWithAttachments({ from, to, subject, body, date, attachments = [] }) {
  // If no attachments, fall back to simple format
  if (!attachments || attachments.length === 0) {
    return generateEmlContent({ from, to, subject, body, date });
  }

  // Format date according to RFC 2822
  const emailDate = date || new Date();
  const formattedDate = emailDate.toUTCString().replace('GMT', '+0000');

  // Encode subject if it contains non-ASCII characters
  const encodedSubject = containsNonAscii(subject)
    ? `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`
    : subject;

  const boundary = generateBoundary();

  // Build the email parts
  let emlContent = `From: ${from}
To: ${to}
Subject: ${encodedSubject}
MIME-Version: 1.0
X-Unsent: 1
X-Uniform-Type-Identifier: com.apple.mail-draft
Content-Type: multipart/mixed; boundary="${boundary}"

This is a multi-part message in MIME format.

--${boundary}
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: 8bit

${body}
`;

  // Add each attachment
  for (const attachment of attachments) {
    // Convert content to base64
    let base64Content;
    if (Buffer.isBuffer(attachment.content)) {
      base64Content = attachment.content.toString('base64');
    } else if (attachment.content instanceof Uint8Array) {
      base64Content = Buffer.from(attachment.content).toString('base64');
    } else if (typeof attachment.content === 'string') {
      // Already base64 encoded
      base64Content = attachment.content;
    } else {
      console.warn(`Skipping attachment ${attachment.filename}: invalid content type`);
      continue;
    }

    // Split base64 into 76-character lines (RFC 2045)
    const base64Lines = base64Content.match(/.{1,76}/g) || [];

    // Encode filename if it contains non-ASCII characters
    const encodedFilename = containsNonAscii(attachment.filename)
      ? `=?UTF-8?B?${Buffer.from(attachment.filename).toString('base64')}?=`
      : attachment.filename;

    emlContent += `
--${boundary}
Content-Type: ${attachment.contentType || 'application/octet-stream'}; name="${encodedFilename}"
Content-Disposition: attachment; filename="${encodedFilename}"
Content-Transfer-Encoding: base64

${base64Lines.join('\n')}
`;
  }

  // Close the multipart message
  emlContent += `--${boundary}--\n`;

  return emlContent;
}

/**
 * Check if string contains non-ASCII characters
 */
function containsNonAscii(str) {
  return /[^\x00-\x7F]/.test(str);
}

/**
 * Replace placeholders in a template string
 *
 * Placeholders use the format {{placeholderName}}
 *
 * @param {string} template - Template string with placeholders
 * @param {Object} data - Key-value pairs for replacement
 * @returns {string} Template with placeholders replaced
 */
function replacePlaceholders(template, data) {
  if (!template) return '';

  return template.replace(/\{\{(\w+(?::\w+)?)\}\}/g, (match, key) => {
    // Handle custom fields: {{customField:fieldName}}
    if (key.startsWith('customField:')) {
      const fieldName = key.split(':')[1];
      return data.customFields?.[fieldName] || match;
    }

    // Direct key lookup
    if (data.hasOwnProperty(key)) {
      return data[key] || '';
    }

    // Return original placeholder if not found
    return match;
  });
}

/**
 * Parse a full name to extract components for email personalization
 *
 * @param {string} fullName - Full name (e.g., "Dr. Kevin Weeks", "Jane Smith")
 * @returns {Object} { fullName, firstName, lastName, salutation, cleanName }
 */
function parseRecipientName(fullName) {
  // Display-normalize at entry (trim + collapse internal whitespace) so the
  // no-honorific path can't leak artifacts from a stored name into cleanName /
  // recipientName (e.g. "Dear Test Case ,"). Defense-in-depth: callers already
  // normalize, but parseRecipientName is the single chokepoint for every token.
  const normalized = ContactParser.normalizeDisplayName(fullName);
  if (!normalized) {
    return {
      fullName: '',
      firstName: '',
      lastName: '',
      salutation: 'Dr.',
      cleanName: ''
    };
  }

  // Detect and extract honorific
  const honorificMatch = normalized.match(/^(Dr\.?|Prof\.?|Professor|Mr\.?|Ms\.?|Mrs\.?)\s+/i);
  let salutation = 'Dr.'; // Default to Dr. for academics
  let cleanName = normalized;

  if (honorificMatch) {
    const honorific = honorificMatch[1].toLowerCase();
    if (honorific.startsWith('prof')) {
      salutation = 'Professor';
    } else if (honorific.startsWith('dr')) {
      salutation = 'Dr.';
    } else if (honorific.startsWith('mr')) {
      salutation = 'Mr.';
    } else if (honorific.startsWith('ms')) {
      salutation = 'Ms.';
    } else if (honorific.startsWith('mrs')) {
      salutation = 'Mrs.';
    }
    cleanName = normalized.replace(honorificMatch[0], '').trim();
  }

  // Split into parts
  const parts = cleanName.split(/\s+/).filter(p => p.length > 0);

  // For the surname used in "Dear Dr. <lastName>", ignore trailing generational/
  // degree suffixes so a stored "Kevin Weeks Jr." greets "Dear Dr. Weeks", not
  // "Dear Dr. Jr.". Only strip when a real surname remains before the suffix.
  const SUFFIX = /^(Jr\.?|Sr\.?|II|III|IV|V|Ph\.?\s?D\.?|M\.?\s?D\.?|Esq\.?)$/i;
  const surnameParts = parts.slice();
  while (surnameParts.length > 1 && SUFFIX.test(surnameParts[surnameParts.length - 1])) {
    surnameParts.pop();
  }
  const lastName = surnameParts.length > 1
    ? surnameParts[surnameParts.length - 1]
    : surnameParts[0] || '';

  return {
    fullName: normalized,
    firstName: parts[0] || '',
    lastName,
    salutation,
    cleanName
  };
}

/**
 * Soft-unwrap hard-wrapped prose (e.g. an abstract stored with a newline every
 * ~15 words) so it reflows to the email's own width — WITHOUT flattening prose
 * that separates paragraphs with a single newline instead of a blank line.
 *
 * Within each blank-line-delimited paragraph, classify first: if the interior
 * lines are DOMINANTLY mid-sentence (a fixed-column hard-wrapped block), join
 * every line — including one that happens to end a sentence right at the wrap
 * column, which is a wrap coincidence, not a paragraph break. Otherwise the
 * lines end at sentences or are short (intentional separators) and are kept,
 * joining only a genuinely-wrapped long non-sentence line. Blank lines always
 * stay as paragraph breaks. Calibrated against 41 real proposal abstracts
 * (S340) incl. #1002794 (fully wrapped, no blank lines → one flowing block) and
 * #1003141 (single-newline paragraph separators → preserved). LIMIT: a fully
 * wrapped abstract with no blank lines has lost its true internal paragraphing
 * upstream; this renders it as clean continuous prose, which is a best-effort
 * guess, not a guarantee of the author's original structure. Free-text prose
 * only — do NOT use on proposalDetails, whose newlines are intentional.
 */
const SENTENCE_END = /[.?!:;]["')\]]?$/;

function softUnwrapProse(text) {
  if (!text) return '';
  const WRAP_MIN = 64;
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((para) => {
      const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) return lines.join('');
      // Document-level classification first: if the interior lines are
      // DOMINANTLY mid-sentence (no terminal punctuation), the whole block is
      // hard-wrapped — every newline is a wrap, including the ones that happen to
      // land right after a sentence at the wrap column — so join all of them.
      // Otherwise the lines end at sentences / are short, i.e. intentional
      // separators, so keep them (only joining a genuinely-wrapped long line).
      const interior = lines.slice(0, -1);
      const midSentence = interior.filter((l) => !SENTENCE_END.test(l)).length;
      const isWrappedBlock = midSentence >= Math.max(2, interior.length * 0.34);
      if (isWrappedBlock) return lines.join(' ');
      let out = '';
      for (let i = 0; i < lines.length; i++) {
        out += lines[i];
        if (i < lines.length - 1) {
          const wrapped = lines[i].length >= WRAP_MIN && !SENTENCE_END.test(lines[i]);
          out += wrapped ? ' ' : '\n';
        }
      }
      return out.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Format a date string for display in emails
 *
 * @param {string|Date} dateInput - Date string or Date object
 * @param {string} format - 'short' (Jan 15, 2025) or 'long' (January 15, 2025)
 * @returns {string} Formatted date string
 */
function formatReviewDeadline(dateInput, format = 'long') {
  if (!dateInput) return '';

  // Pure YYYY-MM-DD strings are calendar dates, not UTC moments. Parse them
  // in local time so a user picking "April 30" doesn't render as "April 29"
  // for anyone west of UTC.
  let date;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, d] = dateInput.split('-').map(Number);
    date = new Date(y, m - 1, d);
  } else {
    date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  }

  if (isNaN(date.getTime())) {
    return dateInput; // Return original if invalid
  }

  const options = format === 'short'
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { month: 'long', day: 'numeric', year: 'numeric' };

  return date.toLocaleDateString('en-US', options);
}

/**
 * Create a safe filename from a name
 *
 * @param {string} name - Person's name
 * @returns {string} Safe filename (e.g., "Kevin_Weeks.eml")
 */
function createFilename(name) {
  if (!name) return 'draft.eml';

  // Remove honorifics
  const cleaned = name.replace(/^(Dr\.?|Prof\.?|Professor|Mr\.?|Ms\.?|Mrs\.?)\s+/i, '');

  // Replace spaces with underscores, remove special characters
  const safe = cleaned
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '');

  return `${safe}.eml`;
}

/**
 * Format the investigator team string for email templates
 *
 * Handles various cases:
 * - Just PI: "the PI Dr. Smith"
 * - PI + 1 Co-PI: "the PI Dr. Smith and co-investigator Dr. Jones"
 * - PI + multiple Co-PIs: "the PI Dr. Smith and 2 co-investigators (Dr. Jones, Dr. Lee)"
 *
 * @param {string} piName - Name of the PI
 * @param {string} coInvestigators - Comma-separated list of Co-PI names
 * @param {number} coInvestigatorCount - Number of Co-PIs
 * @returns {string} Formatted investigator team string
 */
/**
 * Check if there are co-investigators
 */
function hasCoInvestigators(coInvestigators, coInvestigatorCount) {
  return coInvestigatorCount && coInvestigatorCount > 0 &&
         coInvestigators && coInvestigators !== 'None' && coInvestigators.trim() !== '';
}

function formatInvestigatorTeam(piName, coInvestigators, coInvestigatorCount) {
  // Handle missing PI name
  const hasPiName = piName && piName.trim() && piName.trim() !== 'Not specified';
  const piDisplay = hasPiName ? `the PI ${piName.trim()}` : 'the PI';

  // No co-investigators - just return PI
  if (!hasCoInvestigators(coInvestigators, coInvestigatorCount)) {
    return piDisplay;
  }

  // Clean up coInvestigators string
  const coNames = coInvestigators.trim();

  if (coInvestigatorCount === 1) {
    return `${piDisplay} and co-investigator ${coNames}`;
  }

  // Multiple co-investigators
  return `${piDisplay} and ${coInvestigatorCount} co-investigators (${coNames})`;
}

/**
 * Build the complete data object for template replacement
 *
 * @param {Object} candidate - Candidate object with name, affiliation, etc.
 * @param {Object} proposal - Proposal object with title, abstract, authors, etc.
 * @param {Object} settings - Email settings with signature, grantCycle, etc.
 * @returns {Object} Complete data object for replacePlaceholders()
 */
function buildTemplateData(candidate, proposal, settings) {
  const parsed = parseRecipientName(candidate.name);

  // Handle Co-PI information
  const coInvestigators = proposal.coInvestigators || proposal.co_investigators || '';
  const coInvestigatorCount = parseInt(proposal.coInvestigatorCount || proposal.co_investigator_count || 0, 10);
  const piName = proposal.authors || proposal.proposalAuthors || '';

  // Build a well-formatted investigator team string
  const investigatorTeam = formatInvestigatorTeam(piName, coInvestigators, coInvestigatorCount);

  // Verb agreement: "was" for singular PI, "were" for PI + co-investigators
  const investigatorVerb = hasCoInvestigators(coInvestigators, coInvestigatorCount) ? 'were' : 'was';

  const proposalTitle = proposal.title || proposal.proposalTitle || '';
  const piInstitution = proposal.institution || proposal.proposalInstitution || proposal.authorInstitution || '';

  // Pre-composed proposal-details block for the reviewer-invitation email (lets a
  // reviewer flag a COI before accepting). ONLY lines with data are included, so a
  // missing PI / co-PI / institution never leaves a dangling label in an email that
  // goes to an external reviewer. The abstract stays a separate {{proposalAbstract}}
  // token (an empty one degrades to a blank line, not a dangling label).
  const proposalDetails = [
    proposalTitle ? `Title: ${proposalTitle}` : null,
    piName ? `Principal investigator: ${piName}` : null,
    coInvestigators ? `Co-investigators: ${coInvestigators}` : null,
    piInstitution ? `Institution: ${piInstitution}` : null,
  ].filter(Boolean).join('\n');

  return {
    // Recipient info
    recipientName: parsed.cleanName,
    recipientFirstName: parsed.firstName,
    recipientLastName: parsed.lastName,
    salutation: parsed.salutation,
    // Combined greeting for convenience. Fall back to a name-agnostic greeting
    // when no surname is known (e.g. a blank/degenerate stored name) so an
    // invitation never goes out addressed "Dear Dr. ," to a real reviewer.
    greeting: parsed.lastName
      ? `Dear ${parsed.salutation} ${parsed.lastName}`
      : 'Dear Reviewer',
    recipientEmail: candidate.email || '',
    recipientAffiliation: candidate.affiliation || '',
    recipientExpertise: Array.isArray(candidate.expertiseAreas)
      ? candidate.expertiseAreas.join(', ')
      : (candidate.expertise || ''),

    // Proposal info
    proposalTitle: proposalTitle,
    proposalAbstract: softUnwrapProse(proposal.abstract || proposal.proposalAbstract || ''),
    piName: piName,
    piInstitution: piInstitution,
    // Composed title/PI/co-PI/institution block (empty lines dropped).
    proposalDetails: proposalDetails,

    // Co-PI info (V6)
    coInvestigators: coInvestigators,
    coInvestigatorCount: coInvestigatorCount.toString(),

    // Pre-formatted investigator team (handles 0 co-PI case gracefully)
    investigatorTeam: investigatorTeam,
    investigatorVerb: investigatorVerb, // "was" or "were" for verb agreement

    // Settings
    programName: settings.grantCycle?.programName || '',
    reviewDeadline: formatReviewDeadline(settings.grantCycle?.reviewDeadline),
    signature: settings.signature || '',

    // Review Manager fields
    reviewDueDate: formatReviewDeadline(settings.reviewDueDate || settings.grantCycle?.reviewDeadline),
    reviewerFormLink: settings.reviewerFormLink || '',
    // External-reviewer magic link. Minted per-recipient at render time
    // by render-emails when the template body references {{externalLink}}.
    externalLink: settings.externalLink || '',

    // Custom fields from grant cycle settings (with date formatting)
    customFields: formatCustomFields(settings.grantCycle?.customFields || {})
  };
}

/**
 * Format custom fields, converting date values to readable format
 *
 * @param {Object} customFields - Custom fields object
 * @returns {Object} Custom fields with dates formatted
 */
function formatCustomFields(customFields) {
  const formatted = {};
  const dateFieldNames = ['date', 'deadline', 'duedate', 'senddate', 'commitdate'];

  for (const [key, value] of Object.entries(customFields)) {
    // Check if this looks like a date field (by name or value format)
    const keyLower = key.toLowerCase();
    const isDateField = dateFieldNames.some(df => keyLower.includes(df.replace(/\s/g, '')));
    const isIsoDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

    if ((isDateField || isIsoDate) && value) {
      formatted[key] = formatReviewDeadline(value);
    } else {
      formatted[key] = value;
    }
  }

  return formatted;
}

/**
 * Default email template - W. M. Keck Foundation format
 */
const DEFAULT_TEMPLATE = {
  subject: 'Invitation to Review: {{proposalTitle}}',
  body: `{{greeting}},

I am writing to ask if you could assist the W. M. Keck Foundation in reviewing a proposal from {{piInstitution}} titled "{{proposalTitle}}". Based on an initial white paper, {{investigatorTeam}} {{investigatorVerb}} invited to submit a 10-page proposal by {{customField:proposalDueDate}}. Given your expertise, we hope this topic may be of interest to you and are eager to learn your thoughts on this work and its potential to make an important contribution to fundamental science.

Your review will be extremely valuable to the Foundation's decision-making process. In recognition of the time and effort we are asking of you, we can offer a modest honorarium of \${{customField:honorarium}}. The honorarium will be paid through Bill.com after we receive your review.

Attached to this email is our current review template and a one-page project summary to help you determine if you will be able to review the full proposal. Please treat all information contained in this e-mail and its attachments as confidential. If you agree to participate, we will send the full proposal by {{customField:proposalSendDate}}, and we ask that you submit your completed review form by {{reviewDeadline}}.

Please confirm if you can commit to this review timeline by {{customField:commitDate}} and we will send further instructions for processing your honorarium.

If you cannot serve as a reviewer for any reason, would you please suggest names and institutions (and emails if you have them) of others with the expertise to review the project? We ask that you please recuse yourself if you have any review conflicts such as collaborator or research co-author in the last 3 years.

Thank you very much for considering this request. We recognize your expertise in this area and greatly appreciate your time and assistance with our review process to help us fund innovative, fundamental scientific research. Thank you in advance for your help!

{{signature}}`
};

module.exports = {
  generateEmlContent,
  generateEmlContentWithAttachments,
  replacePlaceholders,
  parseRecipientName,
  formatReviewDeadline,
  createFilename,
  buildTemplateData,
  DEFAULT_TEMPLATE
};
