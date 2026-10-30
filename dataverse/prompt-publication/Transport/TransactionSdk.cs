// SDK transport primitives, NOT a registered publisher, authorization or a
// transaction manager. Create per plug-in invocation; never cache across users.
// Only the platform owns commit/rollback. Every SDK fault
// escapes; never retry/refresh a row version or fall back to SYSTEM/app identity.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;

namespace Wmkf.PromptPublication;

public sealed class TransactionSdk
{
    private readonly IPluginExecutionContext context;
    private readonly IOrganizationService service;
    private readonly Guid organization;
    public Guid OrganizationId => organization;
    public Guid InitiatingUserId { get; }
    public Guid EffectiveUserId { get; }
    private static void Reject(string code) => throw new InvalidOperationException(code);
    // expectedOrganizationId MUST be server-owned release configuration, never
    // an input parameter. Factory is the platform-provided service factory.
    public TransactionSdk(IPluginExecutionContext context, IOrganizationServiceFactory factory, Guid expectedOrganizationId)
    {
        this.context = context ?? throw new ArgumentNullException(nameof(context));
        organization = expectedOrganizationId;
        InitiatingUserId = context.InitiatingUserId;
        EffectiveUserId = context.UserId;
        AssertContext();
        if (factory == null) Reject("sdk_service_factory_required");
        service = factory!.CreateOrganizationService(EffectiveUserId) ?? throw new InvalidOperationException("sdk_service_missing");
    }
    private void AssertContext()
    {
        if (organization == Guid.Empty || context.OrganizationId != organization
            || InitiatingUserId == Guid.Empty || EffectiveUserId == Guid.Empty
            || context.InitiatingUserId != InitiatingUserId || context.UserId != EffectiveUserId
            || context.Mode != 0 || !context.IsInTransaction || context.IsExecutingOffline || context.IsOfflinePlayback)
            Reject("sdk_transaction_context_required");
    }
    private static void Name(string name)
    {
        if (name == null || !Regex.IsMatch(name, @"\A[a-z][a-z0-9_]*\z", RegexOptions.CultureInvariant)) Reject("invalid_sdk_name");
    }
    private static bool ValidVersion(string? value) => value != null && Regex.IsMatch(value, @"\A[1-9][0-9]{0,18}\z", RegexOptions.CultureInvariant);
    private static void Identity(Entity entity)
    {
        Name(entity.LogicalName);
        if (entity.Id == Guid.Empty) Reject("sdk_entity_id_required");
    }
    public static string RowVersion(string weakEtag)
    {
        var match = Regex.Match(weakEtag ?? "", "\\AW/\"([1-9][0-9]{0,18})\"\\z", RegexOptions.CultureInvariant);
        if (!match.Success) Reject("original_row_version_required");
        return match.Groups[1].Value;
    }
    public static string WeakEtag(string rowVersion)
    {
        if (!ValidVersion(rowVersion)) Reject("invalid_sdk_row_version");
        return "W/\"" + rowVersion + "\"";
    }
    public Guid CreateOnly(Entity entity)
    {
        AssertContext(); Name(entity.LogicalName);
        var id = service.Create(entity);
        if (id == Guid.Empty) Reject("invalid_sdk_create_result");
        return id;
    }
    public void ConditionalUpdate(Entity changes, string originalEtag)
    {
        AssertContext(); Identity(changes);
        if (changes.Attributes.Count == 0) Reject("empty_sdk_update");
        if (changes.RowVersion != null) Reject("caller_row_version_not_allowed");
        var target = new Entity(changes.LogicalName, changes.Id) { RowVersion = RowVersion(originalEtag) };
        foreach (var pair in changes.Attributes) { Name(pair.Key); target.Attributes.Add(pair.Key, pair.Value); }
        service.Execute(new UpdateRequest { Target = target, ConcurrencyBehavior = ConcurrencyBehavior.IfRowVersionMatches });
    }
    public Entity ReadById(string table, Guid id, params string[] fields)
    {
        AssertContext(); Name(table); if (id == Guid.Empty || fields.Length == 0) Reject("invalid_sdk_read");
        foreach (var field in fields) Name(field);
        var row = service.Retrieve(table, id, new ColumnSet(fields));
        if (row == null || row.Id != id || row.LogicalName != table || !ValidVersion(row.RowVersion)) throw new InvalidOperationException("invalid_sdk_read_result");
        return row;
    }
    // Caller owns the complete-key filter. No HTTP URLs/cookies accepted.
    public IReadOnlyList<Entity> ReadAll(QueryExpression query, string primaryId)
    {
        AssertContext(); Name(query.EntityName); Name(primaryId);
        if (query.Criteria == null || query.TopCount != null || query.Distinct || query.LinkEntities.Count != 0
            || query.ColumnSet.AllColumns || query.ColumnSet.Columns.Count == 0
            || query.Orders.Count != 0 || (query.PageInfo != null && (query.PageInfo.PageNumber > 1 || query.PageInfo.PagingCookie != null))) Reject("unsafe_sdk_inventory_query");
        foreach (var field in query.ColumnSet.Columns) Name(field);
        var request = new QueryExpression(query.EntityName) { ColumnSet = new ColumnSet(query.ColumnSet.Columns.ToArray()), Criteria = query.Criteria };
        request.AddOrder(primaryId, OrderType.Ascending);
        request.PageInfo = new PagingInfo { Count = 5000, PageNumber = 1 };
        var rows = new List<Entity>(); var seen = new HashSet<Guid>(); var cookies = new HashSet<string>(StringComparer.Ordinal);
        while (true)
        {
            AssertContext();
            var page = service.RetrieveMultiple(request);
            if (page == null) throw new InvalidOperationException("incomplete_sdk_inventory");
            foreach (var row in page.Entities)
            {
                if (row.LogicalName != query.EntityName || row.Id == Guid.Empty || !ValidVersion(row.RowVersion) || !seen.Add(row.Id)) Reject("invalid_sdk_inventory_row");
                rows.Add(row); if (rows.Count > 10000) Reject("sdk_inventory_limit");
            }
            if (!page.MoreRecords) return rows.AsReadOnly();
            if (page.Entities.Count == 0 || string.IsNullOrEmpty(page.PagingCookie) || !cookies.Add(page.PagingCookie)) Reject("incomplete_sdk_inventory");
            request.PageInfo.PageNumber++; request.PageInfo.PagingCookie = page.PagingCookie;
        }
    }
}
