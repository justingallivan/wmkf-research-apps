/**
 * Conversation trimming and compaction for the Dynamics Explorer chat loop.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:499-595;
 * characterization tests are the safety net.
 */

// ─── Conversation management ───

/**
 * Bound conversation history to six messages. When trimming is required, two
 * synthetic context notices plus the four most recent real messages are sent.
 * The most recent user message is always kept.
 */
export function trimConversation(messages) {
  const cleaned = messages.map(m => ({ role: m.role, content: m.content }));
  if (cleaned.length <= 6) return cleaned;
  // Keep a two-message summary hint + the last four real messages.
  return [
    { role: 'user', content: '[Earlier conversation context was trimmed to save tokens]' },
    { role: 'assistant', content: 'Understood, I\'ll work with the recent context.' },
    ...cleaned.slice(-4),
  ];
}

/**
 * Compact old tool-use rounds: replace all but the most recent tool results
 * with brief summaries to dramatically reduce token count.
 */
export function compactMessages(messages) {
  // Find all tool_result message indices (role=user, content is array of tool_results)
  const toolResultIndices = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result') {
      toolResultIndices.push(i);
    }
  }

  // Only compact if there are 2+ tool rounds — keep the latest intact
  if (toolResultIndices.length < 2) return messages;

  const result = [...messages];
  // Compact all but the last tool round
  for (let idx = 0; idx < toolResultIndices.length - 1; idx++) {
    const msgIdx = toolResultIndices[idx];
    const oldResults = result[msgIdx].content;

    // Replace verbose tool results with one-line summaries
    const compacted = oldResults.map(tr => ({
      type: 'tool_result',
      tool_use_id: tr.tool_use_id,
      content: summarizeToolResult(tr.content),
    }));

    result[msgIdx] = { ...result[msgIdx], content: compacted };

    // Also compact the preceding assistant message's tool_use input fields
    const assistantIdx = msgIdx - 1;
    if (assistantIdx >= 0 && result[assistantIdx].role === 'assistant' && Array.isArray(result[assistantIdx].content)) {
      result[assistantIdx] = {
        ...result[assistantIdx],
        content: result[assistantIdx].content.map(block => {
          if (block.type === 'tool_use') {
            return { ...block, input: {} }; // Clear verbose input since result is summarized
          }
          return block;
        }),
      };
    }
  }

  return result;
}

/**
 * Summarize a tool result string to a brief one-liner.
 */
export function summarizeToolResult(content) {
  if (!content || content.length < 100) return content;
  try {
    const data = JSON.parse(content);
    if (data.error) return `Error: ${data.error.substring(0, 80)}`;
    if (data.totalCount !== undefined && data.results) return `Search: ${data.totalCount} results`;
    if (data.count !== undefined && data.tables) return `Found ${data.count} tables`;
    if (data.count !== undefined && !data.records) return `Count: ${data.count}`;
    if (data.results && data.operation) {
      if (data.results.length === 1) return `${data.operation}: ${data.results[0]?.value ?? 'null'}`;
      return `${data.operation}: ${data.results.length} groups`;
    }
    if (data.records) return `Returned ${data.records.length} records`;
    if (data.emailCount !== undefined) return `Found ${data.emailCount} emails`;
    if (data.reportCount !== undefined) return `Found ${data.reportCount} reports`;
    if (data.documentCount !== undefined) return `Found ${data.documentCount} documents`;
    if (data.searchCount !== undefined) return `Found ${data.searchCount} matching documents`;
    if (data.fields) return `Table schema returned`;
    if (data.exportedCount !== undefined) return `Exported ${data.exportedCount} records`;
    if (data.estimatedCount !== undefined) return `Estimate: ${data.estimatedCount} records, ~$${(data.estimatedCostCents / 100).toFixed(2)}`;
    return content.substring(0, 100) + '...';
  } catch {
    return content.substring(0, 100) + '...';
  }
}

