'use strict';

const VERIFIED_RE = /\[VERIFIED(?:\s+via[^\]]+)?\]/i;
const NON_DESCRIPTIVE_RE =
  /\b(?:must|should|shall|ought to|required to|requirement|hypothesis|hypothetical|historical quotation|quoted example|worked example|will)\b/i;
const NON_CLAIM_PREFIX_RE =
  /^(?:[-*]\s+)?(?:example|worked example|historical quotation|hypothesis|hypothetical)\s*:/i;
const CONDITIONAL_RE =
  /\[VERIFIED(?:\s+via[^\]]+)?\]\s*(?:if|suppose|assuming)\b/i;
const EXEMPT_RE =
  /<!--\s*assertion-exempt:\s*(?:quoted-example|hypothetical|template)\s*-->/i;
const CALL_PATH_RE =
  /\b(?:is\s+)?(?:called|invoked|executed|triggered)\s+(?:from|by|at|before|after|during|on)\b|\b(?:runs?|fires?)\s+(?:from|at|before|after|during|on)\b|\bat\s+(?:save|load|read|write|refresh|startup|shutdown|render|commit)\s+time\b/i;
const UNIVERSAL_RE =
  /\b(?:all|only|never|none|every|always|impossible|no mechanism|cannot|can't)\b|\bno\s+(?:(?:plan|design)\s+documents?|routes?|files?|sites?|callers?|consumers?|entries?|paths?|hooks?|records?|rows?)\b/i;
const COUNT_RE =
  /\b\d+\s+of\s+\d+\b|\b\d+\s+(?:sites?|routes?|files?|callers?|consumers?|entries?|mechanisms?|paths?|hooks?|tables?|records?|rows?)\b|\bevery\s+(?:route|file|site|caller|consumer|entry|path)\b/i;

function withoutFencedCode(text) {
  let inFence = false;
  return String(text || '').split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return '';
    }
    return inFence ? '' : line;
  }).join('\n');
}

