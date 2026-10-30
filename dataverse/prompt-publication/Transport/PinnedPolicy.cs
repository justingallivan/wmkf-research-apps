// Packaged, byte-pinned reviewed policy. Never accept policy or model data from a caller.
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Wmkf.PromptPublication;

public static class PinnedPolicy
{
    public const string ArtifactHash="50bcb07a28fd786b1000e6527bd1b06c34170e0088ede2bc35228ebba1f76c5b";
    public const int Revision=5;
    private static readonly JObject Packaged=Load();
    private static JObject Load()
    {
        using var stream=typeof(PinnedPolicy).Assembly.GetManifestResourceStream("Wmkf.PromptPublication.Policy.v1.json")??throw new InvalidOperationException("packaged_policy_missing");
        using var memory=new MemoryStream();stream.CopyTo(memory);var bytes=memory.ToArray();using var sha=SHA256.Create();
        PublicationWire.Require(string.Concat(sha.ComputeHash(bytes).Select(b=>b.ToString("x2")))=="36e88fd6dac92aaec96866cc8605d24757c8204bd37752ebebe06a904250dc87","packaged_policy_corrupt");
        var artifact=(JObject)CanonicalJson.Parse(Encoding.UTF8.GetString(bytes));
        PublicationWire.Require(PublicationWire.Text(artifact["hash"])==ArtifactHash&&PublicationWire.Integer(artifact["policy"]?["policyVersion"],Revision,Revision),"packaged_policy_identity_mismatch");// ASCII folding is valid only for the reviewed marker grammar. Future
        // class escapes/backreferences need an explicit port, never lower \S.
        foreach(var pattern in (JArray)artifact["policy"]!["forbiddenPatterns"]!)
        {
            PublicationWire.Require(PublicationWire.Text(pattern["flags"])=="i"&&PublicationWire.Text(pattern["source"]) is string,"unsupported_packaged_marker_pattern");
            foreach(Match escape in Regex.Matches(PublicationWire.Text(pattern["source"])!,@"\\."))PublicationWire.Require(new[]{@"\s",@"\[",@"\]",@"\/"}.Contains(escape.Value,StringComparer.Ordinal),"unsupported_packaged_marker_pattern");
        }
        return (JObject)artifact["policy"]!;
    }
    public static JObject Read()=>(JObject)Packaged.DeepClone();
    public static void AssertRequest(JObject request)=>PublicationWire.Require(PublicationWire.Integer(request["policyRevision"],Revision,Revision)&&PublicationWire.Text(request["policyArtifactHash"])==ArtifactHash,"policy_changed");
}
