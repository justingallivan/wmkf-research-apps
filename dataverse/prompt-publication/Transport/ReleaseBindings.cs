// Reviewed build-time environment/identity bindings, not Custom API input or a
// mutable settings row. MainOperation has no constructor configuration support.
using System;
using System.IO;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Newtonsoft.Json.Linq;
namespace Wmkf.PromptPublication;
public sealed class ReleaseBindings
{
    public const string ApiMessage="wmkf_PublishPrompt",RequestParameter="RequestJson",ResponseParameter="ResultJson",Preimage="publication";
    private readonly JObject data;
    private ReleaseBindings(JObject data){this.data=(JObject)data.DeepClone();}
    public static ReleaseBindings Parse(string json)
    {
        var d=PublicationWire.Shape(CanonicalJson.Parse(json),"bindingVersion","enabled","organizationId","publisherExtensionId","publisherIds","initiatingPrincipalIds","executePrivilege");
        PublicationWire.Require(PublicationWire.Integer(d["bindingVersion"],1,1)&&d["enabled"]?.Type==JTokenType.Boolean&&d["publisherIds"] is JArray&&d["initiatingPrincipalIds"] is JArray,"invalid_release_bindings");
        foreach(var name in new[]{"publisherIds","initiatingPrincipalIds"}){var a=(JArray)d[name]!;PublicationWire.Require(a.All(PublicationWire.GuidValue)&&a.Select(PublicationWire.Text).Distinct(StringComparer.Ordinal).Count()==a.Count,"invalid_release_identity");}
        foreach(var name in new[]{"organizationId","publisherExtensionId"})PublicationWire.Require(PublicationWire.Null(d[name])||PublicationWire.GuidValue(d[name]),"invalid_release_identity");
        PublicationWire.Require(PublicationWire.Null(d["executePrivilege"])||PublicationWire.Match(d["executePrivilege"],"prv[A-Za-z0-9_]+"),"invalid_execute_privilege_binding");return new ReleaseBindings(d);
    }
    public static ReleaseBindings Packaged()
    {using var stream=typeof(ReleaseBindings).Assembly.GetManifestResourceStream("Wmkf.PromptPublication.ReleaseBindings.json")??throw new InvalidOperationException("release_bindings_missing");using var reader=new StreamReader(stream);return Parse(reader.ReadToEnd());}
    public bool Enabled=>data["enabled"]!.Value<bool>();
    public Guid Organization=>Guid.Parse(PublicationWire.Text(data["organizationId"])!);
    public Guid Extension=>Guid.Parse(PublicationWire.Text(data["publisherExtensionId"])!);
    public string ExecutePrivilege=>PublicationWire.Text(data["executePrivilege"])!;
    public Guid[] Publishers=>((JArray)data["publisherIds"]!).Select(v=>Guid.Parse(PublicationWire.Text(v)!)).ToArray();
    public void AssertBound(IPluginExecutionContext context,bool publication)
    {
        PublicationWire.Require(PublicationWire.GuidValue(data["organizationId"])&&PublicationWire.GuidValue(data["publisherExtensionId"])&&((JArray)data["publisherIds"]!).Count>0&&PublicationWire.Text(data["executePrivilege"])!=null,"release_bindings_incomplete");
        PublicationWire.Require(context.OrganizationId==Organization&&context.Mode==0&&!context.IsExecutingOffline&&!context.IsOfflinePlayback&&context.IsInTransaction,"plugin_target_or_transaction_mismatch");
        if(publication)
        {
            PublicationWire.Require(context.Stage==30&&context.MessageName==ApiMessage&&context.OwningExtension?.Id==Extension,"publication_registration_mismatch");
            PublicationWire.Require(Publishers.Contains(context.UserId)&&((JArray)data["publisherIds"]!).Concat((JArray)data["initiatingPrincipalIds"]!).Any(v=>PublicationWire.Text(v)==context.InitiatingUserId.ToString()),"publication_actor_not_bound");
        }
        else PublicationWire.Require(context.Stage==20,"guard_registration_mismatch");
    }
}
