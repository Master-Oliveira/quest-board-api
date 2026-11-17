const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { getAbsoluteFSPath } = require('swagger-ui-dist');

const assets = new Map([
  ['/docs/swagger-ui.css', {
    type: 'text/css; charset=utf-8',
    body: readFileSync(join(getAbsoluteFSPath(), 'swagger-ui.css')),
  }],
  ['/docs/swagger-ui-bundle.js', {
    type: 'text/javascript; charset=utf-8',
    body: readFileSync(join(getAbsoluteFSPath(), 'swagger-ui-bundle.js')),
  }],
  ['/docs/initializer.js', {
    type: 'text/javascript; charset=utf-8',
    body: `window.onload = function () {
  SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    validatorUrl: null
  });
};`,
  }],
]);

const page = {
  type: 'text/html; charset=utf-8',
  body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Adventurers' Guild API — Swagger UI</title>
  <link rel="stylesheet" href="/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script src="/docs/initializer.js"></script>
</body>
</html>`,
};
assets.set('/docs', page);
assets.set('/docs/', page);

function serveDocs(path, response) {
  const asset = assets.get(path);
  if (!asset) return false;
  response.writeHead(200, {
    'Content-Type': asset.type,
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(asset.body);
  return true;
}

module.exports = { serveDocs };
