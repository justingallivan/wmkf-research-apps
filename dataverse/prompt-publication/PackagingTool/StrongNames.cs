// Offline ECMA-335 strong-name inspection. No Assembly.Load/SDK execution.
// Protocol cross-check: source.dot.net/Microsoft.DotNet.StrongName/{Utils,Verification}.cs.html
using System.Buffers.Binary;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
internal static class StrongNames
{
    internal static void Require(bool value,string code){if(!value)throw new InvalidDataException(code);}
    internal static string Sha(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    internal static string Token(byte[] publicKey)=>Convert.ToHexString(SHA1.HashData(publicKey)[^8..].Reverse().ToArray()).ToLowerInvariant(); // Strong-name identity protocol, not certificate trust.
    internal static byte[] PublicFromPrivate(byte[] key)
    {
        Require(key.Length>=20&&key[0]==7&&key[1]==2&&BinaryPrimitives.ReadUInt32LittleEndian(key.AsSpan(8))==0x32415352,"invalid_private_signing_key");
        var width=checked((int)BinaryPrimitives.ReadUInt32LittleEndian(key.AsSpan(12))/8);Require(width>=256&&key.Length==20+width*9/2,"invalid_private_signing_key");
        var csp=key[..(20+width)];csp[0]=6;BinaryPrimitives.WriteUInt32LittleEndian(csp.AsSpan(8),0x31415352);
        var result=new byte[12+csp.Length];BinaryPrimitives.WriteUInt32LittleEndian(result,0x2400);BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(4),0x8004);BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(8),(uint)csp.Length);csp.CopyTo(result,12);return result;
    }
    internal static void CreateKey(string keyPath,string identityPath)
    {
        Require(Path.IsPathFullyQualified(keyPath)&&!File.Exists(keyPath)&&!File.Exists(identityPath),"signing_output_must_be_new");
        if(OperatingSystem.IsWindows())throw new InvalidDataException("generate_key_with_reviewed_platform_custody");
        Directory.CreateDirectory(Path.GetDirectoryName(keyPath)!,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);
        Require((File.GetUnixFileMode(Path.GetDirectoryName(keyPath)!)&(UnixFileMode)0x3f)==0,"signing_directory_not_private");
        using var rsa=RSA.Create(2048);var p=rsa.ExportParameters(true);Require(p.Exponent!.SequenceEqual(new byte[]{1,0,1}),"unexpected_rsa_exponent");byte[]? blob=null;
        try
        {
            using var memory=new MemoryStream();using(var writer=new BinaryWriter(memory,System.Text.Encoding.UTF8,true))
            {writer.Write((byte)7);writer.Write((byte)2);writer.Write((ushort)0);writer.Write(0x2400u);writer.Write(0x32415352u);writer.Write(2048u);writer.Write(65537u);foreach(var value in new[]{p.Modulus,p.P,p.Q,p.DP,p.DQ,p.InverseQ,p.D})writer.Write(value!.Reverse().ToArray());}
            blob=memory.ToArray();var publicKey=PublicFromPrivate(blob);
            using(var output=new FileStream(keyPath,new FileStreamOptions{Mode=FileMode.CreateNew,Access=FileAccess.Write,Share=FileShare.None,UnixCreateMode=UnixFileMode.UserRead|UnixFileMode.UserWrite}))output.Write(blob);
            var identity=new JsonObject{["identityVersion"]=1,["assemblyName"]="Wmkf.PromptPublication.Transport",["assemblyVersion"]="1.0.0.0",["packageId"]="WMKF.PromptPublication",["packageVersion"]="1.0.0",["publicKeyToken"]=Token(publicKey),["publicKeySha256"]=Sha(publicKey),["keyOwner"]="Connor",["custody"]="created-locally-awaiting-secure-transfer",["assemblySigning"]="full-strong-name",["nugetCertificateSignature"]="none"};
            using var identityFile=new FileStream(identityPath,FileMode.CreateNew,FileAccess.Write,FileShare.None);System.Text.Json.JsonSerializer.Serialize(identityFile,identity,new System.Text.Json.JsonSerializerOptions{WriteIndented=true});
        }
        finally{if(blob!=null)CryptographicOperations.ZeroMemory(blob);foreach(var value in new[]{p.D,p.P,p.Q,p.DP,p.DQ,p.InverseQ})if(value!=null)CryptographicOperations.ZeroMemory(value);}
    }
    internal static byte[] Verify(byte[] bytes)
    {
        using var pe=new PEReader(new MemoryStream(bytes));var h=pe.PEHeaders;Require(pe.HasMetadata&&h.PEHeader!=null&&h.CorHeader!=null&&(h.CorHeader.Flags&CorFlags.StrongNameSigned)!=0,"assembly_not_fully_signed");
        var reader=pe.GetMetadataReader();var a=reader.GetAssemblyDefinition();var key=reader.GetBlobBytes(a.PublicKey);
        Require(key.Length>=32&&BinaryPrimitives.ReadUInt32LittleEndian(key)==0x2400&&BinaryPrimitives.ReadUInt32LittleEndian(key.AsSpan(4))==0x8004&&key[12]==6&&key[13]==2&&BinaryPrimitives.ReadUInt32LittleEndian(key.AsSpan(20))==0x31415352,"unsupported_strong_name_key");
        var width=checked((int)BinaryPrimitives.ReadUInt32LittleEndian(key.AsSpan(24))/8);Require(width>=128&&key.Length==32+width&&BinaryPrimitives.ReadUInt32LittleEndian(key.AsSpan(8))==key.Length-12,"invalid_strong_name_key");
        var sn=h.CorHeader!.StrongNameSignatureDirectory;Require(sn.Size==width&&h.TryGetDirectoryOffset(sn,out _),"strong_name_signature_missing");h.TryGetDirectoryOffset(sn,out var offset);
        var signature=bytes.AsSpan(offset,sn.Size).ToArray();Array.Reverse(signature);var image=(byte[])bytes.Clone();var optional=h.PEHeaderStartOffset;
        image.AsSpan(optional+64,4).Clear();image.AsSpan(optional+(h.PEHeader!.Magic==PEMagic.PE32?96:112)+32,8).Clear();
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA1); // Required by the strong-name protocol.
        var headerEnd=checked(optional+h.CoffHeader.SizeOfOptionalHeader+h.SectionHeaders.Length*40);hash.AppendData(image.AsSpan(0,headerEnd));
        foreach(var section in h.SectionHeaders)
        {
            var start=section.PointerToRawData;var end=checked(start+section.SizeOfRawData);
            if(offset>=start&&offset<end){Require(offset+sn.Size<=end,"split_strong_name_signature");hash.AppendData(image.AsSpan(start,offset-start));hash.AppendData(image.AsSpan(offset+sn.Size,end-offset-sn.Size));}
            else hash.AppendData(image.AsSpan(start,section.SizeOfRawData));
        }
        var exponent=key.AsSpan(28,4).ToArray();Array.Reverse(exponent);exponent=exponent.SkipWhile(b=>b==0).ToArray();
        using var rsa=RSA.Create();rsa.ImportParameters(new RSAParameters{Modulus=key.AsSpan(32,width).ToArray().Reverse().ToArray(),Exponent=exponent});
        Require(rsa.VerifyHash(hash.GetHashAndReset(),signature,HashAlgorithmName.SHA1,RSASignaturePadding.Pkcs1),"strong_name_signature_invalid");return key;
    }
}
