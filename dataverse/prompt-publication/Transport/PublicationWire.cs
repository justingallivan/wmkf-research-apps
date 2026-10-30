// Stable v1 wire rules. Never consult current policy during historical replay.
using System;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Wmkf.PromptPublication;

public static class PublicationWire
{
    public static void Require(bool valid, string code) { if (!valid) throw new InvalidOperationException(code); }
    public static string Json(JToken token) => token.ToString(Formatting.None);
    public static bool Equal(JToken? a, JToken? b) => a != null && b != null && CanonicalJson.Preimage(Json(a)) == CanonicalJson.Preimage(Json(b));
    public static string? Text(JToken? v) => v?.Type == JTokenType.String ? v.Value<string>() : null;
    public static bool Match(JToken? v, string pattern) => Text(v) is string s && Regex.IsMatch(s, "\\A(?:" + pattern + ")\\z", RegexOptions.CultureInvariant);
    public static bool Integer(JToken? v, double min, double max) => v != null && (v.Type == JTokenType.Integer || v.Type == JTokenType.Float) && v.Value<double>() is double d && !double.IsNaN(d) && !double.IsInfinity(d) && Math.Truncate(d) == d && d >= min && d <= max;
    public static bool Null(JToken? v) => v?.Type == JTokenType.Null;
    public static bool GuidValue(JToken? v) => Match(v,"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}") && Text(v) != Guid.Empty.ToString();
    public static bool Etag(JToken? v) => Match(v,"W/\"[1-9][0-9]{0,18}\"");
    public static bool Revision(JToken? v) => Match(v,"0|[1-9][0-9]{0,18}") && long.TryParse(Text(v),NumberStyles.None,CultureInfo.InvariantCulture,out _);
    public static string Increment(JToken? v) { Require(Revision(v) && Text(v) != long.MaxValue.ToString(CultureInfo.InvariantCulture),"invalid_head_revision"); return (long.Parse(Text(v)!,CultureInfo.InvariantCulture)+1).ToString(CultureInfo.InvariantCulture); }
    public static bool Key(JToken? v) => Match(v,"[a-z0-9]+(?:[._-][a-z0-9]+)+") && Text(v)!.Length <= 850;
    public static JObject Shape(JToken? v, params string[] fields)
    {
        Require(v is JObject o && o.Count == fields.Length && fields.All(k=>o.Property(k,StringComparison.Ordinal)!=null),"invalid_publication_shape"); return (JObject)v!;
    }
    public static JObject Catalog(JToken? value)
    {
        var c=Shape(value,"title","description","groupKey","sectionKey","usedBy","usageCategory");
        var caps=new[]{200,4000,80,80,4000,40};
        foreach(var p in c.Properties()) { var cap=caps[Array.IndexOf(new[]{"title","description","groupKey","sectionKey","usedBy","usageCategory"},p.Name)]; Require(Null(p.Value)||Text(p.Value) is string s && s.Length<=cap,"invalid_catalog_text"); }
        foreach(var k in new[]{"groupKey","sectionKey"})Require(Null(c[k])||Match(c[k],"[a-z0-9]+(?:[._-][a-z0-9]+)*"),"invalid_catalog_key");
        Require(Null(c["sectionKey"])||!Null(c["groupKey"]),"section_requires_group");return c;
    }
    public static void Current(JToken? value, bool nullable=true)
    {
        if(nullable && Null(value))return;
        var c=Shape(value,"id","version","etag");Require(GuidValue(c["id"])&&Integer(c["version"],1,int.MaxValue)&&Etag(c["etag"]),"invalid_current");
    }
    // Baseline byte/UTF16 limits use JSON.stringify spelling, not Json.NET's
    // extra escaping of U+0085/U+2028/U+2029. Numbers here are schemaVersion=1.
    private static string BaselineJson(JToken value)
    {
        if(value is JObject obj)return "{"+string.Join(",",obj.Properties().Select(p=>BaselineJson(new JValue(p.Name))+":"+BaselineJson(p.Value)))+"}";
        if(value.Type==JTokenType.Null)return "null";
        if(value.Type==JTokenType.Integer)return value.Value<int>().ToString(CultureInfo.InvariantCulture);
        Require(value.Type==JTokenType.String,"invalid_baseline");var result=new StringBuilder("\"");
        foreach(var c in value.Value<string>()!)
        {
            var at="\"\\\b\f\n\r\t".IndexOf(c);
            if(at>=0)result.Append('\\').Append("\"\\bfnrt"[at]);
            else if(c<32)result.Append("\\u").Append(((int)c).ToString("x4",CultureInfo.InvariantCulture));
            else result.Append(c);
        }
        return result.Append('"').ToString();
    }
    public static JObject Baseline(JToken? value)
    {
        var b=Shape(value,"schemaVersion","current","catalog","headRevision");Require(Integer(b["schemaVersion"],1,1)&&Revision(b["headRevision"]),"invalid_baseline");Catalog(b["catalog"]);
        if(!Null(b["current"])) {var c=Shape(b["current"],"id","etag");Require(GuidValue(c["id"])&&Etag(c["etag"]),"invalid_baseline_current");}
        var bounded=(JObject)b.DeepClone();bounded["schemaVersion"]=1;var serialized=BaselineJson(bounded);
        Require(serialized.Length<=16000&&Encoding.UTF8.GetByteCount(serialized)<=16000,"baseline_too_large");return b;
    }
    public static JObject Request(string json)
    {
        var r=Shape(CanonicalJson.Parse(json),"contractVersion","definitionFormatVersion","policyRevision","policyArtifactHash","requestId","operation","promptKey","draftId","draftEtag","expectedHeadRevision","expectedCurrent","metadataBaseline","snapshotHash");
        Require(Integer(r["contractVersion"],1,1)&&Integer(r["definitionFormatVersion"],1,1),"unsupported_contract_version");
        Require(Integer(r["policyRevision"],1,int.MaxValue)&&Match(r["policyArtifactHash"],"[0-9a-f]{64}"),"invalid_policy_identity");
        Require(GuidValue(r["requestId"])&&GuidValue(r["draftId"])&&Etag(r["draftEtag"]),"invalid_request_identity");
        Require(Text(r["operation"])=="publish"&&Key(r["promptKey"])&&Match(r["snapshotHash"],"[0-9a-f]{64}"),"invalid_publication_request");Increment(r["expectedHeadRevision"]);Current(r["expectedCurrent"]);
        var b=Baseline(r["metadataBaseline"]);Require(Equal(b["headRevision"],r["expectedHeadRevision"]),"baseline_head_mismatch");
        Require(Null(r["expectedCurrent"])?Null(b["current"]):!Null(b["current"])&&Equal(b["current"]!["id"],r["expectedCurrent"]!["id"])&&Equal(b["current"]!["etag"],r["expectedCurrent"]!["etag"]),"baseline_current_mismatch");
        Require(!Null(b["current"])||((JObject)b["catalog"]!).Properties().All(p=>Null(p.Value)),"new_name_baseline_not_empty");
        Require(Null(r["expectedCurrent"])||!Equal(r["expectedCurrent"]!["id"],r["draftId"]),"draft_equals_current");return r;
    }
    public static JObject Actor(Guid org,Guid initiator,Guid effective)
    { Require(org!=Guid.Empty&&initiator!=Guid.Empty&&effective!=Guid.Empty,"invalid_actor_context");return new JObject{["organizationId"]=org.ToString(),["initiatingUserId"]=initiator.ToString(),["effectiveUserId"]=effective.ToString()}; }
    public static void Actor(JToken? actor) {var a=Shape(actor,"organizationId","initiatingUserId","effectiveUserId");Require(a.Properties().All(p=>GuidValue(p.Value)),"invalid_actor_context");}
    public static JObject Snapshot(JToken? value)
    {var s=Shape(value,"definitionFormatVersion","definition","catalog");Require(Integer(s["definitionFormatVersion"],1,1),"unsupported_definition_version");Shape(s["definition"],"name","systemPrompt","body","variables","outputSchema","model","temperature","maxTokens");Catalog(s["catalog"]);CanonicalJson.Preimage(Json(s));return s;}
    public static string Fingerprint(JObject request,JObject actor)
    {Request(Json(request));Actor(actor);return CanonicalJson.Hash("wmkf.prompt.publication.v1",Json(new JObject{["fingerprintVersion"]=1,["request"]=request.DeepClone(),["actor"]=actor.DeepClone(),["canonicalKey"]=request["promptKey"]!.DeepClone()}));}
    public static JObject Receipt(string json)
    {
        var r=Shape(CanonicalJson.Parse(json),"receiptVersion","fingerprintVersion","request","actor","requestFingerprint","published","headRevision","publishedAt");
        Require(Integer(r["receiptVersion"],1,1)&&Integer(r["fingerprintVersion"],1,1),"unsupported_receipt_version");var request=Request(Json(r["request"]!));Actor(r["actor"]);Current(r["published"],false);
        Require(Match(r["requestFingerprint"],"[0-9a-f]{64}")&&Equal(r["published"]!["id"],request["draftId"])&&(Null(request["expectedCurrent"])||r["published"]!["version"]!.Value<double>()>request["expectedCurrent"]!["version"]!.Value<double>()),"invalid_published_result");
        Require(Text(r["headRevision"])==Increment(request["expectedHeadRevision"]),"invalid_committed_revision");
        Require(Match(r["publishedAt"],"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z")&&DateTime.TryParseExact(Text(r["publishedAt"])!.StartsWith("0000",StringComparison.Ordinal)?"2000"+Text(r["publishedAt"])!.Substring(4):Text(r["publishedAt"]),"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out _),"invalid_timestamp");return r;
    }
    public static JObject Replay(string json,JObject request,JObject actor)
    {var r=Receipt(json);Require(Text(r["requestFingerprint"])==Fingerprint((JObject)r["request"]!,(JObject)r["actor"]!)&&Text(r["requestFingerprint"])==Fingerprint(request,actor),"publication_request_id_reused");return r;}
}
