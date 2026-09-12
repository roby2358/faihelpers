# Agents

Superseded by TASK_DELEGATION_SPEC.md for agent orchestration and by SPEC_DELEGATE.md for the agent loop.

An agent is an AgentLoop over a chat docmem and is identified by that docmem's root id. The user-facing chat agent is run from the Chat tab; workers are run by the task harness from task nodes. Agents do not run in parallel.
