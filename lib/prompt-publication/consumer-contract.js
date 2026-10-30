/** Pinned per-name consumer requirements, NOT caller-selected validation profiles.
 * Parsed memo values may compare structurally; Pre-Site intentionally retains
 * JSON property order because its current reader compares JSON.stringify values.
 */
const { canonicalPreimage, owns } = require('./json-contract');
const { POLICY_ARTIFACT } = require('./template-policy');
function getConsumerContract(name) {
  return typeof name === 'string' && owns(POLICY_ARTIFACT.policy.consumerContracts, name)
    ? POLICY_ARTIFACT.policy.consumerContracts[name] : null;
}
function validateConsumerDefinition(definition, variables, outputs) {
  const c = getConsumerContract(definition.name);
  if (!c) return [];
  const errors = [];
  const error = (path, code) => errors.push({ path, code });
  for (const [path, parsed, expected] of [['variables', variables, c.variablesJson], ['outputSchema', outputs, c.outputJson]]) {
    const matches = c.orderedMemos ? JSON.stringify(parsed) === expected
      : canonicalPreimage(parsed) === canonicalPreimage(JSON.parse(expected));
    if (!matches) error(path, 'consumer_memo_mismatch');
  }
  if (c.body !== null && definition.body !== c.body) error('body', 'consumer_body_mismatch');
  if (typeof definition.systemPrompt !== 'string' || c.systemIncludes.some(text => !definition.systemPrompt.includes(text))) error('systemPrompt', 'consumer_system_assertion_missing');
  if (c.rowMaxTokens !== null && typeof definition.maxTokens === 'number' && definition.maxTokens > c.rowMaxTokens) error('maxTokens', 'consumer_row_token_limit');
  if (c.blockedReason !== null) error('name', c.blockedReason);
  return errors;
}
module.exports = { getConsumerContract, validateConsumerDefinition };
