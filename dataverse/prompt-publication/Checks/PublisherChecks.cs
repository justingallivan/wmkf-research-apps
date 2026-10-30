// Offline composition tests. TEST-ONLY rule stub is NOT a release validator.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;
using Microsoft.Xrm.Sdk.Metadata;
using Microsoft.Crm.Sdk.Messages;
using Newtonsoft.Json.Linq;
using Wmkf.PromptPublication;

internal static class PublisherChecks
{
    private static int count;
    private static void Check(bool value,string label){if(!value)throw new Exception(label);count++;}
    private static void Deny(Action action,string code){try{action();}catch(Exception e){Check(e.Message==code,"wrong denial "+e);return;}throw new Exception("accepted "+code);}
    private static readonly Guid Org=Guid.Parse("10000000-0000-4000-8000-000000000001"),User=Guid.Parse("10000000-0000-4000-8000-000000000002"),Initiator=Guid.Parse("10000000-0000-4000-8000-000000000003"),Extension=Guid.NewGuid();
    private static IPluginExecutionContext Context()
    {
        var c=DispatchProxy.Create<IPluginExecutionContext,ContextProxy>();var v=((ContextProxy)c).Values;
        v["OrganizationId"]=Org;v["UserId"]=User;v["InitiatingUserId"]=Initiator;v["Stage"]=30;v["Mode"]=0;v["Depth"]=1;v["IsInTransaction"]=true;v["CorrelationId"]=Guid.NewGuid();v["OwningExtension"]=new EntityReference("plugintype",Extension);v["MessageName"]="wmkf_PublishPrompt";v["SharedVariables"]=new ParameterCollection();return c;
    }
    public static int Run(JObject fixture,string fixturePath)
    {
        var matrix=(JObject)CanonicalJson.Parse(File.ReadAllText(Path.Combine(Path.GetDirectoryName(fixturePath)!,"wire-sdk-v1.json")));
        foreach(var vector in (JArray)matrix["vectors"]!)
        {
            var accepted=true;try{if(vector["kind"]!.Value<string>()=="request")PublicationWire.Request(vector["json"]!.Value<string>()!);else PublicationWire.Receipt(vector["json"]!.Value<string>()!);}catch{accepted=false;}
            Check(accepted==vector["valid"]!.Value<bool>(),"JS wire parity "+vector["label"]);
        }
        foreach(var request in (JArray)fixture["requests"]!)Check(PublicationWire.Fingerprint((JObject)request["input"]!,(JObject)request["actor"]!)==request["hash"]!.Value<string>(),"validated request fingerprint");
        foreach(var condition in new[]{"unapproved","disabled","application","accessmode","missing-flag","basic-read","no-execute","auth-fault","wrong-org","wrong-metadata","wrong-privilege","execute-binding"})
        {
            var c=Context();var memory=new MemorySdk(c);if(condition=="wrong-org")((ContextProxy)c).Values["OrganizationId"]=Guid.NewGuid();
            if(condition=="disabled")memory.Disabled=true;if(condition=="application")memory.Application=true;if(condition=="accessmode")memory.AccessMode=4;if(condition=="missing-flag")memory.MissingDisabled=true;if(condition=="basic-read")memory.GlobalRead=false;if(condition=="no-execute")memory.ExecutePrivilege=false;if(condition=="auth-fault")memory.Fault="authorization";if(condition=="wrong-metadata")memory.WrongMetadata=true;if(condition=="wrong-privilege")memory.WrongPrivilege=true;if(condition=="execute-binding")memory.ExecuteBindingMismatch=true;
            Deny(()=>new PublisherAuthorization(c,new ServiceFactory(memory),Org,new[]{condition=="unapproved"?Guid.NewGuid():User},"prvCreateReceipt").Authorize(),condition=="wrong-org"||condition=="unapproved"?"publisher_not_authorized":condition=="auth-fault"?"authorization":condition=="wrong-metadata"?"publisher_privilege_metadata_required":condition=="execute-binding"?"publisher_execute_privilege_binding_required":condition=="basic-read"||condition=="no-execute"||condition=="wrong-privilege"?"publisher_privilege_required":"publisher_human_required");
            Check(memory.Mutations==0,"auth denial never writes");
        }
        var fresh=(JObject)fixture["requests"]![0]!["input"]!.DeepClone();var snapshot=(JObject)fixture["snapshot"]!["input"]!.DeepClone();
        // A complete first-name fixture, using original memo text exactly.
        snapshot["definition"]!["name"]=fresh["promptKey"]!.DeepClone();snapshot["definition"]!["temperature"]=0.2;
        snapshot["catalog"]=new JObject{["title"]="Offline SDK fixture",["description"]="No model or tenant call",["groupKey"]="test",["sectionKey"]=JValue.CreateNull(),["usedBy"]="offline checks",["usageCategory"]="test"};
        fresh["snapshotHash"]=CanonicalJson.Hash("wmkf.prompt.snapshot.v1",PublicationWire.Json(snapshot));
        var session=Session(fresh,snapshot);var result=PublicationPublisher.Publish(PublicationWire.Json(fresh),session.store,session.rules);
        Check(!result["replayed"]!.Value<bool>()&&result["receipt"]!["published"]!["version"]!.Value<int>()==1,"SDK first publish");
        Check(session.memory.Mutations==5&&session.memory.Guards==5,"head create/fence/promotion/finish/receipt all guarded");
        var nativeHead=session.memory.Rows.Values.Single(e=>e.LogicalName==PublicationSdkStore.HeadTable);
        Check(!nativeHead.Attributes.ContainsKey(PublicationSdkStore.Payload)&&nativeHead.GetAttributeValue<EntityReference>(PublicationSdkStore.CurrentPrompt).LogicalName==PromptRows.Table&&nativeHead.GetAttributeValue<EntityReference>(PublicationSdkStore.CurrentPrompt).Id==Guid.Parse(fresh["draftId"]!.Value<string>()!)&&nativeHead.GetAttributeValue<int>(PublicationSdkStore.CurrentVersion)==1,"native head uses exact prompt lookup/version, not a JSON pointer");
        Check(session.rules.Calls.SequenceEqual(new[]{"policy","budget","fresh","catalog"}),"required rules ordered");
        // Later publish, immutable prior content and strictly higher version.
        var nextRequest=(JObject)fresh.DeepClone();nextRequest["draftId"]=Guid.NewGuid().ToString();nextRequest["requestId"]=Guid.NewGuid().ToString();nextRequest["draftEtag"]="W/\"77\"";
        nextRequest["expectedHeadRevision"]="1";nextRequest["expectedCurrent"]=result["receipt"]!["published"]!.DeepClone();
        nextRequest["metadataBaseline"]=new JObject{["schemaVersion"]=1,["current"]=new JObject{["id"]=fresh["draftId"]!.DeepClone(),["etag"]=result["receipt"]!["published"]!["etag"]!.DeepClone()},["catalog"]=snapshot["catalog"]!.DeepClone(),["headRevision"]="1"};
        var later=Session(nextRequest,snapshot);later.memory.SetNextVersion(2000);
        foreach(var entity in session.memory.Rows.Values){var copy=new Entity(entity.LogicalName,entity.Id){RowVersion=entity.RowVersion};foreach(var a in entity.Attributes)copy[a.Key]=a.Value;later.memory.Rows[entity.Id]=copy;}
        var priorBody=later.memory.Rows[Guid.Parse(fresh["draftId"]!.Value<string>()!)]["wmkf_ai_promptbody"];
        var second=PublicationPublisher.Publish(PublicationWire.Json(nextRequest),later.store,later.rules);
        Check(second["receipt"]!["published"]!["version"]!.Value<int>()==2&&second["receipt"]!["headRevision"]!.Value<string>()=="2","later publication increases version/revision");
        var previous=later.memory.Rows[Guid.Parse(fresh["draftId"]!.Value<string>()!)];Check(!previous.GetAttributeValue<bool>("wmkf_ai_iscurrent")&&Equals(previous["wmkf_ai_promptbody"],priorBody)&&previous.GetAttributeValue<int>("wmkf_promptversion")==1,"previous only loses current flag");
        var receiptJson=PublicationWire.Json(result["receipt"]!);var originalMutations=session.memory.Mutations;session.rules.Deny=true;
        var replay=PublicationPublisher.Publish(PublicationWire.Json(fresh),session.store,session.rules);
        Check(replay["replayed"]!.Value<bool>()&&PublicationWire.Equal(replay["receipt"],CanonicalJson.Parse(receiptJson))&&session.memory.Mutations==originalMutations,"authorized replay before changed policy, no restamp/write");
        var changed=(JObject)fresh.DeepClone();changed["snapshotHash"]=new string('f',64);Deny(()=>PublicationPublisher.Publish(PublicationWire.Json(changed),session.store,session.rules),"publication_request_id_reused");
        session.memory.Disabled=true;Deny(()=>PublicationPublisher.Publish(PublicationWire.Json(fresh),session.store,session.rules),"publisher_human_required");Check(session.memory.Mutations==originalMutations,"replay reauthorizes");
        foreach(var failure in new[]{"policy","budget","fresh","catalog","head-create","head-fence","promotion","head-finish","receipt"})
        {
            var s=Session(fresh,snapshot);s.rules.Fault=failure;s.memory.Fault=failure;
            Deny(()=>PublicationPublisher.Publish(PublicationWire.Json(fresh),s.store,s.rules),failure);
            Check(!s.memory.Rows.Values.Any(e=>e.LogicalName==PublicationSdkStore.ReceiptTable),"no success receipt after "+failure);
            Check(s.memory.LastFaultCount==0||s.memory.LastFaultCount==s.memory.Calls.Count,"no SDK continuation after fault "+failure);
        }
        foreach(var kind in new[]{"case-alias","wrong-current-type","reserved-version","baseline","catalog","snapshot","duplicate-version","missing-status"})
        {
            var s=Session(fresh,snapshot);var row=s.memory.Rows.Values.Single(e=>e.LogicalName==PromptRows.Table);
            if(kind=="case-alias")row["wmkf_ai_promptname"]=row.GetAttributeValue<string>("wmkf_ai_promptname").ToUpperInvariant();
            if(kind=="wrong-current-type")row["wmkf_ai_iscurrent"]="false";
            if(kind=="reserved-version")row["wmkf_promptversion"]=1;
            if(kind=="baseline")row["wmkf_ai_draftbaseline"]="{}";
            if(kind=="catalog")row["wmkf_ai_groupkey"]="changed";
            if(kind=="snapshot")row["wmkf_ai_promptbody"]="changed";
            if(kind=="missing-status")row.Attributes.Remove("wmkf_ai_promptstatus");
            if(kind=="duplicate-version"){row["wmkf_promptversion"]=1;var extra=new Entity(PromptRows.Table,Guid.NewGuid()){RowVersion="20"};foreach(var a in row.Attributes)extra[a.Key]=a.Value;s.memory.Rows[extra.Id]=extra;}
            var code=kind=="baseline"?"draft_baseline_reconciliation_required":kind=="reserved-version"?"uninitialized_publication_head":kind=="duplicate-version"?"duplicate_publication_history":kind=="catalog"||kind=="snapshot"?"snapshot_hash_mismatch":"invalid_publication_inventory";
            Deny(()=>PublicationPublisher.Publish(PublicationWire.Json(fresh),s.store,s.rules),code);Check(!s.memory.Rows.Values.Any(e=>e.LogicalName==PublicationSdkStore.ReceiptTable),"no receipt for corrupt state");
        }
        GuardChecks();return count;
    }
    private static (PublicationSdkStore store,MemorySdk memory,TestRules rules) Session(JObject request,JObject snapshot)
    {
        var context=Context();var memory=new MemorySdk(context);var authority=new PublicationWriteAuthority(Org,"wmkf_PublishPrompt",Extension);memory.Authority=authority;
        var factory=new ServiceFactory(memory);var authorization=new PublisherAuthorization(context,factory,Org,new[]{User},"prvCreateReceipt");
        var store=new PublicationSdkStore(context,factory,Org,authorization,authority);
        var row=new Entity(PromptRows.Table,Guid.Parse(request["draftId"]!.Value<string>()!)){RowVersion=TransactionSdk.RowVersion(request["draftEtag"]!.Value<string>()!)};
        row["wmkf_ai_promptname"]=request["promptKey"]!.Value<string>();row["wmkf_ai_iscurrent"]=false;row["wmkf_ai_promptstatus"]=new OptionSetValue(682090000);
        var keys=new[]{"systemPrompt","body","variables","outputSchema","model","temperature","maxTokens"};for(var i=0;i<keys.Length;i++){var v=snapshot["definition"]![keys[i]]!;row[PublicationWriteGuard.DefinitionColumns[i]]=v.Type==JTokenType.Null?null:v.Type==JTokenType.String?v.Value<string>():v.Value<double>();}
        var catalogKeys=new[]{"title","description","groupKey","sectionKey","usedBy","usageCategory"};for(var i=0;i<catalogKeys.Length;i++)row[PublicationWriteGuard.CatalogColumns[i]]=snapshot["catalog"]![catalogKeys[i]]!.Type==JTokenType.Null?null:snapshot["catalog"]![catalogKeys[i]]!.Value<string>();
        row["wmkf_ai_draftbaseline"]=PublicationWire.Json(request["metadataBaseline"]!);memory.Rows[row.Id]=row;return(store,memory,new TestRules());
    }
    private static void GuardChecks()
    {
        var parent=Context();var authority=new PublicationWriteAuthority(Org,"wmkf_PublishPrompt",Extension);
        var row=new Entity(PromptRows.Table,Guid.NewGuid()){["wmkf_ai_promptname"]="test.example",["wmkf_ai_iscurrent"]=false,["wmkf_ai_promptstatus"]=new OptionSetValue(682090000)};
        var child=MemorySdk.Child(parent,"Create",PromptRows.Table);
        PublicationWriteGuard.Assert(child,row,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable);count++;
        var raw=MemorySdk.Child(parent,"Create",PromptRows.Table);((ContextProxy)raw).Values.Remove("ParentContext");
        PublicationWriteGuard.Assert(raw,row,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,authority);count++;
        var unrelated=Context();((ContextProxy)unrelated).Values["MessageName"]="workflow";((ContextProxy)raw).Values["ParentContext"]=unrelated;
        PublicationWriteGuard.Assert(raw,row,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,authority);count++;
        var badDraft=new Entity(PromptRows.Table){["wmkf_ai_promptname"]="test.example",["wmkf_ai_iscurrent"]=true,["wmkf_ai_promptstatus"]=new OptionSetValue(682090001)};
        Deny(()=>PublicationWriteGuard.Assert(raw,badDraft,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,authority),"raw_draft_create_required");
        foreach(var message in new[]{"UpdateMultiple","CreateMultiple","Upsert","UpsertMultiple","DeleteMultiple","SetState","Assign"}){((ContextProxy)child).Values["MessageName"]=message;Deny(()=>PublicationWriteGuard.Assert(child,row,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable),"raw_bulk_or_alternate_write_denied");}
        ((ContextProxy)child).Values["MessageName"]="Update";
        foreach(var attribute in new[]{"wmkf_ai_promptname","wmkf_promptversion","wmkf_ai_iscurrent","wmkf_ai_promptstatus","wmkf_ai_publisheddatetime","ownerid","statecode"})
        {var edit=new Entity(PromptRows.Table,row.Id){[attribute]=null};Deny(()=>PublicationWriteGuard.Assert(child,edit,row,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable),"raw_prompt_attribute_denied");}
        var published=new Entity(PromptRows.Table,row.Id);foreach(var a in row.Attributes)published[a.Key]=a.Value;published["wmkf_ai_promptstatus"]=new OptionSetValue(682090001);published["wmkf_promptversion"]=1;published["wmkf_ai_iscurrent"]=true;
        Deny(()=>PublicationWriteGuard.Assert(child,new Entity(PromptRows.Table,row.Id){["wmkf_ai_promptbody"]="evil"},published,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable),"raw_published_or_legacy_write_denied");
        Deny(()=>PublicationWriteGuard.Assert(child,new Entity(PromptRows.Table,row.Id),null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable),"raw_published_or_legacy_write_denied");
        ((ContextProxy)child).Values["MessageName"]="Create";var control=new Entity(PublicationSdkStore.ReceiptTable);((ContextProxy)child).Values["PrimaryEntityName"]=control.LogicalName;
        Deny(()=>PublicationWriteGuard.Assert(child,control,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable),"raw_publication_control_write_denied");
        authority.Write(parent,"Create",control,()=>{Deny(()=>PublicationWriteGuard.Assert(child,control,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,authority),"invalid_publication_shape");return 0;});
        Deny(()=>PublicationWriteGuard.Assert(child,control,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,authority),"raw_publication_control_write_denied");
        authority.Write(parent,"Create",control,()=>{var altered=new Entity(control.LogicalName){["wmkf_payload"]="forged"};Deny(()=>PublicationWriteGuard.Assert(child,altered,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,authority),"raw_publication_control_write_denied");return 0;});
        authority.Write(parent,"Create",control,()=>{var changedVersion=new Entity(control.LogicalName){RowVersion="123"};Deny(()=>PublicationWriteGuard.Assert(child,changedVersion,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,authority),"raw_publication_control_write_denied");return 0;});
        foreach(var field in new[]{"UserId","InitiatingUserId","OrganizationId","CorrelationId","Depth","Stage","Mode","IsInTransaction"})
        {
            var v=((ContextProxy)child).Values;var original=v[field];v[field]=field=="IsInTransaction"?(object)false:field=="Depth"||field=="Stage"||field=="Mode"?99:Guid.NewGuid();
            authority.Write(parent,"Create",control,()=>{Deny(()=>PublicationWriteGuard.Assert(child,control,null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,authority),field=="Mode"||field=="Stage"||field=="IsInTransaction"?"write_guard_context_required":"trusted_publication_child_required");return 0;});v[field]=original;
        }
        ((ContextProxy)parent).Values["MessageName"]="evil";Deny(()=>authority.Write(parent,"Create",control,()=>0),"trusted_publication_parent_required");
        Check(parent.SharedVariables.Count==0,"permit removed including failures");
    }
}
internal sealed class TestRules : IPublicationRules
{
    public readonly List<string> Calls=new();public bool Deny;public string? Fault;
    private void Call(string name){Calls.Add(name);if(Deny||Fault==name)throw new InvalidOperationException(name);}
    public void AssertInstalledPolicy(JObject request)=>Call("policy");
    public JObject? FenceBudgetBeforeHead(JObject request){Call("budget");return new JObject{["testOnlyCapturedRevision"]="7"};}
    public void ValidateFresh(JObject request,JObject snapshot,JObject? capturedBudget){if(capturedBudget?["testOnlyCapturedRevision"]?.Value<string>()!="7")throw new Exception("budget handoff changed");Call("fresh");}
    public void ValidateCatalogAssignments(JObject catalog,JObject baseline,bool firstPublication)=>Call("catalog");
}
internal sealed class ServiceFactory(IOrganizationService service):IOrganizationServiceFactory
{public IOrganizationService CreateOrganizationService(Guid? id){if(id==null)throw new Exception("SYSTEM forbidden");return service;}}
internal sealed class MemorySdk(IPluginExecutionContext context):IOrganizationService
{
    public readonly Dictionary<Guid,Entity> Rows=new();public readonly List<string> Calls=new();public PublicationWriteAuthority? Authority;public int Mutations,Guards,LastFaultCount;private long rowVersion=1000;
    private readonly Dictionary<string,Guid> privilegeIds=new();
    private Guid PrivilegeId(string name){if(!privilegeIds.TryGetValue(name,out var id))privilegeIds[name]=id=Guid.NewGuid();return id;}
    public void SetNextVersion(long version)=>rowVersion=version;
    public bool Disabled,Application,MissingDisabled,WrongMetadata,WrongPrivilege,ExecuteBindingMismatch;public int AccessMode;public bool GlobalRead=true,ExecutePrivilege=true;public string? Fault;
    public static IPluginExecutionContext Child(IPluginExecutionContext parent,string message,string table)
    {
        var child=DispatchProxy.Create<IPluginExecutionContext,ContextProxy>();var v=((ContextProxy)child).Values;
        foreach(var key in new[]{"OrganizationId","UserId","InitiatingUserId","CorrelationId"})v[key]=((ContextProxy)parent).Values[key];v["Stage"]=20;v["Mode"]=0;v["Depth"]=parent.Depth+1;v["IsInTransaction"]=true;v["ParentContext"]=parent;v["PrimaryEntityName"]=table;v["MessageName"]=message;return child;
    }
    private void Call(string code){Calls.Add(code);if(Fault==code){LastFaultCount=Calls.Count;throw new InvalidOperationException(code);}}
    private void Guard(string message,Entity entity)
    {PublicationWriteGuard.Assert(Child(context,message,entity.LogicalName),entity,Rows.TryGetValue(entity.Id,out var old)?old:null,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,Authority);Guards++;}
    public Guid Create(Entity entity)
    {
        var label=entity.LogicalName==PublicationSdkStore.HeadTable?"head-create":"receipt";Call(label);Guard("Create",entity);
        var key=entity.LogicalName==PublicationSdkStore.HeadTable?PublicationSdkStore.HeadHash:PublicationSdkStore.RequestId;
        if(Rows.Values.Any(r=>r.LogicalName==entity.LogicalName&&r.GetAttributeValue<string>(key)==entity.GetAttributeValue<string>(key)))throw new InvalidOperationException("duplicate key");
        var id=entity.Id==Guid.Empty?Guid.NewGuid():entity.Id;var copy=new Entity(entity.LogicalName,id){RowVersion=(++rowVersion).ToString()};foreach(var a in entity.Attributes)copy[a.Key]=a.Value;Rows.Add(id,copy);Mutations++;return id;
    }
    // TEST ONLY: SDK metadata is immutable outside server deserialization.
    private SecurityPrivilegeMetadata SecurityMetadata(string name,PrivilegeType type)
    {
#pragma warning disable SYSLIB0050
        var result=(SecurityPrivilegeMetadata)System.Runtime.Serialization.FormatterServices.GetUninitializedObject(typeof(SecurityPrivilegeMetadata));
#pragma warning restore SYSLIB0050
        var fields=typeof(SecurityPrivilegeMetadata).GetFields(BindingFlags.Instance|BindingFlags.NonPublic);
        fields.Single(f=>f.FieldType==typeof(string)).SetValue(result,name);
        fields.Single(f=>f.FieldType==typeof(Guid)).SetValue(result,PrivilegeId(name));
        fields.Single(f=>f.FieldType==typeof(PrivilegeType)).SetValue(result,type);return result;
    }
    public OrganizationResponse Execute(OrganizationRequest request)
    {
        if(request is RetrieveEntityRequest retrieve)
        {
            Call("metadata");var metadata=new EntityMetadata{LogicalName=WrongMetadata?"wrong_table":retrieve.LogicalName};
            var list=new List<SecurityPrivilegeMetadata>{SecurityMetadata("prvRead"+retrieve.LogicalName,PrivilegeType.Read)};
            if(retrieve.LogicalName==PublicationSdkStore.ReceiptTable)list.Add(SecurityMetadata(ExecuteBindingMismatch?"prvUnrelatedCreate":"prvCreateReceipt",PrivilegeType.Create));
            typeof(EntityMetadata).GetProperty("Privileges")!.SetValue(metadata,list.ToArray());var reply=new RetrieveEntityResponse();reply.Results["EntityMetadata"]=metadata;return reply;
        }
        if(request.RequestName=="RetrieveUserPrivilegeByPrivilegeName")
        {Call("authorization");var response=new OrganizationResponse();var name=(string)request["PrivilegeName"];response.Results["RolePrivileges"]=name=="prvCreateReceipt"&&!ExecutePrivilege?Array.Empty<RolePrivilege>():new[]{new RolePrivilege{PrivilegeId=WrongPrivilege?Guid.NewGuid():PrivilegeId(name),Depth=GlobalRead?PrivilegeDepth.Global:PrivilegeDepth.Basic}};return response;}
        var update=(UpdateRequest)request;var entity=update.Target;var current=Rows[entity.Id];var label=entity.LogicalName==PromptRows.Table?(entity.Attributes.Count==1?"previous-clear":"promotion"):entity.Attributes.Count==1?"head-fence":"head-finish";
        Call(label);Guard("Update",entity);if(update.ConcurrencyBehavior!=ConcurrencyBehavior.IfRowVersionMatches||current.RowVersion!=entity.RowVersion)throw new InvalidOperationException("CAS fault");
        foreach(var a in entity.Attributes)current[a.Key]=a.Value;current.RowVersion=(++rowVersion).ToString();Mutations++;return new UpdateResponse();
    }
    public Entity Retrieve(string name,Guid id,ColumnSet columns)
    {
        Call("retrieve");if(name=="systemuser"){var user=new Entity(name,id){["accessmode"]=new OptionSetValue(AccessMode)};if(!MissingDisabled)user["isdisabled"]=Disabled;if(Application)user["applicationid"]=Guid.NewGuid();return user;}
        var original=Rows[id];var result=new Entity(name,id){RowVersion=original.RowVersion};foreach(var c in columns.Columns)if(original.Attributes.TryGetValue(c,out var value)&&value!=null)result[c]=value;return result;
    }
    public EntityCollection RetrieveMultiple(QueryBase request)
    {
        Call("query");var q=(QueryExpression)request;var selected=Rows.Values.Where(r=>r.LogicalName==q.EntityName&&q.Criteria.Conditions.All(c=>string.Equals(r.GetAttributeValue<string>(c.AttributeName),(string)c.Values[0],StringComparison.OrdinalIgnoreCase))).Select(r=>Retrieve(q.EntityName,r.Id,q.ColumnSet)).ToList();return new EntityCollection(selected){MoreRecords=false};
    }
    public void Update(Entity entity)=>throw new Exception("unconditional update");public void Delete(string name,Guid id)=>throw new Exception("delete");public void Associate(string name,Guid id,Relationship r,EntityReferenceCollection e)=>throw new Exception("associate");public void Disassociate(string name,Guid id,Relationship r,EntityReferenceCollection e)=>throw new Exception("disassociate");
}
