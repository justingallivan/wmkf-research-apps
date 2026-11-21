/** Shared validation and presentation contract for the private Admin service register. */
export const CATEGORIES = ['AI', 'Hosting & storage', 'Security', 'Research & search', 'Corporate', 'Payments'];
export const UPDATE_MODES = ['Pinned by us', 'Provider-managed', 'Mixed', 'Unknown'];
export const COST_MODES = ['Review costs', 'Corporate-managed — excluded', 'No paid plan identified'];
export const DECISIONS = ['Keep', 'Change', 'Investigate', 'Retire'];
export const REVIEW_STATES = ['Proposed', 'Approved', 'Implemented'];
export const CORPORATE_IDS = ['microsoft', 'github', 'zoom'];
/** Foundation calendar dates use Pacific time on both browser and server. */
export function reviewToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function nextReviewDate(reviewedOn, cadenceDays) {
  validDate(reviewedOn, 'review date');
  const date = new Date(`${reviewedOn}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(cadenceDays));
  return validDate(date.toISOString().slice(0, 10), 'next review date');
}
export function defaultCadence(category) { return category === 'AI' ? 30 : 90; }
export function isCorporateService(id, provider = '') {
  return CORPORATE_IDS.includes(id) || ['microsoft', 'github', 'zoom'].includes(provider.trim().toLowerCase());
}
export function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }
function text(value, label, max, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw invalid(`${label} is required and must be at most ${max} characters.`);
  return value.trim();
}
function choice(value, choices, label) {
  if (!choices.includes(value)) throw invalid(`Choose a valid ${label}.`);
  return value;
}
export function validDate(value, label, optional = false) {
  if (optional && value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw invalid(`Enter a valid ${label}.`);
  return value;
}
function links(value) {
  if (!Array.isArray(value) || value.length > 12) throw invalid('Use at most 12 reference links.');
  return value.map(item => {
    const label = text(item?.label, 'Link label', 120);
    const href = text(item?.href, 'Link URL', 1000);
    let url;
    try { url = new URL(href); } catch { throw invalid('Reference links must be HTTPS URLs.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw invalid('Reference links must be HTTPS URLs without credentials.');
    return { label, href };
  });
}
export function validateService(raw, id) {
  if (!raw || typeof raw !== 'object') throw invalid('Enter service details.');
  const costTracking = choice(raw.costTracking, COST_MODES, 'cost policy');
  if (isCorporateService(id, typeof raw.provider === 'string' ? raw.provider : '') && costTracking !== COST_MODES[1]) throw invalid('Microsoft, GitHub, and Zoom costs are corporate-managed and excluded.');
  const cadenceDays = Number(raw.cadenceDays);
  if (!Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > 730) throw invalid('Review interval must be 1–730 days.');
  return {
    name: text(raw.name, 'Service name', 120), provider: text(raw.provider, 'Provider', 120),
    category: choice(raw.category, CATEGORIES, 'category'), purpose: text(raw.purpose, 'Use', 2000),
    configuration: text(raw.configuration, 'Configuration', 2000), updateMode: choice(raw.updateMode, UPDATE_MODES, 'update behavior'),
    costTracking, owner: text(raw.owner, 'Owner', 120), cadenceDays,
    nextReviewOn: validDate(raw.nextReviewOn, 'next review date'),
    actionNeeded: raw.actionNeeded === true,
    notes: text(raw.notes ?? '', 'Notes', 6000, false), links: links(raw.links ?? []),
  };
}
export function validateReview(raw) {
  if (!raw || typeof raw !== 'object') throw invalid('Enter review details.');
  const reviewedOn = validDate(raw.reviewedOn, 'review date');
  if (reviewedOn > reviewToday()) throw invalid('Review date cannot be in the future.');
  return {
    reviewedOn, trigger: text(raw.trigger, 'Review trigger', 1000), changes: text(raw.changes, 'Findings', 6000),
    evidence: text(raw.evidence, 'Evidence and limitations', 6000),
    decision: choice(raw.decision, DECISIONS, 'decision'), rationale: text(raw.rationale, 'Rationale', 4000),
    status: choice(raw.status, REVIEW_STATES, 'implementation status'),
    followUp: text(raw.followUp ?? '', 'Follow-up', 4000, false), links: links(raw.links ?? []),
  };
}
export function serviceStatus(service, today = reviewToday()) {
  if (service.data.actionNeeded) return 'Action needed';
  if (!service.lastReviewedOn || service.data.nextReviewOn <= today) return 'Review due';
  return 'Current';
}
