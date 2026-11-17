const { createServices } = require('./services');
const { ModelServiceError } = require('./foundry/model-service');

async function verify(model) {
  await model.complete('Reply with a short greeting.', { maxOutputTokens: 128 });
}

if (require.main === module) {
  verify(createServices().model).then(() => {
    console.log('Foundry connection verified.');
  }).catch(error => {
    const message = error instanceof ModelServiceError
      ? `${error.code}: ${error.message}` : 'Unexpected error while verifying the Foundry connection.';
    console.error(message);
    process.exitCode = 1;
  });
}

module.exports = { verify };
