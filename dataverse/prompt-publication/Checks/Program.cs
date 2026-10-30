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
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Wmkf.PromptPublication;

internal static class Program
{
    private static int count;
    private static void Check(bool ok, string label) { if (!ok) throw new Exception(label); count++; }
    private static void Reject(Action action, string code)
    { try { action(); } catch (Exception error) { Check(error.Message.Contains(code), "wrong rejection: " + error.Message); return; } throw new Exception("accepted: " + code); }
    private static readonly Guid Org = Guid.Parse("10000000-0000-4000-8000-000000000001"), User = Guid.Parse("10000000-0000-4000-8000-000000000002"), Initiator = Guid.Parse("10000000-0000-4000-8000-000000000003");
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1) throw new Exception("fixture path required");
            var fixture = (JObject)CanonicalJson.Parse(File.ReadAllText(args[0]));
            foreach (var item in (JArray)fixture["canonical"]!) Check(CanonicalJson.Preimage(item["input"]!.ToString(Formatting.None)) == item["preimage"]!.Value<string>(), "canonical vector");
            var snapshot = fixture["snapshot"]!;
            Check(CanonicalJson.Hash("wmkf.prompt.snapshot.v1", snapshot["input"]!.ToString(Formatting.None)) == snapshot["hash"]!.Value<string>(), "snapshot hash");
            foreach (var vector in (JArray)fixture["requests"]!)
            {
                var request = vector["input"]!;
                var input = new JObject { ["fingerprintVersion"] = 1, ["request"] = request.DeepClone(), ["actor"] = vector["actor"]!.DeepClone(), ["canonicalKey"] = request["promptKey"]!.DeepClone() };
                Check(CanonicalJson.Preimage(input.ToString(Formatting.None)) == vector["preimage"]!.Value<string>()!.Substring(vector["preimage"]!.Value<string>()!.IndexOf('\n')+1), "request preimage");
                Check(CanonicalJson.Hash("wmkf.prompt.publication.v1", input.ToString(Formatting.None)) == vector["hash"]!.Value<string>(), "request hash");
            }
            var receipt=fixture["receipt"]!;
            var receiptInput=new JObject {["fingerprintVersion"]=1,["request"]=receipt["request"]!.DeepClone(),["actor"]=receipt["actor"]!.DeepClone(),["canonicalKey"]=receipt["request"]!["promptKey"]!.DeepClone()};
            Check(CanonicalJson.Hash("wmkf.prompt.publication.v1",receiptInput.ToString(Formatting.None))==receipt["requestFingerprint"]!.Value<string>(),"historical receipt request fingerprint");
            foreach (var json in new[] { "{\"a\":1,\"\\u0061\":2}", "[1,]", "{\"a\":1,}", "{a:1}", "/*x*/null", "NaN", "undefined", "01", "1.", "1e", "+1", "true false", "'text'" }) Reject(() => CanonicalJson.Preimage(json), json.StartsWith("{\"a\":1,\"\\u0061") ? "duplicate_json_key" : "invalid_json");
            foreach (var json in new[] { "-0", "-0.0", "-0e1", "1e999", "9007199254740992", "1e16" }) Reject(() => CanonicalJson.Preimage(json), "unsupported_number");
            foreach (var json in new[] { "\"\\ud800\"", "\"\\udfff\"", "{\"\\ud800\":0}" }) Reject(() => CanonicalJson.Preimage(json), "malformed_unicode");
            Check(CanonicalJson.Preimage("\"\\ud83d\\ude00\"") == "[\"s\",\"\\ud83d\\ude00\"]", "astral");
            Reject(() => CanonicalJson.Preimage(new string('[', 33) + "0" + new string(']', 33)), "json_complexity_limit");
            Reject(() => CanonicalJson.Preimage("[" + string.Join(",", Enumerable.Repeat("0", 50000)) + "]"), "json_complexity_limit");
            Reject(() => CanonicalJson.Preimage("\"" + new string('x', 1000000) + "\""), "payload_too_large");
            var numeric=(JObject)CanonicalJson.Parse(File.ReadAllText(Path.Combine(Path.GetDirectoryName(args[0])!,"sdk-numbers-v1.json")));
            foreach(var vector in (JArray)numeric["vectors"]!)
            {
                var json=vector["json"]!.Value<string>()!;
                if(vector["error"]!=null)Reject(()=>CanonicalJson.Preimage(json),vector["error"]!.Value<string>()!);
                else Check(CanonicalJson.Preimage(json)==vector["preimage"]!.Value<string>(),"binary64 boundary vector: "+json);
            }
            SdkChecks();
            MetadataChecks();
            count += PublisherChecks.Run(fixture,args[0]);
            Console.WriteLine($"SDK/canonical checks passed: {count}. No tenant connection."); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    private static (TransactionSdk sdk, FakeService service, ContextProxy context, Factory factory) Session()
    {
        var context = DispatchProxy.Create<IPluginExecutionContext, ContextProxy>();
        var proxy = (ContextProxy)context;
        proxy.Values["OrganizationId"] = Org; proxy.Values["InitiatingUserId"] = Initiator; proxy.Values["UserId"] = User; proxy.Values["IsInTransaction"] = true;
        var service = new FakeService(); var factory = new Factory(service);
        return (new TransactionSdk(context, factory, Org), service, proxy, factory);
    }
    private static Entity Row(Guid id, string version = "123") => new(PromptRows.Table, id) { RowVersion = version };
    private static EntityCollection Page(bool more, string? cookie, params Entity[] rows) => new(rows.ToList()) { MoreRecords = more, PagingCookie = cookie };
    private static QueryExpression Query() => new(PromptRows.Table) { ColumnSet = new ColumnSet("wmkf_promptversion") };
    private static void SdkChecks()
    {
        var initial=Session();initial.context.Values["IsInTransaction"]=false;var untouchedFactory=new Factory(new FakeService());
        Reject(()=>new TransactionSdk((IPluginExecutionContext)initial.context,untouchedFactory,Org),"sdk_transaction_context_required");Check(untouchedFactory.User==null,"invalid initial context never obtains a service");
        var s = Session(); Check(s.factory.User == User, "effective service user, not SYSTEM");
        foreach (var property in new[] { "IsInTransaction", "IsExecutingOffline", "IsOfflinePlayback", "OrganizationId", "UserId", "InitiatingUserId", "Mode" })
        {
            var t = Session(); t.context.Values[property] = property == "IsInTransaction" ? false : property.StartsWith("Is") ? true : property == "Mode" ? 1 : Guid.Empty;
            Reject(() => t.sdk.CreateOnly(new Entity("wmkf_ai_prompt")), "sdk_transaction_context_required"); Check(t.service.Calls.Count == 0, "context before mutation");
        }
        foreach (var bad in new[] { "*", "123", "W/\"0\"", "W/\"01\"", "W/\"1\"\n" }) Reject(() => TransactionSdk.RowVersion(bad), "original_row_version_required");
        Check(TransactionSdk.RowVersion("W/\"9007199254740993\"") == "9007199254740993", "lossless row version");
        Check(TransactionSdk.WeakEtag("9007199254740993")=="W/\"9007199254740993\"" && TransactionSdk.RowVersion(TransactionSdk.WeakEtag("123"))=="123","SDK/OData exact ETag reconstruction");
        Reject(()=>TransactionSdk.WeakEtag("01"),"invalid_sdk_row_version");
        var create=Session();Check(create.sdk.CreateOnly(new Entity(PromptRows.Table))!=Guid.Empty && create.service.Calls.SequenceEqual(new[]{"create"}),"create only, no upsert");
        create.service.Fault=new InvalidOperationException("create-fault");Reject(()=>create.sdk.CreateOnly(new Entity(PromptRows.Table)),"create-fault");Check(create.service.Calls.Count==2,"no create retry");
        var changes = new Entity(PromptRows.Table, Guid.NewGuid()) { ["wmkf_ai_iscurrent"] = false };
        s.sdk.ConditionalUpdate(changes, "W/\"9007199254740993\"");
        var update = (UpdateRequest)s.service.Requests.Single(); Check(update.ConcurrencyBehavior == ConcurrencyBehavior.IfRowVersionMatches, "conditional update");
        Check(update.Target.RowVersion == "9007199254740993" && changes.RowVersion == null, "original token retained, input unchanged");
        s.service.Fault = new InvalidOperationException("sdk-fault");
        Reject(() => s.sdk.ConditionalUpdate(changes, "W/\"9\""), "sdk-fault"); Check(s.service.Requests.Count == 2, "no retry/fallback");
        var pages = Session(); var first = Guid.NewGuid(); pages.service.Pages.Enqueue(Page(true, "opaque", Row(first))); pages.service.Pages.Enqueue(Page(false, null, Row(Guid.NewGuid())));
        Check(pages.sdk.ReadAll(Query(), PromptRows.PrimaryId).Count == 2, "all pages"); Check(pages.service.PageNumbers.SequenceEqual(new[] {1,2}) && pages.service.PageCookies.SequenceEqual(new string?[]{null,"opaque"}), "page sequence");
        foreach (var scenario in new[] { "cookie", "repeat", "duplicate", "empty", "rowversion", "badversion" })
        {
            var t = Session();
            if (scenario == "cookie") t.service.Pages.Enqueue(Page(true, null, Row(first)));
            if (scenario == "repeat") { t.service.Pages.Enqueue(Page(true,"same",Row(first))); t.service.Pages.Enqueue(Page(true,"same",Row(Guid.NewGuid()))); }
            if (scenario == "duplicate") { t.service.Pages.Enqueue(Page(true,"a",Row(first))); t.service.Pages.Enqueue(Page(false,null,Row(first))); }
            if (scenario == "empty") t.service.Pages.Enqueue(Page(true,"a"));
            if (scenario == "rowversion") t.service.Pages.Enqueue(Page(false,null,Row(first,"")));
            if (scenario == "badversion") t.service.Pages.Enqueue(Page(false,null,Row(first,"01")));
            Reject(() => t.sdk.ReadAll(Query(),PromptRows.PrimaryId), scenario == "duplicate" || scenario == "rowversion" || scenario == "badversion" ? "invalid_sdk_inventory_row" : "incomplete_sdk_inventory");
        }
        foreach (var kind in new[] { "top", "distinct", "all", "page", "order", "link", "criteria" })
        {
            var q = Query(); if(kind=="top")q.TopCount=1;if(kind=="distinct")q.Distinct=true;if(kind=="all")q.ColumnSet.AllColumns=true;if(kind=="page")q.PageInfo=new PagingInfo{PageNumber=2};if(kind=="order")q.AddOrder("wmkf_promptversion",OrderType.Ascending);if(kind=="link")q.LinkEntities.Add(new LinkEntity());if(kind=="criteria")q.Criteria=null;
            Reject(()=>Session().sdk.ReadAll(q,PromptRows.PrimaryId),"unsafe_sdk_inventory_query");
        }
        var read=Session();Check(read.sdk.ReadById(PromptRows.Table,first,"wmkf_promptversion").Id==first,"read by id");
        read.service.RetrieveReply=Row(Guid.NewGuid());Reject(()=>read.sdk.ReadById(PromptRows.Table,first,"wmkf_promptversion"),"invalid_sdk_read_result");
        read.service.RetrieveReply=Row(first,"");Reject(()=>read.sdk.ReadById(PromptRows.Table,first,"wmkf_promptversion"),"invalid_sdk_read_result");
        Reject(()=>Session().sdk.ConditionalUpdate(new Entity(PromptRows.Table,first),"W/\"1\""),"empty_sdk_update");
        Reject(()=>new TransactionSdk((IPluginExecutionContext)s.context,null!,Org),"sdk_service_factory_required");
        var capped=Session();capped.service.Pages.Enqueue(Page(true,"one",Enumerable.Range(0,5000).Select(_=>Row(Guid.NewGuid())).ToArray()));capped.service.Pages.Enqueue(Page(true,"two",Enumerable.Range(0,5000).Select(_=>Row(Guid.NewGuid())).ToArray()));capped.service.Pages.Enqueue(Page(false,null,Row(Guid.NewGuid())));
        Reject(()=>capped.sdk.ReadAll(Query(),PromptRows.PrimaryId),"sdk_inventory_limit");
        var writes = Session(); var repo = new PromptRows(writes.sdk);
        repo.PromoteDraft(first,"W/\"17\"",4,new DateTime(2026,10,30,0,0,0,DateTimeKind.Utc)); repo.ClearPrevious(Guid.NewGuid(),"W/\"18\"");
        var promote=((UpdateRequest)writes.service.Requests[0]).Target; Check(promote.GetAttributeValue<int>("wmkf_promptversion")==4 && promote.Attributes.ContainsKey("wmkf_ai_draftbaseline") && promote["wmkf_ai_draftbaseline"]==null,"promotion stamps and baseline clear");
        Check(promote.GetAttributeValue<bool>("wmkf_ai_iscurrent") && promote.GetAttributeValue<OptionSetValue>("wmkf_ai_promptstatus").Value==682090001 && promote.GetAttributeValue<DateTime>("wmkf_ai_publisheddatetime").Kind==DateTimeKind.Utc,"current/status/UTC promotion");
        Reject(()=>repo.PromoteDraft(first,"W/\"1\"",1,DateTime.SpecifyKind(DateTime.Now,DateTimeKind.Unspecified)),"invalid_promotion_stamp");
        Check(((UpdateRequest)writes.service.Requests[1]).Target.Attributes.Count==1,"previous content immutable");
        var inventory=Session();inventory.service.Pages.Enqueue(Page(false,null));new PromptRows(inventory.sdk).ReadInventory("pa.example");
        Check(inventory.service.LastQuery!.Criteria.Conditions.Count==1 && inventory.service.LastQuery.Criteria.Conditions[0].AttributeName=="wmkf_ai_promptname","no lifecycle filters hide corruption");
        Reject(()=>new PromptRows(Session().sdk).ReadInventory("PA.Example"),"invalid_canonical_key");
    }
    private static void MetadataChecks()
    {
        var wrong=new FakeService();var wrongWho=new WhoAmIResponse();wrongWho.Results["OrganizationId"]=Guid.NewGuid();wrong.Replies.Enqueue(wrongWho);
        Reject(()=>PromptSchemaPreflight.Inspect(wrong,Org),"sandbox_organization_mismatch");Check(wrong.Requests.Count==1,"foreign org stops before metadata");
        var service=new FakeService();var who=new WhoAmIResponse();who.Results["OrganizationId"]=Org;service.Replies.Enqueue(who);
        var metadata=new EntityMetadata {LogicalName=PromptRows.Table};
        typeof(EntityMetadata).GetProperty("IsOptimisticConcurrencyEnabled")!.SetValue(metadata,true);
        var field=new StringAttributeMetadata {LogicalName="wmkf_ai_promptname",MaxLength=850,IsValidForCreate=true,IsValidForUpdate=true};
        typeof(AttributeMetadata).GetProperty("IsValidForRead")!.SetValue(field,true);
        typeof(EntityMetadata).GetProperty("Attributes")!.SetValue(metadata,new AttributeMetadata[]{field});
        var response=new RetrieveEntityResponse();response.Results["EntityMetadata"]=metadata;service.Replies.Enqueue(response);
        var report=PromptSchemaPreflight.Inspect(service,Org);
        Check(report["deploymentAuthorized"]!.Value<bool>()==false && report["optimisticConcurrency"]!.Value<bool>(),"metadata report never authorizes");
        Check(report["fields"]!.Count()==12 && report["fields"]![0]!["status"]!.Value<string>()=="compatible" && report["fields"]![11]!["status"]!.Value<string>()=="missing-or-duplicate","missing columns reported, not provisioned");
        Check(service.Requests.All(r=>r is WhoAmIRequest || r is RetrieveEntityRequest),"read-only messages");
        Check(((RetrieveEntityRequest)service.Requests[1]).RetrieveAsIfPublished==false,"published metadata only");
        foreach(var scenario in new[]{"valid","date-only","missing-status"})
        {
            var probe=new FakeService();var probeWho=new WhoAmIResponse();probeWho.Results["OrganizationId"]=Org;probe.Replies.Enqueue(probeWho);
            var date=new DateTimeAttributeMetadata {LogicalName="wmkf_ai_publisheddatetime",Format=scenario=="date-only"?DateTimeFormat.DateOnly:DateTimeFormat.DateAndTime,IsValidForCreate=true,IsValidForUpdate=true};
            var status=new PicklistAttributeMetadata {LogicalName="wmkf_ai_promptstatus",OptionSet=new OptionSetMetadata(),IsValidForCreate=true,IsValidForUpdate=true};
            foreach(var v in scenario=="missing-status"?new[]{682090000,682090001}:new[]{682090000,682090001,682090002})status.OptionSet.Options.Add(new OptionMetadata(new Label("status",1033),v));
            typeof(AttributeMetadata).GetProperty("IsValidForRead")!.SetValue(date,true);typeof(AttributeMetadata).GetProperty("IsValidForRead")!.SetValue(status,true);
            var entity=new EntityMetadata {LogicalName=PromptRows.Table};typeof(EntityMetadata).GetProperty("Attributes")!.SetValue(entity,new AttributeMetadata[]{date,status});
            var metaResponse=new RetrieveEntityResponse();metaResponse.Results["EntityMetadata"]=entity;probe.Replies.Enqueue(metaResponse);
            var result=PromptSchemaPreflight.Inspect(probe,Org);
            Check(result["fields"]!.Single(f=>f["field"]!.Value<string>()=="wmkf_ai_publisheddatetime")["status"]!.Value<string>()==(scenario=="date-only"?"divergent":"compatible"),"datetime format proof");
            Check(result["fields"]!.Single(f=>f["field"]!.Value<string>()=="wmkf_ai_promptstatus")["status"]!.Value<string>()==(scenario=="missing-status"?"divergent":"compatible"),"all lifecycle option values proof");
        }
        var failed=new FakeService{Fault=new InvalidOperationException("read-unknown")};Reject(()=>PromptSchemaPreflight.Inspect(failed,Org),"read-unknown");Check(failed.Requests.Count==1,"no retry or false absence");
    }

}
public class ContextProxy : DispatchProxy
{
    public readonly Dictionary<string, object> Values = new();
    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        if (targetMethod == null) throw new Exception("method");
        var name=targetMethod.Name.Substring(4); if(Values.TryGetValue(name,out var value))return value;
        return targetMethod.ReturnType.IsValueType ? Activator.CreateInstance(targetMethod.ReturnType) : null;
    }
}
internal sealed class Factory(FakeService service) : IOrganizationServiceFactory
{
    public Guid? User;
    public IOrganizationService CreateOrganizationService(Guid? userId) {User=userId;return service;}
}
internal sealed class FakeService : IOrganizationService
{
    public readonly List<string> Calls=new();public readonly List<OrganizationRequest> Requests=new();public readonly Queue<OrganizationResponse> Replies=new();public readonly Queue<EntityCollection> Pages=new();public readonly List<int> PageNumbers=new();public readonly List<string?> PageCookies=new();public Exception? Fault;public QueryExpression? LastQuery;public Entity? RetrieveReply;
    public Guid Create(Entity entity){Calls.Add("create");if(Fault!=null)throw Fault;return Guid.NewGuid();}
    public OrganizationResponse Execute(OrganizationRequest request){Calls.Add("execute");Requests.Add(request);if(Fault!=null)throw Fault;return Replies.Count>0?Replies.Dequeue():new UpdateResponse();}
    public EntityCollection RetrieveMultiple(QueryBase query){Calls.Add("read");LastQuery=(QueryExpression)query;PageNumbers.Add(LastQuery.PageInfo.PageNumber);PageCookies.Add(LastQuery.PageInfo.PagingCookie);if(Fault!=null)throw Fault;return Pages.Dequeue();}
    public Entity Retrieve(string name,Guid id,ColumnSet columns){Calls.Add("retrieve");if(Fault!=null)throw Fault;return RetrieveReply??new Entity(name,id){RowVersion="123"};}
    public void Update(Entity entity)=>throw new Exception("unconditional update forbidden");
    public void Delete(string name,Guid id)=>throw new Exception("delete forbidden");
    public void Associate(string name,Guid id,Relationship relationship,EntityReferenceCollection entities)=>throw new Exception("associate forbidden");
    public void Disassociate(string name,Guid id,Relationship relationship,EntityReferenceCollection entities)=>throw new Exception("disassociate forbidden");
}
