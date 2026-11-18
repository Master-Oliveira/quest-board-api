const { createApp } = require('./api/app');

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535.');
}
const host = process.env.HOST?.trim() || '127.0.0.1';
const server = createApp();
server.on('error', error => {
  console.error(`Unable to start API: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const address = server.address();
  const displayHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  console.log(`Guild API listening on http://${displayHost}:${address.port}`);
  if (process.env.AZURE_AI_MODEL_ENDPOINT?.trim()) {
    console.warn('Warning: POST /model/test and POST /quests/generate are unauthenticated and make billable model calls. They accept only local requests.');
  }
});
