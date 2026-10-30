// Real production rules through the fake SDK. Reflection constructs immutable
// metadata fixtures only; no test stub is substituted into production rules.
using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Metadata;
using Newtonsoft.Json.Linq;
using Wmkf.PromptPublication;
internal static class ProductionChecks
{
    private static int count;
    private static void Check(bool v,string label){if(!v)throw new Exception(label);count++;}
    private static void Deny(Action action,string code){try{action();}catch(Exception e){Check(e.Message==code,"wrong error "+code+": "+e);return;}throw new Exception("accepted "+code);}
    private static void Set(object target,string name,object value)=>target.GetType().GetProperty(name)!.SetValue(target,value);
    internal static void Metadata(EntityMetadata e,string table)
    {
        Set(e,"IsOptimisticConcurrencyEnabled",true);e.OwnershipType=OwnershipTypes.OrganizationOwned;var fields=new List<AttributeMetadata>();
        void Add(AttributeMetadata a){a.IsValidForCreate=true;a.IsValidForUpdate=true;Set(a,"IsValidForRead",true);fields.Add(a);}
        void Str(string name,int length)=>Add(new StringAttributeMetadata{LogicalName=name,MaxLength=length});
        void Memo(string name,int length)=>Add(new MemoAttributeMetadata{LogicalName=name,MaxLength=length});
        void Int(string name,int min=0)=>Add(new IntegerAttributeMetadata{LogicalName=name,MinValue=min,MaxValue=int.MaxValue});
        string? key=null;
        if(table==PromptRows.Table)
        {
            Str("wmkf_ai_promptname",850);Int("wmkf_promptversion",1);Add(new BooleanAttributeMetadata{LogicalName="wmkf_ai_iscurrent"});
            var status=new PicklistAttributeMetadata{LogicalName="wmkf_ai_promptstatus",OptionSet=new OptionSetMetadata()};foreach(var v in new[]{682090000,682090001,682090002})status.OptionSet.Options.Add(new OptionMetadata(new Label("state",1033),v));Add(status);
            Add(new DateTimeAttributeMetadata{LogicalName="wmkf_ai_publisheddatetime",Format=DateTimeFormat.DateAndTime});
            Str("wmkf_ai_displaytitle",200);Memo("wmkf_ai_description",4000);Str("wmkf_ai_groupkey",80);Str("wmkf_ai_sectionkey",80);Memo("wmkf_ai_usedby",4000);Str("wmkf_ai_usagecategory",40);Memo("wmkf_ai_draftbaseline",16000);
            foreach(var name in PublicationWriteGuard.DefinitionColumns.Take(4))Memo(name,1000000);Str("wmkf_ai_model",100);Int("wmkf_ai_maxtokens",1);Add(new DecimalAttributeMetadata{LogicalName="wmkf_ai_temperature",MinValue=0,MaxValue=1});
        }
        if(table==PublicationSdkStore.HeadTable)
        {key=PublicationSdkStore.HeadHash;Str(key,64);Str(PublicationSdkStore.PromptKey,850);Str(PublicationSdkStore.OriginalKey,850);Str(PublicationSdkStore.HeadRevision,19);Int(PublicationSdkStore.HighWater);Int(PublicationSdkStore.CurrentVersion,1);Add(new LookupAttributeMetadata{LogicalName=PublicationSdkStore.CurrentPrompt,Targets=new[]{PromptRows.Table}});}
        if(table==PublicationSdkStore.ReceiptTable){key=PublicationSdkStore.RequestId;Str(key,36);Memo(PublicationSdkStore.Payload,65536);}
        if(table==ProductionPublicationRules.Settings){key=ProductionPublicationRules.Key;Str(key,255);Memo(ProductionPublicationRules.Value,100000);}
        Set(e,"Attributes",fields.ToArray());if(key!=null){var k=new EntityKeyMetadata{LogicalName=key+"_key",KeyAttributes=new[]{key}};Set(k,"EntityKeyIndexStatus",EntityKeyIndexStatus.Active);Set(e,"Keys",new[]{k});}
    }
    private static void Setting(MemorySdk memory,string key,string value)
    {var row=new Entity(ProductionPublicationRules.Settings,Guid.NewGuid()){RowVersion="700"};row[ProductionPublicationRules.Key]=key;row[ProductionPublicationRules.Value]=value;memory.Rows[row.Id]=row;}
    internal static (PublicationSdkStore store,MemorySdk memory,ProductionPublicationRules rules) Session(JObject request,JObject snapshot)
    {
        var s=PublisherChecks.Session(request,snapshot);s.memory.ConfigureMetadata=Metadata;
        Setting(s.memory,ProductionPublicationRules.Groups,"{\"schemaVersion\":1,\"groups\":[{\"key\":\"reviews\",\"label\":\"Reviews\",\"order\":10,\"sections\":[]}]}");
        Setting(s.memory,ProductionPublicationRules.BudgetControl,"{\"schemaVersion\":1,\"revision\":\"0\",\"policyRevision\":1,\"policyArtifactHash\":\""+new string('a',64)+"\"}");
        var context=s.memory.Context;var sdk=new TransactionSdk(context,new ServiceFactory(s.memory),context.OrganizationId,s.memory.Authority);
        return(s.store,s.memory,new ProductionPublicationRules(sdk,s.memory,context.OrganizationId,true));
    }
    private static JObject NamedDefinition(string name)
    {
        var c=PinnedPolicy.Read()["consumerContracts"]![name]!;var vars=CanonicalJson.Parse(c["variablesJson"]!.Value<string>()!);
        return new JObject{["name"]=name,["systemPrompt"]=c["systemExact"]?.DeepClone()??string.Join("\n",((JArray)c["systemIncludes"]!).Select(v=>v.Value<string>())),["body"]=PublicationWire.Null(c["body"])?string.Join("\n",((JArray)vars["variables"]!).Select(v=>"{{"+v["name"]!.Value<string>()+"}}")):c["body"]!.DeepClone(),["variables"]=c["variablesJson"]!.DeepClone(),["outputSchema"]=c["outputJson"]!.DeepClone(),["model"]=PublicationWire.Text(CanonicalJson.Parse(c["outputJson"]!.Value<string>()!)["generationMode"])=="native-json-schema"?"claude-sonnet-5":"sonnet",["temperature"]=0.2,["maxTokens"]=PublicationWire.Null(c["rowMaxTokens"])?8000:c["rowMaxTokens"]!.DeepClone()};
    }
    public static int Run(JObject fixture,string fixturePath)
    {
        var snapshot=(JObject)fixture["snapshot"]!["input"]!.DeepClone();var request=(JObject)fixture["requests"]![0]!["input"]!.DeepClone();
        var s=Session(request,snapshot);var result=PublicationPublisher.Publish(PublicationWire.Json(request),s.store,s.rules);
        Check(!result["replayed"]!.Value<bool>(),"production generic publish, no test rules");Check(!s.memory.Calls.Contains("budget-fence")&&s.memory.Calls.Contains("catalog-fence"),"generic skips budget only by registry, takes catalog fence");
        foreach(var mutation in new[]{"key","column","ownership","lookup","concurrency"})
        {
            var bad=Session(request,snapshot);bad.memory.ConfigureMetadata=(e,t)=>{Metadata(e,t);if(t==PublicationSdkStore.HeadTable){if(mutation=="key")Set(e,"Keys",Array.Empty<EntityKeyMetadata>());if(mutation=="column")Set(e,"Attributes",e.Attributes.Where(a=>a.LogicalName!=PublicationSdkStore.HighWater).ToArray());if(mutation=="ownership")e.OwnershipType=OwnershipTypes.UserOwned;if(mutation=="lookup")((LookupAttributeMetadata)e.Attributes.Single(a=>a.LogicalName==PublicationSdkStore.CurrentPrompt)).Targets=new[]{"systemuser"};if(mutation=="concurrency")Set(e,"IsOptimisticConcurrencyEnabled",false);}};
            var code=mutation=="key"?"publication_unique_key_not_active":mutation=="column"?"publication_column_missing":mutation=="ownership"?"publication_table_must_be_organization_owned":mutation=="lookup"?"publication_lookup_incompatible":"publication_table_incompatible";
            Deny(()=>PublicationPublisher.Publish(PublicationWire.Json(request),bad.store,bad.rules),code);Check(bad.memory.Mutations==0,"schema before mutation "+mutation);
        }
        // Historical replay deliberately survives today's broken schema/policy.
        s.memory.ConfigureMetadata=(e,t)=>{};var old=(JObject)request.DeepClone();old["policyRevision"]=1;old["policyArtifactHash"]=new string('b',64);
        var historical=(JObject)result["receipt"]!.DeepClone();historical["request"]=old;historical["requestFingerprint"]=PublicationWire.Fingerprint(old,(JObject)historical["actor"]!);
        s.memory.Rows.Values.Single(e=>e.LogicalName==PublicationSdkStore.ReceiptTable)[PublicationSdkStore.Payload]=PublicationWire.Json(historical);
        Check(PublicationPublisher.Publish(PublicationWire.Json(old),s.store,s.rules)["replayed"]!.Value<bool>(),"historical replay before schema/installed policy");
        var governed=(JObject)snapshot.DeepClone();governed["definition"]=NamedDefinition("review-synthesis.generate");var governedRequest=(JObject)request.DeepClone();governedRequest["promptKey"]="review-synthesis.generate";governedRequest["snapshotHash"]=CanonicalJson.Hash("wmkf.prompt.snapshot.v1",PublicationWire.Json(governed));
        var governedSession=Session(governedRequest,governed);PublicationPublisher.Publish(PublicationWire.Json(governedRequest),governedSession.store,governedSession.rules);
        Check(governedSession.memory.Calls.IndexOf("budget-fence")<governedSession.memory.Calls.IndexOf("head-create"),"production original budget before head");
        var control=CanonicalJson.Parse(governedSession.memory.Rows.Values.Single(e=>e.GetAttributeValue<string>(ProductionPublicationRules.Key)==ProductionPublicationRules.BudgetControl).GetAttributeValue<string>(ProductionPublicationRules.Value));Check(control["revision"]!.Value<string>()=="1"&&control["policyRevision"]!.Value<int>()==5,"budget revision advanced, no upgrade reset");
        foreach(var scenario in new[]{"missing-control","future","unsupported-time","bad-model-budget","catalog-missing","catalog-removed","catalog-duplicate","budget-fault","catalog-fault","catalog-no-version-change"})
        {
            var bad=Session(governedRequest,governed);var group=bad.memory.Rows.Values.Single(e=>e.GetAttributeValue<string>(ProductionPublicationRules.Key)==ProductionPublicationRules.Groups);
            if(scenario=="missing-control")bad.memory.Rows.Remove(bad.memory.Rows.Values.Single(e=>e.GetAttributeValue<string>(ProductionPublicationRules.Key)==ProductionPublicationRules.BudgetControl).Id);
            if(scenario=="future")Setting(bad.memory,ProductionPublicationRules.BudgetPrefix+"000001","{\"schemaVersion\":2}");
            if(scenario=="unsupported-time")Setting(bad.memory,ProductionPublicationRules.BudgetPrefix+"000001",PublicationWire.Json(new JObject{["schemaVersion"]=1,["version"]=1,["requestId"]=Guid.NewGuid().ToString(),["publishedAt"]="13:00",["budgets"]=new BudgetRules().Defaults()}));
            if(scenario=="bad-model-budget")
            {var d=(JObject)governed.DeepClone();d["definition"]!["model"]="claude-haiku-4-5-20251001";var budgets=new BudgetRules().Defaults();budgets["review-synthesis.generate"]!["ceiling"]=100000;var envelope=new JObject{["schemaVersion"]=1,["version"]=1,["requestId"]=Guid.NewGuid().ToString(),["publishedAt"]="2026-10-30T00:00:00.000Z",["budgets"]=budgets};Setting(bad.memory,ProductionPublicationRules.BudgetPrefix+"000001",PublicationWire.Json(envelope));bad.memory.Rows[Guid.Parse(governedRequest["draftId"]!.Value<string>()!)]["wmkf_ai_model"]="claude-haiku-4-5-20251001";var changed=(JObject)governedRequest.DeepClone();changed["snapshotHash"]=CanonicalJson.Hash("wmkf.prompt.snapshot.v1",PublicationWire.Json(d));Deny(()=>PublicationPublisher.Publish(PublicationWire.Json(changed),bad.store,bad.rules),"budget_model_conflict");continue;}
            if(scenario=="catalog-missing")bad.memory.Rows.Remove(group.Id);if(scenario=="catalog-removed")group[ProductionPublicationRules.Value]="{\"schemaVersion\":1,\"groups\":[]}";
            if(scenario=="catalog-duplicate"){var data=(JObject)CanonicalJson.Parse(group.GetAttributeValue<string>(ProductionPublicationRules.Value));((JArray)data["groups"]!).Add(data["groups"]![0]!.DeepClone());group[ProductionPublicationRules.Value]=PublicationWire.Json(data);}
            if(scenario=="catalog-no-version-change")bad.memory.KeepCatalogVersion=true;
            if(scenario=="budget-fault")bad.memory.Fault="budget-fence";if(scenario=="catalog-fault")bad.memory.Fault="catalog-fence";
            var code=scenario=="missing-control"||scenario=="catalog-missing"?"setting_missing_duplicate_or_invalid":scenario=="future"||scenario=="unsupported-time"?"unsupported_budget_state":scenario=="catalog-removed"?"invalid_catalog_assignment":scenario=="catalog-duplicate"?"invalid_group_catalog":scenario=="budget-fault"?"budget-fence":scenario=="catalog-no-version-change"?"invalid_catalog_fence_result":"catalog-fence";
            Deny(()=>PublicationPublisher.Publish(PublicationWire.Json(governedRequest),bad.store,bad.rules),code);Check(!bad.memory.Rows.Values.Any(e=>e.LogicalName==PublicationSdkStore.ReceiptTable),"no receipt after rule failure "+scenario);
        }
        ExtraRuleChecks(request,snapshot,governedRequest,governed,s,result);
        var repo=Path.GetFullPath(Path.Combine(Path.GetDirectoryName(fixturePath)!,"../../.."));var manifest=JObject.Parse(File.ReadAllText(Path.Combine(repo,"dataverse/prompt-publication/registration/manifest.json")));
        Check(manifest["customApi"]!["uniqueName"]!.Value<string>()==ReleaseBindings.ApiMessage&&manifest["customApi"]!["pluginType"]!.Value<string>()==typeof(PublishPromptPlugin).FullName&&manifest["guard"]!["pluginType"]!.Value<string>()==typeof(PromptPublicationGuardPlugin).FullName,"manifest matches actual IPlugin types/message");
        Check(manifest["customApi"]!["request"]!["name"]!.Value<string>()==ReleaseBindings.RequestParameter&&manifest["customApi"]!["response"]!["name"]!.Value<string>()==ReleaseBindings.ResponseParameter&&manifest["guard"]!["preimageAlias"]!.Value<string>()==ReleaseBindings.Preimage,"manifest matches actual parameter/image contracts");
        Check(((JArray)manifest["guard"]!["tables"]![PublicationSdkStore.HeadTable]!).Select(v=>v.Value<string>()).OrderBy(v=>v,StringComparer.Ordinal).SequenceEqual(PublicationSdkStore.HeadColumns.OrderBy(v=>v,StringComparer.Ordinal)),"manifest covers every native head preimage field");
        PluginChecks(request,snapshot);return count;
    }
    private static void ExtraRuleChecks(JObject request,JObject snapshot,JObject governedRequest,JObject governed,(PublicationSdkStore store,MemorySdk memory,ProductionPublicationRules rules) prior,JObject priorResult)
    {
        var bomSnapshot=(JObject)snapshot.DeepClone();bomSnapshot["catalog"]!["title"]="\ufeff";var bomRequest=(JObject)request.DeepClone();bomRequest["snapshotHash"]=CanonicalJson.Hash("wmkf.prompt.snapshot.v1",PublicationWire.Json(bomSnapshot));
        var bom=Session(bomRequest,bomSnapshot);Deny(()=>PublicationPublisher.Publish(PublicationWire.Json(bomRequest),bom.store,bom.rules),"new_catalog_incomplete");
        // A newer invalid GUID must NOT hide an older incompatible budget.
        var lower=(JObject)governed.DeepClone();lower["definition"]!["model"]="claude-haiku-4-5-20251001";var lowerRequest=(JObject)governedRequest.DeepClone();lowerRequest["snapshotHash"]=CanonicalJson.Hash("wmkf.prompt.snapshot.v1",PublicationWire.Json(lower));var nel=Session(lowerRequest,lower);
        var high=new BudgetRules().Defaults();high["review-synthesis.generate"]!["ceiling"]=100000;
        var older=new JObject{["schemaVersion"]=1,["version"]=1,["requestId"]=Guid.NewGuid().ToString(),["publishedAt"]="2026-10-30T00:00:00.000Z",["budgets"]=high};
        Setting(nel.memory,ProductionPublicationRules.BudgetPrefix+"000001",PublicationWire.Json(older));var invalidNewer=(JObject)older.DeepClone();invalidNewer["version"]=2;invalidNewer["requestId"]="\u0085"+Guid.NewGuid().ToString();invalidNewer["budgets"]=new BudgetRules().Defaults();Setting(nel.memory,ProductionPublicationRules.BudgetPrefix+"000002",PublicationWire.Json(invalidNewer));
        Deny(()=>PublicationPublisher.Publish(PublicationWire.Json(lowerRequest),nel.store,nel.rules),"budget_model_conflict");Check(!nel.memory.Rows.Values.Any(e=>e.LogicalName==PublicationSdkStore.ReceiptTable),"invalid NEL GUID cannot select lower budgets and authorize incompatible model");
        var malformed=Session(governedRequest,governed);var envelope=new JObject{["schemaVersion"]=1,["version"]=1,["requestId"]=Guid.NewGuid().ToString(),["publishedAt"]="2026-10-30T00:00:00.000Z",["budgets"]=new BudgetRules().Defaults()};
        Setting(malformed.memory,ProductionPublicationRules.BudgetPrefix+"000001",PublicationWire.Json(envelope));Setting(malformed.memory,ProductionPublicationRules.BudgetPrefix+"000002","{");
        var captured=malformed.rules.FenceBudgetBeforeHead(governedRequest)!;Check(captured["state"]!["currentVersion"]!.Value<int>()==1&&captured["state"]!["latestRevision"]!.Value<int>()==2&&captured["state"]!["warnings"]!.Count()==1,"malformed reserved revision warns, older valid revision retained");
        var invalid=Session(governedRequest,governed);var control=invalid.memory.Rows.Values.Single(e=>e.GetAttributeValue<string>(ProductionPublicationRules.Key)==ProductionPublicationRules.BudgetControl);
        var sdk=new TransactionSdk(invalid.memory.Context,new ServiceFactory(invalid.memory),invalid.memory.Context.OrganizationId,invalid.memory.Authority);var badValue=new JObject{["schemaVersion"]=1,["revision"]="9",["policyRevision"]=PinnedPolicy.Revision,["policyArtifactHash"]=PinnedPolicy.ArtifactHash};
        Deny(()=>sdk.ConditionalUpdate(new Entity(ProductionPublicationRules.Settings,control.Id){[ProductionPublicationRules.Value]=PublicationWire.Json(badValue)},TransactionSdk.WeakEtag(control.RowVersion)),"invalid_coordinated_setting_value");Check(invalid.memory.Mutations==0,"trusted budget wrong-next revision cannot write");
        var noImageVersion=Session(governedRequest,governed);
        noImageVersion.memory.GuardHook=(child,target,image)=>
        {
            Entity? withoutVersion=null;if(image!=null){withoutVersion=new Entity(image.LogicalName,image.Id);foreach(var a in image.Attributes)withoutVersion[a.Key]=a.Value;}
            if(child.PrimaryEntityName==ProductionPublicationRules.Settings)SettingsWriteGuard.Assert(child,target,withoutVersion,noImageVersion.memory.Authority!);
            else PublicationWriteGuard.Assert(child,target,withoutVersion,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,noImageVersion.memory.Authority);
        };
        Check(!PublicationPublisher.Publish(PublicationWire.Json(governedRequest),noImageVersion.store,noImageVersion.rules)["replayed"]!.Value<bool>(),"complete preimages need no RowVersion property; original target token is used");
        var nextRequest=(JObject)request.DeepClone();nextRequest["requestId"]=Guid.NewGuid().ToString();nextRequest["draftId"]=Guid.NewGuid().ToString();nextRequest["draftEtag"]="W/\"77\"";nextRequest["expectedHeadRevision"]="1";nextRequest["expectedCurrent"]=priorResult["receipt"]!["published"]!.DeepClone();
        var nextSnapshot=(JObject)snapshot.DeepClone();nextSnapshot["catalog"]!["groupKey"]="old-group";nextRequest["metadataBaseline"]=new JObject{["schemaVersion"]=1,["headRevision"]="1",["current"]=new JObject{["id"]=request["draftId"]!.DeepClone(),["etag"]=priorResult["receipt"]!["published"]!["etag"]!.DeepClone()},["catalog"]=nextSnapshot["catalog"]!.DeepClone()};nextRequest["snapshotHash"]=CanonicalJson.Hash("wmkf.prompt.snapshot.v1",PublicationWire.Json(nextSnapshot));
        var later=Session(nextRequest,nextSnapshot);later.memory.SetNextVersion(3000);
        foreach(var row in prior.memory.Rows.Values.Where(r=>r.LogicalName!=ProductionPublicationRules.Settings))
        {var copy=new Entity(row.LogicalName,row.Id){RowVersion=row.RowVersion};foreach(var a in row.Attributes)copy[a.Key]=a.Value;if(copy.LogicalName==PromptRows.Table)copy["wmkf_ai_groupkey"]="old-group";later.memory.Rows[copy.Id]=copy;}
        Check(PublicationPublisher.Publish(PublicationWire.Json(nextRequest),later.store,later.rules)["receipt"]!["published"]!["version"]!.Value<int>()==2,"unchanged baseline assignment preserves missing legacy group membership");
    }
    private sealed class TraceSink:ITracingService
    {public string? Message;public int Calls;public void Trace(string format,params object[] args){Message=string.Format(System.Globalization.CultureInfo.InvariantCulture,format,args);Calls++;}}
    private sealed class Services(IPluginExecutionContext context,IOrganizationServiceFactory factory,ITracingService? tracing=null):IServiceProvider
    {public object? GetService(Type type)=>type==typeof(IPluginExecutionContext)?context:type==typeof(IOrganizationServiceFactory)?factory:type==typeof(ITracingService)?tracing:null;}
    private static JObject Binding(MemorySdk memory,bool enabled=true)=>new(){["bindingVersion"]=1,["enabled"]=enabled,["organizationId"]=memory.Context.OrganizationId.ToString(),["publisherExtensionId"]=memory.Context.OwningExtension.Id.ToString(),["publisherIds"]=new JArray(memory.Context.UserId.ToString()),["initiatingPrincipalIds"]=new JArray(memory.Context.InitiatingUserId.ToString()),["executePrivilege"]="prvCreateReceipt"};
    private static void Parameters(IPluginExecutionContext context,JObject request)
    {var v=((ContextProxy)context).Values;v["InputParameters"]=new ParameterCollection{[ReleaseBindings.RequestParameter]=PublicationWire.Json(request)};v["OutputParameters"]=new ParameterCollection();}
    private static void PluginChecks(JObject request,JObject snapshot)
    {
        var s=Session(request,snapshot);var context=s.memory.Context;Parameters(context,request);var factory=new ServiceFactory(s.memory);var provider=new Services(context,factory);
        Deny(()=>new PublishPromptPlugin().Execute(provider),"release_bindings_incomplete");Check(s.memory.Calls.Count==0,"packaged disabled template fails before SDK calls");
        var trace=new TraceSink();context.InputParameters[ReleaseBindings.RequestParameter]="DO_NOT_TRACE_PROMPT_CONTENT";
        Deny(()=>new PublishPromptPlugin().Execute(new Services(context,factory,trace)),"release_bindings_incomplete");
        Check(trace.Calls==1&&trace.Message!.StartsWith("PR553_BOOTSTRAP_CONTEXT ",StringComparison.Ordinal)&&!trace.Message.Contains("DO_NOT_TRACE_PROMPT_CONTENT"),"bootstrap emits only content-free context");
        var observed=CanonicalJson.Parse(trace.Message!.Substring("PR553_BOOTSTRAP_CONTEXT ".Length));
        Check(observed["organizationId"]!.Value<string>()==context.OrganizationId.ToString()&&observed["extensionId"]!.Value<string>()==context.OwningExtension.Id.ToString()&&observed["extensionLogicalName"]!.Value<string>()==context.OwningExtension.LogicalName&&observed["isInTransaction"]!.Value<bool>()&&observed["stage"]!.Value<int>()==30,"bootstrap context reflects actual trusted SDK context");
        Check(s.memory.Calls.Count==0&&s.memory.Mutations==0,"bootstrap observation cannot obtain SDK service or mutate");Parameters(context,request);
        var binding=Binding(s.memory);var bindings=ReleaseBindings.Parse(PublicationWire.Json(binding));
        Check(!bindings.IsUnboundPreparation,"bound enabled bindings never activate bootstrap observation");
        var boundDisabled=(JObject)binding.DeepClone();boundDisabled["enabled"]=false;Check(!ReleaseBindings.Parse(PublicationWire.Json(boundDisabled)).IsUnboundPreparation,"bound disabled replay path never activates bootstrap observation");
        s.memory.GuardHook=(child,target,preimage)=>
        {
            var v=((ContextProxy)child).Values;v["InputParameters"]=new ParameterCollection{["Target"]=target};v["PreEntityImages"]=new EntityImageCollection();
            if(preimage!=null)((EntityImageCollection)v["PreEntityImages"])[ReleaseBindings.Preimage]=preimage;
            PluginInvocation.Guard(new Services(child,factory),bindings);
        };
        PluginInvocation.Publish(provider,bindings);var output=CanonicalJson.Parse((string)context.OutputParameters[ReleaseBindings.ResponseParameter]);Check(output["receipt"]!["published"]!["version"]!.Value<int>()==1&&s.memory.Guards==6,"bound production plugin composition and guard wrapper, generic publish");
        // Disable new publication while retaining authorized historical replay.
        binding["enabled"]=false;var disabled=ReleaseBindings.Parse(PublicationWire.Json(binding));PluginInvocation.Publish(provider,disabled);Check(CanonicalJson.Parse((string)context.OutputParameters[ReleaseBindings.ResponseParameter])["replayed"]!.Value<bool>(),"disabled writer still returns authorized old receipt");
        foreach(var scenario in new[]{"disabled","initiator","wrong-extension","wrong-org","extra-input","async","missing-image","raw-control","protected-delete","wrong-table"})
        {
            var bad=Session(request,snapshot);var c=bad.memory.Context;Parameters(c,request);var b=Binding(bad.memory);var p=new Services(c,new ServiceFactory(bad.memory));var v=((ContextProxy)c).Values;
            if(scenario=="disabled")b["enabled"]=false;if(scenario=="initiator")b["initiatingPrincipalIds"]=new JArray(Guid.NewGuid().ToString());if(scenario=="wrong-extension")b["publisherExtensionId"]=Guid.NewGuid().ToString();if(scenario=="wrong-org")b["organizationId"]=Guid.NewGuid().ToString();if(scenario=="extra-input")c.InputParameters["force"]=true;if(scenario=="async")v["Mode"]=1;
            var finalBindings=ReleaseBindings.Parse(PublicationWire.Json(b));
            if(scenario=="missing-image"||scenario=="raw-control"||scenario=="protected-delete"||scenario=="wrong-table")
            {
                var child=MemorySdk.Child(c,scenario=="missing-image"?"Update":scenario=="protected-delete"?"Delete":"Create",scenario=="missing-image"?PromptRows.Table:scenario=="wrong-table"?"unrelated_table":ProductionPublicationRules.Settings);var values=((ContextProxy)child).Values;values["InputParameters"]=new ParameterCollection{["Target"]=new Entity(child.PrimaryEntityName,Guid.NewGuid()){[ProductionPublicationRules.Key]=ProductionPublicationRules.Groups,[ProductionPublicationRules.Value]="{}"}};values["PreEntityImages"]=new EntityImageCollection();
                if(scenario=="protected-delete"){var row=bad.memory.Rows.Values.Single(e=>e.GetAttributeValue<string>(ProductionPublicationRules.Key)==ProductionPublicationRules.Groups);((ParameterCollection)values["InputParameters"])["Target"]=new EntityReference(ProductionPublicationRules.Settings,row.Id);((EntityImageCollection)values["PreEntityImages"])[ReleaseBindings.Preimage]=row;}
                Deny(()=>PluginInvocation.Guard(new Services(child,new ServiceFactory(bad.memory)),finalBindings),scenario=="missing-image"?"guard_preimage_required":scenario=="wrong-table"?"guard_registration_table_mismatch":"raw_coordinated_setting_write_denied");
            }
            else Deny(()=>PluginInvocation.Publish(p,finalBindings),scenario=="disabled"?"publication_disabled":scenario=="initiator"?"publication_actor_not_bound":scenario=="wrong-extension"?"publication_registration_mismatch":scenario=="extra-input"?"invalid_plugin_request":"plugin_target_or_transaction_mismatch");
            Check(bad.memory.Mutations==0,"plugin denial before writes "+scenario);
        }
    }

}
