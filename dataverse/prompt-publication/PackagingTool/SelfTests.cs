using System.IO.Compression;
using System.Reflection.PortableExecutable;
using System.Text.Json.Nodes;
using static StrongNames;
internal static partial class PackageTests
{
    internal static int Run(string root,string package)
    {
        var count=0;var temp=Path.Combine(Path.GetTempPath(),"pr553-package-test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temp);
        void Check(bool value,string label){Require(value,label);count++;}
        void Deny(Action action,string code){try{action();}catch(InvalidDataException e){Check(e.Message==code,"unexpected_test_error:"+e.Message);return;}throw new InvalidDataException("test_accepted:"+code);}
        try
        {
            var good=Program.Inspect(root,package);Check(good["assemblySigning"]!.GetValue<string>()=="full-strong-name-cryptographically-verified","signed_positive");
            using var original=ZipFile.OpenRead(package);
            void Copy(string target,string scenario)
            {
                using var zip=ZipFile.Open(target,ZipArchiveMode.Create);
                foreach(var entry in original.Entries)
                {
                    if(scenario=="missing-dependency"&&entry.FullName.EndsWith("/Newtonsoft.Json.dll",StringComparison.Ordinal))continue;
                    using var input=entry.Open();using var data=new MemoryStream();input.CopyTo(data);var bytes=data.ToArray();
                    if(entry.FullName.EndsWith("/Wmkf.PromptPublication.Transport.dll",StringComparison.Ordinal)&&(scenario=="signature"||scenario=="body"||scenario=="public-sign"))
                    {
                        using var pe=new PEReader(new MemoryStream(bytes));var directory=pe.PEHeaders.CorHeader!.StrongNameSignatureDirectory;pe.PEHeaders.TryGetDirectoryOffset(directory,out var at);
                        if(scenario=="signature")bytes[at]^=1;
                        if(scenario=="public-sign")bytes.AsSpan(at,directory.Size).Clear();
                        if(scenario=="body"){var s=pe.PEHeaders.SectionHeaders[0];bytes[s.PointerToRawData+s.SizeOfRawData-1]^=1;}
                    }
                    using var output=zip.CreateEntry(entry.FullName).Open();output.Write(bytes);
                }
                var extra=scenario=="sdk"?"lib/net48/Microsoft.Xrm.Sdk.dll":scenario=="net8"?"lib/net8.0/Unexpected.dll":scenario=="key"?"private.snk":scenario=="duplicate"?"README.md":null;
                if(extra!=null){using var entry=zip.CreateEntry(extra).Open();entry.Write(new byte[]{1,2,3});}
            }
            foreach(var scenario in new[]{"signature","body","public-sign","sdk","net8","key","duplicate","missing-dependency"})
            {var candidate=Path.Combine(temp,scenario+".nupkg");Copy(candidate,scenario);Deny(()=>Program.Inspect(root,candidate),scenario=="signature"||scenario=="body"||scenario=="public-sign"?"strong_name_signature_invalid":scenario=="duplicate"?"duplicate_or_excess_package_entries":scenario=="missing-dependency"?"required_assembly_missing":"unexpected_package_entry");}
            var wrong=(JsonObject)good.DeepClone();wrong["packageSha256"]=new string('0',64);var wrongReceipt=Path.Combine(temp,"wrong-receipt.json");File.WriteAllText(wrongReceipt,wrong.ToJsonString());Deny(()=>Program.VerifyReceipt(root,package,wrongReceipt),"package_receipt_drift");
            // Actual source is copied into isolated scratch, never edited in-place.
            var clone=Path.Combine(temp,"source");var packetPath="dataverse/prompt-publication/rehearsal/packet.json";var packet=JsonNode.Parse(File.ReadAllText(Path.Combine(root,packetPath)))!;
            foreach(var source in packet["sourceHashes"]!.AsObject().Select(p=>p.Key).Append(packetPath)){var target=Path.Combine(clone,source);Directory.CreateDirectory(Path.GetDirectoryName(target)!);File.Copy(Path.Combine(root,source),target);}
            File.AppendAllText(Path.Combine(clone,"lib/prompt-publication/transaction-core.js"),"\n");Deny(()=>Program.Inspect(clone,package),"source_packet_drift");
            if(!OperatingSystem.IsWindows())
            {
                var key=Path.Combine(temp,"private","test.snk");var identity=Path.Combine(temp,"test-identity.json");CreateKey(key,identity);
                Check((File.GetUnixFileMode(key)&(UnixFileMode)0x3f)==0,"key_permissions_private");Deny(()=>CreateKey(key,Path.Combine(temp,"other.json")),"signing_output_must_be_new");
            }
            var bound=new JsonObject{["bindingVersion"]=1,["enabled"]=false,["organizationId"]="3d52a072-b138-ef11-8e4b-000d3a106422",["publisherExtensionId"]="10000000-0000-4000-8000-000000000021",["publisherIds"]=new JsonArray("10000000-0000-4000-8000-000000000022"),["initiatingPrincipalIds"]=new JsonArray(),["executePrivilege"]="prvCreateTestReceipt"};
            byte[] Bytes(JsonObject value)=>System.Text.Encoding.UTF8.GetBytes(value.ToJsonString());
            Program.ValidateBoundDisabled(Bytes(bound));Check(true,"bound_disabled_positive");
            foreach(var scenario in new[]{"enabled","organization","extension","empty-publishers","duplicate","unknown-field","privilege","uppercase"})
            {
                var value=(JsonObject)bound.DeepClone();var code="invalid_bound_disabled_shape";
                if(scenario=="enabled")value["enabled"]=true;
                if(scenario=="organization"){value["organizationId"]="10000000-0000-4000-8000-000000000001";code="bound_test_identity_required";}
                if(scenario=="extension"){value["publisherExtensionId"]="00000000-0000-0000-0000-000000000000";code="bound_test_identity_required";}
                if(scenario=="empty-publishers"){value["publisherIds"]=new JsonArray();code="bound_actor_privilege_required";}
                if(scenario=="duplicate"){value["publisherIds"]!.AsArray().Add(value["publisherIds"]![0]!.DeepClone());code="invalid_bound_identity_list";}
                if(scenario=="unknown-field")value["bypass"]=true;
                if(scenario=="privilege"){value["executePrivilege"]="prvCreateTestReceipt\n";code="bound_actor_privilege_required";}
                if(scenario=="uppercase"){value["publisherIds"]=new JsonArray("10000000-0000-4000-8000-0000000000AA");code="invalid_bound_identity_list";}
                Deny(()=>Program.ValidateBoundDisabled(Bytes(value)),code);
            }
            return count;
        }
        finally{Directory.Delete(temp,true);}
    }
}
