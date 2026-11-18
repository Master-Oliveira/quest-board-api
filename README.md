---
title: quest-board-api
description: An in-memory Adventurers' Guild REST API with an optional Foundry model service.
---

A small REST API for an Adventurers' Guild, designed for a developer bootcamp.
Manage quests and adventurers using an in-memory store seeded with 10 fantasy
quests and 5 adventurers. No database or external services are required for
the existing CRUD API. An optional Azure AI Foundry connection powers the AI
Quest Master (`POST /quests/generate`) and a model test endpoint.
Swagger UI assets are installed locally through npm. Data resets whenever the
process restarts.

## Build, run, and test

Install **Node.js 22 or newer**. From the cloned repository:

```sh
npm ci
npm start
```

The API listens at `http://localhost:3000` and accepts connections only from this
computer (it binds to `127.0.0.1`). Set `PORT` to change the port, for example
`PORT=4000 npm start` on macOS/Linux. Set `HOST` to bind to another interface;
`POST /model/test` and `POST /quests/generate` still accept only local requests. Stop it with Ctrl+C.
There is no compilation/build step. Run `npm ci` once after cloning to install
the dependencies from the lockfile.

Run all automated tests:

```sh
npm test
```

Run a targeted test:

```sh
node --test --test-name-pattern="CRUD" test/api.test.js
```

Tests use Node's built-in runner and isolated servers on ephemeral local ports.

## Azure AI Foundry connection

The optional model service uses the OpenAI Responses API through a Microsoft
Foundry resource's model inference endpoint and Azure Identity's `DefaultAzureCredential`.
It powers `POST /quests/generate` and `POST /model/test`; quest CRUD routes do not
need it. You need a Foundry resource and a deployed model that supports the
Responses API, structured outputs (JSON Schema), and Microsoft Entra ID
authentication. Model calls may incur charges.

Set these environment variables (see `.env.example`):

| Variable | Description |
| --- | --- |
| `AZURE_AI_MODEL_ENDPOINT` | HTTPS resource root, such as `https://<resource>.services.ai.azure.com` or `https://<resource>.openai.azure.com`, without any path |
| `AZURE_AI_MODEL_DEPLOYMENT` | Name of the deployed model, not necessarily its base model name |

