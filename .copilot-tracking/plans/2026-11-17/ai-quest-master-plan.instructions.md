<!-- markdownlint-disable-file -->
# Plan: AI Quest Master (issue #2)

* Research: `.copilot-tracking/research/2026-11-17/ai-quest-master-research.md`
* Details: `.copilot-tracking/details/2026-11-17/ai-quest-master-details.md`
* Planning log: `.copilot-tracking/plans/logs/2026-11-17/ai-quest-master-log.md`
* Branch: `feature/2-ai-quest-master-research`
* Status: implemented; validation 6.1 blocked by policy, 6.2 passed

## User Requests

* Run the research for GitHub issue #2 in a new branch (complete)
* Use the recommended default for every open decision (recorded in research "Decisions")
* Produce the plan before any implementation (this document)

## Overview and objectives

Add `POST /quests/generate`, which loads the adventurer, asks the Foundry model for a strict JSON Schema quest, enforces game rules in application code, persists through the existing quest repository, and returns 201 with the quest. Derived objectives:

* Keep request contracts for existing routes unchanged; quest responses gain additive read-only `objectives` and `aiGenerated`
* Keep SDKs inside `src/foundry/model-service.js`; business rules in `src/domain`; HTTP concerns in `src/api`
* Persist nothing on any failure; log one sanitized structured entry per attempt
* Keep the test suite offline and credential-free

## Context Summary

* `AGENTS.md` (architecture, invariants, security constraints, Definition of Done)
* `.github/copilot-instructions.md` (Windows + Node 22 + npm 10, feed registry, validation reporting)
* Commit message instructions (Conventional Commits) for the final suggested message

## Implementation checklist

### Phase 1: Model service structured output <!-- parallelizable: true -->

* [x] 1.1 Add optional `instructions` and `jsonSchema` options to `complete()` in `src/foundry/model-service.js`
* [x] 1.2 Add focused tests in `test/foundry.test.js`

### Phase 2: Quest data model <!-- parallelizable: true -->

* [x] 2.1 Seeds gain `objectives: []` and `aiGenerated: false` (`src/data/seeds.js`)
* [x] 2.2 Repository copies array fields on every read and write (`src/data/repository.js`)
* [x] 2.3 `GuildService`: quest create sets defaults, update preserves server-managed fields, new `createGenerated` (`src/domain/guild-service.js`)
* [x] 2.4 Validation: `questGeneration` schema, export `difficulties` and `isText` (`src/domain/validation.js`)

### Phase 3: Quest generator domain module <!-- parallelizable: false -->

Depends on Phases 1 and 2.

* [x] 3.1 Create `src/domain/quest-generator.js` (rules, schema, prompt, parsing, persistence, logging)
* [x] 3.2 Wire it in `src/services.js` with an injectable `logger`
* [x] 3.3 Unit tests in `test/quest-generator.test.js`

### Phase 4: HTTP endpoint <!-- parallelizable: false -->

Depends on Phase 3.

* [x] 4.1 Extract a shared model-request helper from `testModel` in `src/api/app.js`
* [x] 4.2 Add `/quests/generate` route with request ID handling
* [x] 4.3 Update the billable-endpoint warning in `src/server.js`
* [x] 4.4 Integration tests in `test/api.test.js`

### Phase 5: Documentation <!-- parallelizable: true -->

Can run alongside Phase 4 once the contract below is fixed.

* [x] 5.1 `openapi.json`: new path, request schema, Quest fields, responses, header
* [x] 5.2 `README.md`: endpoint row, example, rules, errors, logging, project structure
* [x] 5.3 `AGENTS.md`: architecture and model-service wording

### Phase 6: Validation <!-- parallelizable: false -->

* [ ] 6.1 `npm ci --registry=https://packagefeedproxy.microsoft.io/npm/` (blocked: registry access excluded by organization content policy)
* [x] 6.2 `npm test` on Windows; fix failures and re-run

## Dependencies

* No new npm packages; `openai@7.55.0` already types `text.format` JSON Schema
* No skills required; `commit` / `create-pr` skills apply only if the user later asks to commit or open a PR

## Success criteria

* Every issue #2 acceptance criterion maps to an implemented change and a test (see details, "Acceptance traceability")
* Existing tests pass unchanged except the documented repository-copy extension
* OpenAPI, README, AGENTS.md, implementation, and tests agree
* `npm ci` (feed) and `npm test` pass on Windows; results reported with OS

