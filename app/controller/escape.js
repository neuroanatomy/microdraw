// Escaping for data that the server writes into HTML pages (H2b).

// JSON for a Mustache `{{{ }}}` inside an inline <script>. JSON.stringify
// leaves `<` and `>` as they are, so a string holding `</script>` (a project,
// annotation or user name) would end the script element and let the rest run
// as HTML. Escaping `<`, `>` and `&` as JSON \u escapes keeps the same
// value once parsed; U+2028/U+2029 are escaped for older JavaScript parsers.
const scriptJSON = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const htmlEntities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;'
};

// Text for HTML built as a string (element content or a quoted attribute).
const escapeHTML = (text) => String(text).replace(/[&<>"']/g, (c) => htmlEntities[c]);

module.exports = { scriptJSON, escapeHTML };
