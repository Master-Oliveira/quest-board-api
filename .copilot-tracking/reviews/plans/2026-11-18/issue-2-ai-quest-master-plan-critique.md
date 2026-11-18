<!-- markdownlint-disable-file -->
# RPI Plan Critique: Issue 2 - AI Quest Master

## Metadata

* Task ID: issue-2
* Critique date: 2026-11-18
* Plan: .copilot-tracking\plans\2026-11-18\issue-2-ai-quest-master-plan.md
* Critique execution: Complete
* Critique depth: standard
* Depth provenance: first-task default retained by parent; no deep request.
* Critique type: initial
* Earlier critique: not applicable.

## Inputs and Criterion Boundary

* Task context: issue #2, structured personalized quest generation with application-enforced rules, in-memory save, safe errors/telemetry, offline tests and API documentation.
* Research: .copilot-tracking\research\2026-11-18\issue-2-ai-quest-master-research.md, F1-F5, C1-C13, W1-W2, confirmed D2-D4.
* Plan: all P01-P03 tasks, FR-001 through FR-009, NFR-001 through NFR-004, requirements, dependencies, risks, test ownership and validation boundaries.
* Evidence: src\api\app.js, src\domain\validation.js, src\domain\guild-service.js, src\data\repository.js, src\data\seeds.js, src\foundry\model-service.js, src\services.js, src\server.js, test\api.test.js, test\foundry.test.js, openapi.json, README.md, AGENTS.md, .github\copilot-instructions.md, package.json.
* Confirmed direction: manual progression, generation-only reward/level rules, generated-only read-only metadata preserved through PUT, local-only shared two-call budget and disconnect cancellation. No production edits or live calls authorized.
* Boundary: assess supplied plan and evidence only. No new research, implementation, tests, live service checks, or inferred live capability.

## Lens Assessments

| Lens | Scope | Reasoning effort and source | Status | Candidates |
|------|-------|-----------------------------|--------|------------|
| Coverage | All tasks and requirement/acceptance coverage | host default; no user override | Complete | 0 adopted; 7 rejected: plan already maps every FR/NFR to tasks and assigns named test layers/cases; no verbatim issue or second test matrix is required. Failure mapping, invalid request validation, method semantics and all-response correlation are explicit. Startup expansion is not an issue acceptance item; budget exhaustion is conjecture. |
| Evidence | Research-supported claims and code references across P01-P03 | host default; no user override | Complete | 3 adopted: PC-001 through PC-003. Remaining 5 and outside-lens sequencing candidate rejected: request/proposal error distinction, metadata fields and HTTP ID ownership are explicit; new bounded fields are labeled planner choices; reserving the named feature route is intrinsic; validator can accept a snapshot without waiting for orchestration. |
| Executability | Dependencies, environments, budgets, validation and implementation handoff | host default; no user override | Complete | 1 adopted: PC-004. 8 rejected: exact internal signature is implementer judgment and required context is stated; current maxOutputTokens already supports the fixed per-call bound; global test cap/ownership are checkable; validator/domain test ownership is collectively explicit; feature route reservation is intentional; existing OpenAPI assertion pattern is referenced; hypothetical helper files are not planned; warnings/examples do not require a separate tool. |
| Risk | Material side effects, decisions and operational boundaries | host default; no user override | Complete | 1 adopted: PC-005. 8 rejected: live capability is explicitly deferred without authorization; concurrency cap does not imply a spend cap; named route reservation follows requested feature; proposal failures are explicitly 502; adventurer egress is intentional task context, with delimiting/no logs; startup warning completeness is not an acceptance requirement; existing mitigations cover truncation/instruction data; final failed outcome with safe code already covers cancellation. |

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|------------------------------------------|----------|---------------------|
| FR-001 through FR-009; NFR-001 through NFR-004 | Covered | Tasks cite each requirement and assign semantic and regression evidence without requiring a second matrix |
| P01-T01, P01-T02 | Covered | Copy/metadata boundaries and independent request/proposal rules |
| P02-T01 | Covered | Trusted JSON Schema option, unchanged existing calls and offline wire tests |
| P02-T02 | Partial | PC-001 clarifies trusted persistence; PC-005 requires explicit adventurer-concurrency decision |
| P03-T01, P03-T02 | Covered with correction | PC-003 removes optional public header; existing feature-route reservation is intentional |
| Dependencies and source claims | Partial | PC-002 and PC-004 need small direct corrections |

## Verdict

* Verdict: Revise.
* Rationale: no Critical or High concern verified. Four direct clarity/scope corrections and one user-owned concurrency-policy decision remain. Counts: 0 Critical, 0 High, 4 Medium, 1 Low.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [Medium]: Name the trusted persistence seam explicitly

