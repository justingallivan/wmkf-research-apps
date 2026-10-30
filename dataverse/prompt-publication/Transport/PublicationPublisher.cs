// Synchronous SDK publisher state machine. It returns a PROVISIONAL receipt to
// the platform pipeline; only successful completion of that pipeline commits.
// No catch/replay inside a failed transaction. Client retries SAME UUID outside.
// No IPlugin entry is registered until full fresh rules/guard composition exists.
using System;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;

namespace Wmkf.PromptPublication;

// These are trusted server dependencies, not request options. No permissive
// production implementation exists. Missing format/budget/catalog rules block
// composition, never silently turn into lifecycle-only publication.
public interface IPublicationRules
{
    void AssertInstalledPolicy(JObject request);
    JObject? FenceBudgetBeforeHead(JObject request);
    void ValidateFresh(JObject request,JObject snapshot,JObject? capturedBudget);
    void ValidateCatalogAssignments(JObject catalog,JObject baseline,bool firstPublication);
}
public interface IPublicationStore
{
    JObject Authorize();
    void AssertTransaction();
    string? ReadReceipt(string requestId);
    JObject? ReadHead(string keyHash);
    JObject CreateHead(JObject head);
    JObject FenceHead(JObject head,string nextRevision);
    JArray ReadInventory(string key);
    JObject ReadDraft(string id);
    JObject PromoteDraft(string id,string etag,int version,DateTime utc);
    void ClearPrevious(string id,string etag);
    void FinishHead(JObject fenced,JObject current,int highWaterVersion);
    void CreateReceipt(JObject receipt);
}
public static class PublicationPublisher
{
    private const int Draft=682090000,Published=682090001,Retired=682090002;
    public static string HeadKey(string key)
    {using var sha=SHA256.Create();return string.Concat(sha.ComputeHash(Encoding.UTF8.GetBytes(key)).Select(b=>b.ToString("x2",CultureInfo.InvariantCulture)));}
    private static JToken ExpectedCurrent(JObject request)
    {return PublicationWire.Null(request["expectedCurrent"])?JValue.CreateNull():new JObject{["id"]=request["expectedCurrent"]!["id"]!.DeepClone(),["version"]=request["expectedCurrent"]!["version"]!.DeepClone()};}
    private static void AssertHead(JObject h,JObject request)
    {
        PublicationWire.Shape(h,"keyHash","key","originalKey","revision","etag","highWaterVersion","current");
        PublicationWire.Require(PublicationWire.Text(h["keyHash"])==HeadKey(PublicationWire.Text(request["promptKey"])!)&&PublicationWire.Equal(h["key"],request["promptKey"])&&PublicationWire.Equal(h["originalKey"],request["promptKey"])
            &&PublicationWire.Revision(h["revision"])&&PublicationWire.Etag(h["etag"])&&PublicationWire.Integer(h["highWaterVersion"],0,int.MaxValue),"invalid_publication_head");
        if(!PublicationWire.Null(h["current"]))
        {var c=PublicationWire.Shape(h["current"],"id","version");PublicationWire.Require(PublicationWire.GuidValue(c["id"])&&PublicationWire.Integer(c["version"],1,h["highWaterVersion"]!.Value<double>()),"invalid_publication_head");}
        PublicationWire.Require(PublicationWire.Equal(h["revision"],request["expectedHeadRevision"])&&PublicationWire.Equal(h["current"],ExpectedCurrent(request)),"publication_conflict");
    }
    public static JObject Publish(string requestJson,IPublicationStore store,IPublicationRules rules)
    {
        if(store==null||rules==null)throw new InvalidOperationException("publisher_composition_required");
        var r=PublicationWire.Request(requestJson);var actor=store.Authorize();PublicationWire.Actor(actor);store.AssertTransaction();
        var prior=store.ReadReceipt(PublicationWire.Text(r["requestId"])!);
        if(prior!=null)return new JObject{["receipt"]=PublicationWire.Replay(prior,r,actor),["replayed"]=true};
        rules.AssertInstalledPolicy((JObject)r.DeepClone());
        // Trusted rules must fence registered budgets against ORIGINAL control
        // before any head, and retain that exact budget state for ValidateFresh.
        var budget=rules.FenceBudgetBeforeHead((JObject)r.DeepClone());
        if(budget!=null)budget=(JObject)CanonicalJson.Parse(PublicationWire.Json(budget));
        store.AssertTransaction();
        var key=PublicationWire.Text(r["promptKey"])!;var head=store.ReadHead(HeadKey(key));
        if(head==null)
        {
            PublicationWire.Require(PublicationWire.Text(r["expectedHeadRevision"])=="0"&&PublicationWire.Null(r["expectedCurrent"]),"publication_conflict");
            head=store.CreateHead(new JObject{["keyHash"]=HeadKey(key),["key"]=key,["originalKey"]=key,["revision"]="0",["highWaterVersion"]=0,["current"]=JValue.CreateNull()});
        }
        AssertHead(head,r);PublicationWire.Require(head["highWaterVersion"]!.Value<int>()<int.MaxValue,"publication_version_exhausted");
        var next=PublicationWire.Increment(head["revision"]);var fenced=store.FenceHead((JObject)head.DeepClone(),next);
        var check=(JObject)fenced.DeepClone();check["revision"]=head["revision"]!.DeepClone();AssertHead(check,r);
        PublicationWire.Require(PublicationWire.Text(fenced["revision"])==next&&PublicationWire.Equal(fenced["highWaterVersion"],head["highWaterVersion"])&&!PublicationWire.Equal(fenced["etag"],head["etag"]),"invalid_head_fence_result");
        var rows=store.ReadInventory(key);PublicationWire.Require(rows.Count<=10000,"incomplete_publication_inventory");
        var ids=new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);var versions=new System.Collections.Generic.HashSet<int>();
        foreach(var row in rows)
        {
            var item=PublicationWire.Shape(row,"id","name","version","etag","status","isCurrent","catalog");
            PublicationWire.Require(PublicationWire.GuidValue(item["id"])&&PublicationWire.Etag(item["etag"])&&PublicationWire.Text(item["name"])==key&&PublicationWire.Integer(item["status"],Draft,Retired)
                &&item["isCurrent"]?.Type==JTokenType.Boolean&&(item["status"]!.Value<int>()==Draft?(PublicationWire.Null(item["version"])||PublicationWire.Integer(item["version"],1,int.MaxValue)):PublicationWire.Integer(item["version"],1,int.MaxValue))
                &&(!item["isCurrent"]!.Value<bool>()||item["status"]!.Value<int>()==Published),"invalid_publication_inventory");PublicationWire.Catalog(item["catalog"]);
            PublicationWire.Require(ids.Add(PublicationWire.Text(item["id"])!)&&(PublicationWire.Null(item["version"])||versions.Add(item["version"]!.Value<int>())),"duplicate_publication_history");
        }
        var current=rows.Cast<JObject>().Where(x=>x["isCurrent"]!.Value<bool>()).ToArray();
        PublicationWire.Require(PublicationWire.Null(r["expectedCurrent"])?current.Length==0:current.Length==1&&PublicationWire.Equal(new JObject{["id"]=current[0]["id"]!.DeepClone(),["version"]=current[0]["version"]!.DeepClone(),["etag"]=current[0]["etag"]!.DeepClone()},r["expectedCurrent"]),"publication_conflict");
        PublicationWire.Require(!PublicationWire.Null(r["expectedCurrent"])||rows.All(x=>x["status"]!.Value<int>()==Draft),"legacy_lifecycle_recovery_required");
        PublicationWire.Require(current.Length==0||PublicationWire.Equal(current[0]["catalog"],r["metadataBaseline"]!["catalog"]),"catalog_baseline_conflict");
        PublicationWire.Require(versions.All(v=>v<=head["highWaterVersion"]!.Value<int>()),"uninitialized_publication_head");
        var draftRow=rows.Cast<JObject>().SingleOrDefault(x=>PublicationWire.Equal(x["id"],r["draftId"]));
        PublicationWire.Require(draftRow!=null&&draftRow["status"]!.Value<int>()==Draft&&!draftRow["isCurrent"]!.Value<bool>()&&PublicationWire.Null(draftRow["version"])&&PublicationWire.Equal(draftRow["etag"],r["draftEtag"]),"publication_conflict");
        var draft=PublicationWire.Shape(store.ReadDraft(PublicationWire.Text(r["draftId"])!),"id","name","version","etag","status","isCurrent","snapshot","metadataBaseline");
        foreach(var field in new[]{"id","name","version","etag","status","isCurrent"})PublicationWire.Require(PublicationWire.Equal(draft[field],draftRow![field]),"publication_conflict");
        var snapshot=PublicationWire.Snapshot(draft["snapshot"]);PublicationWire.Require(PublicationWire.Equal(snapshot["catalog"],draftRow!["catalog"]),"publication_conflict");
        PublicationWire.Require(PublicationWire.Equal(draft["metadataBaseline"],r["metadataBaseline"]),"draft_baseline_reconciliation_required");
        // Shared identity/hash/catalog requirements cannot be weakened by a format rule.
        PublicationWire.Require(PublicationWire.Text(snapshot["definition"]!["name"])==key&&CanonicalJson.Hash("wmkf.prompt.snapshot.v1",PublicationWire.Json(snapshot))==PublicationWire.Text(r["snapshotHash"]),"snapshot_hash_mismatch");
        if(PublicationWire.Null(r["expectedCurrent"]))PublicationWire.Require(new[]{"title","description","groupKey","usedBy","usageCategory"}.All(k=>PublicationWire.Text(snapshot["catalog"]![k]) is string text&&DefinitionRules.JsTrim(text).Length>0)&&!PublicationWire.Null(snapshot["definition"]!["temperature"]),"new_catalog_incomplete");
        rules.ValidateFresh((JObject)r.DeepClone(),(JObject)snapshot.DeepClone(),budget==null?null:(JObject)budget.DeepClone());
        rules.ValidateCatalogAssignments((JObject)snapshot["catalog"]!.DeepClone(),(JObject)r["metadataBaseline"]!["catalog"]!.DeepClone(),PublicationWire.Null(r["expectedCurrent"]));
        store.AssertTransaction();var version=head["highWaterVersion"]!.Value<int>()+1;var utc=DateTime.UtcNow;utc=new DateTime(utc.Ticks-utc.Ticks%TimeSpan.TicksPerMillisecond,DateTimeKind.Utc);
        var published=store.PromoteDraft(PublicationWire.Text(r["draftId"])!,PublicationWire.Text(r["draftEtag"])!,version,utc);PublicationWire.Current(published,false);
        if(!PublicationWire.Null(r["expectedCurrent"]))store.ClearPrevious(PublicationWire.Text(r["expectedCurrent"]!["id"])!,PublicationWire.Text(r["expectedCurrent"]!["etag"])!);
        store.FinishHead(fenced,new JObject{["id"]=r["draftId"]!.DeepClone(),["version"]=version},version);
        var receipt=new JObject{["receiptVersion"]=1,["fingerprintVersion"]=1,["request"]=r.DeepClone(),["actor"]=actor.DeepClone(),["requestFingerprint"]=PublicationWire.Fingerprint(r,actor),["published"]=published,["headRevision"]=next,["publishedAt"]=utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture)};
        PublicationWire.Receipt(PublicationWire.Json(receipt));PublicationWire.Require(published["version"]!.Value<int>()==version,"invalid_publication_result");store.CreateReceipt(receipt);
        return new JObject{["receipt"]=receipt,["replayed"]=false};
    }
}
