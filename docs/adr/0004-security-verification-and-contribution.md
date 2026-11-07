# ADR 0004: Security verification and contribution standards

- Status: Accepted
- Date: 2026-11-07

## Decision

Use Apache License 2.0 for the repository, with copyright attribution to Seyyid Annan. Contributor guidance requires synthetic secrets, threat-model notes for security changes, negative authorization tests and honest reporting of checks. CI runs formatting, lint, type checking, unit tests and builds.

## Rationale

Apache-2.0 includes an express patent license and is a widely understood permissive license for infrastructure software. The license does not imply that the project is production-ready or independently audited.

## Consequences

The repository includes LICENSE, NOTICE, AUTHORS.md and CONTRIBUTING.md. Contributors must retain applicable notices and follow the security contribution checklist.
