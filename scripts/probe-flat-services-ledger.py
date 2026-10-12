#!/usr/bin/env python3
# Read-only probe (docs/CLAUDE_REMEDIATION_PLAN.md "Commit probe scripts"). Produced the move
# ledger for docs/plans/FLAT_SERVICES_RELOCATION_PLAN_2026-10-11.md at origin/main b3135037c.
# Reads the repo only; writes to LEDGER_OUT (default docs/plans/data). Run from the repo root:
#   LEDGER_OUT=docs/plans/data python3 scripts/probe-flat-services-ledger.py && \
#   LEDGER_OUT=docs/plans/data python3 scripts/probe-flat-services-ledger-render.py
"""Read-only analysis of flat lib/services/*.js files. Writes analysis.json to LEDGER_OUT."""
import os, re, json, sys, subprocess
from collections import Counter, defaultdict

ROOT = os.environ.get('REPO_ROOT', os.getcwd())
OUT = os.environ.get('LEDGER_OUT', os.path.join(os.environ.get('REPO_ROOT', os.getcwd()), 'docs/plans/data'))
SVC = os.path.join(ROOT, 'lib/services')
EXTS = ('.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx')
SKIP_DIRS = {'node_modules', '.next', 'node_modules.nosync', '.next.nosync', '.git', 'vendor'}

def walk(rel_roots):
    for rr in rel_roots:
        base = os.path.join(ROOT, rr)
        if not os.path.isdir(base):
            continue
        for dp, dns, fns in os.walk(base):
            dns[:] = [d for d in dns if d not in SKIP_DIRS]
            for fn in fns:
                yield os.path.relpath(os.path.join(dp, fn), ROOT)

flat = sorted(f for f in os.listdir(SVC) if f.endswith('.js') and os.path.isfile(os.path.join(SVC, f)))
names = [f[:-3] for f in flat]
subdirs = sorted(d for d in os.listdir(SVC) if os.path.isdir(os.path.join(SVC, d)))
subdir_files = {d: sorted(os.listdir(os.path.join(SVC, d))) for d in subdirs}

def read(rel):
    with open(os.path.join(ROOT, rel), 'r', encoding='utf-8', errors='replace') as fh:
        return fh.read()

# --- specifier extraction & resolution ---
SPEC_RE = re.compile(
    r"""(?:require\(\s*|import\(\s*|require\.resolve\(\s*|jest\.(?:mock|unstable_mockModule|requireActual|doMock|requireMock)\(\s*|\bfrom\s+|^\s*import\s+(?![\w{*]))['"`]([^'"`\n]+)['"`]""",
    re.M)

def resolve(spec, from_rel):
    """Return normalized root-relative path (without extension) or None."""
    if spec.startswith('@/'):
        p = spec[2:]
    elif spec.startswith('.'):
        p = os.path.normpath(os.path.join(os.path.dirname(from_rel), spec))
    elif spec.startswith('lib/') or spec.startswith('/lib/'):
        p = spec.lstrip('/')
    else:
        return None
    for e in EXTS:
        if p.endswith(e):
            p = p[:-len(e)]
            break
    return p

code_files = [f for f in walk(['lib', 'pages', 'shared', 'scripts']) if f.endswith(EXTS)]
# importers[target_relpath_noext] -> set(importer files)
importers = defaultdict(set)
# imports_of_flat[name] -> set of resolved targets
imports_of = {}
for f in code_files:
    src = read(f)
    specs = SPEC_RE.findall(src)
    resolved = set()
    for s in specs:
        r = resolve(s, f)
        if r:
            resolved.add(r)
            importers[r].add(f)
    imports_of[f] = resolved

def domain(path):
    parts = path.split('/')
    if parts[0] == 'pages':
        if len(parts) > 2 and parts[1] == 'api':
            return 'pages/api/' + parts[2] if len(parts) > 3 else 'pages/api'
        return 'pages/' + parts[1] if len(parts) > 2 else 'pages'
    if parts[0] == 'lib':
        if len(parts) > 2 and parts[1] == 'services':
            return 'lib/services/' + parts[2] if len(parts) > 3 else 'lib/services(flat)'
        return 'lib/' + parts[1] if len(parts) > 2 else 'lib'
    if parts[0] == 'shared':
        if len(parts) > 3 and parts[1] in ('components', 'hooks', 'utils', 'config'):
            return 'shared/' + parts[1] + '/' + parts[2]
        return 'shared/' + parts[1] if len(parts) > 2 else 'shared'
    if parts[0] == 'scripts':
        return 'scripts'
    return parts[0]

