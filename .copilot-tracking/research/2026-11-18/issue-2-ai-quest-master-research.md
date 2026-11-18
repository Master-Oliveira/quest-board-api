<!-- markdownlint-disable-file -->
# Task Research: Issue 2 - AI Quest Master

| Field | Value |
|-------|-------|
| Date | 2026-11-18 |
| Researcher / agent | RPI Agent / rpi-research |
| Output mode | convergence |

## Executive Summary

The existing composition root and model abstraction can support quest generation without a new framework or dependency. A dedicated generation consumer can use the configured model and existing quest repository while leaving ordinary CRUD offline.

Research is complete. The user approved generation-only reward bands and level bounds, read-only generated metadata preserved through PUT, and local-only generation with a shared two-call model budget. Planning can start after explicit manual advancement.

Confidence is high for the current-code findings and the SDK request shape. The deployed model's actual structured-output support is unverified; no local .env values or live services were accessed.

## What You May Not Know

Objectives introduce the first nested quest data, so current shallow defensive copies become insufficient. Existing PUT replaces records and would erase AI provenance unless deliberately preserved. Provider structured output also cannot be relied on to enforce every application rule: Microsoft's documented subset excludes numeric bounds and array-size constraints.

## Findings

### F1: Reuse the injected model, not an SDK in the HTTP or domain consumer

The current services factory already supplies fresh guild repositories and an injectable model. The adapter returns completed text and classifies failures safely. A generation consumer can retrieve the adventurer before calling the model, validate a complete result, then perform one repository write. No database or direct Azure SDK dependency in the consumer is needed.

* Questions: Q1, Q3, Q4.
* Evidence state: evidence-backed finding.
* Evidence: C1, C3, C6-C9.
* Confidence and limits: high for the existing seam; the exact public service member is a planning choice, not an existing API.

The new literal route must precede generic quest-ID routing. A successful response should follow existing creation semantics: 201, Location, and the saved quest. Invalid input or an unknown adventurer should fail before billable work. Invalid model output must fail without a write, not become a 400 attributed to the caller.

### F2: Structured output needs a narrow adapter extension and independent application validation

The installed OpenAI 7.55.0 SDK supports text.format with type json_schema, name, schema, and strict as siblings. The current adapter forwards only the token limit and signal, so prompt-only JSON instructions would not provide the requested structured-output contract. An optional trusted internal schema parameter can preserve existing text completion behavior.

* Questions: Q2, Q3.
* Evidence state: evidence-backed finding.
* Evidence: C6, C7, C11, C12, W2.
* Confidence and limits: high for installed request types and documented v1 support; actual configured deployment compatibility is unknown and must not be inferred from SDK support.

Keep the provider schema restricted to its supported subset, with required fields and additionalProperties false. Parse returned text as one JSON value, reject malformed JSON, unexpected fields, wrong types, blank/overlong text, unsafe integers, invalid difficulty, invalid objective count, or policy violations. Treat refusals and incomplete output as sanitized failures. Do not retry with a weaker format or synthesize success-shaped fallback content.

### F3: Adding objectives and provenance affects storage and PUT compatibility

Neither the writable quest schema nor its closed OpenAPI response schema includes objectives or AI provenance. Existing POST/PUT must not suddenly require those fields. Repository copies are shallow and GuildService.update replaces all data except createdAt, so merely adding generation would leave nested mutation and provenance-loss problems.

* Questions: Q1, Q2, Q4.
* Evidence state: evidence-backed finding.
* Evidence: C2, C4, C5, C8, C10.
* Confidence and limits: high; all affected record boundaries and update code were read directly.

Confirmed D3 direction: generated records add read-only objectives and aiGenerated: true; old seeds and manual records keep their current shape. Existing PUT retains generated-only metadata while replacing the same writable fields as before. Generated records remain visible through list, filter, get, update and delete. Objectives arrays need defensive copies on constructor input, create/update input, and every returned record. Requiring objectives for old POST/PUT is rejected as a breaking change.

### F4: The issue does not define a numerical game-balance policy

Current validation enforces only minimumLevel >= 1 and nonnegative safe-integer rewards. Seed quests illustrate difficulty-specific values but are not an executable or documented balance rule. Issue #2 does not define "appropriate" levels or rewards, nor require inactive adventurers to be rejected.

* Questions: Q2.
* Evidence state: evidence-backed finding.
* Evidence: C2, C5, W1.
* Confidence and limits: high for the gap after reading the issue, all domain code, seeds and README rules, and confirming there are no issue comments.

