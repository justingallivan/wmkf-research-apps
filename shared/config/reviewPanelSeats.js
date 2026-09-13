/**
 * Fixed provider identity for the Virtual Review Panel's three governed slots.
 * Admin model selection may change the reviewed model within a slot's provider,
 * but may never change the slot's provider.
 */

export const REVIEW_PANEL_SEATS = Object.freeze([
  Object.freeze({
    key: 'seat.claude',
    label: 'Claude reviewer',
    vendor: 'anthropic',
    enabled: true,
    defaultModel: 'claude-fable-5-1',
  }),
  Object.freeze({
    key: 'seat.openai',
    label: 'OpenAI reviewer',
    vendor: 'openai',
    enabled: true,
    defaultModel: 'gpt-5.6-sol',
  }),
  Object.freeze({
    key: 'chair',
    label: 'Claude chair',
    vendor: 'anthropic',
    enabled: true,
    defaultModel: 'claude-opus-5',
  }),
]);

export function getReviewPanelSeat(key) {
  return REVIEW_PANEL_SEATS.find((seat) => seat.key === key) || null;
}
