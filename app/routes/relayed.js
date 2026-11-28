'use strict';

// /getTile, /image and /getJson answer with what another server sent. Anyone
// can make a link to them, so no answer may become a page of MicroDraw: opened
// in a browser, it runs no script and does not have this site's origin.

// the types of what the viewer asks for: tiles, descriptions and lists
const RELAYED_TYPES = /^\s*(image\/[\w.+-]+|application\/(json|ld\+json|xml)|text\/(xml|plain))\s*(;|$)/i;

/**
 * @param {string|undefined} contentType The type the other server gave
 * @returns {string} The type to answer with: that one if it is on the list
 */
const relayedType = (contentType) => (RELAYED_TYPES.test(contentType || '') ? contentType : 'application/octet-stream');

/**
 * @returns {object} The headers every relayed answer carries
 */
const inertHeaders = () => ({
  // SVG and XML can hold scripts: sandbox keeps them from running
  'Content-Security-Policy': 'sandbox; default-src \'none\'',
  // the browser keeps to the type given, whatever the bytes look like
  'X-Content-Type-Options': 'nosniff'
});

module.exports = { relayedType, inertHeaders };
