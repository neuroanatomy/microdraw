'use strict';

// /getTile, /getJson and /image fetch an address that anyone can give. They
// may reach only public servers: never this computer, the local network or
// the cloud's metadata service (F2 of the access audit of 2026-10-19, S1a).

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');

// the largest answer relayed: a DeepZoom tile is under 1 MB and the largest
// dataset list in the repository is 16 kB; 16 MB leaves room for a whole
// image given as one tile source
const MAX_BYTES = 16 * 1024 * 1024;
// for a whole answer, redirects included
const TIME_LIMIT_MS = 20000;

const refused = new net.BlockList();
[
  ['0.0.0.0', 8], // unspecified, "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared (carrier) address space
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, the cloud metadata service
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4] // reserved, broadcast
].forEach(([address, prefix]) => refused.addSubnet(address, prefix, 'ipv4'));
[
  ['::', 96], // unspecified, loopback and the old IPv4-compatible form
  ['64:ff9b::', 96], // NAT64: an IPv4 address behind a gateway
  ['2002::', 16], // 6to4: an IPv4 address inside
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (old)
  ['ff00::', 8] // multicast
].forEach(([address, prefix]) => refused.addSubnet(address, prefix, 'ipv6'));

/**
 * An error whose message and status the routes answer with, as plain text
 * @param {number} status The HTTP status
 * @param {string} message What to say
 * @returns {Error} The error
 */
const answerError = (status, message) => Object.assign(new Error(message), { status });

const guard = {
  // read from here, so that the tests can lower them
  MAX_BYTES,
  TIME_LIMIT_MS,

  /**
   * Whether an address is one the proxies must not reach. The rules for IPv4
   * also match its IPv4-mapped IPv6 form (::ffff:127.0.0.1).
   * @param {string} address An IP address
   * @returns {boolean} True for loopback, private, link-local, unique-local, unspecified or multicast
   */
  isRefusedAddress: (address) => {
    const family = net.isIP(address);

    return family === 0 || refused.check(address, family === 4 ? 'ipv4' : 'ipv6');
  },

  // replaced by the tests, to give a name the address they want
  lookup: (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true })
};

/**
 * The addresses to connect to for a URL's host, if all are public
 * @param {URL} target The address asked for
 * @returns {Promise<Array<{address: string, family: number}>>} The checked addresses
 */
const publicAddress = async (target) => {
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  const family = net.isIP(hostname);
  let addresses = [{ address: hostname, family }];
  if (family === 0) {
    try {
      addresses = await guard.lookup(hostname);
    } catch (err) {
      throw answerError(502, 'cannot find the server ' + hostname);
    }
  }
  // every address the name has: the connection could use any
  if (addresses.length === 0 || addresses.some(({ address }) => guard.isRefusedAddress(address))) {
    throw answerError(403, 'not a public address: ' + hostname);
  }

  return addresses;
};

/**
 * Read a URL as one the proxies may fetch
 * @param {string} address The address asked for
 * @returns {URL} The parsed URL
 */
const checkedURL = (address) => {
  let target;
  try {
    target = new URL(address);
  } catch (err) {
    throw answerError(400, 'not a valid address');
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw answerError(400, 'only http and https addresses');
  }

  return target;
};

/**
 * Keep reading an answer while it is under the size limit
 * @param {object} response The answer
 * @param {Function} resolve Called with status, headers and body
 * @param {Function} reject Called with an error
 * @returns {void}
 */
const readBody = (response, resolve, reject) => {
  const max = guard.MAX_BYTES;
  const tooLarge = () => answerError(413, 'the answer is larger than ' + max + ' bytes');
  if (Number(response.headers['content-length']) > max) {
    response.destroy();

    return reject(tooLarge());
  }
  const chunks = [];
  let size = 0;
  response.on('data', (chunk) => {
    size += chunk.length;
    if (size > max) {
      response.destroy();
      reject(tooLarge());
    } else {
      chunks.push(chunk);
    }
  });
  response.on('end', () => resolve({
    statusCode: response.statusCode,
    headers: response.headers,
    body: Buffer.concat(chunks)
  }));
  response.on('error', reject);
};

/**
 * One GET, with the size and time limits
 * @param {object} client http or https
 * @param {object} options Options for client.get: host, port, path...
 * @param {number} deadline When to give up (ms since the epoch)
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>} The answer
 */
const get = (client, options, deadline) => new Promise((resolve, reject) => {
  const request = client.get(options, (response) => readBody(response, resolve, reject));
  const timer = setTimeout(() => {
    request.destroy(answerError(502, 'the server took too long to answer'));
  }, Math.max(0, deadline - Date.now()));
  request.on('close', () => clearTimeout(timer));
  request.on('error', (err) => reject(err.status ? err : answerError(502, 'cannot fetch: ' + (err.code || err.message))));
});

/**
 * One request to a public address, connecting to the address checked
 * @param {URL} target What to fetch
 * @param {number} deadline When to give up (ms since the epoch)
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>} The answer
 */
const getPublic = async (target, deadline) => {
  const checked = await publicAddress(target);
  // not what a second lookup would give (DNS rebinding)
  const lookup = (hostname, options, callback) => (options && options.all
    ? callback(null, checked)
    : callback(null, checked[0].address, checked[0].family));

  // certificates are verified: Node's default
  return get(target.protocol === 'https:' ? https : http, {
    protocol: target.protocol,
    hostname: target.hostname.replace(/^\[|\]$/g, ''),
    port: target.port,
    path: target.pathname + target.search,
    lookup
  }, deadline);
};

/**
 * Fetch a public address: http or https, a public IP, a verified certificate,
 * and each redirect checked again
 * @param {string} address The address asked for
 * @param {number} [maxRedirects=0] How many redirects to follow; with 0 a redirect is the answer
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>} The answer
 */
const fetchPublic = (address, maxRedirects = 0) => {
  const deadline = Date.now() + guard.TIME_LIMIT_MS;
  const hop = async (target, left) => {
    const answer = await getPublic(target, deadline);
    const isRedirect = [301, 302, 303, 307, 308].includes(answer.statusCode) && answer.headers.location;
    if (!isRedirect || maxRedirects === 0) {
      return answer;
    }
    if (left === 0) {
      throw answerError(502, 'too many redirects');
    }

    return hop(checkedURL(new URL(answer.headers.location, target).href), left - 1);
  };

  return Promise.resolve().then(() => hop(checkedURL(address), maxRedirects));
};

/**
 * Fetch a path of this server, through the address and port the request came
 * in on: never the Host header, which the client writes
 * @param {object} req The request being answered
 * @param {string} path The path and query
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>} The answer
 */
const fetchOwn = (req, path) => get(http, {
  host: req.socket.localAddress,
  port: req.socket.localPort,
  path
}, Date.now() + guard.TIME_LIMIT_MS);

guard.fetchPublic = fetchPublic;
guard.fetchOwn = fetchOwn;

module.exports = guard;