The application must enforce an explicit, agreed generation-only policy. User-confirmed D2 policy: 1 <= minimumLevel <= the selected adventurer's level; model difficulty must exactly match requested difficulty; gold/XP must fall inside the following seed-inspired bands. These bands are now an explicit user decision, not a rule inferred from seeds.

| Difficulty | Gold inclusive | Experience inclusive |
|------------|----------------|----------------------|
| easy | 20-30 | 50-75 |
| medium | 100-200 | 200-400 |
| hard | 500-800 | 900-1400 |
| legendary | 3000-5000 | 5000-8000 |

Reject invalid output instead of silently clamping rewards or rewriting its difficulty. Set open status and AI provenance in the application, not from model-supplied values. Exactly 3-5 nonblank bounded string objectives must be independently checked. Theme relevance can be requested in the prompt but exact semantic adherence is not established by JSON Schema.

### F5: Reuse safe failures and offline tests, but explicitly choose model-route protections

Only /model/test currently has loopback/Host checks, a two-call concurrency guard, bounded output and disconnect cancellation. The SDK adapter supplies lazy configuration, a 30-second authentication/inference deadline, no retries and sanitized errors. There is no request correlation or invocation-duration logging in the current request path.

* Questions: Q3, Q4.
* Evidence state: evidence-backed finding.
* Evidence: C3, C6, C8, C9, C13.
* Confidence and limits: high for existing behavior. Applying protections to the new route is a user-owned product/design decision, not an existing acceptance criterion.

Confirmed D4 direction: keep generation local-only like the existing billable route, share a two-call model budget per app across both routes, and cancel on disconnect. Also retain an explicit bounded output limit and check cancellation again before saving. The shared budget intentionally means a generation call occupies one of the two slots also available to /model/test; its local checks, text response, output bound and error behavior remain intact. Create a server-generated correlation ID and emit only allowlisted event fields such as ID, duration, outcome and safe error code; never log prompts, adventurer records, response text, SDK exceptions, tokens or endpoints.

Use the existing mock injection and loopback HTTP setup for success, all invalid-output boundaries, rule violations, missing adventurer, invalid difficulty, safe upstream errors, no-persistence failures, cancellation, nested copies, metadata preservation, and legacy CRUD. Tests must remain offline.

## Recommendation and Alternatives

Recommendation: reuse the existing model abstraction with strict structured output, validate at an application boundary before one in-memory save, and preserve existing CRUD request shapes. This is supported by C1-C11 and W2. D2-D4 now confirm balance, metadata compatibility and route-protection policy. No further material research decision remains.

| Option | Benefits | Costs and risks | Evidence | Disposition |
|--------|----------|-----------------|----------|-------------|
| Extend complete(input, options) with trusted structured-output configuration | Preserves current abstraction and mocks; no dependency change | Adapter needs a narrow new option and wire-level tests | C6, C9, C11-C12, W2 | recommended |
| Prompt-only JSON with unchanged adapter | Minimal adapter work | Does not request provider-enforced structure | C6, W1-W2 | rejected |
| Add Zod / replace Responses with Chat Completions | Higher-level parsing helpers | Unnecessary dependency/API churn; does not remove domain validation | C7, C11, W2 | rejected for this scope |
| Add persistence, authentication framework or a new AI endpoint family | Could serve future production needs | Outside the issue and repository boundaries | W1 and repository guide | excluded |
| Let model choose unrestricted rewards, then clamp | May hide invalid output | Silent correction obscures violations of the approved balance policy | C2, C5, W1, D2 | rejected |

## Scope and Questions

* Goal: establish how issue #2 can add validated, persisted AI quests without breaking existing CRUD.
* Audience and use: repository contributor preparing a subsequent implementation plan.
* In scope: HTTP routing, guild rules and validation, in-memory repositories, model-service contract and SDK capabilities, tests, OpenAPI, README, observability and bounded model execution.
* Out of scope: implementation, persistence replacement, authentication infrastructure, deployment, live or billable inference, credentials, dependency changes, commits and issue mutations.
* Criteria: all acceptance criteria in Master-Oliveira/quest-board-api#2; existing behavior and local compatibility constraints remain applicable.
* Requested output: evidence-backed recommendation, alternatives, material decisions, planning readiness; manual phase progression.

