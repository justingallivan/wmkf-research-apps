// Existing prompt table only. Not publication authorization/definition validation.
// New draft-baseline column must be metadata-proved before these writes enable.
using System;
using System.Text.RegularExpressions;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Wmkf.PromptPublication;

public sealed class PromptRows(TransactionSdk sdk)
{
    public const string Table = "wmkf_ai_prompt";
    public const string PrimaryId = "wmkf_ai_promptid";
    private static readonly string[] InventoryColumns = { PrimaryId, "wmkf_ai_promptname", "wmkf_promptversion", "wmkf_ai_promptstatus", "wmkf_ai_iscurrent" };
    public System.Collections.Generic.IReadOnlyList<Entity> ReadInventory(string canonicalKey)
    {
        if (canonicalKey == null || canonicalKey.Length > 850 || !Regex.IsMatch(canonicalKey, @"\A[a-z0-9]+(?:[._-][a-z0-9]+)+\z")) throw new InvalidOperationException("invalid_canonical_key");
        var query = new QueryExpression(Table) { ColumnSet = new ColumnSet(InventoryColumns) };
        // No current/status predicate: stale Draft or retired/reserved history
        // must remain visible to the operation's later invariant checks.
        query.Criteria.AddCondition("wmkf_ai_promptname", ConditionOperator.Equal, canonicalKey);
        return sdk.ReadAll(query, PrimaryId);
    }
    public void PromoteDraft(Guid id, string originalEtag, int assignedVersion, DateTime publishedAt)
    {
        if (assignedVersion < 1 || publishedAt.Kind != DateTimeKind.Utc) throw new InvalidOperationException("invalid_promotion_stamp");
        var changes = new Entity(Table, id) {
            ["wmkf_ai_iscurrent"] = true,
            ["wmkf_ai_promptstatus"] = new OptionSetValue(682090001),
            ["wmkf_promptversion"] = assignedVersion,
            ["wmkf_ai_publisheddatetime"] = publishedAt,
            ["wmkf_ai_draftbaseline"] = null
        };
        sdk.ConditionalUpdate(changes, originalEtag);
    }
    public void ClearPrevious(Guid id, string originalEtag) =>
        sdk.ConditionalUpdate(new Entity(Table, id) { ["wmkf_ai_iscurrent"] = false }, originalEtag);
}