The service appends `/openai/v1` and sends requests to `/openai/v1/responses`.
Do not use the project endpoint (`/api/projects/<project>`), a deployment URL,
or a URL already ending in `/openai/v1`. See Microsoft's
[model endpoint documentation](https://learn.microsoft.com/azure/foundry/foundry-models/concepts/endpoints#azure-openai-inference-endpoint).
If you previously configured `AZURE_AI_PROJECT_ENDPOINT`, replace it with
`AZURE_AI_MODEL_ENDPOINT` and set its value to the resource root URL.

Use only a trusted model endpoint: the application sends an Azure bearer token
to it. Do not include credentials, query parameters, or a fragment in the URL.
The application reads environment variables directly; it does not load `.env`
files automatically.

For local development, install the Azure CLI and sign in with `az login`. Select
the appropriate subscription with `az account set --subscription <subscription>`
if needed. Give the signed-in identity permission to invoke the deployment: for
example, Microsoft documents **Cognitive Services User** at the Foundry resource
scope for keyless model inference. See the [Microsoft Entra ID setup guide](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-entra-id)
for deployment-specific permissions. In Azure, use a managed identity with the
appropriate permissions; `DefaultAzureCredential` also supports other Azure
Identity credential sources. No API key is required.

For example, in PowerShell:

```powershell
$env:AZURE_AI_MODEL_ENDPOINT = 'https://<resource>.services.ai.azure.com'
$env:AZURE_AI_MODEL_DEPLOYMENT = '<deployment name>'
npm run verify:foundry
```

The command makes a small, billable model request and prints only a success
message or a sanitized diagnostic, never the model output, endpoint, or token.
It exits nonzero on failure. Check the configuration, local login, role
assignments, deployment availability, and network access if it fails. Model
requests have a 30-second deadline and no automatic retries. This is a
local development/demo command.

### Test through REST or Swagger

After setting the same environment variables and running `npm start`, open
`http://localhost:3000/docs` and use **POST /model/test**, or run in PowerShell:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/model/test' -Method Post `
  -ContentType 'application/json' `
  -Body '{"input":"Reply with a short greeting."}'
```

The JSON response is `{ "text": "Hello, adventurer!" }` (actual text varies).
The request must contain only `input`, a non-blank string of at most 5000 Unicode
code points, measured before trimming. Responses are limited to 512 output tokens
by default. Set `MODEL_TEST_MAX_OUTPUT_TOKENS` to an integer from 16 to 4096 to
change the limit; reasoning models count reasoning tokens toward it. Requests that
exhaust the limit and produce an incomplete response return an error, not partial
text. The JSON-only policy and 64 KiB body limit apply.

This endpoint invokes the configured model and incurs usage charges. It is
unauthenticated and intended only for local testing. It returns 403 unless the
request comes from a loopback address with a `localhost`, `127.0.0.1`, or `[::1]`
`Host` header, which also blocks DNS-rebinding requests from web pages. At most
two model calls run at once; additional requests return 429 with `Retry-After`.
If the client disconnects, the server cancels the model call. When
`AZURE_AI_MODEL_ENDPOINT` is set, the server prints a startup warning about this
endpoint. Only the caller receives model text; the server does not log it.

Errors use the standard envelope:

| Status | Codes                                                                                         |
|--------|-----------------------------------------------------------------------------------------------|
| 500    | `CONFIGURATION_ERROR`, or `INTERNAL_ERROR` for unexpected failures                            |
| 502    | `AUTHENTICATION_ERROR`, `MODEL_REQUEST_REJECTED`, `MODEL_NOT_FOUND`, `INVALID_MODEL_RESPONSE` |
| 503    | `MODEL_UNAVAILABLE` (throttling, upstream server errors, or connection failures)              |
| 504    | `MODEL_TIMEOUT`                                                                               |

Configuration and model errors contain sanitized diagnostics; unexpected errors
return a generic message. Other routes still work without Foundry configuration.

### Generate an AI quest

The guild's Quest Master asks the configured model to write a quest for a
specific adventurer, then the application checks the result against the guild
rules and saves it like any other quest. With the Foundry variables set and the
server running, in PowerShell:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/quests/generate' -Method Post `
  -ContentType 'application/json' `
  -Headers @{ 'X-Request-Id' = 'demo-123' } `
  -Body '{"adventurerId":"adventurer-1","theme":"haunted lighthouse","difficulty":"medium"}'
```

Or with curl:

```sh
curl -i http://localhost:3000/quests/generate \
  -H 'Content-Type: application/json' \
  -d '{"adventurerId":"adventurer-1","theme":"haunted lighthouse","difficulty":"medium"}'
```

The response is `201 Created` with a `Location` header and the saved quest
(text varies):

```json
{
  "id": "6f1c2b9e-5d1a-4f7e-9c3b-2a8d7e6f5c4b",
  "title": "The Lantern Wraith",
  "description": "A restless spirit has darkened the coastal lighthouse.",
  "difficulty": "medium",
  "minimumLevel": 4,
  "goldReward": 150,
  "experienceReward": 300,
  "status": "open",
  "createdAt": "2026-11-17T22:40:00.000Z",
  "objectives": ["Reach the lighthouse", "Relight the lantern", "Banish the wraith"],
  "aiGenerated": true
}
```

The request requires exactly `adventurerId`, `theme` (at most 200 characters),
and `difficulty` (`easy`, `medium`, `hard`, or `legendary`). The model returns
JSON that must match a strict schema, and the application, not the model,
enforces these rules before saving:

| Rule | Requirement |
| --- | --- |
| Difficulty | Matches the requested difficulty |
| Minimum level | Between `max(1, adventurer level - 5)` and the adventurer's level |
| Objectives | 3 to 5 non-blank objectives, each at most 200 characters |
| Status and marker | Always saved with `status: "open"` and `aiGenerated: true` |

| Difficulty | Gold reward | Experience reward |
| --- | --- | --- |
| easy | 10-60 | 25-150 |
| medium | 75-300 | 150-600 |
| hard | 400-1200 | 700-2000 |
| legendary | 2000-8000 | 4000-12000 |

Generated quests then work with every quest route: list filters, GET, PUT, and
DELETE. PUT keeps `objectives` and `aiGenerated`, which are server-managed.
Nothing is saved when generation fails:

| Status | Codes |
| --- | --- |
| 400 | `VALIDATION_ERROR` (missing, unknown, or invalid fields, including difficulty), `INVALID_JSON` |
| 404 | `NOT_FOUND` for an unknown adventurer; the model is not called |
| 502 | `INVALID_MODEL_RESPONSE` (malformed output), `INVALID_GENERATED_QUEST` (rule violations, with field `details`), and the model-test 502 codes |
| 503, 504 | `MODEL_UNAVAILABLE`, `MODEL_TIMEOUT`; try again later |

The endpoint shares the model test's protections: local requests only (403
otherwise), at most two model calls at once across both endpoints (429 with
`Retry-After`), a 30-second deadline with no retries, and cancellation when the
client disconnects. Invalid bodies and unknown adventurers are rejected with
400 or 404 before the concurrency check, so 429 means only that a valid request
should be retried. It is unauthenticated and billable.

Model output is limited to 2048 tokens by default. Set
`QUEST_GENERATION_MAX_OUTPUT_TOKENS` to an integer from 256 to 16384 to change
it; reasoning models count reasoning tokens toward the limit, and an exhausted
limit returns 502 `INVALID_MODEL_RESPONSE`.

Each request gets a correlation ID: a valid `X-Request-Id` header (1-128
letters, digits, `.`, `_`, or `-`) is reused, otherwise a UUID is generated. The
ID is returned in the `X-Request-Id` response header. The server writes one
JSON log line per attempt with the request ID, adventurer ID, difficulty, model
duration in milliseconds, outcome, and error code or quest ID. Logs never
include the theme, prompt, model output, credentials, or tokens.

### Troubleshoot model requests

* For `MODEL_NOT_FOUND` (upstream HTTP 404), confirm that `AZURE_AI_MODEL_DEPLOYMENT`
  matches the deployment name shown in Foundry, which may differ from the model
  family, and that it belongs to the configured resource.
* For `MODEL_REQUEST_REJECTED` (upstream HTTP 400/422), check the deployed model's
  Responses API support and output-token requirements.
* For `MODEL_UNAVAILABLE` connection failures, check DNS, TLS trust, proxy
  settings, and network access.
* Restart the server after changing environment settings; the model client
  caches configuration after its first use.

Do not disable TLS verification or enable SDK debug logging to diagnose problems.

If Node's default connection fails with `ECONNRESET` while Windows curl works,
test whether a certificate-verified TLS 1.2 connection succeeds. On an affected
Windows connection, the following startup command was verified with a successful
`POST /model/test` request:

```powershell
node --tls-max-v1.2 --env-file=.env .\src\server.js
```

This is a process-scoped workaround, not a required application setting.
Certificate verification remains enabled. Investigate endpoint or network
handling of newer TLS connections before making this a permanent startup option.
Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### Use the model service in code

Application services receive the `model` service as a dependency
from the composition root (`createServices` in `src/services.js`) and call
`await model.complete('Your input')`. It returns text and throws a
`ModelServiceError` with a safe `code` and message on failure. Pass
`{ signal }` in the options to cancel a call, which then fails with
`MODEL_CANCELLED`. Pass `{ instructions, jsonSchema: { name, schema } }` to send
system instructions and request strict structured output; the result is still
the JSON text, which the caller must parse and validate. The quest generator in
`src/domain/quest-generator.js` is the reference consumer. To test a
consumer without Azure, inject an object implementing `complete(input, options)`
as `createServices({ modelService: fakeModel })`, and optionally a
`logger` with `info(entry)` and `error(entry)`. The verification command uses
the same abstraction; consumers do not need to import the SDK or handle tokens.
Foundry configuration is checked only when the model service is first used, so
the existing API runs without it.

## Endpoints

| Method | Path | Success |
| --- | --- | --- |
| GET | `/quests` | 200, array of quests |
| GET | `/quests/{id}` | 200, quest |
| POST | `/quests` | 201, created quest and `Location` header |
| POST | `/quests/generate` | 201, AI-generated quest and `Location` header |
| PUT | `/quests/{id}` | 200, updated quest |
| DELETE | `/quests/{id}` | 204, no body |
| GET | `/adventurers` | 200, array of adventurers |
| GET | `/adventurers/{id}` | 200, adventurer |
| POST | `/adventurers` | 201, created adventurer and `Location` header |
| PUT | `/adventurers/{id}` | 200, updated adventurer |
| DELETE | `/adventurers/{id}` | 204, no body |
| POST | `/model/test` | 200, object with model `text` |

Filter quests using `status` and/or `difficulty`, for example:

```sh
curl 'http://localhost:3000/quests?status=open&difficulty=easy'
```

Both filters must match when combined. No matches returns `[]`.
Unknown, duplicate, or invalid quest filters return 400.

Create a quest:

```sh
curl -i http://localhost:3000/quests \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Rescue the griffin",
    "description": "Free the griffin trapped in the old tower.",
    "difficulty": "medium",
    "minimumLevel": 3,
    "goldReward": 150,
    "experienceReward": 300,
    "status": "open"
  }'