| ID | Question | Source | Status |
|----|----------|--------|--------|
| Q1 | Where can generation fit while preserving API, domain, storage and SDK boundaries? | Issue #2 and repository guide | answered, F1 and F3 |
| Q2 | What schemas and application-enforced game rules are missing or ambiguous? | Issue #2 | evidence answered, F2-F4; D2-D3 require user choice |
| Q3 | Can the current model adapter support reliable structured output and safe failures? | Issue #2 | answered, F1-F2 and F5; actual deployment unverified |
| Q4 | What compatibility, observability and offline-test constraints affect generation? | Issue #2 and repository guide | answered, F3 and F5; D4 requires user choice |

## Decisions and Feedback

| Group | Decision or feedback item | Status | Owner | Rationale or input needed | Evidence | Impact of answer |
|-------|---------------------------|--------|-------|---------------------------|----------|------------------|
| D1 | Manual RPI progression | confirmed | user | User chose manual mode | Conversation intake | Stop before each phase transition |
| D2 | Generation-only level and reward policy | confirmed | user | User selected seed-inspired-bands: F4 reward bands, 1 <= minimumLevel <= adventurer.level, reject violations without save; manual CRUD unchanged | C2, C5, W1 and user answer | Balance policy resolved |
| D3 | Generated metadata and existing PUT compatibility | confirmed | user | User selected read-only-generated-metadata: objectives and aiGenerated only on generated quests; preserve both on legacy-shaped PUT; old seeds/manual bodies unchanged | C2, C4, C8, C10 and user answer | Additive compatibility policy resolved |
| D4 | Protection policy for the new billable route | confirmed | user | User selected local-only-shared-budget: loopback/Host restriction, shared two-call model budget and disconnect cancellation | C3, C6, C13 and user answer | Exposure and execution policy resolved |

### D2: Generation-only game balance

Resolved: user approved F4's seed-inspired reward bands, minimumLevel between 1 and adventurer.level, and rejection without persistence outside these bounds. Original alternatives:

* A (recommended): use the proposed ranges as explicit generation-only rules, with rejection rather than clamping.
* B: supply different numeric bands or a formula and a different level relationship.
* C: keep the choice open and remain in Research; Planning cannot yet specify game-rule acceptance tests.

These are not restrictions on manually created or subsequently edited quests. No inactive-adventurer restriction is proposed because the issue does not request one.

### D3: Compatible generated metadata

Resolved: user approved server-managed objectives and aiGenerated on generated records only, preserved through existing PUT. Original alternatives:

* A (recommended): preserve old write bodies and manual/seed response shapes; generated metadata remains read-only.
* B: choose a different objectives/provenance editing contract and specify its compatibility requirements.

### D4: New model route exposure

Resolved: user approved the same local-only guard as /model/test and a shared two-call model budget with disconnect cancellation. Original alternatives:

* A (recommended): local-only and shared bounded execution, preserving cancellation and safe errors.
* B: permit nonlocal generation; this requires an explicitly scoped exposure and security design rather than silently publishing unauthenticated billable work.

## Risks and Open Questions

| Priority | Type | Risk, question, or research item | Impact | Smallest action or evidence needed | Owner |
|----------|------|---------------------------------|--------|------------------------------------|-------|
| Medium | risk | Deployment supports Responses but possibly not strict structured output | Upstream rejected request, not usable generation | Document capability requirement; a separate explicitly authorized live check only if needed | downstream |
| Medium | risk | Prompt theme or adventurer text attempts to override instructions | Structured shape alone does not ensure semantic safety or relevance | Delimit untrusted values and keep every persisted field application-validated | downstream |
| Medium | risk | Adventurer state changes during an awaited model call | Eligibility snapshot may be stale | Plan must state snapshot policy; avoid inventing cross-resource transactions | downstream |
| Medium | risk | Objectives and full descriptions exceed selected output budget | Incomplete output, no save | Explicit token bound and sanitized incomplete-output tests | downstream |
| Low | further research | Live model quality and theme adherence | Not proven by offline structural tests | Deferred; requires billable-call authorization and trusted configuration | user |

## Planning Readiness and Next Step

| Field | Record |
|-------|--------|
| Research disposition | executed; complete |
| Decision participation | user-owned; manual mode selected at intake |
| Planning Readiness | Ready; C1-C13, W1-W2 and confirmed D2-D4 establish sufficient evidence and policy |
| Research depth and helpers | Wider, Deeper and Contrarian complete; no helpers |
| Blockers | none; live deployment capability remains an explicitly deferred validation limit |
| Output mode and planning support | convergence; supports planning once Ready |
| Continuation owner | manual RPI Agent |
| Required gates or confirmations | Research gates passed; explicit manual advancement required; no Implementation authorization |
| Next action | Offer refinement, pause, or explicit /rpi-plan advancement; remain in Research until authorized |
| Primary evidence file | .copilot-tracking\research\2026-11-18\issue-2-ai-quest-master-research.md; date from user-supplied current date |

