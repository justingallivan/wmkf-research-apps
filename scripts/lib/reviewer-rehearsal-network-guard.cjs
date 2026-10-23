'use strict';

// Node preload used only by the isolated reviewer rehearsal. It rejects every
// non-loopback network path before the app, Next.js, or a child Node process can
// open it. Browser traffic is separately guarded by the Playwright route policy.
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const tls = require('node:tls');
const dgram = require('node:dgram');
const http2 = require('node:http2');
const os = require('node:os');
const dnsPromises = require('node:dns/promises');

function loopbackHost(host) {
  const normalized = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1';
}

function assertLoopback(target) {
  const host = typeof target === 'string'
    ? target
    : target?.hostname || target?.host || target?.address;
  if (!loopbackHost(host)) {
    throw new Error('Reviewer rehearsal blocked a non-loopback network connection');
  }
}

function targetFromHttpArgs(args) {
  const first = args[0];
  if (typeof first === 'string' || first instanceof URL) {
    const url = new URL(first);
    if (url.protocol !== 'http:') assertLoopback(url.hostname);
    return url.hostname;
  }
  if (first && typeof first === 'object') {
    if (first.protocol && first.protocol !== 'http:') assertLoopback(first.hostname || first.host);
    return first.hostname || first.host;
  }
  return args[1]?.hostname || args[1]?.host;
}

function assertTcpOrOwnedIpc(target) {
  if (typeof target === 'string') {
    const tempRoot = process.env.TMPDIR;
    if (tempRoot && pathIsUnder(target, tempRoot)) return;
  }
  if (target?.path) {
    const tempRoot = process.env.TMPDIR;
    if (tempRoot && pathIsUnder(target.path, tempRoot)) return;
  }
  assertLoopback(target);
}

