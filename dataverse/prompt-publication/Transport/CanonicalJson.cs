// Portable v1 JSON/preimage primitives, NOT definition/request authorization.
// No provider/network/service imports. Mirrors lib/prompt-publication/json-contract.js.
using System;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Wmkf.PromptPublication;

public static class CanonicalJson
{
    public const int MaxBytes = 1048576;
    private static readonly Regex Number = new(@"\G-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", RegexOptions.CultureInvariant);
    private static Exception Invalid(string code) => new FormatException(code);
    private static void Unicode(string value)
    {
        for (var i = 0; i < value.Length; i++)
        {
            if (char.IsHighSurrogate(value[i])) { if (++i >= value.Length || !char.IsLowSurrogate(value[i])) throw Invalid("malformed_unicode"); }
            else if (char.IsLowSurrogate(value[i])) throw Invalid("malformed_unicode");
        }
    }
    public static JToken Parse(string text)
    {
        if (text == null || text.Length > 1000000) throw Invalid("payload_too_large");
        Unicode(text);
        if (Encoding.UTF8.GetByteCount(text) > MaxBytes) throw Invalid("payload_too_large");
        var parser = new Parser(text);
        var result = parser.Value(0);
        parser.Space();
        if (parser.Position != text.Length) throw Invalid("invalid_json");
        return result;
    }
    private sealed class Parser(string text)
    {
        internal int Position;
        private int nodes;
        internal void Space() { while (Position < text.Length && " \t\r\n".IndexOf(text[Position]) >= 0) Position++; }
        private bool Take(char c) { Space(); if (Position >= text.Length || text[Position] != c) return false; Position++; return true; }
        private string String()
        {
            Space();
            if (Position >= text.Length || text[Position++] != '"') throw Invalid("invalid_json");
            var value = new StringBuilder();
            while (Position < text.Length)
            {
                var c = text[Position++];
                if (c == '"') { var result = value.ToString(); Unicode(result); return result; }
                if (c < 32) throw Invalid("invalid_json");
                if (c != '\\') { value.Append(c); continue; }
                if (Position >= text.Length) throw Invalid("invalid_json");
                var escape = text[Position++];
                if (escape == 'u')
                {
                    var start = Position;
                    for (var i = 0; i < 4; i++) if (Position >= text.Length || !Uri.IsHexDigit(text[Position++])) throw Invalid("invalid_json");
                    value.Append((char)int.Parse(text.Substring(start, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                }
                else
                {
                    var index = "\"\\/bfnrt".IndexOf(escape);
                    if (index < 0) throw Invalid("invalid_json");
                    value.Append(new[] { '"', '\\', '/', '\b', '\f', '\n', '\r', '\t' }[index]);
                }
            }
            throw Invalid("invalid_json");
        }
        internal JToken Value(int depth)
        {
            if (++nodes > 50000 || depth > 32) throw Invalid("json_complexity_limit");
            Space(); if (Position >= text.Length) throw Invalid("invalid_json");
            if (text[Position] == '"') return new JValue(String());
            if (Take('{'))
            {
                var obj = new JObject(); if (Take('}')) return obj;
                do
                {
                    var key = String();
                    if (obj.Property(key, StringComparison.Ordinal) != null) throw Invalid("duplicate_json_key");
                    if (!Take(':')) throw Invalid("invalid_json");
                    obj.Add(key, Value(depth + 1));
                    if (Take('}')) return obj;
                } while (Take(','));
                throw Invalid("invalid_json");
            }
            if (Take('['))
            {
                var array = new JArray(); if (Take(']')) return array;
                do { array.Add(Value(depth + 1)); if (Take(']')) return array; } while (Take(','));
                throw Invalid("invalid_json");
            }
            foreach (var literal in new[] { "null", "true", "false" })
                if (text.Length - Position >= literal.Length && string.CompareOrdinal(text, Position, literal, 0, literal.Length) == 0)
                { Position += literal.Length; return literal == "null" ? JValue.CreateNull() : new JValue(literal == "true"); }
            var match = Number.Match(text, Position);
            if (!match.Success) throw Invalid("invalid_json");
            Position += match.Length;
            if (!double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
                || double.IsNaN(number) || double.IsInfinity(number) || (number == 0 && match.Value.StartsWith("-", StringComparison.Ordinal)) || BitConverter.DoubleToInt64Bits(number) == long.MinValue
                || (Math.Truncate(number) == number && Math.Abs(number) > 9007199254740991d)) throw Invalid("unsupported_number");
            return new JValue(number);
        }
    }
    private static string Quote(string text)
    {
        Unicode(text); var result = new StringBuilder("\"");
        foreach (var c in text)
        {
            if (c == '"' || c == '\\') result.Append('\\').Append(c);
            else if (c < 32 || c >= 127) result.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
            else result.Append(c);
        }
        return result.Append('"').ToString();
    }
    // Public hashing accepts strict JSON text so hand-built JTokens cannot bypass
    // bounds, duplicate detection, Unicode, negative-zero or numeric checks.
    public static string Preimage(string json) => Encode(Parse(json));
    private static string Encode(JToken token)
    {
        switch (token.Type)
        {
            case JTokenType.Null: return "[\"null\"]";
            case JTokenType.Boolean: return "[\"b\"," + (token.Value<bool>() ? "true" : "false") + "]";
            case JTokenType.String: return "[\"s\"," + Quote(token.Value<string>()!) + "]";
            case JTokenType.Float:
                return "[\"n\",\"" + unchecked((ulong)BitConverter.DoubleToInt64Bits(token.Value<double>())).ToString("x16", CultureInfo.InvariantCulture) + "\"]";
            case JTokenType.Array: return "[\"a\",[" + string.Join(",", ((JArray)token).Select(Encode)) + "]]";
            case JTokenType.Object:
                return "[\"o\",[" + string.Join(",", ((JObject)token).Properties().OrderBy(p => p.Name, StringComparer.Ordinal).Select(p => "[" + Quote(p.Name) + "," + Encode(p.Value) + "]")) + "]]";
            default: throw Invalid("json_value_required");
        }
    }
    public static string Hash(string domain, string json)
    {
        if (domain != "wmkf.prompt.snapshot.v1" && domain != "wmkf.prompt.publication.v1") throw Invalid("unsupported_hash_domain");
        using var sha = SHA256.Create();
        return string.Concat(sha.ComputeHash(Encoding.UTF8.GetBytes(domain + "\n" + Preimage(json))).Select(b => b.ToString("x2", CultureInfo.InvariantCulture)));
    }
}