# literal-reference counting
def lit_re(name):
    return re.compile(r'lib/services/' + re.escape(name) + r'(?![\w\-/])')
def lit_js_re(name):
    return re.compile(r'lib/services/' + re.escape(name) + r'\.js(?![\w\-])')

tests_files = [f for f in walk(['tests'])]
scripts_files = [f for f in walk(['scripts'])]
docs_files = [f for f in walk(['docs', '.claude-memory'])]
gate_files = [f for f in walk(['scripts']) if re.match(r'scripts/check-[^/]*\.js$', f)]
gate_files += [f for f in tests_files if re.match(r'tests/unit/[^/]*recorded-set[^/]*\.test\.js$', f)]
gate_files += ['tsconfig.check.json', 'jest.config.js', 'next.config.js']
gate_files += [f for f in walk(['.github/workflows'])]
cache = {}
def content(f):
    if f not in cache:
        try:
            cache[f] = read(f)
        except Exception:
            cache[f] = ''
    return cache[f]

def count_files(files, rx):
    return sum(1 for f in files if rx.search(content(f)))

def gate_hits(name):
    rx = lit_re(name)
    hits = []
    for f in gate_files:
        for i, line in enumerate(content(f).split('\n'), 1):
            if rx.search(line):
                hits.append(f'{f}:{i}: {line.strip()[:160]}')
    return hits

def header_purpose(src):
    lines = src.split('\n')[:40]
    out = []
    for ln in lines:
        s = ln.strip()
        if s.startswith('/**') or s.startswith('/*'):
            s = s.lstrip('/*').strip()
        if s.startswith('*/'):
            if out: break
            continue
        if s.startswith('*') or s.startswith('//'):
            s = s.lstrip('*/').strip()
            if s.startswith('@'):
                if out: break
                continue
            if s == '' and out: break
            if s and not s.lower().startswith('@ts-check'):
                out.append(s)
        elif out:
            break
        elif s and not s.startswith("'use") and not s.startswith('"use'):
            break
    return ' '.join(out)

rows = []
for name in names:
    rel = f'lib/services/{name}.js'
    src = read(rel)
    lines = src.count('\n') + (0 if src.endswith('\n') else 1)
    imps = sorted(importers.get(f'lib/services/{name}', set()))
    dirs = Counter(domain(f) for f in imps)
    distinct_domains = set(dirs)
    # what this file imports
    my_imports = imports_of.get(rel, set())
    imported_subdirs = Counter()
    imported_flat = []
    for t in my_imports:
        m = re.match(r'lib/services/([^/]+)/', t)
        if m:
            imported_subdirs[m.group(1)] += 1
        m2 = re.match(r'lib/services/([^/]+)$', t)
        if m2:
            imported_flat.append(m2.group(1))
    # subdirs whose files import this
    importing_subdirs = Counter()
    for f in imps:
        m = re.match(r'lib/services/([^/]+)/', f)
        if m:
            importing_subdirs[m.group(1)] += 1
    cycle = sorted(set(imported_subdirs) & set(importing_subdirs))
    gh = gate_hits(name)
    rows.append({
        'name': name, 'lines': lines,
        'purpose_raw': header_purpose(src)[:300],
        'importer_files_total': len(imps),
        'importer_dirs': dirs.most_common(),
        'importers': imps,
        'distinct_domains': len(distinct_domains),
        'imported_subdirs': imported_subdirs.most_common(),
        'imported_flat': sorted(imported_flat),
        'importing_subdirs': importing_subdirs.most_common(),
        'cycle_subdirs': cycle,
        'test_file_refs': count_files(tests_files, lit_re(name)),
        'script_refs': count_files(scripts_files, lit_re(name)),
        'doc_memory_refs': count_files(docs_files, lit_js_re(name)),
        'gate_hits': gh,
        'collisions': sorted(d for d in subdirs if f'{name}.js' in subdir_files[d]),
    })

json.dump({'rows': rows, 'subdirs': {d: len(v) for d, v in subdir_files.items()},
           'subdir_files': subdir_files}, open(os.path.join(OUT, 'analysis.json'), 'w'), indent=1)
print('flat', len(rows), 'code_files', len(code_files), 'tests', len(tests_files), 'docs', len(docs_files), 'gates', len(gate_files))
