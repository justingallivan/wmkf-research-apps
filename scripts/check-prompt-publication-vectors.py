#!/usr/bin/env python3
"""Independent, standard-library-only verifier of PR553 portable hash vectors.
No application imports, environment files, network or fixture rewriting.
"""
import hashlib
import json
import math
from pathlib import Path
import struct


def quote(text):
    # Match ordinal UTF16 code-unit escaping, not Python's codepoint ordering.
    units = text.encode('utf-16-be')
    out = '"'
    for i in range(0, len(units), 2):
        n = int.from_bytes(units[i:i + 2], 'big')
        if n in (34, 92):
            out += '\\' + chr(n)
        elif n < 32 or n >= 127:
            out += '\\u' + format(n, '04x')
        else:
            out += chr(n)
    return out + '"'


def canonical(value):
    if value is None:
        return '["null"]'
    if isinstance(value, bool):
        return '["b",' + ('true' if value else 'false') + ']'
    if isinstance(value, str):
        return '["s",' + quote(value) + ']'
    if isinstance(value, (int, float)):
        n = float(value)
        assert math.isfinite(n) and not (n == 0 and math.copysign(1, n) < 0)
        assert not n.is_integer() or abs(n) <= 9007199254740991
        return '["n","' + struct.pack('>d', n).hex() + '"]'
    if isinstance(value, list):
        return '["a",[' + ','.join(canonical(v) for v in value) + ']]'
    assert isinstance(value, dict)
    keys = sorted(value, key=lambda k: k.encode('utf-16-be'))
    return '["o",[' + ','.join('[' + quote(k) + ',' + canonical(value[k]) + ']' for k in keys) + ']]'


def verify(domain, value, vector):
    preimage = domain + '\n' + canonical(value)
    assert preimage == vector['preimage'], 'Preimage mismatch'
    assert hashlib.sha256(preimage.encode('ascii')).hexdigest() == vector['hash'], 'SHA256 mismatch'


def main():
    root = Path(__file__).resolve().parent.parent
    vectors = json.loads((root / 'tests/fixtures/prompt-publication/fingerprints-v1.json').read_text())
    for vector in vectors['canonical']:
        assert canonical(vector['input']) == vector['preimage']
    verify('wmkf.prompt.snapshot.v1', vectors['snapshot']['input'], vectors['snapshot'])
    for vector in vectors['requests']:
        verify('wmkf.prompt.publication.v1', {
            'fingerprintVersion': 1, 'request': vector['input'],
            'actor': vector['actor'], 'canonicalKey': vector['input']['promptKey'],
        }, vector)
    assert vectors['receipt']['requestFingerprint'] == vectors['requests'][0]['hash']
    assert vectors['receipt']['request'] == vectors['requests'][0]['input']
    print('Independent Python canonical/preimage/SHA256 vectors passed.')


if __name__ == '__main__':
    main()
