// Real SDK persistence composition; proposed solution names, NOT deployed schema.
// Head/receipt rows must be OrganizationOwned, concurrency enabled, and their
// required key indexes Active before constructing/enabling a registered entry.
// All exceptions escape to the platform. No HTTP, retry, batch or SYSTEM client.
using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json.Linq;

namespace Wmkf.PromptPublication;

public sealed class PublicationSdkStore : IPublicationStore
{
    public const string HeadTable="wmkf_promptpublicationhead",ReceiptTable="wmkf_promptpublicationreceipt";
    public const string Payload="wmkf_payload",HeadHash="wmkf_keyhash",RequestId="wmkf_requestid";
    public const string PromptKey="wmkf_promptkey",OriginalKey="wmkf_originalkey",HeadRevision="wmkf_revision",HighWater="wmkf_highwaterversion",CurrentPrompt="wmkf_currentprompt",CurrentVersion="wmkf_currentversion";
    public static readonly string[] HeadColumns={HeadHash,PromptKey,OriginalKey,HeadRevision,HighWater,CurrentPrompt,CurrentVersion};
    private readonly TransactionSdk sdk;
    private readonly PublisherAuthorization authorization;
    private readonly PromptRows prompts;
    public PublicationSdkStore(IPluginExecutionContext context,IOrganizationServiceFactory factory,Guid expectedOrganizationId,PublisherAuthorization authorization,PublicationWriteAuthority authority)
    {this.authorization=authorization??throw new ArgumentNullException(nameof(authorization));if(authority==null)throw new InvalidOperationException("trusted_write_authority_required");sdk=new TransactionSdk(context,factory,expectedOrganizationId,authority);prompts=new PromptRows(sdk);}
    public JObject Authorize()
    {
        sdk.AssertContext();var actor=authorization.Authorize();
        PublicationWire.Require(PublicationWire.Text(actor["organizationId"])==sdk.OrganizationId.ToString()&&PublicationWire.Text(actor["initiatingUserId"])==sdk.InitiatingUserId.ToString()&&PublicationWire.Text(actor["effectiveUserId"])==sdk.EffectiveUserId.ToString(),"publisher_actor_binding_mismatch");return actor;
    }
    public void AssertTransaction()=>sdk.AssertContext();
    private Entity? Unique(string table,string field,string value)
    {
        var query=new QueryExpression(table){ColumnSet=new ColumnSet(table==HeadTable?HeadColumns:new[]{field,Payload})};query.Criteria.AddCondition(field,ConditionOperator.Equal,value);
        var rows=sdk.ReadAll(query,table+"id");PublicationWire.Require(rows.Count<=1,"duplicate_publication_control");
        if(rows.Count==0)return null;var row=rows[0];PublicationWire.Require(row.GetAttributeValue<string>(field)==value,"publication_control_identity_mismatch");return row;
    }
    public string? ReadReceipt(string requestId)
    {
        var row=Unique(ReceiptTable,RequestId,requestId);if(row==null)return null;
        var text=row.GetAttributeValue<string>(Payload);PublicationWire.Require(text!=null,"invalid_publication_receipt_row");var receipt=PublicationWire.Receipt(text!);
        PublicationWire.Require(PublicationWire.Text(receipt["request"]!["requestId"])==requestId,"invalid_publication_receipt_row");return text;
    }
    internal static JObject HeadState(Entity row)
    {
        var reference=row.GetAttributeValue<EntityReference>(CurrentPrompt);
        var version=Value(row,CurrentVersion);
        PublicationWire.Require(reference==null?PublicationWire.Null(version):reference.LogicalName==PromptRows.Table&&reference.Id!=Guid.Empty&&reference.KeyAttributes.Count==0&&PublicationWire.Integer(version,1,int.MaxValue),"invalid_publication_head_current");
        return new JObject{["keyHash"]=Value(row,HeadHash),["key"]=Value(row,PromptKey),["originalKey"]=Value(row,OriginalKey),["revision"]=Value(row,HeadRevision),["highWaterVersion"]=Value(row,HighWater),["current"]=reference==null?JValue.CreateNull():new JObject{["id"]=reference.Id.ToString(),["version"]=version}};
    }
    private static JObject Head(Entity row)
    {var head=HeadState(row);head["etag"]=TransactionSdk.WeakEtag(row.RowVersion);return head;}
    public JObject? ReadHead(string keyHash) {var row=Unique(HeadTable,HeadHash,keyHash);return row==null?null:Head(row);}
    public JObject CreateHead(JObject head)
    {
        PublicationWire.Shape(head,"keyHash","key","originalKey","revision","highWaterVersion","current");
        PublicationWire.Require(PublicationWire.Null(head["current"]),"initial_head_current_must_be_null");
        var id=sdk.CreateOnly(new Entity(HeadTable){[HeadHash]=PublicationWire.Text(head["keyHash"]),[PromptKey]=PublicationWire.Text(head["key"]),[OriginalKey]=PublicationWire.Text(head["originalKey"]),[HeadRevision]=PublicationWire.Text(head["revision"]),[HighWater]=head["highWaterVersion"]!.Value<int>(),[CurrentPrompt]=null,[CurrentVersion]=null});
        return Head(sdk.ReadById(HeadTable,id,HeadColumns));
    }
    private Entity HeadRow(JObject head)
    {
        var row=Unique(HeadTable,HeadHash,PublicationWire.Text(head["keyHash"])!)??throw new InvalidOperationException("missing_publication_head");
        // Do not refresh the original condition after validation.
        PublicationWire.Require(TransactionSdk.WeakEtag(row.RowVersion)==PublicationWire.Text(head["etag"])&&PublicationWire.Equal(Head(row),head),"publication_conflict");return row;
    }
    public JObject FenceHead(JObject head,string nextRevision)
    {
        PublicationWire.Require(nextRevision==PublicationWire.Increment(head["revision"]),"invalid_head_fence");var row=HeadRow(head);
        sdk.ConditionalUpdate(new Entity(HeadTable,row.Id){[HeadRevision]=nextRevision},PublicationWire.Text(head["etag"])!);
        return Head(sdk.ReadById(HeadTable,row.Id,HeadColumns));
    }
    public void FinishHead(JObject fenced,JObject current,int highWaterVersion)
    {
        var row=HeadRow(fenced);PublicationWire.Shape(current,"id","version");
        sdk.ConditionalUpdate(new Entity(HeadTable,row.Id){[CurrentPrompt]=new EntityReference(PromptRows.Table,Guid.Parse(PublicationWire.Text(current["id"])!)),[CurrentVersion]=current["version"]!.Value<int>(),[HighWater]=highWaterVersion},PublicationWire.Text(fenced["etag"])!);
    }
    private static JToken Value(Entity row,string column)
    {
        if(!row.Attributes.TryGetValue(column,out var value)||value==null)return JValue.CreateNull();
        if(value is OptionSetValue option)return new JValue(option.Value);
        PublicationWire.Require(value is string||value is bool||value is int||value is double||value is decimal,"invalid_prompt_column_type");return JToken.FromObject(value);
    }
    private static JObject Catalog(Entity row)
    {var keys=new[]{"title","description","groupKey","sectionKey","usedBy","usageCategory"};var result=new JObject();for(var i=0;i<keys.Length;i++)result[keys[i]]=Value(row,PublicationWriteGuard.CatalogColumns[i]);PublicationWire.Catalog(result);return result;}
    private static JObject Inventory(Entity row)=>new(){["id"]=row.Id.ToString(),["name"]=Value(row,"wmkf_ai_promptname"),["version"]=Value(row,"wmkf_promptversion"),["etag"]=TransactionSdk.WeakEtag(row.RowVersion),["status"]=Value(row,"wmkf_ai_promptstatus"),["isCurrent"]=Value(row,"wmkf_ai_iscurrent"),["catalog"]=Catalog(row)};
    public JArray ReadInventory(string key)
    {
        var query=new QueryExpression(PromptRows.Table){ColumnSet=new ColumnSet(new[]{"wmkf_ai_promptname","wmkf_promptversion","wmkf_ai_promptstatus","wmkf_ai_iscurrent"}.Concat(PublicationWriteGuard.CatalogColumns).ToArray())};
        query.Criteria.AddCondition("wmkf_ai_promptname",ConditionOperator.Equal,key);return new JArray(sdk.ReadAll(query,PromptRows.PrimaryId).Select(Inventory));
    }
    public JObject ReadDraft(string id)
    {
        var columns=new[]{"wmkf_ai_promptname","wmkf_promptversion","wmkf_ai_promptstatus","wmkf_ai_iscurrent","wmkf_ai_draftbaseline"}.Concat(PublicationWriteGuard.DefinitionColumns).Concat(PublicationWriteGuard.CatalogColumns).ToArray();
        var row=sdk.ReadById(PromptRows.Table,Guid.Parse(id),columns);var result=Inventory(row);result.Remove("catalog");
        var definition=new JObject{["name"]=Value(row,"wmkf_ai_promptname")};var keys=new[]{"systemPrompt","body","variables","outputSchema","model","temperature","maxTokens"};for(var i=0;i<keys.Length;i++)definition[keys[i]]=Value(row,PublicationWriteGuard.DefinitionColumns[i]);
        result["snapshot"]=new JObject{["definitionFormatVersion"]=1,["definition"]=definition,["catalog"]=Catalog(row)};
        result["metadataBaseline"]=CanonicalJson.Parse(row.GetAttributeValue<string>("wmkf_ai_draftbaseline")??throw new InvalidOperationException("draft_baseline_reconciliation_required"));return result;
    }
    public JObject PromoteDraft(string id,string etag,int version,DateTime utc)
    {
        prompts.PromoteDraft(Guid.Parse(id),etag,version,utc);var row=sdk.ReadById(PromptRows.Table,Guid.Parse(id),"wmkf_promptversion","wmkf_ai_promptstatus","wmkf_ai_iscurrent","wmkf_ai_publisheddatetime","wmkf_ai_draftbaseline");
        PublicationWire.Require(row.GetAttributeValue<int>("wmkf_promptversion")==version&&row.GetAttributeValue<OptionSetValue>("wmkf_ai_promptstatus")?.Value==682090001&&row.GetAttributeValue<bool>("wmkf_ai_iscurrent")
            &&row.GetAttributeValue<DateTime>("wmkf_ai_publisheddatetime").Kind==DateTimeKind.Utc&&row.GetAttributeValue<DateTime>("wmkf_ai_publisheddatetime")==utc&&(!row.Attributes.TryGetValue("wmkf_ai_draftbaseline",out var baseline)||baseline==null),"invalid_publication_result");
        return new JObject{["id"]=id,["version"]=version,["etag"]=TransactionSdk.WeakEtag(row.RowVersion)};
    }
    public void ClearPrevious(string id,string etag)=>prompts.ClearPrevious(Guid.Parse(id),etag);
    public void CreateReceipt(JObject receipt)
    {PublicationWire.Receipt(PublicationWire.Json(receipt));sdk.CreateOnly(new Entity(ReceiptTable){[RequestId]=PublicationWire.Text(receipt["request"]!["requestId"]),[Payload]=PublicationWire.Json(receipt)});}
}
