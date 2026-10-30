// Production v1 acceptance rules. Mirrors JS definition-schema/template-policy/
// consumer-contract; throws content-free fixed codes, not editable memo content.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Wmkf.PromptPublication;

public sealed class DefinitionRules
{
    private readonly JObject policy=PinnedPolicy.Read();
    private const string Space="\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
    internal static string JsTrim(string value)=>value.Trim(Space.ToCharArray());
    private static string? S(JToken? v)=>PublicationWire.Text(v);
    private static bool N(JToken? v)=>PublicationWire.Null(v);
    private static void Need(bool b,string code)=>PublicationWire.Require(b,code);
    private static bool Has(JObject o,string k)=>o.Property(k,StringComparison.Ordinal)!=null;
    private static bool Bool(JToken? v,bool expected)=>v?.Type==JTokenType.Boolean&&v.Value<bool>()==expected;
    private static bool Num(JToken? v)=>v?.Type==JTokenType.Float||v?.Type==JTokenType.Integer;
    private static bool Positive(JToken? v)=>PublicationWire.Integer(v,1,int.MaxValue);
    private static bool Bound(JToken? v)=>PublicationWire.Integer(v,0,int.MaxValue);
    private static bool Text(JToken? v,int cap,bool blank=false)=>S(v) is string s&&s.Length<=cap&&(blank||s.Trim(Space.ToCharArray()).Length>0);
    private static bool In(JToken? v,params string[] choices)=>S(v) is string s&&choices.Contains(s,StringComparer.Ordinal);
    private static bool Forbidden(string s)=>new[]{"__proto__","constructor","prototype"}.Contains(s,StringComparer.Ordinal);
    private static JObject Shape(JToken? value,string required,string optional="")
    {Need(value is JObject,"object_required");var o=(JObject)value!;var r=required.Split(new[]{' '},StringSplitOptions.RemoveEmptyEntries);var a=r.Concat(optional.Split(new[]{' '},StringSplitOptions.RemoveEmptyEntries));Need(r.All(k=>Has(o,k)),"missing_field");Need(o.Properties().All(p=>a.Contains(p.Name,StringComparer.Ordinal)),"unknown_field");return o;}
    private static void Bools(JObject o,params string[] keys){foreach(var k in keys)if(Has(o,k))Need(o[k]!.Type==JTokenType.Boolean,"boolean_required");}
    private static JObject? ParseMemo(JToken? value)
    {if(N(value)||S(value)=="")return null;Need(S(value)!=null,"json_text_required");var parsed=CanonicalJson.Parse(S(value)!);Need(parsed is JObject,"object_required");return (JObject)parsed;}
    private static string Lower(string s)=>string.Concat(s.Select(c=>c>='A'&&c<='Z'?(char)(c+32):c));
    private static bool Member(JToken? list,string value)=>list is JArray a&&a.Any(v=>S(v)==value);
    private static bool Equal(JToken? a,JToken? b)=>PublicationWire.Equal(a??JValue.CreateNull(),b??JValue.CreateNull());
    private static IEnumerable<JProperty> JsProperties(JObject o)
    {
        bool Index(string s)=>uint.TryParse(s,NumberStyles.None,CultureInfo.InvariantCulture,out var n)&&n<uint.MaxValue&&n.ToString(CultureInfo.InvariantCulture)==s;
        return o.Properties().Where(p=>Index(p.Name)).OrderBy(p=>uint.Parse(p.Name,CultureInfo.InvariantCulture)).Concat(o.Properties().Where(p=>!Index(p.Name)));
    }
    private static bool OrderedEqual(JToken a,JToken b)
    {if(a is JObject x&&b is JObject y){var xp=JsProperties(x).ToArray();var yp=JsProperties(y).ToArray();return xp.Length==yp.Length&&xp.Select((p,i)=>p.Name==yp[i].Name&&OrderedEqual(p.Value,yp[i].Value)).All(v=>v);}if(a is JArray ax&&b is JArray ay)return ax.Count==ay.Count&&ax.Select((v,i)=>OrderedEqual(v,ay[i])).All(v=>v);return Equal(a,b);}
    public JObject ResolveModel(JToken? model,string name,bool native=false)
    {
        var value=S(model);
        if(N(model)){Need(!native&&policy["defaultsByName"] is JObject defaults&&defaults.Property(name,StringComparison.Ordinal)!=null,"model_default_not_registered");value=S(policy["defaultsByName"]![name]);}
        else Need(!string.IsNullOrEmpty(value),"model_required");
        if(value!=null&&Regex.IsMatch(value,@"\A[A-Za-z]+\z")&&((JObject)policy["tiers"]!).Property(Lower(value),StringComparison.Ordinal)!=null){Need(!native,"native_requires_concrete_model");value=S(policy["tiers"]![Lower(value)]);}
        Need(value!=null&&((JObject)policy["models"]!).Property(value,StringComparison.Ordinal)!=null,"unreviewed_model");var capabilities=(JObject)policy["models"]![value!]!;
        Need(!native||Bool(capabilities["supportsStructuredOutput"],true),"native_unsupported");return (JObject)capabilities.DeepClone();
    }
    public void Validate(string json)
    {
        var d=Shape(CanonicalJson.Parse(json),"name systemPrompt body variables outputSchema model temperature maxTokens");
        Need(PublicationWire.Key(d["name"]),"invalid_canonical_key");var name=S(d["name"])!;Need(!Member(policy["pendingConsumerNames"],name),"consumer_contract_pending");
        var consumer=((JObject)policy["consumerContracts"]!)[name] as JObject;var templateOnly=((JObject)policy["templateOnlyByName"]!).Property(name,StringComparison.Ordinal)!=null;
        var variables=ParseMemo(d["variables"]);var outputs=ParseMemo(d["outputSchema"]);Need(outputs!=null||templateOnly,"output_schema_required");
        var names=new List<string>();
        if(variables!=null)
        {
            Shape(variables,"variables");Need(variables["variables"] is JArray,"variables_array_required");
            foreach(var value in (JArray)variables["variables"]!)
            {
                var item=Shape(value,"name","source required cacheable untrusted placement dataClass maxChars");Need(PublicationWire.Match(item["name"],"[A-Za-z0-9_]+"),"invalid_variable_name");Need(!Forbidden(S(item["name"])!),"forbidden_property_name");names.Add(S(item["name"])!);
                if(Has(item,"source"))Source(item["source"],consumer!=null);else Need(templateOnly,"source_required");
                Bools(item,"required","cacheable","untrusted");if(Has(item,"placement"))Need(In(item["placement"],"user","system"),"unsupported_placement");
                if(Has(item,"dataClass"))Need(Text(item["dataClass"],100),"invalid_data_class");if(Has(item,"maxChars"))Need(Positive(item["maxChars"]),"invalid_max_chars");
                Need(Has(item,"dataClass")==Has(item,"maxChars")&&(!Bool(item["untrusted"],true)||Has(item,"dataClass")&&Has(item,"maxChars")),"incomplete_boundary");
            }
        }
        Templates(d,names,consumer);
        if(consumer!=null)
        {
            foreach(var pair in new[]{("variables",variables,"variablesJson"),("outputSchema",outputs,"outputJson")})
            {var expected=consumer[pair.Item3];Need(N(expected)?pair.Item2==null:pair.Item2!=null&&(Bool(consumer["orderedMemos"],true)?OrderedEqual(pair.Item2,CanonicalJson.Parse(S(expected)!)):Equal(pair.Item2,CanonicalJson.Parse(S(expected)!))),"consumer_memo_mismatch");}
            if(Has(consumer,"systemExact"))Need(Equal(d["systemPrompt"],consumer["systemExact"]),"consumer_system_mismatch");if(!N(consumer["body"]))Need(Equal(d["body"],consumer["body"]),"consumer_body_mismatch");
            Need(S(d["systemPrompt"]) is string system&&((JArray)consumer["systemIncludes"]!).All(v=>system.Contains(S(v)!)),"consumer_system_assertion_missing");
            if(!N(consumer["rowMaxTokens"])&&Num(d["maxTokens"]))Need(d["maxTokens"]!.Value<double>()<=consumer["rowMaxTokens"]!.Value<double>(),"consumer_row_token_limit");Need(N(consumer["blockedReason"]),S(consumer["blockedReason"])??"consumer_blocked");
        }
        if(outputs!=null)Outputs(outputs,Bool(consumer?["rootPassThrough"],true));
        if(S(d["model"]) is string modelName&&Regex.IsMatch(modelName,@"\A[A-Za-z]+\z")&&((JObject)policy["tiers"]!).Property(Lower(modelName),StringComparison.Ordinal)!=null)Need(modelName==Lower(modelName),"noncanonical_model");
        var model=ResolveModel(d["model"],name,S(outputs?["generationMode"])=="native-json-schema");Need(Positive(d["maxTokens"]),"invalid_max_tokens");Need(d["maxTokens"]!.Value<double>()<=model["maxOutputTokens"]!.Value<double>(),"model_output_limit_exceeded");
        Need(N(d["temperature"])?templateOnly||Bool(consumer?["allowNullTemperature"],true):Num(d["temperature"])&&d["temperature"]!.Value<double>()>=0&&d["temperature"]!.Value<double>()<=1,"invalid_temperature");
    }
    private void Templates(JObject d,List<string> names,JObject? consumer)
    {
        var used=new HashSet<string>(StringComparer.Ordinal);var bodyUsed=new HashSet<string>(StringComparer.Ordinal);Need(names.Distinct(StringComparer.Ordinal).Count()==names.Count,"duplicate_variable");
        foreach(var field in new[]{"systemPrompt","body"})
        {
            Need(S(d[field])!=null,"text_required");var text=S(d[field])!;Need(field!="body"||text.Trim(Space.ToCharArray()).Length>0,"body_blank");Need(text.Length<=65536,"template_too_long");var lower=Lower(text);
            foreach(var p in (JArray)policy["forbiddenPatterns"]!)
            {var pattern=Lower(S(p["source"])!).Replace("\\s","[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]");Need(!Regex.IsMatch(lower,pattern,RegexOptions.CultureInvariant,TimeSpan.FromSeconds(1)),"a7_marker");}
            foreach(Match token in Regex.Matches(text,@"\{\{([\s\S]*?)\}\}",RegexOptions.CultureInvariant,TimeSpan.FromSeconds(1)))
            {var match=Regex.Match(token.Value,"\\A(?:"+S(policy["placeholder"]!["token"])+")\\z",RegexOptions.CultureInvariant);Need(match.Success,"unsupported_placeholder");used.Add(match.Groups[1].Value);if(field=="body")bodyUsed.Add(match.Groups[1].Value);}
        }
        Need(used.All(names.Contains),"undeclared_variable");Need(names.All(n=>used.Contains(n)||Member(consumer?["unusedDeclarations"],n)),"unused_variable");
        var name=S(d["name"])!;var reviewer=policy["reviewerContracts"]![name];var template=policy["templateContracts"]![name];
        if(reviewer is JObject r){Need(((JArray)r["requiredPlaceholders"]!).All(v=>bodyUsed.Contains(S(v)!)),"required_placeholder_missing");Need(((JArray)r["requiredLabels"]!).All(v=>S(d["body"])!.Contains(S(v)!)),"required_label_missing");}
        if(template is JObject t)Need(((JArray)t["requiredPlaceholders"]!).All(v=>used.Contains(S(v)!)),"required_placeholder_missing");
    }
    private static void Source(JToken? value,bool audited)
    {
        Need(value is JObject,"source_required");var source=(JObject)value!;var kind=S(source["kind"]);
        var extras=kind=="override"?"default":kind=="dynamics"?"table field":kind=="sharepoint"?"pattern preprocess maxChars":null;Need(extras!=null,"unsupported_source");Shape(source,"kind",extras!);
        if(kind=="override"&&Has(source,"default"))Need(S(source["default"])!=null||audited&&(source["default"]!.Type==JTokenType.Boolean||Num(source["default"])),"invalid_default");
        if(kind=="dynamics"){Need(!Has(source,"table")||S(source["table"])=="akoya_request","unsupported_table");Need(PublicationWire.Match(source["field"],"[A-Za-z_][A-Za-z0-9_]*"),"invalid_field");}
        if(kind=="sharepoint"){Need(Text(source["pattern"],1000),"invalid_pattern");Need(!Has(source,"preprocess")||S(source["preprocess"])=="pdf_to_text","unsupported_preprocess");Need(!Has(source,"maxChars")||Positive(source["maxChars"]),"invalid_max_chars");}
    }
    private static void Outputs(JObject spec,bool rootPassThrough)
    {
        Shape(spec,"outputs","parseMode generationMode jsonSchema validationSchema rawOutputRetention");var parse=Has(spec,"parseMode")?S(spec["parseMode"]):"json";Need(parse=="raw"||parse=="json","unsupported_parse_mode");
        Need(!Has(spec,"generationMode")||N(spec["generationMode"])||S(spec["generationMode"])=="native-json-schema","unsupported_generation_mode");Need(!Has(spec,"rawOutputRetention")||In(spec["rawOutputRetention"],"full","hash","none"),"unsupported_retention");
        Need(spec["outputs"] is JArray list&&list.Count>0,"outputs_required");var outputs=(JArray)spec["outputs"]!;Need(parse!="raw"||outputs.Count==1,"raw_single_output_required");
        var names=new HashSet<string>(StringComparer.Ordinal);var destinations=new Dictionary<string,HashSet<string>>(StringComparer.Ordinal);
        foreach(var value in outputs)
        {
            var o=Shape(value,"name target","type guard");Need(PublicationWire.Match(o["name"],"[A-Za-z0-9_]+")&&!Forbidden(S(o["name"])!)&&names.Add(S(o["name"])!),"invalid_or_duplicate_output_name");
            Need(!Has(o,"type")||In(o["type"],"string","text","object","array","number","integer","boolean","json"),"unsupported_output_type");Need(!Has(o,"guard")||In(o["guard"],"skip-if-populated","always-overwrite"),"unsupported_guard");
            Need(o["target"] is JObject&&In(o["target"]!["kind"],"none","akoya_request"),"unsupported_target");var target=(JObject)o["target"]!;Shape(target,"kind",S(target["kind"])=="none"?"":"field jsonPath");
            if(S(target["kind"])=="akoya_request")
            {
                Need(PublicationWire.Match(target["field"],"[A-Za-z_][A-Za-z0-9_]*"),"invalid_field");var field=S(target["field"])!;var path=Has(target,"jsonPath")?S(target["jsonPath"]):"";
                if(Has(target,"jsonPath"))Need(PublicationWire.Match(target["jsonPath"],"\\$\\.[A-Za-z0-9_]+")&&!Forbidden(path!.Substring(2)),"invalid_json_path");
                if(!destinations.TryGetValue(field,out var prior))destinations[field]=prior=new HashSet<string>(StringComparer.Ordinal);Need(!prior.Contains(path!)&&!(path==""&&prior.Count>0)&&!prior.Contains(""),"duplicate_output_target");prior.Add(path!);
            }
        }
        Need(parse!="raw"||!Has(spec,"jsonSchema")&&!Has(spec,"validationSchema"),"raw_schema_ignored");var native=S(spec["generationMode"])=="native-json-schema";
        Need(!native||S(spec["parseMode"])=="json"&&spec["jsonSchema"] is JObject,"native_json_schema_required");
        if(spec["jsonSchema"] is JObject schema){Need(!Has(schema,"type")||S(schema["type"])=="object","output_root_object_required");if(native&&!rootPassThrough)Need(names.All(n=>schema["properties"] is JObject properties&&Has(properties,n)&&Member(schema["required"],n)),"output_schema_name_mismatch");}
        if(!rootPassThrough&&spec["validationSchema"] is JObject validation)Need(S(validation["type"])=="object"&&validation["fields"] is JObject fields&&names.All(n=>Has(fields,n)),"output_schema_name_mismatch");
        if(Has(spec,"jsonSchema"))JsonSchema(spec["jsonSchema"],native);if(Has(spec,"validationSchema"))ValidationNode(spec["validationSchema"]);
    }
    private static void ValidationNode(JToken? value)
    {
        Need(value is JObject,"unsupported_validation_node");var n=(JObject)value!;var type=S(n["type"]);
        var extras=type=="string"?"maxLength forbidPattern enum coerceEnum":type=="integer"||type=="number"?"min max":type=="boolean"?"":type=="array"?"of maxItems":type=="object"?"fields allowExtra":type=="record"?"of keys maxEntries":null;Need(extras!=null,"unsupported_validation_node");Shape(n,"type","required nullable default "+extras);
        Bools(n,"required","nullable","coerceEnum");foreach(var k in new[]{"maxLength","maxItems","maxEntries"})Need(!Has(n,k)||Bound(n[k]),"invalid_bound");
        foreach(var k in new[]{"min","max"})Need(!Has(n,k)||Num(n[k])&&(type!="integer"||PublicationWire.Integer(n[k],-9007199254740991d,9007199254740991d)),"invalid_bound");
        Need(!Num(n["min"])||!Num(n["max"])||n["min"]!.Value<double>()<=n["max"]!.Value<double>(),"inverted_bounds");
        if(Has(n,"enum"))Need(n["enum"] is JArray a&&a.Count>0&&a.All(v=>S(v)!=null)&&a.Select(S).Distinct(StringComparer.Ordinal).Count()==a.Count,"invalid_enum");
        Need(!Bool(n["coerceEnum"],true)||Has(n,"default")&&n["enum"] is JArray en&&en.Any(v=>Equal(v,n["default"])),"invalid_enum_default");Need(!Has(n,"forbidPattern"),"pattern_requires_consumer_review");
        if(type=="object"){Need(n["fields"] is JObject,"fields_required");foreach(var p in ((JObject)n["fields"]!).Properties()){Need(!Forbidden(p.Name),"forbidden_property_name");ValidationNode(p.Value);}Need(!Has(n,"allowExtra")||S(n["allowExtra"])=="error","unsupported_allow_extra");}
        if(type=="array"||type=="record")ValidationNode(n["of"]);
        if(type=="record"&&Has(n,"keys")){var keys=Shape(n["keys"],"","maxLength pattern enum");Need(!Has(keys,"maxLength")||Positive(keys["maxLength"]),"invalid_bound");Need(!Has(keys,"pattern"),"pattern_requires_consumer_review");Need(!Has(keys,"enum")||keys["enum"] is JArray a&&a.Count>0&&a.All(v=>Text(v,1000)),"invalid_enum");}
        if(Has(n,"default"))
        {
            var d=n["default"]!;if(N(d)&&Bool(n["nullable"],true))return;
            var valid=type=="string"?S(d) is string s&&(!Has(n,"maxLength")||s.Length<=n["maxLength"]!.Value<int>())&&(!Has(n,"enum")||((JArray)n["enum"]!).Any(v=>Equal(v,d)))
                :type=="number"||type=="integer"?Num(d)&&(type!="integer"||PublicationWire.Integer(d,-9007199254740991d,9007199254740991d))&&(!Has(n,"min")||d.Value<double>()>=n["min"]!.Value<double>())&&(!Has(n,"max")||d.Value<double>()<=n["max"]!.Value<double>())
                :type=="boolean"?d.Type==JTokenType.Boolean:type=="array"&&d is JArray arr&&arr.Count==0;Need(valid,"invalid_schema_default");
        }
    }
    private static void JsonSchema(JToken? value,bool native)
    {
        var n=Shape(value,"","type properties required additionalProperties items enum description title minimum maximum minLength maxLength minItems maxItems");var type=S(n["type"]);var types=new[]{"object","array","string","number","integer","boolean","null"};
        if(Has(n,"type"))Need(type!=null&&types.Contains(type,StringComparer.Ordinal)||!native&&n["type"] is JArray a&&a.Count>0&&a.All(v=>S(v)!=null&&types.Contains(S(v)!,StringComparer.Ordinal))&&a.Select(S).Distinct(StringComparer.Ordinal).Count()==a.Count,"unsupported_json_schema_type");
        Need(!native||Has(n,"type"),"json_schema_type_required");Need(!native||!new[]{"minimum","maximum","minLength","maxLength","maxItems"}.Any(k=>Has(n,k)),"unsupported_native_constraint");Need(!native||!Has(n,"minItems")||PublicationWire.Integer(n["minItems"],0,1),"unsupported_native_constraint");
        foreach(var k in new[]{"description","title"})Need(!Has(n,k)||Text(n[k],4000,true),"invalid_schema_text");foreach(var k in new[]{"minLength","maxLength","minItems","maxItems"})Need(!Has(n,k)||Bound(n[k]),"invalid_bound");foreach(var k in new[]{"minimum","maximum"})Need(!Has(n,k)||Num(n[k]),"invalid_bound");
        foreach(var pair in new[]{("minimum","maximum"),("minLength","maxLength"),("minItems","maxItems")})Need(!Num(n[pair.Item1])||!Num(n[pair.Item2])||n[pair.Item1]!.Value<double>()<=n[pair.Item2]!.Value<double>(),"inverted_bounds");
        Need(!Has(n,"enum")||n["enum"] is JArray en&&en.Count>0&&en.All(v=>N(v)||S(v)!=null||Num(v)||v.Type==JTokenType.Boolean),"invalid_enum");
        if(Has(n,"type")){Need(type=="object"||!new[]{"properties","required","additionalProperties"}.Any(k=>Has(n,k)),"schema_keyword_type_mismatch");Need(type=="array"||!new[]{"items","minItems","maxItems"}.Any(k=>Has(n,k)),"schema_keyword_type_mismatch");}
        if(Has(n,"additionalProperties")&&n["additionalProperties"]!.Type!=JTokenType.Boolean){Need(!native&&n["additionalProperties"] is JObject,"unsupported_additional_properties");JsonSchema(n["additionalProperties"],false);}
        Need(!native||type!="object"||Bool(n["additionalProperties"],false),"native_closed_object_required");
        if(Has(n,"properties")){Need(n["properties"] is JObject,"properties_required");foreach(var p in ((JObject)n["properties"]!).Properties()){Need(!Forbidden(p.Name),"forbidden_property_name");JsonSchema(p.Value,native);}}else Need(!native||type!="object","properties_required");
        if(Has(n,"required")){Need(n["required"] is JArray a&&a.All(v=>Text(v,1000))&&a.Select(S).Distinct(StringComparer.Ordinal).Count()==a.Count,"invalid_required");if(n["properties"] is JObject properties)Need(((JArray)n["required"]!).All(v=>Has(properties,S(v)!)),"required_property_missing");}
        if(Has(n,"items"))JsonSchema(n["items"],native);else Need(type!="array","items_required");
    }
}
