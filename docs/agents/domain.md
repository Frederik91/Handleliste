# Domain Docs

This is a single-context repository.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- Relevant decisions under `docs/adr/`.

If either is absent, proceed silently. Domain documents are created lazily when terminology or decisions are resolved.

## Use the glossary vocabulary

Use terms exactly as defined in `CONTEXT.md`. Avoid synonyms the glossary explicitly rejects.

If a required concept is absent, reconsider whether new terminology is necessary or note the gap for `/domain-modeling`.

## Flag ADR conflicts

Surface contradictions with existing ADRs explicitly rather than silently overriding them.
