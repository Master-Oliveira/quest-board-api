const { createApp } = require('./api/app');

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535.');
}
const server = createApp();
server.on('error', error => {
  console.error(`Unable to start API: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, () => {
  console.log(`Guild API listening on http://localhost:${server.address().port}`);
});