```

Create an adventurer:

```sh
curl -i http://localhost:3000/adventurers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Elara","level":1,"experience":0,"gold":0,"status":"active"}'
```

Use the returned `id` for GET, PUT, and DELETE requests. Seed IDs are
`quest-1` through `quest-10` and `adventurer-1` through `adventurer-5`;
new IDs are UUIDs.

### Validation and errors

- POST and PUT require **all writable fields** shown in the examples.
  PUT replaces those fields; it does not create missing records.
- `id` and quest `createdAt`, `objectives`, and `aiGenerated` are server-managed
  and cannot be supplied. Updating a quest preserves them. Manually created and
  seed quests have `objectives: []` and `aiGenerated: false`.
- Quest difficulty: `easy`, `medium`, `hard`, `legendary`.
- Quest status: `open`, `in-progress`, `completed`.
- Adventurer status: `active`, `inactive`.
- Levels must be integers >= 1. Rewards, experience, and gold must be integers >= 0.
  All integers must be <= JavaScript's safe integer maximum (9007199254740991).
- Names and titles must contain non-whitespace text and be at most 200 characters;
  descriptions at most 5000 characters. Surrounding whitespace is trimmed.
- Unknown fields are rejected. Bodies must be JSON objects, with
  `Content-Type: application/json`, and no larger than 64 KiB.

Errors use this format (field details are included for invalid fields):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body.",
    "details": [
      { "field": "title", "message": "Required field is missing or invalid." }
    ]
  }
}
```

