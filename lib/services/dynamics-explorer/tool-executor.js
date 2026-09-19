/**
 * Tool dispatcher: routes a Claude tool_use block to its Dynamics Explorer
 * implementation. Owns the inline `query_records`/`count_records`/`aggregate`
 * handlers and emits `document_links` (and strips `_files`) for
 * `list_documents`/`search_documents` itself.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:670-775
 * (pre-S2 line numbers); characterization tests are the safety net.
 */

import { DynamicsService } from '../dynamics-service';
import { findReportsDue, searchRecords } from './tools/composite';
import { describeTable } from './tools/describe-table';
import { getEntity } from './tools/get-entity';
import { getRelated } from './tools/get-related';
import { listDocuments, searchDocuments } from './tools/documents';
import { exportCsv } from './tools/export';
import { validateEffectiveODataCall, validatorReject } from './tool-errors';
import { sanitizeSelect, applyActiveOnlyFilter, stripEmpty } from './result-shaping';

export async function executeTool(name, input, sendEvent, userProfileId, restrictions = [], toolContext = {}) {
  switch (name) {
    case 'search':
      return await searchRecords(input);

    case 'get_entity':
      {
        const validation = await validateEffectiveODataCall(name, input, restrictions);
        if (validation.reject) return validatorReject(validation.reject);
      }
      return await getEntity(input);

    case 'get_related':
      {
        const validation = await validateEffectiveODataCall(name, input, restrictions);
        if (validation.reject) return validatorReject(validation.reject);
      }
      return await getRelated(input);

    case 'describe_table':
      return await describeTable(input, restrictions);

    case 'query_records': {
      const effectiveInput = {
        ...input,
        select: sanitizeSelect(input.select),
        filter: applyActiveOnlyFilter(input.filter, input.include_inactive),
      };
      const validation = await validateEffectiveODataCall(name, effectiveInput, restrictions);
      if (validation.reject) return validatorReject(validation.reject);
      const entitySet = await DynamicsService.resolveEntitySetName(input.table_name);
      const result = await DynamicsService.queryRecords(entitySet, {
        select: effectiveInput.select,
        filter: effectiveInput.filter,
        orderby: input.orderby,
        top: input.top || 50,
        expand: input.expand,
      });
      result.records = result.records.map(stripEmpty);
      return result;
    }

    case 'count_records': {
      const effectiveInput = {
        ...input,
        filter: applyActiveOnlyFilter(input.filter, input.include_inactive),
      };
      const validation = await validateEffectiveODataCall(name, effectiveInput, restrictions);
      if (validation.reject) return validatorReject(validation.reject);
      const entitySet = await DynamicsService.resolveEntitySetName(input.table_name);
      const count = await DynamicsService.countRecords(
        entitySet,
        effectiveInput.filter,
      );
      return { count };
    }

    case 'aggregate': {
      const effectiveInput = {
        ...input,
        filter: applyActiveOnlyFilter(input.filter, input.include_inactive),
      };
      const validation = await validateEffectiveODataCall(name, effectiveInput, restrictions);
      if (validation.reject) return validatorReject(validation.reject);
      const entitySet = await DynamicsService.resolveEntitySetName(input.table_name);
      const result = await DynamicsService.aggregateRecords(entitySet, {
        field: input.field,
        operation: input.operation,
        filter: effectiveInput.filter,
        groupBy: input.group_by,
      });
      if (result.results) result.results = result.results.map(stripEmpty);
      return result;
    }

    case 'find_reports_due':
      return await findReportsDue(input);

    case 'list_documents': {
      const docResult = await listDocuments(input);
      if (docResult._files?.length > 0) {
        sendEvent('document_links', {
          requestNumber: docResult.requestNumber,
          files: docResult._files,
        });
        delete docResult._files; // Don't send structured data to Claude
      }
      return docResult;
    }

    case 'search_documents': {
      const searchResult = await searchDocuments(input, toolContext);
      if (searchResult._files?.length > 0) {
        sendEvent('document_links', { files: searchResult._files });
        delete searchResult._files;
      }
      return searchResult;
    }

    case 'export_csv':
      return await exportCsv(input, sendEvent, userProfileId, restrictions);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