## Research Record

### Method and Boundaries

| Field | Record |
|-------|--------|
| Research posture and provenance | balanced; default |
| Helper lane effort | auto; no helpers selected |
| Completion basis | Current-code contracts and official provider support are covered; remaining gaps are user policy, not more source discovery |
| Explicit limits or deadline | No deadline supplied; research-only write boundary |
| Codebase and external scope | Current checkout; official SDK/Foundry documentation if needed; GitHub issue #2 |
| Initial candidate areas | src\api, src\domain, src\data, src\foundry, src\services.js, test, openapi.json, README.md, package.json |
| Evidence root | D:\repos\quest-board-api\.copilot-tracking; research writes only under research\2026-11-18; required RPI JSON state under rpi-sessions |
| Constraints and excluded sources | Do not read local .env; no live inference; no source edits; preserve dependencies and Windows/Linux support |
| Prior knowledge | Issue retrieved through gh; working tree clean; state discovery found no existing state. Supplied memory about per-app isolation is unverified until source inspection |

### Extensions and Participation

#### Extension Registry

| Kind | Candidate | Provenance and scoped contract | Selected or skipped reason |
|------|-----------|--------------------------------|----------------------------|
| instruction | Repository agent guide | Supplied repository context | selected: boundaries, behavior and completion requirements |
| instruction | .github\copilot-instructions.md | applyTo ** | selected: Windows/feed compatibility; no executable changes in Research |
| instruction | copilot-tracking.instructions.md and copilot-tracking-location.instructions.md | Installed RPI shared guidance | selected: evidence paths and state conventions |
| skill | rpi / rpi-research | Active session and phase | selected: manual coordination and research evidence |
| skill | secure-by-design / owasp-llm | Adjacent design/security concerns | skipped: no separate security assessment requested; inspect existing constraints without widening scope |
| skill | documentation | Future README/OpenAPI updates | skipped: no documentation authoring or audit in this phase |

#### Direction and Participation Log

| Checkpoint or change | Question, direction, or rationale | Answer or no-interaction reason | Result and revalidation effect |
|----------------------|-----------------------------------|---------------------------------|--------------------------------|
| Intake | How should RPI proceed? | manual | User owns material decisions and phase advancement |
| Research intake | Is the brief sufficient to start? | Issue #2 supplies acceptance criteria and repository scope | No redundant intake question; verify implementation and identify actual choices |
| Canvas | No RPI Workflow canvas tools are exposed by this host | Unavailable | Continue using durable files; open canvas only if host later exposes capability |
| Prior knowledge gate | Verify supplied per-app isolation memory before relying on it | C1 and C8 confirm it; attempted upvote failed because memory service was unavailable | Use verified source evidence; no new memory stored |
| Convergence | D2 game balance is the first dependency-ordered unresolved group | Awaiting user answer | Not ready for Planning; D3 and D4 follow separately |
| D2 answer | Use seed-inspired generation-only bands and minimumLevel <= adventurer.level? | User selected seed-inspired-bands | D2 confirmed; no further source research needed; ask D3 next |
| D3 answer | Preserve generated-only read-only objectives and aiGenerated through existing PUT? | User selected read-only-generated-metadata | D3 confirmed; retain defensive-copy requirement; ask D4 next |
| D4 answer | Local-only generation, shared two-call budget and disconnect cancellation? | User selected local-only-shared-budget | D4 confirmed; Ready for Planning; manual advancement still required |

### Research Cycle Log

#### Cycle 1

* Active posture, controls, and limits: balanced, issue #2, research-only, manual decisions.

##### Wave 1: Wider

* Focus and questions: inspect the complete HTTP/domain/storage/model composition and current contract before choosing a generation seam (Q1-Q4).
* Evidence: C1 identifies the injected model seam and lazy configuration; C2 establishes current required quest fields and absence of generation rules; C3 shows routing treats generate as an item ID today; C4 shows shallow repository copies; C5 establishes flat seeded quest records; C6 establishes the existing text-only Responses adapter.
* Reflection: a separate injected generation consumer fits existing boundaries, but adding objectives creates a nested-mutation problem and the current PUT replacement would discard generated metadata. Exact game balance is not established by seed examples. Prioritize schema compatibility, structured-output request support, failure mapping, and model execution policy in the Deeper wave.

