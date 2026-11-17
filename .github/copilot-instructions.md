---
description: 'Keep cloud-agent changes compatible with local Windows development and the configured npm feed.'
applyTo: '**'
---

# Local compatibility

Support Windows with Node.js 22 and npm 10, while keeping the application
and npm scripts compatible with Linux cloud-agent environments.

Local development uses this npm registry:
<https://packagefeedproxy.microsoft.io/npm/>.

## Dependency changes

* Preserve existing dependency versions unless the task requires a change.
* Before adding or changing a dependency, verify the exact version exists in
  the local-development registry:

  ```sh
  npm view <package>@<version> version --registry=https://packagefeedproxy.microsoft.io/npm/
  ```

* Verify the package tarball can actually be downloaded from that registry.
  Metadata availability alone is insufficient. Use `npm pack --ignore-scripts`
  with the exact package version and registry in a temporary directory, then
  remove the downloaded archive.
* Update package.json and package-lock.json together using npm.
* Do not bypass the registry, disable TLS verification, or silently downgrade
  dependencies to make installation succeed. Explain any necessary version
  change and its compatibility implications.
* If the registry is inaccessible, explicitly report local compatibility as
  unverified rather than treating another registry as equivalent evidence.

## Validation

* For dependency or executable-code changes, run a clean installation against
  the local-development registry, followed by the automated tests:

  ```sh
  npm ci --registry=https://packagefeedproxy.microsoft.io/npm/
  npm test
  ```

* Keep npm scripts compatible with Windows and Linux; avoid shell-specific
  environment-variable assignments and commands.
* Report which checks passed, failed, or could not run, and the operating
  system used for validation.
* Do not claim local Windows validation based only on Linux cloud tests.
* Documentation-only changes do not require dependency installation or
  application tests unless they affect executable examples.

## Configuration

* Keep secrets out of source control.
* Use .env.example only for non-secret configuration examples.
