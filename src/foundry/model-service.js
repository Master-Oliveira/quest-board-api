const OpenAI = require('openai');
const { DefaultAzureCredential, getBearerTokenProvider } = require('@azure/identity');

class ModelServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelServiceError';
    this.code = code;
  }
}

function configuration(env) {
  const endpoint = env.AZURE_AI_PROJECT_ENDPOINT?.trim();
  const model = env.AZURE_AI_MODEL_DEPLOYMENT?.trim();
  if (!endpoint || !model) {
    throw new ModelServiceError('CONFIGURATION_ERROR',
      'Set AZURE_AI_PROJECT_ENDPOINT and AZURE_AI_MODEL_DEPLOYMENT.');
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ModelServiceError('CONFIGURATION_ERROR', 'The Foundry project endpoint must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ModelServiceError('CONFIGURATION_ERROR', 'The Foundry project endpoint must be a valid HTTPS URL without credentials, query, or fragment.');
  }
  return { endpoint: endpoint.replace(/\/+$/, ''), model };
}

function createFoundryModelService({ env = process.env, createClient = defaultClient, timeoutMs = 30000 } = {}) {
  let client;
  let model;
  return {
    async complete(input, options = {}) {
      if (typeof input !== 'string' || !input.trim()) {
        throw new ModelServiceError('INVALID_INPUT', 'A non-empty input is required.');
      }
      const config = client ? undefined : configuration(env);
      let response;
      const controller = new AbortController();
      let timer;
      try {
        if (!client) {
          model = config.model;
          client = createClient(config.endpoint);
        }
        response = await Promise.race([
          client.responses.create({
            model, input,
            ...(options.maxOutputTokens === undefined ? {} : { max_output_tokens: options.maxOutputTokens }),
          }, { signal: controller.signal }),
          new Promise((resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new ModelServiceError('MODEL_TIMEOUT', 'The Foundry model request timed out. Try again.'));
            }, timeoutMs);
          }),
        ]);
      } catch (error) {
        if (error instanceof ModelServiceError) throw error;
        if (error?.cause instanceof ModelServiceError) throw error.cause;
        if (error instanceof OpenAI.APIConnectionTimeoutError || error?.name === 'AbortError') {
          throw new ModelServiceError('MODEL_TIMEOUT', 'The Foundry model request timed out. Try again.');
        }
        if (error?.status === 401 || error?.status === 403) {
          throw new ModelServiceError('AUTHENTICATION_ERROR', 'Azure authentication or model access failed. Check your identity and permissions.');
        }
        if (error?.status === 429 || error?.status >= 500) {
          throw new ModelServiceError('MODEL_UNAVAILABLE', 'The Foundry model is temporarily unavailable. Try again.');
        }
        throw new ModelServiceError('MODEL_UNAVAILABLE', 'Unable to reach the Foundry model. Check the endpoint and deployment.');
      } finally {
        clearTimeout(timer);
      }
      if (response?.status !== 'completed' || typeof response.output_text !== 'string' || !response.output_text.trim()) {
        throw new ModelServiceError('INVALID_MODEL_RESPONSE', 'The Foundry model returned an incomplete or empty response.');
      }
      return response.output_text;
    },
  };
}

function defaultClient(endpoint) {
  const tokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), 'https://ai.azure.com/.default');
  return new OpenAI({
    baseURL: `${endpoint}/openai/v1`,
    apiKey: async () => {
      try {
        return await tokenProvider();
      } catch {
        throw new ModelServiceError('AUTHENTICATION_ERROR', 'Azure authentication failed. Check your local login or deployed identity.');
      }
    },
    timeout: 30000,
    maxRetries: 0,
    logLevel: 'off',
  });
}

module.exports = { createFoundryModelService, ModelServiceError };
