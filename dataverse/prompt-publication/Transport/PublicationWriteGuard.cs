// Fail-closed synchronous pre-operation guard. No depth-only or input bypass.
// Bulk/upsert/alternate mutation messages reject until separately proved; do not
// register this evaluator twice in a merged single/bulk pipeline.
using System;
using System.Linq;
using System.Globalization;
using Microsoft.Xrm.Sdk;
using Newtonsoft.Json.Linq;

namespace Wmkf.PromptPublication;

public sealed class PublicationWriteAuthority
{
    private const string Slot="wmkf.prompt.publication.internal-write.v1";
    private readonly Guid organization, extension;
    private readonly string message;
    public PublicationWriteAuthority(Guid organization,string customApiMessage,Guid owningExtension)
    {this.organization=organization;message=customApiMessage;extension=owningExtension;PublicationWire.Require(organization!=Guid.Empty&&extension!=Guid.Empty&&!string.IsNullOrWhiteSpace(message),"trusted_publication_binding_required");}
    private bool EligibleParent(IPluginExecutionContext? p) => p!=null&&p.OrganizationId==organization&&p.OwningExtension?.Id==extension&&p.MessageName==message&&p.Stage==30&&p.Mode==0&&p.IsInTransaction&&p.UserId!=Guid.Empty&&p.InitiatingUserId!=Guid.Empty&&p.CorrelationId!=Guid.Empty&&!p.IsExecutingOffline&&!p.IsOfflinePlayback;
    private static string Mutation(string operation,Entity entity)
    {
        PublicationWire.Require(entity.KeyAttributes.Count==0,"trusted_write_key_attributes_denied");
        var attrs=new JObject();foreach(var pair in entity.Attributes)
        {
            JToken value;
            if(pair.Value==null)value=JValue.CreateNull();
            else if(pair.Value is OptionSetValue option)value=new JObject{["option"]=option.Value};
            else if(pair.Value is DateTime date) {PublicationWire.Require(date.Kind==DateTimeKind.Utc,"trusted_write_utc_required");value=new JObject{["utc"]=date.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture)};}
            else if(pair.Value is EntityReference reference) {PublicationWire.Require(reference.KeyAttributes.Count==0&&reference.Id!=Guid.Empty,"trusted_write_lookup_required");value=new JObject{["table"]=reference.LogicalName,["id"]=reference.Id.ToString()};}
            else if(pair.Value is string || pair.Value is bool || pair.Value is int || pair.Value is long || pair.Value is decimal || pair.Value is double)value=JToken.FromObject(pair.Value);
            else throw new InvalidOperationException("unsupported_trusted_write_value");
            attrs.Add(pair.Key,value);
        }
        return CanonicalJson.Preimage(PublicationWire.Json(new JObject{["operation"]=operation,["table"]=entity.LogicalName,["id"]=entity.Id.ToString(),["rowVersion"]=entity.RowVersion,["attributes"]=attrs}));
    }
    // Narrow permit exists only while the synchronous SDK message is executing.
    // SharedVariables contains serializable text, never a custom CLR capability.
    public T Write<T>(IPluginExecutionContext parent,string operation,Entity target,Func<T> action)
    {
        PublicationWire.Require(EligibleParent(parent),"trusted_publication_parent_required");PublicationWire.Require(operation=="Create"||operation=="Update","invalid_trusted_write");
        PublicationWire.Require(!parent.SharedVariables.ContainsKey(Slot),"nested_trusted_write");parent.SharedVariables[Slot]=Mutation(operation,target);
        try{return action();}finally{parent.SharedVariables.Remove(Slot);}
    }
    public bool Matches(IPluginExecutionContext child,Entity target)
    {
        var parentContext=child.ParentContext;if(!EligibleParent(parentContext))return false;
        var p=parentContext!;
        PublicationWire.Require(child.OrganizationId==organization&&child.Mode==0&&child.Stage==20&&child.IsInTransaction&&child.UserId==p.UserId&&child.InitiatingUserId==p.InitiatingUserId&&child.CorrelationId==p.CorrelationId&&child.Depth==p.Depth+1&&!child.IsExecutingOffline&&!child.IsOfflinePlayback,"trusted_publication_child_required");
        return p.SharedVariables.TryGetValue(Slot,out var value)&&value is string text&&text==Mutation(child.MessageName,target);
    }
}

