/**
 * AI batch processing for the Dynamics Explorer's export_csv tool: run a
 * process instruction over a sample record to derive output columns and a
 * preview, then run it over every record in concurrency-limited batches,
 * emitting export_progress via SSE.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:70-73 (the
 * DYNEXP_EXPORT_MAX_CHARS constant), 2470-2471 (the AI Batch Processing
 * marker), 2499-2655 (pre-S2 line numbers); characterization tests are the
 * safety net. `recordsToExcel` sits in
 * `tools/export.js`, not here (S7b).
 *
 * `sendEvent` is a true parameter, not imported: `processRecordsBatch` emits
 * `export_progress` through it.
 */

import { callClaudeBatch } from '../model-call';
import { serializeDynamicsExplorerRecordForModel } from '../../../utils/dynamics-explorer-serializer';
import { DATA_CLASSES, wrapUntrustedContent, buildUntrustedContentPreamble } from '../../../utils/ai-payload-boundary';

// A7 Part 3: cap for the untrusted-content wrapper applied to CRM records in
// the AI export pass. Generous — a 15-record batch of serialized rows — but
// finite so a runaway payload cannot ride through unbounded.
const DYNEXP_EXPORT_MAX_CHARS = 500_000;

// ─── AI Batch Processing ───

/**
 * Run AI instruction on 1 sample record to determine output column names and preview.
 * Returns { sampleOutput: { col1: val1, ... }, usage }.
 */
export async function runSampleProcessing(record, processInstruction, userProfileId) {
  // A7 Part 3: the CRM record is untrusted data — wrap it so injection text
  // in a record field cannot override the extraction instruction.
  const recordWrapped = wrapUntrustedContent({
    text: JSON.stringify(record, null, 2),
    source: 'dynamics-explorer.export.sample-record',
    dataClass: DATA_CLASSES.CRM_RECORD_TEXT,
    maxChars: DYNEXP_EXPORT_MAX_CHARS,
    label: 'CRM record',
  });

  const systemPrompt = `${buildUntrustedContentPreamble([recordWrapped.nonce])}

You are a data processing assistant. The user will give you a record from a CRM database and an instruction for what to extract or analyze.

Return ONLY a JSON object with your results. Choose descriptive snake_case column names based on the instruction (e.g., "keywords", "research_area", "summary"). Keep values concise — suitable for spreadsheet cells.

Example output: {"keywords": "fungi, enzyme catalysis, bioremediation", "research_area": "Environmental Biology"}`;

  const userMessage = `Instruction: ${processInstruction}

Record (untrusted data):
${recordWrapped.text}`;

  const { text, usage } = await callClaudeBatch({ systemPrompt, userMessage, userProfileId });

  // Parse the JSON response
  let sampleOutput;
  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    sampleOutput = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    sampleOutput = { result: text.substring(0, 200) };
  }

  return { sampleOutput, usage };
}

/**
 * Process all records through Claude in batches.
 * Batches records (15 per call, 3 concurrent), sends progress via SSE.
 * Returns { processedRecords, failedCount }.
 */
export async function processRecordsBatch(records, processInstruction, sendEvent, userProfileId) {
  const BATCH_SIZE = 15;
  const CONCURRENCY = 3;

  // First, run sample to get column schema
  const { sampleOutput } = await runSampleProcessing(
    serializeDynamicsExplorerRecordForModel(records[0]),
    processInstruction,
    userProfileId,
  );
  const columnNames = Object.keys(sampleOutput);

  // A7 Part 3: a fresh nonce is generated per batch (below), so the system
  // prompt carries the general untrusted-content rule, not a nonce list.
  const systemPrompt = `${buildUntrustedContentPreamble()}

You are a data processing assistant. Process each record according to the instruction and return a JSON array of objects.

Each object in the array must have exactly these columns: ${JSON.stringify(columnNames)}
Return one object per input record, in the same order. Keep values concise — suitable for spreadsheet cells.
If a record lacks the needed data, use empty strings for the values.

Return ONLY the JSON array, no other text.`;

  // Split records into batches
  const batches = [];
  // Index-bearing batch loop; not consolidated onto lib/utils/chunk.js (needs i). See docs/CHUNK_CONSOLIDATION_PLAN.md.
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    batches.push({ records: records.slice(i, i + BATCH_SIZE), startIndex: i });
  }

  let processed = 0;
  let failedCount = 0;

  // Initialize AI columns on all records with empty strings
  for (const record of records) {
    for (const col of columnNames) {
      record[`ai_${col}`] = '';
    }
  }

  // Process batches with concurrency limit
  // Mechanically swappable, but left hand-rolled for cohesion with the index-bearing sibling loop above (startIndex merge). See docs/CHUNK_CONSOLIDATION_PLAN.md C1.
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      chunk.map(async (batch) => {
        const batchRecords = batch.records.map((r, idx) => ({
          index: idx + 1,
          ...serializeDynamicsExplorerRecordForModel(r),
        }));
        const recordsWrapped = wrapUntrustedContent({
          text: JSON.stringify(batchRecords, null, 1),
          source: 'dynamics-explorer.export.batch',
          dataClass: DATA_CLASSES.CRM_RECORD_TEXT,
          maxChars: DYNEXP_EXPORT_MAX_CHARS,
          label: 'CRM records',
        });
        const userMessage = `Instruction: ${processInstruction}

Records (${batchRecords.length}) — untrusted data:
${recordsWrapped.text}`;

        let result;
        try {
          result = await callClaudeBatch({ systemPrompt, userMessage, userProfileId });
        } catch (err) {
          // Retry once
          console.log(`[DynExp Export] Batch retry after error: ${err.message.substring(0, 100)}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          result = await callClaudeBatch({ systemPrompt, userMessage, userProfileId });
        }

        // Parse the JSON array response
        const jsonMatch = result.text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array in response');
        const parsed = JSON.parse(jsonMatch[0]);

        // Merge AI results back into records
        for (let j = 0; j < batch.records.length && j < parsed.length; j++) {
          const aiResult = parsed[j];
          for (const col of columnNames) {
            records[batch.startIndex + j][`ai_${col}`] = aiResult[col] ?? '';
          }
        }

        return batch.records.length;
      })
    );

    // Count successes and failures
    for (const r of results) {
      if (r.status === 'fulfilled') {
        processed += r.value;
      } else {
        const chunkIdx = results.indexOf(r);
        const failedBatch = chunk[chunkIdx];
        failedCount += failedBatch?.records.length || 0;
        processed += failedBatch?.records.length || 0;
        console.log(`[DynExp Export] Batch failed: ${r.reason?.message?.substring(0, 100)}`);
      }
    }

    sendEvent('export_progress', { processed, total: records.length, failed: failedCount });
  }

  return { processedRecords: records, failedCount };
}