function installNetworkGuard() {
  const privateHome = process.env.REHEARSAL_PRIVATE_HOME;
  if (privateHome) os.homedir = () => privateHome;
  const originalHttpRequest = http.request;
  http.request = function guardedHttpRequest(...args) {
    assertLoopback(targetFromHttpArgs(args));
    return originalHttpRequest.apply(this, args);
  };
  http.get = function guardedHttpGet(...args) {
    const request = http.request(...args);
    request.end();
    return request;
  };
  const denyHttps = () => { throw new Error('Reviewer rehearsal blocked HTTPS; only loopback HTTP is permitted'); };
  https.request = denyHttps;
  https.get = denyHttps;

  const originalConnect = net.connect;
  net.connect = function guardedNetConnect(...args) {
    const first = args[0];
    const target = typeof first === 'object' ? first : args[1];
    if (typeof first === 'number' && target == null) assertLoopback({ host: '127.0.0.1' });
    else assertTcpOrOwnedIpc(typeof first === 'string' ? first : target);
    return originalConnect.apply(this, args);
  };
  net.createConnection = net.connect;

  const originalSocketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedSocketConnect(...args) {
    let options = args[0];
    if (Array.isArray(options)) options = options[0];
    if (typeof options === 'number') options = { port: options, host: args[1] };
    if (typeof options === 'string') {
      const tempRoot = process.env.TMPDIR;
      if (!tempRoot || !pathIsUnder(options, tempRoot)) {
        throw new Error('Reviewer rehearsal blocked a socket connection outside its owned temporary IPC directory');
      }
    } else if (options?.path) {
      const tempRoot = process.env.TMPDIR;
      if (!tempRoot || !pathIsUnder(options.path, tempRoot)) {
        throw new Error('Reviewer rehearsal blocked a socket connection outside its owned temporary IPC directory');
      }
    } else {
      assertLoopback(options?.port != null && !options.host ? { host: '127.0.0.1' } : (options || {}));
    }
    return originalSocketConnect.apply(this, args);
  };

  const originalServerListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function guardedServerListen(...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = typeof first === 'object' && first !== null
      ? first
      : (typeof first === 'number' ? { port: first, host: args[1] } : null);
    if (typeof first === 'string') {
      const tempRoot = process.env.TMPDIR;
      if (!tempRoot || !pathIsUnder(first, tempRoot)) {
        throw new Error('Reviewer rehearsal blocked a server bind outside loopback or owned temporary IPC');
      }
    } else if (options?.path) {
      const tempRoot = process.env.TMPDIR;
      if (!tempRoot || !pathIsUnder(options.path, tempRoot)) {
        throw new Error('Reviewer rehearsal blocked a server bind outside loopback or owned temporary IPC');
      }
    } else if (options?.port != null) {
      if (!options.host) throw new Error('Reviewer rehearsal blocked a TCP listener without an explicit loopback host');
      assertLoopback({ host: options.host });
    } else if (typeof first === 'object' && first !== null) {
      assertLoopback({ host: options.host || '127.0.0.1' });
    }
    return originalServerListen.apply(this, args);
  };

  // TLS, HTTP/2 clients, and UDP are not used by this local rehearsal. Deny
  // their connection APIs explicitly instead of relying on HTTP wrappers.
  tls.connect = () => { throw new Error('Reviewer rehearsal blocked TLS network access'); };
  http2.connect = () => { throw new Error('Reviewer rehearsal blocked HTTP/2 network access'); };
  const originalDgramCreateSocket = dgram.createSocket;
  dgram.createSocket = function guardedCreateSocket(...args) {
    const socket = originalDgramCreateSocket.apply(this, args);
    const originalSend = socket.send.bind(socket);
    socket.send = function guardedSend(...sendArgs) {
      const address = [...sendArgs].reverse().find((value) => typeof value === 'string' && !/^\d+$/.test(value));
      assertLoopback(address);
      return originalSend(...sendArgs);
    };
    const originalSocketDgramConnect = socket.connect.bind(socket);
    socket.connect = function guardedDgramConnect(port, address, ...rest) {
      assertLoopback(address);
      return originalSocketDgramConnect(port, address, ...rest);
    };
    return socket;
  };

  const originalLookup = dns.lookup;
  dns.lookup = function guardedLookup(hostname, ...args) {
    assertLoopback(hostname);
    return originalLookup.call(this, hostname, ...args);
  };
  for (const promiseDns of new Set([dns.promises, dnsPromises])) {
    if (promiseDns?.lookup) {
      const originalPromiseLookup = promiseDns.lookup.bind(promiseDns);
      promiseDns.lookup = async function guardedPromiseLookup(hostname, ...args) {
        assertLoopback(hostname);
        return originalPromiseLookup(hostname, ...args);
      };
    }
  }
  for (const method of ['lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
    if (typeof dns[method] === 'function') {
      dns[method] = function guardedDnsResolution(_hostname, callback) {
        const error = new Error('Reviewer rehearsal blocked external DNS resolution');
        if (typeof callback === 'function') { process.nextTick(callback, error); return; }
        throw error;
      };
    }
    for (const promiseDns of new Set([dns.promises, dnsPromises])) {
      if (typeof promiseDns?.[method] === 'function') {
        promiseDns[method] = async function guardedPromiseDnsResolution() {
          throw new Error('Reviewer rehearsal blocked external DNS resolution');
        };
      }
    }
  }
  const resolverTypes = [dns.Resolver, dns.promises?.Resolver, dnsPromises.Resolver];
  for (const Resolver of resolverTypes) {
    if (!Resolver?.prototype) continue;
    for (const method of Object.getOwnPropertyNames(Resolver.prototype)) {
      if (/^(resolve|reverse)/.test(method) && typeof Resolver.prototype[method] === 'function') {
        Resolver.prototype[method] = function guardedResolverMethod() {
          throw new Error('Reviewer rehearsal blocked external DNS resolution');
        };
      }
    }
  }

  if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function guardedFetch(input, init) {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.protocol !== 'http:') assertLoopback(url.hostname);
      assertLoopback(url.hostname);
      return originalFetch.call(this, input, { ...init, redirect: 'manual' }).then((response) => {
        if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
          throw new Error('Reviewer rehearsal blocked an HTTP redirect; only direct loopback responses are permitted');
        }
        return response;
      });
    };
  }
  if (typeof globalThis.WebSocket === 'function') {
    globalThis.WebSocket = class BlockedRehearsalWebSocket {
      constructor() { throw new Error('Reviewer rehearsal blocked WebSocket network access'); }
    };
  }
}

function pathIsUnder(candidate, root) {
  const path = require('node:path');
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

installNetworkGuard();

module.exports = { assertLoopback, assertTcpOrOwnedIpc, loopbackHost, installNetworkGuard };
