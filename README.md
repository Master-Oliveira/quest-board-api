# quest-board-api

A small REST API for an Adventurers' Guild, designed for a developer bootcamp.
Manage quests and adventurers using an in-memory store seeded with 10 fantasy
quests and 5 adventurers. No database or external services are required.
Swagger UI assets are installed locally through npm. Data resets whenever the
process restarts.

## Build, run, and test

Install **Node.js 22 or newer**. From the cloned repository:

```sh
npm ci
npm start
```

The API listens at `http://localhost:3000`. Set `PORT` to change the port, for example
`PORT=4000 npm start` on macOS/Linux. Stop it with Ctrl+C.
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

## Endpoints

| Method | Path | Success |
| --- | --- | --- |
| GET | `/quests` | 200, array of quests |
| GET | `/quests/{id}` | 200, quest |
| POST | `/quests` | 201, created quest and `Location` header |
| PUT | `/quests/{id}` | 200, updated quest |
| DELETE | `/quests/{id}` | 204, no body |
| GET | `/adventurers` | 200, array of adventurers |
| GET | `/adventurers/{id}` | 200, adventurer |
| POST | `/adventurers` | 201, created adventurer and `Location` header |
| PUT | `/adventurers/{id}` | 200, updated adventurer |
| DELETE | `/adventurers/{id}` | 204, no body |

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
- `id` and quest `createdAt` are server-generated and cannot be supplied.
  Updating a quest preserves its original creation timestamp.
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

Status codes: 400 for invalid input/JSON/filters, 404 for missing routes or records,
405 for unsupported resource methods (with `Allow`), 413 for oversized bodies,
415 for unsupported content types, and 500 for unexpected errors.

## OpenAPI documentation

After starting the API, open **http://localhost:3000/docs** for Swagger UI
(use your configured port if different).

1. Expand **GET /quests** and click **Try it out**.
2. Optionally select a `status` and/or `difficulty`, then click **Execute**.
3. Inspect the response status and JSON body below the operation.
4. To create a record, expand **POST /quests** or **POST /adventurers**,
   click **Try it out**, fill in all writable fields, and click **Execute**.
   Do not include server-managed `id` or `createdAt` fields.
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
  domain/validation.js    Input rules and API errors
  data/repository.js      In-memory CRUD implementation
  data/seeds.js           Initial fantasy quests and adventurers
  server.js               Application entry point
test/api.test.js           HTTP integration and repository tests
openapi.json              API contract
```

Services depend on the repository's `list`, `get`, `create`, `update`, and `delete`
operations, not HTTP details. A persistent repository can implement the same
operations later (with async calls added if needed), leaving the REST contract
unchanged. This intentionally simple API has no authentication and is intended
for local learning, not public production deployment.
