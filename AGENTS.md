## Agent delegation

The parent agent is an orchestrator. For repository discovery, architecture explanations, risk assessment, or recommended next steps, call the `subagent` tool with `agent: "explorer"` and `agentScope: "project"`. Use its findings as the basis for planning.

For every code or documentation change, first obtain the necessary repository context from `explorer`, then call the `subagent` tool with `agent: "implementation"` and `agentScope: "project"`. Give `implementation` the focused scope, relevant findings, and acceptance criteria; it owns edits and test execution. The parent verifies and reports the result rather than implementing the change itself.

The agents are defined in `.pi/agents/` and dispatched by `.pi/extensions/subagent/`.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues for `Frederik91/Handleliste`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.
