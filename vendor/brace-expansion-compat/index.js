'use strict';

// Security backport for the callable brace-expansion 1.x API required by older
// minimatch versions. The expansion behavior is based on upstream 1.1.16, with
// bounded result count, accumulated output length, and brace depth for
// CVE-2026-14257. Remove this adapter once all parent chains accept >=5.0.8.
//
// Upstream source:
// https://github.com/juliangruber/brace-expansion/blob/1.1.16/index.js

var balanced = require('balanced-match');

module.exports = expandTop;

var escSlash = '\0SLASH' + Math.random() + '\0';
var escOpen = '\0OPEN' + Math.random() + '\0';
var escClose = '\0CLOSE' + Math.random() + '\0';
var escComma = '\0COMMA' + Math.random() + '\0';
var escPeriod = '\0PERIOD' + Math.random() + '\0';

var EXPANSION_MAX = 100000;
var EXPANSION_MAX_LENGTH = 4000000;
var EXPANSION_MAX_BRACES = 100;
var modernUpstream = require('brace-expansion-upstream');

module.exports.expand = modernUpstream.expand;
module.exports.EXPANSION_MAX = modernUpstream.EXPANSION_MAX;
module.exports.EXPANSION_MAX_LENGTH = modernUpstream.EXPANSION_MAX_LENGTH;

function numeric(str) {
  return parseInt(str, 10) == str
    ? parseInt(str, 10)
    : str.charCodeAt(0);
}

function escapeBraces(str) {
  return str.split('\\\\').join(escSlash)
    .split('\\{').join(escOpen)
    .split('\\}').join(escClose)
    .split('\\,').join(escComma)
    .split('\\.').join(escPeriod);
}

function unescapeBraces(str) {
  return str.split(escSlash).join('\\')
    .split(escOpen).join('{')
    .split(escClose).join('}')
    .split(escComma).join(',')
    .split(escPeriod).join('.');
}

function parseCommaParts(str) {
  if (!str) return [''];

  var parts = [];
  var m = balanced('{', '}', str);
  if (!m) return str.split(',');

  var pre = m.pre;
  var body = m.body;
  var post = m.post;
  var p = pre.split(',');

  p[p.length - 1] += '{' + body + '}';
  var postParts = parseCommaParts(post);
  if (post.length) {
    p[p.length - 1] += postParts.shift();
    p.push.apply(p, postParts);
  }

  parts.push.apply(parts, p);
  return parts;
}

function expandTop(str, options) {
  if (!str) return [];

  options = options || {};
  var max = options.max == null ? EXPANSION_MAX : options.max;
  var maxLength = options.maxLength == null ? EXPANSION_MAX_LENGTH : options.maxLength;

  // Deep chained groups are not realistic glob patterns and recurse once per
  // group in the legacy algorithm. Treat them literally before expansion.
  var braceCount = (str.match(/\{/g) || []).length;
  if (braceCount > EXPANSION_MAX_BRACES) return [str];

  if (str.substr(0, 2) === '{}') {
    str = '\\{\\}' + str.substr(2);
  }

  return expand(escapeBraces(str), max, maxLength, true).map(unescapeBraces);
}

function embrace(str) {
  return '{' + str + '}';
}

function isPadded(el) {
  return /^-?0\d/.test(el);
}

function lte(i, y) {
  return i <= y;
}

function gte(i, y) {
  return i >= y;
}

function appendWithinBounds(target, values, max, maxLength, currentLength) {
  var length = currentLength;
  for (var i = 0; i < values.length && target.length < max; i++) {
    if (length + values[i].length > maxLength) break;
    target.push(values[i]);
    length += values[i].length;
  }
  return length;
}

function expand(str, max, maxLength, isTop) {
  var expansions = [];
  var expansionLength = 0;

  for (;;) {
    var m = balanced('{', '}', str);
    if (!m || /\$$/.test(m.pre)) return [str];

    var isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body);
    var isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body);
    var isSequence = isNumericSequence || isAlphaSequence;
    var isOptions = m.body.indexOf(',') >= 0;

    if (!isSequence && !isOptions) {
      if (m.post.match(/,(?!,).*\}/)) {
        str = m.pre + '{' + m.body + escClose + m.post;
        isTop = true;
        continue;
      }
      return [str];
    }

    var n;
    if (isSequence) {
      n = m.body.split(/\.\./);
    } else {
      n = parseCommaParts(m.body);
      if (n.length === 1) {
        n = expand(n[0], max, maxLength, false).map(embrace);
        if (n.length === 1) {
          var nestedPost = m.post.length
            ? expand(m.post, max, maxLength, false)
            : [''];
          var nested = [];
          var nestedLength = 0;
          for (var np = 0; np < nestedPost.length && nested.length < max; np++) {
            var nestedValue = m.pre + n[0] + nestedPost[np];
            if (nestedLength + nestedValue.length > maxLength) break;
            nested.push(nestedValue);
            nestedLength += nestedValue.length;
          }
          return nested;
        }
      }
    }

    var pre = m.pre;
    var post = m.post.length
      ? expand(m.post, max, maxLength, false)
      : [''];

    var N;
    if (isSequence) {
      var x = numeric(n[0]);
      var y = numeric(n[1]);
      var width = Math.max(n[0].length, n[1].length);
      var incr = n.length == 3
        ? Math.max(Math.abs(numeric(n[2])), 1)
        : 1;
      var test = lte;
      var reverse = y < x;
      if (reverse) {
        incr *= -1;
        test = gte;
      }
      var pad = n.some(isPadded);

      N = [];
      for (var i = x; test(i, y) && N.length < max; i += incr) {
        var c;
        if (isAlphaSequence) {
          c = String.fromCharCode(i);
          if (c === '\\') c = '';
        } else {
          c = String(i);
          if (pad) {
            var need = width - c.length;
            if (need > 0) {
              var z = new Array(need + 1).join('0');
              if (i < 0) c = '-' + z + c.slice(1);
              else c = z + c;
            }
          }
        }
        N.push(c);
      }
    } else {
      N = [];
      var optionLength = 0;
      for (var ni = 0; ni < n.length && N.length < max; ni++) {
        optionLength = appendWithinBounds(
          N,
          expand(n[ni], max, maxLength, false),
          max,
          maxLength,
          optionLength,
        );
      }
    }

    for (var j = 0; j < N.length; j++) {
      for (var k = 0; k < post.length && expansions.length < max; k++) {
        var expansion = pre + N[j] + post[k];
        if (!isTop || isSequence || expansion) {
          if (expansionLength + expansion.length > maxLength) return expansions;
          expansions.push(expansion);
          expansionLength += expansion.length;
        }
      }
    }

    return expansions;
  }
}
