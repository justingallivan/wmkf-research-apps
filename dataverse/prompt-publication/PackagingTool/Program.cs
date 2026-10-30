using System.IO.Compression;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using static StrongNames;
internal static class Program
{
    private static readonly string[] Dlls={"lib/net48/Wmkf.PromptPublication.Transport.dll","lib/net48/Newtonsoft.Json.dll"};
    private static string Text(JsonNode node,string field)=>node[field]?.GetValue<string>()??throw new InvalidDataException("missing_package_field");
    private static byte[] Entry(ZipArchiveEntry e){Require(e.Length<=16777216,"package_entry_too_large");using var input=e.Open();using var output=new MemoryStream();var buffer=new byte[8192];int read;while((read=input.Read(buffer))>0){Require(output.Length+read<=16777216,"package_entry_too_large");output.Write(buffer,0,read);}Require(output.Length==e.Length,"invalid_zip_length");return output.ToArray();}
    private static Dictionary<string,byte[]> Resources(byte[] dll)
    {
        using var pe=new PEReader(new MemoryStream(dll));var reader=pe.GetMetadataReader();var d=pe.PEHeaders.CorHeader!.ResourcesDirectory;Require(pe.PEHeaders.TryGetDirectoryOffset(d,out _),"embedded_resources_missing");pe.PEHeaders.TryGetDirectoryOffset(d,out var start);var resources=new Dictionary<string,byte[]>(StringComparer.Ordinal);
        foreach(var handle in reader.ManifestResources){var resource=reader.GetManifestResource(handle);Require(resource.Implementation.IsNil,"external_resource_denied");var at=checked(start+(int)resource.Offset);var length=System.Buffers.Binary.BinaryPrimitives.ReadInt32LittleEndian(dll.AsSpan(at,4));Require(length>=0&&length<=1048576,"embedded_resource_too_large");resources.Add(reader.GetString(resource.Name),dll.AsSpan(at+4,length).ToArray());}return resources;
    }
    private static string Framework(MetadataReader r)
    {
        foreach(var handle in r.GetAssemblyDefinition().GetCustomAttributes())
        {var a=r.GetCustomAttribute(handle);if(a.Constructor.Kind!=HandleKind.MemberReference)continue;var constructor=r.GetMemberReference((MemberReferenceHandle)a.Constructor);if(constructor.Parent.Kind!=HandleKind.TypeReference)continue;var type=r.GetTypeReference((TypeReferenceHandle)constructor.Parent);if(r.GetString(type.Namespace)!="System.Runtime.Versioning"||r.GetString(type.Name)!="TargetFrameworkAttribute")continue;var blob=r.GetBlobReader(a.Value);Require(blob.ReadUInt16()==1,"invalid_framework_attribute");return blob.ReadSerializedString()??"";}throw new InvalidDataException("framework_attribute_missing");
    }
    private static string SourcePacket(string root)
    {
        var raw=File.ReadAllBytes(Path.Combine(root,"dataverse/prompt-publication/rehearsal/packet.json"));var packet=JsonNode.Parse(raw)!;
        Require(Text(packet,"status")=="PREPARED_NOT_REHEARSED"&&packet["deploymentAuthorized"]!.GetValue<bool>()==false&&packet["liveWritesAuthorized"]!.GetValue<bool>()==false,"source_packet_authority_invalid");
        foreach(var pair in packet["sourceHashes"]!.AsObject())
        {Require(!Path.IsPathRooted(pair.Key)&&!pair.Key.Split('/').Contains("..")&&!pair.Key.Contains('\\'),"invalid_source_path");var file=Path.GetFullPath(Path.Combine(root,pair.Key));Require(file.StartsWith(Path.GetFullPath(root)+Path.DirectorySeparatorChar,StringComparison.Ordinal)&&new FileInfo(file).LinkTarget==null,"source_path_escapes_root");Require(Sha(File.ReadAllBytes(file))==pair.Value!.GetValue<string>(),"source_packet_drift");}
        Require(Sha(System.Text.Encoding.UTF8.GetBytes(packet["sourceHashes"]!.ToJsonString()))==Text(packet,"sourceDigest"),"source_digest_invalid");return Sha(raw);
    }
    private static string EmbeddedSource(MetadataReader r)
    {
        var values=new List<string>();foreach(var handle in r.GetAssemblyDefinition().GetCustomAttributes())
        {var a=r.GetCustomAttribute(handle);if(a.Constructor.Kind!=HandleKind.MemberReference)continue;var ctor=r.GetMemberReference((MemberReferenceHandle)a.Constructor);if(ctor.Parent.Kind!=HandleKind.TypeReference)continue;var t=r.GetTypeReference((TypeReferenceHandle)ctor.Parent);if(r.GetString(t.Namespace)!="System.Reflection"||r.GetString(t.Name)!="AssemblyMetadataAttribute")continue;var blob=r.GetBlobReader(a.Value);Require(blob.ReadUInt16()==1,"invalid_source_attribute");var key=blob.ReadSerializedString();var value=blob.ReadSerializedString();if(key=="PromptPublication.SourcePacketSha256")values.Add(value??"");}
        Require(values.Count==1,"signed_source_binding_missing");return values[0];
    }
    internal static JsonObject Inspect(string root,string package)
    {
        var sourcePacketHash=SourcePacket(root);var identity=JsonNode.Parse(File.ReadAllText(Path.Combine(root,"dataverse/prompt-publication/registration/signing-identity.json")))!;
        Require(new FileInfo(package).Length<=33554432,"package_too_large");var packageBytes=File.ReadAllBytes(package);Require(packageBytes.Length<=33554432,"package_too_large");using var archive=new ZipArchive(new MemoryStream(packageBytes),ZipArchiveMode.Read);Require(archive.Entries.Count<=10&&archive.Entries.Select(e=>e.FullName).Distinct(StringComparer.Ordinal).Count()==archive.Entries.Count,"duplicate_or_excess_package_entries");
        foreach(var e in archive.Entries)
        {var name=e.FullName;Require(Dlls.Contains(name,StringComparer.Ordinal)||name=="WMKF.PromptPublication.nuspec"||name=="README.md"||name=="[Content_Types].xml"||name=="_rels/.rels"||System.Text.RegularExpressions.Regex.IsMatch(name,@"\Apackage/services/metadata/core-properties/[0-9a-f]{32}\.psmdcp\z"),"unexpected_package_entry");Require(e.Length<=16777216,"package_entry_too_large");}
        using var nuspecReader=System.Xml.XmlReader.Create(new MemoryStream(Entry(archive.GetEntry("WMKF.PromptPublication.nuspec")??throw new InvalidDataException("nuspec_missing"))),new System.Xml.XmlReaderSettings{DtdProcessing=System.Xml.DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=65536});var nuspec=XDocument.Load(nuspecReader);
        string Meta(string name)=>nuspec.Descendants().Single(e=>e.Name.LocalName==name).Value;
        Require(Meta("id")==Text(identity,"packageId")&&Meta("version")==Text(identity,"packageVersion")&&!nuspec.Descendants().Any(e=>e.Name.LocalName=="dependency"),"invalid_package_identity_or_dependencies");
        Require(!nuspec.Descendants().Any(e=>e.Name.LocalName=="repository"&&e.Attribute("commit")!=null),"misleading_commit_provenance");
        var hashes=new JsonObject();byte[]? plugin=null;
        foreach(var path in Dlls)
        {
            var bytes=Entry(archive.GetEntry(path)??throw new InvalidDataException("required_assembly_missing"));var key=Verify(bytes);hashes[path]=Sha(bytes);
            using var pe=new PEReader(new MemoryStream(bytes));var r=pe.GetMetadataReader();var a=r.GetAssemblyDefinition();var name=r.GetString(a.Name);
            if(path==Dlls[0])
            {
                Require(EmbeddedSource(r)==sourcePacketHash,"signed_source_binding_mismatch");
                var informational=new List<string>();foreach(var attributeHandle in a.GetCustomAttributes()){var attribute=r.GetCustomAttribute(attributeHandle);if(attribute.Constructor.Kind!=HandleKind.MemberReference)continue;var ctor=r.GetMemberReference((MemberReferenceHandle)attribute.Constructor);if(ctor.Parent.Kind!=HandleKind.TypeReference)continue;var type=r.GetTypeReference((TypeReferenceHandle)ctor.Parent);if(r.GetString(type.Namespace)!="System.Reflection"||r.GetString(type.Name)!="AssemblyInformationalVersionAttribute")continue;var blob=r.GetBlobReader(attribute.Value);Require(blob.ReadUInt16()==1,"invalid_version_attribute");informational.Add(blob.ReadSerializedString()??"");}Require(informational.SequenceEqual(new[]{"1.0.0"}),"misleading_commit_provenance");
                Require(name==Text(identity,"assemblyName")&&a.Version.ToString()==Text(identity,"assemblyVersion")&&Token(key)==Text(identity,"publicKeyToken")&&Sha(key)==Text(identity,"publicKeySha256")&&Framework(r)==".NETFramework,Version=v4.8","plugin_identity_or_framework_mismatch");
                var refs=r.AssemblyReferences.Select(h=>r.GetString(r.GetAssemblyReference(h).Name)).ToArray();var allowed=new[]{"mscorlib","System","System.Core","System.Runtime.Serialization","System.ServiceModel","System.Xml","Microsoft.Xrm.Sdk","Microsoft.Crm.Sdk.Proxy","Newtonsoft.Json"};Require(refs.All(n=>allowed.Contains(n,StringComparer.Ordinal)),"unbundled_or_unknown_plugin_reference");
                foreach(var handle in r.AssemblyReferences){var reference=r.GetAssemblyReference(handle);var referenceName=r.GetString(reference.Name);if(referenceName=="Microsoft.Xrm.Sdk"||referenceName=="Microsoft.Crm.Sdk.Proxy"||referenceName=="Newtonsoft.Json")Require(reference.Version==(referenceName=="Newtonsoft.Json"?new Version(13,0,0,0):new Version(9,0,0,0))&&Convert.ToHexString(r.GetBlobBytes(reference.PublicKeyOrToken)).ToLowerInvariant()==(referenceName=="Newtonsoft.Json"?"30ad4fe6b2a6aeed":"31bf3856ad364e35"),"plugin_reference_identity_mismatch");}
                var types=r.TypeDefinitions.Select(h=>r.GetTypeDefinition(h)).Where(t=>t.GetInterfaceImplementations().Any(i=>r.GetInterfaceImplementation(i).Interface.Kind==HandleKind.TypeReference&&r.GetString(r.GetTypeReference((TypeReferenceHandle)r.GetInterfaceImplementation(i).Interface).Name)=="IPlugin"&&r.GetString(r.GetTypeReference((TypeReferenceHandle)r.GetInterfaceImplementation(i).Interface).Namespace)=="Microsoft.Xrm.Sdk")).Select(t=>r.GetString(t.Namespace)+"."+r.GetString(t.Name)).OrderBy(s=>s,StringComparer.Ordinal).ToArray();
                Require(types.SequenceEqual(new[]{"Wmkf.PromptPublication.PromptPublicationGuardPlugin","Wmkf.PromptPublication.PublishPromptPlugin"}),"unexpected_plugin_types");plugin=bytes;
            }
            else Require(name=="Newtonsoft.Json"&&a.Version==new Version(13,0,0,0)&&Token(key)=="30ad4fe6b2a6aeed"&&Sha(bytes)=="e1e27af7b07eeedf5ce71a9255f0422816a6fc5849a483c6714e1b472044fa9d","dependency_identity_mismatch");
        }
        var resources=Resources(plugin!);Require(resources.Count==2,"unexpected_embedded_resource");var bindings=resources["Wmkf.PromptPublication.ReleaseBindings.json"];var policy=resources["Wmkf.PromptPublication.Policy.v1.json"];
        var expectedBindings=File.ReadAllBytes(Path.Combine(root,"dataverse/prompt-publication/registration/bindings.json"));
        var expectedPolicy=File.ReadAllBytes(Path.Combine(root,"lib/prompt-publication/policy-v1.json"));
        Require(Sha(bindings)==Sha(expectedBindings)&&Sha(policy)==Sha(expectedPolicy),"embedded_source_mismatch");
        var b=JsonNode.Parse(bindings)!;Require(b["enabled"]!.GetValue<bool>()==false&&b["organizationId"]==null&&b["publisherExtensionId"]==null&&b["executePrivilege"]==null&&b["publisherIds"]!.AsArray().Count==0&&b["initiatingPrincipalIds"]!.AsArray().Count==0,"package_must_remain_disabled_unbound");
        var artifact=JsonNode.Parse(policy)!;
        return new JsonObject{["receiptVersion"]=1,["status"]="SIGNED_PREPARATION_VERIFIED_NOT_REGISTERED",["deploymentAuthorized"]=false,["liveWritesAuthorized"]=false,["packageId"]=Text(identity,"packageId"),["packageVersion"]=Text(identity,"packageVersion"),["packageSha256"]=Sha(packageBytes),["assemblySigning"]="full-strong-name-cryptographically-verified",["nugetCertificateSignature"]="none",["publicKeyToken"]=Text(identity,"publicKeyToken"),["publicKeySha256"]=Text(identity,"publicKeySha256"),["assemblyHashes"]=hashes,["policyArtifactHash"]=artifact["hash"]!.DeepClone(),["bindingsSha256"]=Sha(bindings),["registrationManifestSha256"]=Sha(File.ReadAllBytes(Path.Combine(root,"dataverse/prompt-publication/registration/manifest.json"))),["sourcePacketSha256"]=sourcePacketHash};
    }
    internal static void VerifyReceipt(string root,string package,string receipt)=>Require(JsonNode.DeepEquals(Inspect(root,package),JsonNode.Parse(File.ReadAllText(receipt))),"package_receipt_drift");
    public static int Main(string[] args)
    {
        try
        {
            if(args.Length==3&&args[0]=="create-key"){CreateKey(args[1],args[2]);Console.WriteLine("Created retained key; only public identity recorded.");return 0;}
            if(args.Length==3&&args[0]=="self-test"){Console.WriteLine($"Packaging self-tests passed: {PackageTests.Run(args[1],args[2])}. No tenant connection.");return 0;}
            if(args.Length==3&&args[0]=="inspect"){Console.WriteLine(Inspect(args[1],args[2]).ToJsonString(new(){WriteIndented=true}));return 0;}
            if(args.Length==4&&args[0]=="verify-receipt"){VerifyReceipt(args[1],args[2],args[3]);Console.WriteLine("Signed package and preparation receipt verified; no tenant connection.");return 0;}
            throw new InvalidDataException("unsupported_packaging_command");
        }
        catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
