const { ObjectId } = require('neuroweblab');

/**
 * The ObjectId of a 24-digit hex string, in either case. The ObjectId
 * constructor alone also accepts numbers, and makes up an id for null.
 * @param {string} id The id, as sent by a client or stored in a log entry
 * @returns {ObjectId|null} The ObjectId of NeuroWebLab's driver, null if `id` is not one
 */
const toId = (id) => (typeof id === 'string' && (/^[0-9a-fA-F]{24}$/).test(id) ? new ObjectId(id) : null);

module.exports = { toId };
