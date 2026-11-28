// The CZI service's address, from CZI_SERVICE_URL (e.g. /czi behind the same
// web server), for the pages that show images; empty when there is none.
const { jsonForScript } = require('neuroweblab');

/** @returns {string} The address as JSON for an inline <script> */
const cziServiceForScript = () => jsonForScript(process.env.CZI_SERVICE_URL || '');

module.exports = { cziServiceForScript };