public static class PublicationWriteGuard
{
    public static readonly string[] DefinitionColumns={"wmkf_ai_systemprompt","wmkf_ai_promptbody","wmkf_ai_promptvariables","wmkf_ai_promptoutputschema","wmkf_ai_model","wmkf_ai_temperature","wmkf_ai_maxtokens"};
    public static readonly string[] CatalogColumns={"wmkf_ai_displaytitle","wmkf_ai_description","wmkf_ai_groupkey","wmkf_ai_sectionkey","wmkf_ai_usedby","wmkf_ai_usagecategory"};
    // Registration must supply complete lifecycle/name preimages for Update/Delete.
    // Name/status/current must be present. Dataverse omits selected null version
    // values: an absent version means null ONLY with verified complete preimages.
    public static void Assert(IPluginExecutionContext context,Entity target,Entity? preimage,string headTable,string receiptTable,PublicationWriteAuthority? authority=null)
    {
        PublicationWire.Require(context.Mode==0&&context.Stage==20&&context.IsInTransaction&&!context.IsExecutingOffline&&!context.IsOfflinePlayback,"write_guard_context_required");
        PublicationWire.Require(!string.IsNullOrWhiteSpace(headTable)&&!string.IsNullOrWhiteSpace(receiptTable)&&headTable!=receiptTable&&headTable!=PromptRows.Table&&receiptTable!=PromptRows.Table,"write_guard_binding_required");
        PublicationWire.Require(context.PrimaryEntityName==target.LogicalName&&(target.LogicalName==PromptRows.Table||target.LogicalName==headTable||target.LogicalName==receiptTable),"write_guard_target_mismatch");
        PublicationWire.Require(context.MessageName=="Create"||context.MessageName=="Update"||context.MessageName=="Delete","raw_bulk_or_alternate_write_denied");
        if(authority!=null&&authority.Matches(context,target))
        {
            if(target.LogicalName==headTable)
            {
                PublicationWire.Require(context.MessageName=="Create"||context.MessageName=="Update","invalid_trusted_head_write");
                Entity state=target;
                if(context.MessageName=="Update")
                {
                    PublicationWire.Require(preimage!=null&&preimage.Id==target.Id&&preimage.LogicalName==headTable,"head_guard_preimage_required");
                    state=new Entity(headTable,target.Id);foreach(var a in preimage!.Attributes)state[a.Key]=a.Value;foreach(var a in target.Attributes)state[a.Key]=a.Value;
                }
                var payload=PublicationSdkStore.HeadState(state);
                PublicationWire.Require(PublicationWire.Key(payload["key"])&&PublicationWire.Equal(payload["key"],payload["originalKey"])&&PublicationWire.Text(payload["keyHash"])==PublicationPublisher.HeadKey(PublicationWire.Text(payload["key"])!)
                    &&PublicationWire.Revision(payload["revision"])&&PublicationWire.Integer(payload["highWaterVersion"],0,int.MaxValue)
                    &&(PublicationWire.Null(payload["current"])||payload["current"]!["version"]!.Value<int>()<=payload["highWaterVersion"]!.Value<int>()),"invalid_trusted_head_identity");
                PublicationWire.Require(context.MessageName=="Create"?target.Attributes.Count==PublicationSdkStore.HeadColumns.Length&&target.Attributes.Keys.All(k=>PublicationSdkStore.HeadColumns.Contains(k,StringComparer.Ordinal))
                    :target.Attributes.Count==1&&target.Attributes.ContainsKey(PublicationSdkStore.HeadRevision)||target.Attributes.Count==3&&new[]{PublicationSdkStore.CurrentPrompt,PublicationSdkStore.CurrentVersion,PublicationSdkStore.HighWater}.All(k=>target.Attributes.ContainsKey(k)),"invalid_trusted_head_attributes");
            }
            if(target.LogicalName==receiptTable)
            {
                PublicationWire.Require(context.MessageName=="Create","immutable_publication_receipt");
                var receipt=PublicationWire.Receipt(target.GetAttributeValue<string>(PublicationSdkStore.Payload)??"null");
                PublicationWire.Require(target.GetAttributeValue<string>(PublicationSdkStore.RequestId)==PublicationWire.Text(receipt["request"]!["requestId"])&&target.Attributes.Keys.All(k=>k==PublicationSdkStore.Payload||k==PublicationSdkStore.RequestId),"invalid_trusted_receipt_identity");
            }
            return;
        }
        PublicationWire.Require(target.LogicalName==PromptRows.Table,"raw_publication_control_write_denied");
        if(context.MessageName=="Create")
        {
            PublicationWire.Require(target.KeyAttributes.Count==0&&target.GetAttributeValue<OptionSetValue>("wmkf_ai_promptstatus")?.Value==682090000
                &&target.Attributes.TryGetValue("wmkf_ai_iscurrent",out var current)&&current is bool b&&!b
                &&(!target.Attributes.TryGetValue("wmkf_promptversion",out var version)||version==null)
                &&PublicationWire.Key(JToken.FromObject(target.GetAttributeValue<string>("wmkf_ai_promptname")??"")),"raw_draft_create_required");
        }
        else
        {
            PublicationWire.Require(preimage!=null&&preimage.Id==target.Id&&preimage.LogicalName==target.LogicalName&&target.Id!=Guid.Empty&&target.KeyAttributes.Count==0
                &&preimage.GetAttributeValue<OptionSetValue>("wmkf_ai_promptstatus")?.Value==682090000&&preimage.Attributes.TryGetValue("wmkf_ai_iscurrent",out var current)&&current is bool b&&!b
                &&(!preimage.Attributes.TryGetValue("wmkf_promptversion",out var version)||version==null)&&PublicationWire.Key(JToken.FromObject(preimage.GetAttributeValue<string>("wmkf_ai_promptname")??"")),"raw_published_or_legacy_write_denied");
            PublicationWire.Require(context.MessageName!="Delete","raw_prompt_delete_denied");
        }
        var allowed=DefinitionColumns.Concat(CatalogColumns).Concat(new[]{"wmkf_ai_draftbaseline"}).ToArray();
        if(context.MessageName=="Create")allowed=allowed.Concat(new[]{PromptRows.PrimaryId,"wmkf_ai_promptname","wmkf_ai_promptstatus","wmkf_ai_iscurrent","wmkf_promptversion"}).ToArray();
        PublicationWire.Require(target.Attributes.Keys.All(k=>allowed.Contains(k,StringComparer.Ordinal)),"raw_prompt_attribute_denied");
        // Published metadata requires a separate transactional audited operation;
        // until supplied, it denies along with all published/legacy raw edits.
    }
}
