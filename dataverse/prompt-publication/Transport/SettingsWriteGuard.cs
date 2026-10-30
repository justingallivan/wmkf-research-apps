// Completes the coordination boundary. Raw group/control/history writers deny.
// Future audited group/budget operations must explicitly join these same fences.
using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Newtonsoft.Json.Linq;
namespace Wmkf.PromptPublication;
public static class SettingsWriteGuard
{
    private static bool Protected(string key)=>string.Equals(key,ProductionPublicationRules.Groups,StringComparison.OrdinalIgnoreCase)||string.Equals(key,ProductionPublicationRules.BudgetControl,StringComparison.OrdinalIgnoreCase)||key.StartsWith(ProductionPublicationRules.BudgetPrefix,StringComparison.OrdinalIgnoreCase);
    public static void Assert(IPluginExecutionContext c,Entity target,Entity? preimage,PublicationWriteAuthority authority)
    {
        PublicationWire.Require(c.PrimaryEntityName==ProductionPublicationRules.Settings&&target.LogicalName==c.PrimaryEntityName&&c.Stage==20&&c.Mode==0&&c.IsInTransaction&&!c.IsExecutingOffline&&!c.IsOfflinePlayback,"settings_guard_context_required");
        PublicationWire.Require(c.MessageName=="Create"||c.MessageName=="Update"||c.MessageName=="Delete","settings_bulk_or_alternate_write_denied");
        var old=c.MessageName=="Create"?null:preimage?.GetAttributeValue<string>(ProductionPublicationRules.Key);
        var next=target.Attributes.TryGetValue(ProductionPublicationRules.Key,out var key)?key as string:old;
        PublicationWire.Require(c.MessageName=="Create"?next!=null:old!=null&&preimage!.Id==target.Id&&preimage.LogicalName==target.LogicalName,"settings_key_preimage_required");
        if(!Protected(old??"")&&!Protected(next??""))return;
        // Case-insensitive Dataverse identity cannot bypass these exact keys.
        PublicationWire.Require(next==old&&c.MessageName=="Update"&&target.Attributes.Count==1&&target.Attributes.ContainsKey(ProductionPublicationRules.Value)&&authority.Matches(c,target),"raw_coordinated_setting_write_denied");
        var value=target.GetAttributeValue<string>(ProductionPublicationRules.Value);PublicationWire.Require(value!=null,"invalid_coordinated_setting_value");
        if(old==ProductionPublicationRules.Groups)
        {PublicationWire.Require(value==preimage!.GetAttributeValue<string>(ProductionPublicationRules.Value),"catalog_removal_requires_audited_operation");ProductionPublicationRules.CatalogGroups(CanonicalJson.Parse(value!));}
        else if(old==ProductionPublicationRules.BudgetControl)
        {
            var before=(JObject)CanonicalJson.Parse(preimage!.GetAttributeValue<string>(ProductionPublicationRules.Value));var after=PublicationWire.Shape(CanonicalJson.Parse(value!),"schemaVersion","revision","policyRevision","policyArtifactHash");
            before["etag"]=TransactionSdk.WeakEtag(target.RowVersion);BudgetRules.Control(before);
            PublicationWire.Require(PublicationWire.Integer(after["schemaVersion"],1,1)&&PublicationWire.Text(after["revision"])==PublicationWire.Increment(before["revision"])&&PublicationWire.Integer(after["policyRevision"],PinnedPolicy.Revision,PinnedPolicy.Revision)&&PublicationWire.Text(after["policyArtifactHash"])==PinnedPolicy.ArtifactHash,"invalid_coordinated_setting_value");
        }
        else throw new InvalidOperationException("immutable_budget_history");
    }
}
