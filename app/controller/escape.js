// Escaping for data that the server writes into HTML pages (H2b). JSON in an
// inline <script> uses NeuroWebLab's `jsonForScript` (1.8.0).

const htmlEntities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;'
};

// Text for HTML built as a string (element content or a quoted attribute).
const escapeHTML = (text) => String(text).replace(/[&<>"']/g, (c) => htmlEntities[c]);

module.exports = { escapeHTML };