Status codes: 400 for invalid input/JSON/filters, 403 for non-local model
requests, 404 for missing routes or records, 405 for unsupported resource methods
(with `Allow`), 413 for oversized bodies, 415 for unsupported content types,
429 when too many model calls are in progress, and 500 for unexpected errors.
See the model test and quest generation sections for model-specific codes.

## OpenAPI documentation

After starting the API, open **http://localhost:3000/docs** for Swagger UI
(use your configured port if different).

1. Expand **GET /quests** and click **Try it out**.
2. Optionally select a `status` and/or `difficulty`, then click **Execute**.
3. Inspect the response status and JSON body below the operation.
4. To create a record, expand **POST /quests** or **POST /adventurers**,
   click **Try it out**, fill in all writable fields, and click **Execute**.
   Do not include server-managed `id`, `createdAt`, `objectives`, or `aiGenerated` fields.
5. Copy the returned `id` to test the GET, PUT, and DELETE operations.
   PUT requires all writable fields, not just the fields being changed.

The UI, specification, and API share the same origin, so no CORS configuration
is needed. All UI assets are served locally, with no CDN or external validator.

The OpenAPI 3.0 specification is in `openapi.json` and served at
`GET /openapi.json`. You can also import the file into an OpenAPI-compatible client.
No documentation service is required to run the API.

## Project structure

```text
src/
  api/app.js              HTTP routing, JSON parsing, and error responses
  api/docs.js             Swagger UI page and locally served assets
  domain/guild-service.js Business operations
  domain/quest-generator.js AI quest prompt, output parsing, and guild rules
  domain/validation.js    Input rules and API errors
  data/repository.js      In-memory CRUD implementation
  data/seeds.js           Initial fantasy quests and adventurers
  foundry/model-service.js Azure Foundry model service
  services.js             Application service composition
  verify-foundry.js       Local connection verification command
  server.js               Application entry point
test/api.test.js           HTTP integration and repository tests
test/foundry.test.js       Offline model service tests
test/quest-generator.test.js Offline quest generator unit tests
openapi.json              API contract
```

Services depend on the repository's `list`, `get`, `create`, `update`, and `delete`
operations, not HTTP details. A persistent repository can implement the same
operations later (with async calls added if needed), leaving the REST contract
unchanged. This intentionally simple API has no authentication and is intended
for local learning, not public production deployment.