##### Wave 2: Deeper

* Focus and questions: compare actual HTTP tests, OpenAPI schemas, SDK declarations, and official Foundry structured-output request shapes (Q2-Q4).
* Evidence: C8-C10 verify regression patterns, model SDK mocks and closed Quest schema; C11 and W2 agree that Responses uses text.format with a strict JSON Schema, without requiring Zod. W1 contains no issue comments that resolve balance or compatibility choices.
* Reflection: the existing SDK exposes the necessary request shape, while the adapter does not forward it yet. Strict provider output cannot replace application validation. Preserve the text completion contract and add a trusted internal schema option rather than migrating SDKs. Challenge the assumption that strict schemas can enforce every game constraint, and examine whether model-only execution guards can be reused without changing CRUD.

##### Wave 3: Contrarian

* Focus and questions: challenge "strict schema handles validation", "new fields are harmless", "seed values define rules", and "new model route is automatically protected".
* Evidence: W2 explicitly lists numeric bounds and array lengths among unsupported keywords; C4 and C8 expose nested-copy and PUT regressions; C2/C5/W1 establish that balance thresholds are absent; C3 and C13 show guards are route-local and no generation telemetry exists.
* Reflection: provider structure is necessary but insufficient. Keep domain validation independent and preserve metadata without changing legacy writes. Expose reward bands and local-only policy as proposals for user choice, not facts. Installed SDK version matches the pinned manifest (C12), weakening any claim that a dependency upgrade is necessary.

##### Synthesis and Re-entry

| Material or claim | Evidence | Disposition | Rationale | User-facing effect |
|-------------------|----------|-------------|-----------|--------------------|
| Reuse services.model and existing repositories | C1, C6, C8-C9 | accepted | Existing injection and offline patterns already satisfy the architecture seam | F1 |
| Strict schema replaces business validation | W2, C2 | rejected | Provider subset cannot encode all required bounds; model output remains untrusted | F2 |
| Objectives can use existing shallow-copy behavior | C4 | rejected | Arrays would share mutable internal references | F3 |
| Seed rewards establish mandatory difficulty bands | C2, C5, W1 | rejected as fact; proposed as policy | Examples lack normative thresholds | F4, D2 |
| Guards on /model/test automatically cover new generation route | C3, C13 | rejected | Guards currently run only in testModel | F5, D4 |
| New framework or schema dependency is required | C7, C11-C12, W2 | rejected | Pinned SDK already supports direct JSON Schema request shape | recommendation |
| Actual deployed model supports structured output | W2 | deferred | No trusted configuration examined and no live calls authorized | risk |

* Another complete three-wave cycle needed: no for current-source questions; reconsider after a user direction change or concrete new evidence.
* Trigger or stop basis: all architectural seams, current schemas, relevant tests and provider shapes inspected; remaining material choices require user direction.
* Readiness or revalidation effect: D2-D4 subsequently resolved by the user; Ready for Planning; no phase advancement.

### Evidence Log

* Helpers: none.
* Issue source: https://github.com/Master-Oliveira/quest-board-api/issues/2, retrieved 2026-11-18 using gh; OPEN.

