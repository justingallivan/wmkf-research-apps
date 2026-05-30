#!/usr/bin/env python3
"""Build the docx-wrapped-executable fixture for the intake virus-scan e2e.

Produces a DOCX-shaped ZIP (passes the intake magic-byte gate as a real Office
Open XML container) that embeds a native executable under
`word/embedded/payload.bin`. Cloudmersive's /advanced endpoint extracts the
container and trips `ContainsExecutable`, which `lib/services/cloudmersive-scan.js`
synthesizes into `foundViruses[0].virusName = 'embedded executable'`.

This is the S193-verified shape (see the cloudmersive-scan.js header and
`.claude-memory/project-cloudmersive-advanced-endpoint.md`). The basic
/virus/scan/file endpoint returns 'clean' for this fixture — that's the no-op
that motivated the /advanced switch — so only run the manual e2e against an
environment with the /advanced endpoint wired (the live default).

Manual e2e runbook lives in
`.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md`.

Usage:
    python3 scripts/build-intake-eicar-fixture.py [output_path]
    # default output: /tmp/eicar-test-exe.docx
"""

import os
import sys
import zipfile

# A native executable to embed. /bin/ls is present on macOS (Mach-O) and Linux
# (ELF); either header is enough for ContainsExecutable to fire. Override with
# the EICAR_PAYLOAD_BIN env var to embed a different binary.
PAYLOAD_SRC = os.environ.get("EICAR_PAYLOAD_BIN", "/bin/ls")

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Default Extension="bin" ContentType="application/octet-stream"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)

RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/>'
    '</Relationships>'
)

DOCUMENT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:body><w:p><w:r><w:t>intake virus-scan e2e fixture</w:t></w:r></w:p></w:body>'
    '</w:document>'
)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/eicar-test-exe.docx"
    if not os.path.exists(PAYLOAD_SRC):
        sys.exit(
            f"payload binary not found: {PAYLOAD_SRC}\n"
            "Set EICAR_PAYLOAD_BIN to any native executable (Mach-O/ELF/PE)."
        )
    with open(PAYLOAD_SRC, "rb") as fh:
        payload = fh.read()

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/document.xml", DOCUMENT)
        z.writestr("word/embedded/payload.bin", payload)

    size = os.path.getsize(out)
    head = open(out, "rb").read(2)
    print(f"wrote {out} ({size} bytes), embedded {len(payload)} bytes from {PAYLOAD_SRC}")
    print(f"magic bytes: {head!r} (expect b'PK' — valid ZIP/OOXML container)")
    print("Expected scan result: infected, virusName='embedded executable' (ContainsExecutable).")


if __name__ == "__main__":
    main()
