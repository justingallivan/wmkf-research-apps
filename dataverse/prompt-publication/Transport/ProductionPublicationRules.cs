// Production SDK rules, one trusted invocation/target. No provider/HTTP calls.
using System;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json.Linq;
namespace Wmkf.PromptPublication;
public sealed class ProductionPublicationRules : IPublicationRules
{
    public const string Settings="wmkf_appsystemsetting",SettingId="wmkf_appsystemsettingid",Key="wmkf_settingkey",Value="wmkf_settingvalue",BudgetControl="prompt-library.budget-coordination",Groups="prompt-library.groups",BudgetPrefix="executor.budgets.v";
    private readonly TransactionSdk sdk;private BudgetRules? pinnedBudgets;private BudgetRules budgets=>pinnedBudgets??=new BudgetRules();
    private readonly IOrganizationService service;private readonly Guid organization;private readonly bool enabled;
    public ProductionPublicationRules(TransactionSdk sdk,IOrganizationService service,Guid organization,bool enabled){this.enabled=enabled;this.sdk=sdk??throw new ArgumentNullException(nameof(sdk));this.service=service??throw new ArgumentNullException(nameof(service));this.organization=organization;}
    public void AssertInstalledPolicy(JObject request){PublicationWire.Require(enabled,"publication_disabled");PinnedPolicy.AssertRequest(request);sdk.AssertContext();PublicationSchema.AssertReady(service,organization);}
    private Entity Setting(string key)
    {
        var q=new QueryExpression(Settings){ColumnSet=new ColumnSet(Key,Value)};q.Criteria.AddCondition(Key,ConditionOperator.Equal,key);var rows=sdk.ReadAll(q,SettingId);
        PublicationWire.Require(rows.Count==1&&rows[0].GetAttributeValue<string>(Key)==key&&rows[0].GetAttributeValue<string>(Value)!=null,"setting_missing_duplicate_or_invalid");return rows[0];
    }
    public JObject? FenceBudgetBeforeHead(JObject request)
    {
        var name=PublicationWire.Text(request["promptKey"])!;if(!budgets.RequiresFence(name))return null;
        var row=Setting(BudgetControl);var control=(JObject)CanonicalJson.Parse(row.GetAttributeValue<string>(Value));PublicationWire.Require(control.Property("etag",StringComparison.Ordinal)==null,"budget_control_embedded_etag");control["etag"]=TransactionSdk.WeakEtag(row.RowVersion);BudgetRules.Control(control);
        var next=PublicationWire.Increment(control["revision"]);var stored=new JObject{["schemaVersion"]=1,["revision"]=next,["policyRevision"]=PinnedPolicy.Revision,["policyArtifactHash"]=PinnedPolicy.ArtifactHash};
        sdk.ConditionalUpdate(new Entity(Settings,row.Id){[Value]=PublicationWire.Json(stored)},PublicationWire.Text(control["etag"])!);
        var fenced=sdk.ReadById(Settings,row.Id,Key,Value);var readback=CanonicalJson.Parse(fenced.GetAttributeValue<string>(Value));
        PublicationWire.Require(fenced.GetAttributeValue<string>(Key)==BudgetControl&&PublicationWire.Equal(stored,readback)&&fenced.RowVersion!=row.RowVersion,"invalid_budget_fence_result");
        return new JObject{["control"]=control,["state"]=ReadBudgetState()};
    }
    private JObject ReadBudgetState()
    {
        var q=new QueryExpression(Settings){ColumnSet=new ColumnSet(Key,Value)};q.Criteria.AddCondition(Key,ConditionOperator.BeginsWith,BudgetPrefix);var rows=sdk.ReadAll(q,SettingId);
        var keys=new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);var current=0;var latest=0;var selected=budgets.Defaults();var warnings=new JArray();
        foreach(var row in rows)
        {
            var key=row.GetAttributeValue<string>(Key);PublicationWire.Require(key!=null&&key.StartsWith(BudgetPrefix,StringComparison.Ordinal)&&keys.Add(key),"invalid_budget_history_read");
            var suffix=key!.Substring(BudgetPrefix.Length);var version=Regex.IsMatch(suffix,@"\A[0-9]{6}\z")?int.Parse(suffix,CultureInfo.InvariantCulture):0;if(version>0)latest=Math.Max(latest,version);
            JToken? parsed=null;try{parsed=CanonicalJson.Parse(row.GetAttributeValue<string>(Value)??"");}catch(FormatException error){if(error.Message!="invalid_json")throw new InvalidOperationException("unsupported_budget_state");}
            if(parsed is JObject future&&future.Property("schemaVersion",StringComparison.Ordinal)!=null&&!PublicationWire.Integer(future["schemaVersion"],1,1))throw new InvalidOperationException("unsupported_budget_state");
            // Malformed reserved revisions are warnings, never permission to reuse
            // a version. Ambiguous strict JSON/future schema fails the whole read.
            try
            {
                PublicationWire.Require(version>0,"invalid_executor_budget_revision");var e=PublicationWire.Shape(parsed,"schemaVersion","version","requestId","publishedAt","budgets");
                PublicationWire.Require(PublicationWire.Integer(e["schemaVersion"],1,1)&&PublicationWire.Integer(e["version"],version,version)&&PublicationWire.Text(e["requestId"]) is string id&&Regex.IsMatch(DefinitionRules.JsTrim(id),@"\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z"),"invalid_executor_budget_revision");
                var time=PublicationWire.Text(e["publishedAt"]);PublicationWire.Require(time!=null&&Regex.IsMatch(time,@"\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z\z")&&DateTime.TryParseExact(time,"yyyy-MM-dd\'T\'HH:mm:ss.fff\'Z\'",CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out _),"unsupported_budget_state");
                var values=budgets.ValidateBudgets(e["budgets"],true);if(version>current){selected=values;current=version;}
            }
            catch(InvalidOperationException error)
            {if(error.Message=="unsupported_budget_state")throw;warnings.Add(new JObject{["code"]="invalid_executor_budget_revision",["version"]=version>0?new JValue(version):JValue.CreateNull()});}
        }
        var state=new JObject{["schemaVersion"]=1,["currentVersion"]=current,["latestRevision"]=latest,["budgets"]=selected,["warnings"]=warnings};budgets.State(state);return state;
    }
    public void ValidateFresh(JObject request,JObject snapshot,JObject? capturedBudget)
    {
        PinnedPolicy.AssertRequest(request);PublicationWire.Snapshot(snapshot);new DefinitionRules().Validate(PublicationWire.Json(snapshot["definition"]!));
        var name=PublicationWire.Text(request["promptKey"])!;
        if(budgets.RequiresFence(name))
        {var captured=PublicationWire.Shape(capturedBudget,"control","state");budgets.AssertModel(name,snapshot["definition"]!["model"],(JObject)captured["state"]!,(JObject)captured["control"]!);}
        else PublicationWire.Require(capturedBudget==null,"unexpected_budget_fence");
    }
    public void ValidateCatalogAssignments(JObject catalog,JObject baseline,bool firstPublication)
    {
        PublicationWire.Catalog(catalog);PublicationWire.Catalog(baseline);var row=Setting(Groups);var raw=row.GetAttributeValue<string>(Value);var groups=CatalogGroups(CanonicalJson.Parse(raw));
        // The shared row CAS coordinates referencing publication and removal.
        // Raw removals are denied by SettingsGuard; a future audited group editor
        // must take this same original CAS and inspect ALL references.
        sdk.ConditionalUpdate(new Entity(Settings,row.Id){[Value]=raw},TransactionSdk.WeakEtag(row.RowVersion));
        var fenced=sdk.ReadById(Settings,row.Id,Key,Value);
        PublicationWire.Require(fenced.GetAttributeValue<string>(Key)==Groups&&fenced.GetAttributeValue<string>(Value)==raw&&fenced.RowVersion!=row.RowVersion,"invalid_catalog_fence_result");
        if(firstPublication||!PublicationWire.Equal(catalog["groupKey"],baseline["groupKey"])||!PublicationWire.Equal(catalog["sectionKey"],baseline["sectionKey"]))
        {
            var group=groups.SingleOrDefault(g=>PublicationWire.Equal(g["key"],catalog["groupKey"]));PublicationWire.Require(group!=null,"invalid_catalog_assignment");
            PublicationWire.Require(PublicationWire.Null(catalog["sectionKey"])||((JArray)group!["sections"]!).Any(s=>PublicationWire.Equal(s["key"],catalog["sectionKey"])),"invalid_catalog_assignment");
        }
    }
    public static JObject[] CatalogGroups(JToken value)
    {
        var root=PublicationWire.Shape(value,"schemaVersion","groups");PublicationWire.Require(PublicationWire.Integer(root["schemaVersion"],1,1)&&root["groups"] is JArray,"invalid_group_catalog");var keys=new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
        void Entry(JObject e){PublicationWire.Require(PublicationWire.Match(e["key"],"[a-z0-9]+(?:[._-][a-z0-9]+)*")&&PublicationWire.Text(e["key"])!.Length<=80&&!string.IsNullOrWhiteSpace(PublicationWire.Text(e["label"]))&&PublicationWire.Integer(e["order"],-9007199254740991d,9007199254740991d),"invalid_group_catalog");}
        foreach(var valueGroup in (JArray)root["groups"]!)
        {var g=PublicationWire.Shape(valueGroup,"key","label","order","sections");Entry(g);PublicationWire.Require(keys.Add(PublicationWire.Text(g["key"])!)&&g["sections"] is JArray,"invalid_group_catalog");var sectionKeys=new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);foreach(var s in (JArray)g["sections"]!){var section=PublicationWire.Shape(s,"key","label","order");Entry(section);PublicationWire.Require(sectionKeys.Add(PublicationWire.Text(section["key"])!),"invalid_group_catalog");}}
        return ((JArray)root["groups"]!).Cast<JObject>().ToArray();
    }
}
