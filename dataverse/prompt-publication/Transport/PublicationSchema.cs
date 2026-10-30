// Fresh-operation gate only, AFTER authorized historical receipt replay.
// Metadata is a prerequisite, never proof of actual transaction/role behavior.
using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Metadata;
using Newtonsoft.Json.Linq;
namespace Wmkf.PromptPublication;
public static class PublicationSchema
{
    public static void AssertReady(IOrganizationService service,Guid organization)
    {
        var report=PromptSchemaPreflight.Inspect(service,organization);
        PublicationWire.Require(report["optimisticConcurrency"]!.Value<bool>()&&report["fields"]!.All(f=>PublicationWire.Text(f["status"])=="compatible"),"prompt_schema_not_ready");
        EntityMetadata Read(string table)=>((RetrieveEntityResponse)service.Execute(new RetrieveEntityRequest{LogicalName=table,EntityFilters=EntityFilters.Entity|EntityFilters.Attributes,RetrieveAsIfPublished=false})).EntityMetadata;
        AttributeMetadata Field(EntityMetadata e,string name,AttributeTypeCode type,int length=0)
        {
            var candidates=e.Attributes?.Where(a=>a.LogicalName==name).ToArray();PublicationWire.Require(candidates?.Length==1,"publication_column_missing");var a=candidates![0];
            PublicationWire.Require(a.AttributeType==type&&a.IsValidForRead==true&&a.IsValidForCreate==true&&a.IsValidForUpdate==true,"publication_column_incompatible");
            if(length>0)PublicationWire.Require(a is StringAttributeMetadata text&&text.MaxLength>=length||a is MemoAttributeMetadata memo&&memo.MaxLength>=length,"publication_column_too_small");return a;
        }
        void Key(EntityMetadata e,string name)
        {PublicationWire.Require(e.Keys!=null&&e.Keys.Count(k=>k.EntityKeyIndexStatus==EntityKeyIndexStatus.Active&&k.KeyAttributes!=null&&k.KeyAttributes.SequenceEqual(new[]{name}))==1,"publication_unique_key_not_active");}
        foreach(var table in new[]{PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,ProductionPublicationRules.Settings})
        {
            var e=Read(table);PublicationWire.Require(e!=null&&e.LogicalName==table&&e.IsOptimisticConcurrencyEnabled==true,"publication_table_incompatible");
            if(table!=ProductionPublicationRules.Settings)PublicationWire.Require(e!.OwnershipType==OwnershipTypes.OrganizationOwned,"publication_table_must_be_organization_owned");
            if(table==PublicationSdkStore.HeadTable)
            {
                Field(e!,PublicationSdkStore.HeadHash,AttributeTypeCode.String,64);Key(e!,PublicationSdkStore.HeadHash);Field(e!,PublicationSdkStore.PromptKey,AttributeTypeCode.String,850);Field(e!,PublicationSdkStore.OriginalKey,AttributeTypeCode.String,850);Field(e!,PublicationSdkStore.HeadRevision,AttributeTypeCode.String,19);
                var high=(IntegerAttributeMetadata)Field(e!,PublicationSdkStore.HighWater,AttributeTypeCode.Integer);var version=(IntegerAttributeMetadata)Field(e!,PublicationSdkStore.CurrentVersion,AttributeTypeCode.Integer);
                PublicationWire.Require(high.MinValue<=0&&high.MaxValue>=int.MaxValue&&version.MinValue<=1&&version.MaxValue>=int.MaxValue,"publication_version_range_incompatible");
                var lookup=(LookupAttributeMetadata)Field(e!,PublicationSdkStore.CurrentPrompt,AttributeTypeCode.Lookup);PublicationWire.Require(lookup.Targets!=null&&lookup.Targets.SequenceEqual(new[]{PromptRows.Table}),"publication_lookup_incompatible");
            }
            else if(table==PublicationSdkStore.ReceiptTable){Field(e!,PublicationSdkStore.RequestId,AttributeTypeCode.String,36);Field(e!,PublicationSdkStore.Payload,AttributeTypeCode.Memo,65536);Key(e!,PublicationSdkStore.RequestId);}
            else {Field(e!,ProductionPublicationRules.Key,AttributeTypeCode.String,255);Field(e!,ProductionPublicationRules.Value,AttributeTypeCode.Memo,100000);Key(e!,ProductionPublicationRules.Key);}
        }
        var prompt=Read(PromptRows.Table);
        foreach(var field in PublicationWriteGuard.DefinitionColumns.Take(4))Field(prompt,field,AttributeTypeCode.Memo,1000000);
        Field(prompt,"wmkf_ai_model",AttributeTypeCode.String,100);
        var tokens=(IntegerAttributeMetadata)Field(prompt,"wmkf_ai_maxtokens",AttributeTypeCode.Integer);PublicationWire.Require(tokens.MinValue<=1&&tokens.MaxValue>=128000,"prompt_token_range_incompatible");
        var temperature=prompt.Attributes?.SingleOrDefault(a=>a.LogicalName=="wmkf_ai_temperature");PublicationWire.Require(temperature!=null&&temperature.IsValidForRead==true&&temperature.IsValidForCreate==true&&temperature.IsValidForUpdate==true&&(temperature is DecimalAttributeMetadata d&&d.MinValue<=0&&d.MaxValue>=1||temperature is DoubleAttributeMetadata n&&n.MinValue<=0&&n.MaxValue>=1),"prompt_temperature_range_incompatible");
    }
}
