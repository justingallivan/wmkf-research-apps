/**
 * export_csv tool: export Dynamics query results as a downloadable Excel
 * file, with an optional AI batch-processing pass (estimate mode, then a
 * confirmed run) before export.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:507-735
 * (post-S7a line numbers, all of which trace to the original
 * pre-S2 baseline 2311-2469, 2661-2727); characterization tests are the
 * safety net.
 *
 * `sendEvent` stays a true parameter: `generateExcelExport` emits
 * `file_ready` through it with exactly `base64`, `filename`, `recordCount`,
 * `totalCount`, `capped`, `columns`.
 */

import ExcelJS from 'exceljs';
import { DynamicsService } from '../../dynamics-service';
import { sanitizeSelect, applyActiveOnlyFilter, stripEmpty } from '../result-shaping';
import { validateEffectiveODataCall, validatorReject } from '../tool-errors';
import { serializeDynamicsExplorerRecordForModel } from '../../../utils/dynamics-explorer-serializer';
import { runSampleProcessing, processRecordsBatch } from './batch-processing';
import { getModelForApp } from '../../../../shared/config/baseConfig';
import { estimateCostCents } from '../../../utils/usage-logger';

// ─── Export to Excel ───

const MAX_XLSX_BYTES = 3 * 1024 * 1024; // 3MB buffer limit (~4MB base64)

/**
 * Export query results as a downloadable Excel file.
 * Three-way branch:
 * 1. No process_instruction → existing behavior (straight export)
 * 2. process_instruction without confirmed → estimate mode
 * 3. process_instruction with confirmed: true → full AI batch processing + export
 */
export async function exportCsv({ table_name, select, filter, orderby, filename, process_instruction, confirmed, include_inactive }, sendEvent, userProfileId, restrictions = []) {
  const cleanSelect = sanitizeSelect(select);
  const effectiveFilter = applyActiveOnlyFilter(filter, include_inactive);
  const validation = await validateEffectiveODataCall('export_csv', {
    table_name,
    select: cleanSelect,
    filter: effectiveFilter,
    orderby,
  }, restrictions);
  if (validation.reject) return validatorReject(validation.reject);
  const entitySet = await DynamicsService.resolveEntitySetName(table_name);

  // ─── Branch 1: No AI processing — straight export (unchanged) ───
  if (!process_instruction) {
    const result = await DynamicsService.queryAllRecords(entitySet, {
      select: cleanSelect,
      filter: effectiveFilter,
      orderby,
    });

    if (!result.records.length) {
      return { exportedCount: 0, message: 'No records matched the filter. No file generated.' };
    }

    const records = result.records.map(stripEmpty);
    return await generateExcelExport(records, cleanSelect, table_name, filename, result.totalCount, result.capped, sendEvent);
  }

  // ─── Branch 2: Estimate mode — count records, sample AI processing ───
  if (!confirmed) {
    // Fetch 3 sample records — also gives us totalCount without the /$count endpoint
    // (/$count fails with Edm.Int32 error on complex filters)
    const sampleResult = await DynamicsService.queryRecords(entitySet, {
      select: cleanSelect,
      filter: effectiveFilter,
      top: 3,
    });

    if (!sampleResult.records.length) {
      return { estimatedCount: 0, message: 'No records matched the filter.' };
    }

    const count = sampleResult.totalCount || sampleResult.records.length;

    // Run AI on first sample to determine columns and preview output
    const sampleRecord = serializeDynamicsExplorerRecordForModel(stripEmpty(sampleResult.records[0]));
    const { sampleOutput, usage } = await runSampleProcessing(sampleRecord, process_instruction, userProfileId);

    // Extrapolate cost: (tokens per record) × total records ÷ batch size
    const recordsPerBatch = 15;
    const totalBatches = Math.ceil(Math.min(count, 5000) / recordsPerBatch);
    // Estimate per-batch tokens as sample tokens × batch size (with some overhead)
    const estInputPerBatch = (usage.input_tokens || 500) * recordsPerBatch * 0.8; // records share system prompt
    const estOutputPerBatch = (usage.output_tokens || 100) * recordsPerBatch;
    const totalInputTokens = estInputPerBatch * totalBatches;
    const totalOutputTokens = estOutputPerBatch * totalBatches;

    const model = getModelForApp('dynamics-explorer');
    const costCents = estimateCostCents(model, totalInputTokens, totalOutputTokens) || 0;
    const estimatedTimeSeconds = Math.ceil(totalBatches / 3) * 2; // 3 concurrent, ~2s each

    return {
      estimatedCount: Math.min(count, 5000),
      totalMatched: count,
      capped: count > 5000,
      sampleOutput,
      aiColumns: Object.keys(sampleOutput),
      estimatedCostCents: Math.round(costCents * 100) / 100,
      estimatedTimeSeconds,
      message: `Found ${count} records${count > 5000 ? ' (will export first 5000)' : ''}. Sample AI output shown. Estimated cost: ~$${(costCents / 100).toFixed(2)}, time: ~${estimatedTimeSeconds}s. Ask the user to confirm before proceeding.`,
    };
  }

  // ─── Branch 3: Confirmed — full AI batch processing + export ───
  const result = await DynamicsService.queryAllRecords(entitySet, {
    select: cleanSelect,
    filter: effectiveFilter,
    orderby,
  });

  if (!result.records.length) {
    return { exportedCount: 0, message: 'No records matched the filter. No file generated.' };
  }

  let records = result.records.map(stripEmpty);

  // Run AI batch processing
  const { processedRecords, failedCount } = await processRecordsBatch(
    records, process_instruction, sendEvent, userProfileId
  );

  // Build combined select string including AI columns
  const aiColumns = Object.keys(processedRecords[0] || {}).filter(k => k.startsWith('ai_'));
  const combinedSelect = cleanSelect
    ? cleanSelect + ',' + aiColumns.join(',')
    : null;

  return await generateExcelExport(
    processedRecords, combinedSelect, table_name, filename,
    result.totalCount, result.capped, sendEvent, failedCount
  );
}

