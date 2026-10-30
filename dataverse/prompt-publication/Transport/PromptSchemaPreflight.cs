// Read-only SDK metadata inspection. This report does not authorize deployment,
// provision columns, prove null-version drafts or attest head/receipt keys/roles.
using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Crm.Sdk.Messages;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Metadata;
using Newtonsoft.Json.Linq;

namespace Wmkf.PromptPublication;

public static class PromptSchemaPreflight
{
    public static JObject Inspect(IOrganizationService service, Guid expectedOrganizationId)
    {
        if (expectedOrganizationId == Guid.Empty) throw new InvalidOperationException("expected_organization_required");
        var identity = (WhoAmIResponse)service.Execute(new WhoAmIRequest());
        if (identity.OrganizationId != expectedOrganizationId) throw new InvalidOperationException("sandbox_organization_mismatch");
        var response = (RetrieveEntityResponse)service.Execute(new RetrieveEntityRequest {
            LogicalName = PromptRows.Table, EntityFilters = EntityFilters.Entity | EntityFilters.Attributes,
            RetrieveAsIfPublished = false
        });
        var metadata = response.EntityMetadata;
        if (metadata == null || metadata.LogicalName != PromptRows.Table || metadata.Attributes == null) throw new InvalidOperationException("incomplete_prompt_metadata");
        var expected = new Dictionary<string, (AttributeTypeCode type, int minimum)> {
            ["wmkf_ai_promptname"] = (AttributeTypeCode.String,850),
            ["wmkf_promptversion"] = (AttributeTypeCode.Integer,0),
            ["wmkf_ai_iscurrent"] = (AttributeTypeCode.Boolean,0),
            ["wmkf_ai_promptstatus"] = (AttributeTypeCode.Picklist,0),
            ["wmkf_ai_publisheddatetime"] = (AttributeTypeCode.DateTime,0),
            ["wmkf_ai_displaytitle"] = (AttributeTypeCode.String,200),
            ["wmkf_ai_description"] = (AttributeTypeCode.Memo,4000),
            ["wmkf_ai_groupkey"] = (AttributeTypeCode.String,80),
            ["wmkf_ai_sectionkey"] = (AttributeTypeCode.String,80),
            ["wmkf_ai_usedby"] = (AttributeTypeCode.Memo,4000),
            ["wmkf_ai_usagecategory"] = (AttributeTypeCode.String,40),
            ["wmkf_ai_draftbaseline"] = (AttributeTypeCode.Memo,16000)
        };
        var checks = new JArray();
        foreach (var field in expected)
        {
            var candidates = metadata.Attributes.Where(a => a.LogicalName == field.Key).ToArray();
            var attribute = candidates.Length == 1 ? candidates[0] : null;
            var length = attribute is StringAttributeMetadata text ? text.MaxLength : attribute is MemoAttributeMetadata memo ? memo.MaxLength : 0;
            var valid = attribute != null && attribute.AttributeType == field.Value.type && attribute.IsValidForRead == true
                && attribute.IsValidForCreate == true && attribute.IsValidForUpdate == true
                && (field.Value.minimum == 0 || length >= field.Value.minimum);
            if (field.Key == "wmkf_ai_publisheddatetime") valid = valid && attribute is DateTimeAttributeMetadata date && date.Format == DateTimeFormat.DateAndTime;
            if (field.Key == "wmkf_ai_promptstatus") valid = valid && attribute is PicklistAttributeMetadata pick
                && pick.OptionSet != null && new[] {682090000,682090001,682090002}.All(v => pick.OptionSet.Options.Any(o => o.Value == v));
            checks.Add(new JObject { ["field"] = field.Key, ["status"] = attribute == null ? "missing-or-duplicate" : valid ? "compatible" : "divergent" });
        }
        return new JObject {
            ["reportVersion"] = 1, ["deploymentAuthorized"] = false,
            ["organizationMatched"] = true,
            ["optimisticConcurrency"] = metadata.IsOptimisticConcurrencyEnabled == true,
            ["fields"] = checks,
            ["remainingProof"] = new JArray("head-receipt-organization-owned-and-active-unique-keys", "publisher-role-and-bypass-privileges", "null-version-draft-create", "custom-api-transaction-and-rollback", "policy-and-raw-write-guards", "same-actor-replay-and-unknown-outcome", "net48-runtime-parity")
        };
    }
}