function claimUnits(text) {
  const units = [];
  for (const rawLine of withoutFencedCode(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^>/.test(line)) continue;
    const pieces = line.split(/(?<=[.!?])\s+(?=(?:["'`([]*[A-Z[]))/);
    for (const piece of pieces) {
      const unit = piece.replace(/^[-*]\s+/, '').trim();
      if (unit) units.push(unit);
    }
  }
  return units;
}

function symbolsIn(sentence) {
  const symbols = new Set();
  for (const match of String(sentence || '').matchAll(/`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*(?:\(\))?`/g)) {
    symbols.add(match[1]);
  }
  return [...symbols];
}

function scopesIn(sentence) {
  const value = String(sentence || '');
  const scopes = [];
  if (/\bAPI routes?\b/i.test(value)) scopes.push('pages/api');
  if (/\b(?:Claude )?hooks?\b/i.test(value)) scopes.push('.claude/hooks');
  if (/\b(?:plan|design) documents?\b/i.test(value)) scopes.push('docs');
  if (/\bmemory (?:entry|entries|documents?)\b/i.test(value)) scopes.push('.claude-memory');
  if (/\bDataverse\b/i.test(value)) scopes.push('lib/dataverse');
  return [...new Set(scopes)];
}

function evidenceTermsIn(sentence, symbols) {
  const value = String(sentence || '');
  const terms = [...symbols];
  const stopWords = new Set([
    'verified', 'all', 'only', 'never', 'none', 'every', 'always', 'impossible',
    'api', 'route', 'routes', 'claude', 'hook', 'hooks', 'plan', 'design',
    'document', 'documents', 'use', 'uses', 'using', 'have', 'has', 'from',
    'called', 'runs', 'entry', 'points', 'such', 'that', 'this', 'with', 'without',
  ]);
  for (const token of value.match(/[A-Za-z][A-Za-z0-9-]{3,}/g) || []) {
    if (!stopWords.has(token.toLowerCase())) terms.push(token);
  }
  if (/\b(?:auth(?:entication|orization)?|access guards?)\b/i.test(value)) {
    terms.push('auth', 'requireAppAccess', 'requireAuth');
  }
  if (/\b(?:access tokens?|credentials?|secrets?)\b/i.test(value)) {
    terms.push('token', 'credential', 'secret');
  }
  return [...new Set(terms)];
}

function findClaimEvidenceObligations(text) {
  const claims = [];
  for (const sentence of claimUnits(text)) {
    if (!VERIFIED_RE.test(sentence)) continue;
    if (
      EXEMPT_RE.test(sentence) ||
      NON_DESCRIPTIVE_RE.test(sentence) ||
      NON_CLAIM_PREFIX_RE.test(sentence) ||
      CONDITIONAL_RE.test(sentence)
    ) continue;

    const shapes = [];
    if (CALL_PATH_RE.test(sentence)) shapes.push('call-path');
    if (UNIVERSAL_RE.test(sentence)) shapes.push('universal');
    if (COUNT_RE.test(sentence)) shapes.push('count');
    if (!shapes.length) continue;

    const symbols = symbolsIn(sentence);
    claims.push({
      sentence,
      shapes,
      symbols,
      scopes: scopesIn(sentence),
      evidenceTerms: evidenceTermsIn(sentence, symbols),
    });
  }
  return claims;
}

function transcriptQueryLines(transcript) {
  const queries = { shell: [], codegraph: [] };

  function shellTokens(command) {
    const tokens = [];
    let token = '';
    let quote = '';
    let escaped = false;
    for (const char of String(command || '')) {
      if (escaped) {
        token += char;
        escaped = false;
        continue;
      }
      if (char === '\\' && quote !== "'") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = '';
        else token += char;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === '#' || char === ';' || char === '|' || char === '&' || char === '\n') break;
      if (/\s/.test(char)) {
        if (token) tokens.push(token);
        token = '';
        continue;
      }
      token += char;
    }
    if (token) tokens.push(token);
    return tokens;
  }

  function parseSearchCommand(command) {
    const tokens = shellTokens(command);
    let index = 0;
    if (tokens[index] === 'rtk') index += 1;
    if (tokens[index] === 'proxy') index += 1;
    const tool = tokens[index];
    if (!/^(?:rg|grep)$/i.test(tool || '')) return null;
    index += 1;

    const flags = [];
    const globs = [];
    const filters = [];
    const explicitPatterns = [];
    const positional = [];
    let filesMode = false;
    const valueOptions = new Set([
      '-t', '--type', '--type-add', '--iglob', '--ignore-file', '--encoding',
      '--engine', '--sort', '--sortr', '--max-count', '-m',
    ]);
    for (; index < tokens.length; index += 1) {
      const value = tokens[index];
      if (value === '-g' || value === '--glob') {
        if (tokens[index + 1]) globs.push(tokens[index + 1]);
        index += 1;
        continue;
      }
      if (value.startsWith('--glob=')) {
        globs.push(value.slice('--glob='.length));
        continue;
      }
      if (value === '-e' || value === '--regexp') {
        if (tokens[index + 1]) explicitPatterns.push(tokens[index + 1]);
        index += 1;
        continue;
      }
      if (valueOptions.has(value)) {
        if (tokens[index + 1]) filters.push(`${value}=${tokens[index + 1]}`);
        index += 1;
        continue;
      }
      if (/^-t[^-].+/.test(value)) {
        filters.push(`-t=${value.slice(2)}`);
        continue;
      }
      const assignedOption = value.match(/^(--(?:type|type-add|iglob|ignore-file|encoding|engine|sort|sortr|max-count))=(.+)$/);
      if (assignedOption) {
        filters.push(`${assignedOption[1]}=${assignedOption[2]}`);
        continue;
      }
      if (value.startsWith('-')) {
        flags.push(value);
        if (value === '--files') filesMode = true;
        continue;
      }
      positional.push(value);
    }

    const pattern = filesMode ? '' : (explicitPatterns.length ? explicitPatterns.join('|') : (positional.shift() || ''));
    return {
      command,
      tool: tool.toLowerCase(),
      flags,
      globs,
      filters,
      pattern,
      paths: positional.length ? positional : ['.'],
    };
  }

  function recordShell(command) {
    const parsed = parseSearchCommand(command);
    if (parsed) queries.shell.push(parsed);
  }

  function collect(value) {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const isToolUse = value.type === 'tool_use';
    const toolName = value.tool_name || value.toolName || (isToolUse ? value.name : '');
    const toolInput = value.tool_input || value.toolInput || (isToolUse ? value.input : null) || {};
    if (/^(?:Bash|mcp__.*__exec_command)$/i.test(String(toolName))) {
      const command = typeof toolInput.command === 'string' ? toolInput.command : toolInput.cmd;
      if (typeof command === 'string') recordShell(command);
    }
    if (/codegraph/i.test(String(toolName)) && typeof toolInput.query === 'string') {
      queries.codegraph.push(toolInput.query);
    }

    Object.values(value).forEach(collect);
  }

  for (const line of String(transcript || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      collect(JSON.parse(line));
    } catch {
      // A malformed transcript line is not evidence that a query ran.
    }
  }
  return queries;
}

function mentionsSymbol(line, symbols) {
  const searchable = typeof line === 'string' ? line : line.pattern;
  return symbols.length === 0 || symbols.some((symbol) => searchable.includes(symbol));
}

function pathCoversScope(target, scope) {
  const normalized = String(target || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized === '.' || normalized === '') return true;
  return normalized === scope || scope.startsWith(`${normalized}/`);
}

function hasDirectorySearchScope(line, scopes) {
  if (scopes.length) return scopes.every((scope) => line.paths.some((target) => pathCoversScope(target, scope)));
  return line.paths.some((target) =>
    /^(?:\.?|pages|lib|shared|scripts|\.claude\/hooks)(?:\/|$)/i.test(target)
  ) && line.paths.some((target) => !/\.[A-Za-z0-9]+$/.test(target));
}

function matchesEvidenceTerms(line, claim) {
  return claim.evidenceTerms.length > 0 &&
    claim.evidenceTerms.some((term) => line.pattern.toLowerCase().includes(term.toLowerCase()));
}

function textMatchesEvidenceTerms(text, claim) {
  return claim.evidenceTerms.length > 0 &&
    claim.evidenceTerms.some((term) => String(text || '').toLowerCase().includes(term.toLowerCase()));
}

function codegraphCoversScopes(query, scopes) {
  if (!scopes.length) return true;
  const explicitPaths = [...String(query || '').matchAll(
    /(?:^|[\s`'"(])((?:pages|lib|shared|scripts|docs|\.claude-memory|\.claude)(?:\/[A-Za-z0-9._~@/[\]-]+)*)/g
  )].map((match) => match[1].replace(/\/$/, ''));
  if (!explicitPaths.length) return true;
  return scopes.every((scope) => explicitPaths.some((target) => pathCoversScope(target, scope)));
}

function hasShortFlag(record, letter) {
  return record.flags.some((flag) => /^-[^-]/.test(flag) && flag.slice(1).includes(letter));
}

function hasLongFlag(record, flag) {
  return record.flags.includes(flag);
}

function hasCallerEvidence(queries, claim) {
  const shellTrace = queries.shell.some((line) =>
    (claim.symbols.length ? mentionsSymbol(line, claim.symbols) : matchesEvidenceTerms(line, claim)) &&
    hasDirectorySearchScope(line, claim.scopes)
  );
  const codegraphTrace = queries.codegraph.some((line) =>
    (claim.symbols.length ? mentionsSymbol(line, claim.symbols) : textMatchesEvidenceTerms(line, claim)) &&
    codegraphCoversScopes(line, claim.scopes) &&
    /\b(?:callers?|call paths?|entry points?|depends|uses)\b/i.test(line)
  );
  return shellTrace || codegraphTrace;
}

function hasComplementEvidence(queries, claim) {
  if (!claim.scopes.length) return false;
  return claim.scopes.every((scope) => queries.shell.some((record) =>
    record.paths.some((target) => pathCoversScope(target, scope)) &&
    matchesEvidenceTerms(record, claim) &&
    (hasShortFlag(record, 'L') || hasLongFlag(record, '--files-without-match'))
  ));
}

function queryUniverse(record) {
  return JSON.stringify({
    paths: record.paths.map((value) => value.replace(/\\/g, '/').replace(/^\.\//, '')).sort(),
    globs: [...record.globs].sort(),
    filters: [...record.filters].sort(),
  });
}

function hasIndependentCountEvidence(queries, claim) {
  if (!claim.scopes.length) return false;
  return claim.scopes.every((scope) => {
    const numerators = queries.shell.filter((record) =>
      record.paths.some((target) => pathCoversScope(target, scope)) &&
      matchesEvidenceTerms(record, claim) &&
      (hasShortFlag(record, 'l') || hasLongFlag(record, '--files-with-matches')) &&
      !hasShortFlag(record, 'L')
    );
    const denominators = queries.shell.filter((record) =>
      record.paths.some((target) => pathCoversScope(target, scope)) &&
      hasLongFlag(record, '--files')
    );
    return numerators.some((numerator) =>
      denominators.some((denominator) =>
        numerator !== denominator && queryUniverse(numerator) === queryUniverse(denominator)
      )
    );
  });
}

function evidenceSatisfiesClaim(transcript, claim) {
  const queries = transcriptQueryLines(transcript);
  return claim.shapes.every((shape) => {
    if (shape === 'call-path') return hasCallerEvidence(queries, claim);
    if (shape === 'universal') return hasComplementEvidence(queries, claim);
    if (shape === 'count') return hasIndependentCountEvidence(queries, claim);
    return false;
  });
}

function missingClaimEvidence(transcript, claims) {
  return claims.filter((claim) => !evidenceSatisfiesClaim(transcript, claim));
}

module.exports = {
  evidenceSatisfiesClaim,
  findClaimEvidenceObligations,
  missingClaimEvidence,
};
