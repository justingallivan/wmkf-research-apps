/**
 * Guard for text/JSON consumers that cannot use a provider refusal as output.
 * LLMClient remains lossless; Executor and Explorer own their terminal policy.
 * Check before formatting, parsing, persistence or legacy response conversion.
 * Never retry a refusal on another model and never expose provider response text
 * in this error. Ordinary responses are returned unchanged.
 */
export function requireAcceptedLlmResponse(response) {
  if (response?.refused === true || response?.stopReason === 'refusal') {
    const error = new Error('The AI provider declined this request. No result was generated.');
    error.code = 'model_refusal';
    error.status = 422;
    error.httpStatus = 422;
    throw error;
  }
  return response;
}
