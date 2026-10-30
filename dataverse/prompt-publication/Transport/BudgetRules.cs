// Closed pinned registry; never infer budget exemptions from request metadata.
using System;
using System.Linq;
using Newtonsoft.Json.Linq;
namespace Wmkf.PromptPublication;
public sealed class BudgetRules
{
    private readonly JObject registry=(JObject)PinnedPolicy.Read()["budgetRegistry"]!;
    public bool RequiresFence(string name)=>registry["defaults"] is JObject d&&d.Property(name,StringComparison.Ordinal)!=null&&PublicationWire.Text(d[name]!["kind"])!="timeout";
    public JObject Defaults()=>(JObject)registry["defaults"]!.DeepClone();
    public JObject ValidateBudgets(JToken? value,bool fillDefaults=false)
    {
        PublicationWire.Require(value is JObject,"invalid_budget_shape");var b=(JObject)value!;var defaults=Defaults();
        PublicationWire.Require(b.Properties().All(p=>defaults.Property(p.Name,StringComparison.Ordinal)!=null),"budget_registry_mismatch");
        if(!fillDefaults)PublicationWire.Shape(b,defaults.Properties().Select(p=>p.Name).ToArray());var result=new JObject();
        foreach(var p in defaults.Properties())
        {
            var entry=b.Property(p.Name,StringComparison.Ordinal)?.Value??p.Value;
            PublicationWire.Shape(entry,((JObject)p.Value).Properties().Select(v=>v.Name).ToArray());PublicationWire.Require(PublicationWire.Equal(entry["kind"],p.Value["kind"]),"invalid_budget_shape");
            foreach(var bound in ((JObject)registry["limits"]![p.Name]!).Properties())PublicationWire.Require(PublicationWire.Integer(entry[bound.Name],bound.Value["min"]!.Value<double>(),bound.Value["max"]!.Value<double>()),"budget_out_of_bounds");
            if(PublicationWire.Text(entry["kind"])=="retry")PublicationWire.Require(entry["floor"]!.Value<double>()<=entry["ceiling"]!.Value<double>(),"inverted_budget_range");result[p.Name]=entry.DeepClone();
        }
        return result;
    }
    public static JObject Control(JToken? value)
    {
        var c=PublicationWire.Shape(value,"schemaVersion","revision","etag","policyRevision","policyArtifactHash");
        PublicationWire.Require(PublicationWire.Integer(c["schemaVersion"],1,1)&&PublicationWire.Revision(c["revision"])&&PublicationWire.Text(c["revision"])!="9223372036854775807"&&PublicationWire.Etag(c["etag"])&&PublicationWire.Integer(c["policyRevision"],1,int.MaxValue)&&PublicationWire.Match(c["policyArtifactHash"],"[0-9a-f]{64}"),"invalid_budget_control");return c;
    }
    public JObject State(JToken? value)
    {
        var s=PublicationWire.Shape(value,"schemaVersion","currentVersion","latestRevision","budgets","warnings");PublicationWire.Require(PublicationWire.Integer(s["schemaVersion"],1,1)&&PublicationWire.Integer(s["currentVersion"],0,999999)&&PublicationWire.Integer(s["latestRevision"],s["currentVersion"]!.Value<double>(),999999)&&s["warnings"] is JArray,"invalid_budget_state");
        foreach(var warning in (JArray)s["warnings"]!)
        {var w=PublicationWire.Shape(warning,"code","version");PublicationWire.Require((PublicationWire.Text(w["code"])=="invalid_executor_budget_revision"||PublicationWire.Text(w["code"])=="invalid_executor_budgets")&&(PublicationWire.Null(w["version"])||PublicationWire.Integer(w["version"],1,s["latestRevision"]!.Value<double>())),"unsupported_budget_state");}
        ValidateBudgets(s["budgets"]);PublicationWire.Require(s["currentVersion"]!.Value<int>()!=0||PublicationWire.Equal(s["budgets"],Defaults()),"invalid_budget_fallback");return s;
    }
    public void AssertModel(string name,JToken? model,JObject state,JObject control)
    {
        if(!RequiresFence(name))return;Control(control);State(state);var cap=new DefinitionRules().ResolveModel(model,name);
        var budget=state["budgets"]![name]!;var required=budget[PublicationWire.Text(budget["kind"])=="standing"?"maxTokensOverride":"ceiling"]!.Value<int>();
        PublicationWire.Require(required<=cap["maxOutputTokens"]!.Value<int>(),"budget_model_conflict");if(name=="review-panel.seat")PublicationWire.Require(required<=registry["secondarySeatCeiling"]!.Value<int>(),"budget_secondary_model_conflict");
    }
}