/**
 * Generate Excel file and send via SSE. Shared by plain and AI-processed exports.
 */
export async function generateExcelExport(records, selectStr, tableName, filename, totalCount, capped, sendEvent, failedCount) {
  let xlsxBuf = await recordsToExcel(records, selectStr, tableName);

  // Safety: if xlsx exceeds size limit, trim records
  if (xlsxBuf.length > MAX_XLSX_BYTES) {
    const ratio = MAX_XLSX_BYTES / xlsxBuf.length;
    const trimCount = Math.floor(records.length * ratio * 0.9);
    records.length = trimCount;
    xlsxBuf = await recordsToExcel(records, selectStr, tableName);
    capped = true;
  }

  const base64 = Buffer.from(xlsxBuf).toString('base64');
  const columns = selectStr ? selectStr.split(',').map(f => f.trim()) : Object.keys(records[0] || {});
  const exportFilename = (filename || `${tableName}-export`).replace(/[^a-zA-Z0-9_-]/g, '_') + '.xlsx';

  sendEvent('file_ready', {
    base64,
    filename: exportFilename,
    recordCount: records.length,
    totalCount,
    capped,
    columns,
  });

  const result = {
    exportedCount: records.length,
    totalCount,
    capped,
    columnCount: columns.length,
    filename: exportFilename,
    message: `Excel file exported: ${records.length} records, ${columns.length} columns.${capped ? ` Capped at limit (${totalCount} total matched).` : ''}`,
  };

  if (failedCount > 0) {
    result.failedCount = failedCount;
    result.message += ` ${failedCount} records failed AI processing (columns left blank).`;
  }

  return result;
}

/**
 * Convert records to an xlsx buffer using ExcelJS.
 * Prefers _formatted values for human-readable output.
 */
async function recordsToExcel(records, selectStr, sheetName) {
  // Determine columns from $select
  const selectFields = selectStr
    ? selectStr.split(',').map(f => f.trim())
    : Object.keys(records[0] || {});

  // Build headers
  const headers = selectFields.map(f => cleanColumnName(f));

  // Build rows, preferring _formatted values
  const dataRows = records.map(r => {
    return selectFields.map(field => {
      const formatted = r[`${field}_formatted`];
      return formatted !== undefined ? formatted : (r[field] ?? '');
    });
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet((sheetName || 'Export').substring(0, 31));

  // Add header row
  ws.addRow(headers);

  // Add data rows
  for (const row of dataRows) {
    ws.addRow(row);
  }

  // Auto-size columns based on content
  ws.columns.forEach((col, i) => {
    let maxLen = headers[i].length;
    for (const row of dataRows.slice(0, 100)) {
      const val = String(row[i] || '');
      if (val.length > maxLen) maxLen = val.length;
    }
    col.width = Math.min(maxLen + 2, 50);
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Clean column names: strip akoya_/wmkf_ prefixes, _value suffix,
 * and convert to Title Case. AI columns (ai_*) get "AI: " prefix.
 */
function cleanColumnName(field) {
  // AI-generated columns get "AI: " prefix
  if (field.startsWith('ai_')) {
    const aiName = field.slice(3)
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return `AI: ${aiName}`;
  }

  let name = field
    .replace(/^_/, '')
    .replace(/_value$/, '')
    .replace(/^akoya_/, '')
    .replace(/^wmkf_/, '');
  // Convert snake_case to Title Case
  return name
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
