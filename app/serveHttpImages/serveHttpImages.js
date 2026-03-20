const http = require('http');
const https = require('https');

/**
 * Fetch a URL following redirects, returning the final response.
 * @param {string} requestUrl The URL to fetch
 * @param {number} maxRedirects Maximum number of redirects to follow
 * @returns {Promise<object>} The HTTP response stream
 */
const fetchFollowingRedirects = (requestUrl, maxRedirects = 5) => new Promise((resolve, reject) => {
  if(maxRedirects <= 0) {
    return reject(new Error('Too many redirects'));
  }
  const isHttps = requestUrl.startsWith('https');
  const client = isHttps ? https : http;
  const options = isHttps ? { rejectUnauthorized: false } : {};
  client.get(requestUrl, options, (response) => {
    if([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
      fetchFollowingRedirects(response.headers.location, maxRedirects - 1)
        .then(resolve)
        .catch(reject);
    } else {
      resolve(response);
    }
  }).on('error', reject);
});

const getHttpImg = function (req, res) {
  const { url } = req.query;
  fetchFollowingRedirects(url)
    .then((response) => {
      let data = Buffer.alloc(0);
      response.on('data', (chunk) => {
        data = Buffer.concat([data, chunk]);
      });
      response.on('end', () => {
        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data, 'binary');
      });
    })
    .catch((err) => {
      console.error(err);
      res.sendStatus(500);
    });
};

exports.getHttpImg = getHttpImg;