* Related IDs: P02-T02, FR-004, FR-005.
* Evidence: plan P02-T02 says "existing creation primitives"; src\domain\guild-service.js `create` passes through the legacy quest validator; src\domain\validation.js `schemas.quests` rejects objectives and aiGenerated.
* Concern: the raw repository is reusable but the public GuildService.create path is not; the plan should distinguish them.
* Impact: avoid likely rework or accidental relaxation of the manual write contract.
* Smallest useful change: say the composed consumer uses the same quest repository.create after independent validation, with timestamp/status/provenance supplied by application and UUID assigned by repository.
* Action owner: planning parent.
* Exact resolving evidence: P02-T02 identifies the shared repository write and explicitly preserves legacy GuildService.create validation.
* Decision route: direct planner correction; no new architecture or user behavior.

<!-- rpi:critique id=PC-002 -->
### PC-002 [Medium]: Dependencies falsely imply current structured-output support

* Related IDs: P02-T01, Dependencies, research F2.
* Evidence: plan Dependencies says "Existing model adapter and configured deployment support strict structured output"; src\foundry\model-service.js `complete` currently forwards only maxOutputTokens and signal; research F2 says deployment support is unverified.
* Concern: this contradicts the adapter-extension task and caveat elsewhere.
* Impact: could mislead implementation or runtime-readiness claims.
* Smallest useful change: adapter support is delivered by P02-T01; actual deployment capability is an unverified runtime prerequisite.
* Action owner: planning parent.
* Exact resolving evidence: corrected Dependencies bullet aligned with summary and risk row.
* Decision route: direct planner correction.

<!-- rpi:critique id=PC-005 -->
### PC-005 [Medium]: Confirm which adventurer level governs saving after inference

* Related IDs: P02-T02, FR-003, Risks and Open Questions.
* Evidence: P02-T02 selects a request-start snapshot; research F4/D2 says minimumLevel <= adventurer.level without a temporal rule; src\domain\guild-service.js permits synchronous update/delete while inference is awaited.
* Concern: the current draft chooses a behavioral policy that the user has not selected. A snapshot can produce a saved quest after the adventurer disappears or levels down.
* Impact: changes which otherwise valid generations are accepted after concurrent CRUD.
* Smallest useful change: ask whether to retain request-start semantics or re-read before saving and reject missing/underleveled adventurers; no locking is needed.
* Action owner: user, through planning parent.
* Exact resolving evidence: a recorded user answer, synchronized P02-T02 rule/risk, and a focused pending-generation CRUD test in the coverage lock.
* Decision route: user-owned material behavior decision.

<!-- rpi:critique id=PC-003 -->
### PC-003 [Medium]: Public correlation header is unnecessary scope

* Related IDs: FR-008, P03-T01, P03-T02.
* Evidence: plan adds X-Request-Id response contract; issue acceptance criteria and research F5 require correlation in logs, not a public header.
* Concern: this is an avoidable public-contract addition.
* Impact: unnecessary response documentation and test surface.
* Smallest useful change: keep server-generated correlation IDs for invocation telemetry, without adding a response-header requirement.
* Action owner: planning parent.
* Exact resolving evidence: header removed consistently from FR-008 and HTTP/documentation tasks while log correlation remains.
* Decision route: direct planner correction to narrow scope.

<!-- rpi:critique id=PC-004 -->
### PC-004 [Low]: Phase-level dependency contradicts adapter task independence

* Related IDs: P02, P02-T01.
* Evidence: P02 phase depends on P01; P02-T01 says it may proceed independently of P01.
* Concern: the two execution-order statements differ.
* Impact: minor but concrete scheduling ambiguity.
* Smallest useful change: retain the simple phase ordering and remove the task's early-execution exception.
* Action owner: planning parent.
* Exact resolving evidence: P02-T01 acknowledges the P01 phase boundary while preserving its absence of data-level prerequisites.
* Decision route: direct planner correction.

## Strengths and Residual Risk

* Current composition, defensive storage, strict output plus domain validation, safe errors and offline testing are supported by the supplied code and research.
* Deployed model capability and semantic quality remain honestly unverified, not prerequisites for running offline tests.
* The existing local API and new route have concurrency/token/time bounds, not an aggregate spend or total-record cap. A new cap is outside confirmed scope and is not required by the issue.

## Questions or Blocking Evidence Gaps

* PC-005 requires the user's choice of snapshot versus pre-save revalidation. No additional source research is needed.

## Limitations

* Model and reasoning-effort overrides were not supplied because the user did not request them; agents use harness defaults.
* No live model or diagram rendering evidence is supplied; neither is represented as performed.

## Recommended Next Action

* Highest-impact finding: PC-005.
* Action owner: planning parent for direct corrections; user for PC-005.
* Smallest next action: record all five findings as open in the plan, apply four direct corrections, ask the one remaining behavior question.
* User response required: yes, for PC-005 only; planning parent owns the question.
