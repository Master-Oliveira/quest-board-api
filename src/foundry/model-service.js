const OpenAI = require('openai');
const { DefaultAzureCredential } = require('@azure/identity');

class ModelServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelServiceError';
    this.code = code;
  }
}

function configuration(env) {
  const endpoint = env.AZURE_AI_MODEL_ENDPOINT?.trim();
  const model = env.AZURE_AI_MODEL_DEPLOYMENT?.trim();
  if (!endpoint || !model) {
    throw new ModelServiceError('CONFIGURATION_ERROR',
      'Set AZURE_AI_MODEL_ENDPOINT and AZURE_AI_MODEL_DEPLOYMENT.');
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ModelServiceError('CONFIGURATION_ERROR', 'The Foundry model endpoint must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ModelServiceError('CONFIGURATION_ERROR', 'The Foundry model endpoint must be a valid HTTPS URL without credentials, query, or fragment.');
  }
  if (!/^\/+$/.test(url.pathname)) {
    throw new ModelServiceError('CONFIGURATION_ERROR',
      'Set AZURE_AI_MODEL_ENDPOINT to the resource root URL, without /api/projects, /openai/v1, or other paths.');
  }
  return { endpoint: url.origin, model };
}

function createFoundryModelService({ env = process.env, createClient = defaultClient, timeoutMs = 30000 } = {}) {
  let client;
  let model;
  return {
    async complete(input, options = {}) {
      if (typeof input !== 'string' || !input.trim()) {
        throw new ModelServiceError('INVALID_INPUT', 'A non-empty input is required.');
      }
      const { signal } = options;
      const cancelled = () => new ModelServiceError('MODEL_CANCELLED', 'The model request was cancelled.');
      if (signal?.aborted) throw cancelled();
      const config = client ? undefined : configuration(env);
      let response;
      const controller = new AbortController();
      let timer;
      let cancel;
      try {
        if (!client) {
          model = config.model;
          client = createClient(config.endpoint);
        }
        response = await Promise.race([
          client.responses.create({
            model, input,
            ...(options.maxOutputTokens === undefined ? {} : { max_output_tokens: options.maxOutputTokens }),
            ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
            ...(options.jsonSchema === undefined ? {} : { text: { format: {
              type: 'json_schema',
              name: options.jsonSchema.name,
              schema: options.jsonSchema.schema,
              strict: true,
            } } }),
          }, { signal: controller.signal }),
          new Promise((resolve, reject) => {
            timer = setTimeout(() => {
              reject(new ModelServiceError('MODEL_TIMEOUT', 'The Foundry model request timed out. Try again.'));
              controller.abort();
            }, timeoutMs);
            cancel = () => {
              reject(cancelled());
              controller.abort();
            };
            signal?.addEventListener('abort', cancel, { once: true });
          }),
        ]);
      } catch (error) {
        if (signal?.aborted) throw cancelled();
        if (error instanceof ModelServiceError) throw error;
        if (error?.cause instanceof ModelServiceError) throw error.cause;
        if (error instanceof OpenAI.APIConnectionTimeoutError || error?.name === 'AbortError') {
          throw new ModelServiceError('MODEL_TIMEOUT', 'The Foundry model request timed out. Try again.');
        }
        if (error?.status === 401 || error?.status === 403) {
          throw new ModelServiceError('AUTHENTICATION_ERROR', 'Azure authentication or model access failed. Check your identity and permissions.');
        }
        if (error?.status === 400 || error?.status === 422) {
          throw new ModelServiceError('MODEL_REQUEST_REJECTED',
            `Foundry rejected the request (HTTP ${error.status}). Check Responses API support and the output-token limit for the deployed model.`);
        }
        if (error?.status === 404) {
          throw new ModelServiceError('MODEL_NOT_FOUND',
            'Foundry returned HTTP 404. Check that AZURE_AI_MODEL_ENDPOINT is the resource hosting the deployment and AZURE_AI_MODEL_DEPLOYMENT is its exact deployment name, not just the model family.');
        }
        if (error?.status === 429 || error?.status >= 500) {
          throw new ModelServiceError('MODEL_UNAVAILABLE', 'The Foundry model is temporarily unavailable. Try again.');
        }
        if (error instanceof OpenAI.APIConnectionError) {
          throw new ModelServiceError('MODEL_UNAVAILABLE',
            'No HTTP response was received from Foundry. Check DNS, TLS certificates, proxy settings, and network access to the configured endpoint.');
        }
        throw new ModelServiceError('MODEL_UNAVAILABLE', 'Unable to reach the Foundry model. Check the endpoint and deployment.');
      } finally {
        clearTimeout(timer);
        if (cancel) signal?.removeEventListener('abort', cancel);
      }
      if (response?.status !== 'completed' || typeof response.output_text !== 'string' || !response.output_text.trim()) {
        throw new ModelServiceError('INVALID_MODEL_RESPONSE', 'The Foundry model returned an incomplete or empty response.');
      }
      return response.output_text;
    },
  };
}

function defaultClient(endpoint) {
  const credential = new DefaultAzureCredential();
  return new OpenAI({
    baseURL: `${endpoint}/openai/v1`,
    apiKey: 'foundry-request-auth',
    fetch: async (url, options = {}) => {
      let accessToken;
      try {
        const token = await credential.getToken('https://ai.azure.com/.default', {
          abortSignal: options.signal,
        });
        if (!token?.token) throw new Error('No token was returned.');
        accessToken = token.token;
      } catch {
        throw new ModelServiceError('AUTHENTICATION_ERROR', 'Azure authentication failed. Check your local login or deployed identity.');
      }
      const headers = new Headers(options.headers);
      headers.set('authorization', ['Bearer', accessToken].join(' '));
      return fetch(url, { ...options, headers });
    },
    timeout: 30000,
    maxRetries: 0,
    logLevel: 'off',
  });
}

module.exports = { createFoundryModelService, ModelServiceError };