| ID | Claim or finding | Source or location | Retrieved and version | Tool | Confidence | Notes |
|----|------------------|--------------------|-----------------------|------|------------|-------|
| C1 | Fresh seeded guild repositories and injectable model dependency | src\services.js `createServices`; src\api\app.js `createApp` | not applicable | direct read | high | No SDK import needed in future domain consumer |
| C2 | Quest writes require all current fields, reject unknowns, and enforce only generic reward/level bounds | src\domain\validation.js `schemas`, `validateInput`; src\domain\guild-service.js `create`, `update` | not applicable | direct read | high | Objectives and AI provenance are not in the writable schema |
| C3 | No generation endpoint; existing model test has local checks, cancellation, output bound and concurrency guard | src\api\app.js `testModel`, `createApp`, `modelErrorStatus` | not applicable | direct read | high | Specialized generation routing must precede generic item matching |
| C4 | Repository uses shallow copies on every record boundary | src\data\repository.js `InMemoryRepository` | not applicable | direct read | high | Safe for current scalar records, not objectives arrays |
| C5 | Seeds are deterministic flat records; values illustrate balance but do not define a rule | src\data\seeds.js `createSeeds` | not applicable | direct read | high | Keep existing IDs and timestamps |
| C6 | Model complete returns completed nonempty text; only signal and token bound are forwarded; safe error classification already exists | src\foundry\model-service.js `createFoundryModelService`, `defaultClient` | not applicable | direct read | high | Deadline, no retries, lazy configuration, sanitized errors and SDK logging off must remain |
| C7 | Dependencies pinned; Node built-in test runner, no build/lint/typecheck scripts | package.json `scripts`, `dependencies`, `engines` | not applicable | direct read | high | No dependency change yet justified |
| C8 | HTTP tests use isolated loopback servers and dependency injection; CRUD PUT expectations preserve the existing record shape | test\api.test.js `setup`, CRUD lifecycle tests, `each app starts with independent seed data` | not applicable | direct read | high | Existing unknown-field validation must continue |
| C9 | Offline SDK tests mock Azure token acquisition and fetch; cover incomplete responses, errors, deadlines, cancellation and disabled logs | test\foundry.test.js `fakeService`, real SDK request test, deadline tests | not applicable | direct read | high | Extend these patterns without live credentials |
| C10 | Closed Quest schema has no objectives or provenance; README states no quest generation yet | openapi.json `components.schemas.Quest`; README.md `Azure AI Foundry connection`, `Use the model service in code` | not applicable | direct read | high | Generation requires coordinated additive response documentation and preserved write schema |
| C11 | Installed SDK has JSON Schema response format and text.format request support | node_modules\openai\resources\responses\responses.d.ts `ResponseFormatTextJSONSchemaConfig`, `ResponseTextConfig`, `ResponseCreateParamsBase` | not applicable | direct read/search | high | Declaration inspected; installed package version still to verify against manifest |
| W1 | Issue requires structured generation, enforced rules, persistence, observability and offline coverage; no comments clarify choices | [Feature: AI Quest Master](https://github.com/Master-Oliveira/quest-board-api/issues/2) | 2026-11-18; OPEN | gh issue view | high | No numeric reward policy or minimum-level relationship specified |
| W2 | Responses supports strict JSON Schema under text.format; plain REST shape does not need Zod; refusal/incomplete paths must be handled | [How to use structured outputs with Azure OpenAI in Microsoft Foundry Models](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs) | 2026-11-18; page updated 2026-08-24 | web fetch | high | JavaScript helper examples are alternatives, not requirements to change language/module system or dependencies |
| C12 | Installed SDK version matches the pinned 7.55.0 manifest | node_modules\openai\package.json `version`; package.json `dependencies.openai` | not applicable | direct read | high | No SDK upgrade justified for text.format |
| C13 | No generation objectives, provenance or correlation logger exists in application source; startup alone logs model warning | src\server.js startup callback; src\api\app.js `testModel`; src\domain\validation.js `schemas`; src\data\seeds.js `createSeeds` | not applicable | scoped search and direct reads | high | Search covered all src JavaScript; interpreted matches against already-read implementations |

#### Contradictions and Conflicts

* Issue says "existing persistence": repository evidence resolves this to the existing in-memory store, not a new database.
* Issue requires "appropriate" balance: examples do not resolve numeric rules; D2 retains user authority.
* Generic official examples suggest adding Zod and ESM: treated as inert examples; CommonJS and current dependencies stay the preferred compatibility direction.
* Provider subset limitations are documented broadly; use the documented conservative subset rather than assuming a particular deployed model supports every JSON Schema keyword.

### Artifact Self-Check

* [x] Reader-first sections explain findings, alternatives, constraints and next decision.
* [x] Q1-Q4 have evidence or the smallest retained uncertainty.
* [x] Findings keep their explanation, confidence, counter-evidence and canonical evidence state together.
* [x] Every material code claim has C# and a path/symbol; external claims have W#, URL and retrieval metadata.
* [x] All three waves ran in order with separate reflections, dispositions and a re-entry decision; no helper absence claim is relied on.
* [x] Method, extensions, participation, evidence root, prior knowledge and constraints are recorded.
* [x] Convergence recommendation is supported; pending policy proposals are not misrepresented as selected.
* [x] User-owned D2-D4 answers are persisted.
* [x] Readiness, blockers, owner, required gates and next action accurately reflect the pause.
* [x] Research-only write boundary held; no secrets, application changes or live calls.
* Checked sections: every section above; artifact self-check only, no executable validation.
* Missing or limited sections: deployed-model capability confirmation is intentionally deferred; no executable code changed, so installation/application tests were not run on this Windows host.
