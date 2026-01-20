# Agents

The central idea is that we're going to be delegating work to new agents, partly driven by an interest in keeping the core chat context small, and partly by an interest in separating out work.

For now, agents will not work in parallel. An agent will contract out to a new agent, and receive a report of the work it did.

Each agent has
- a root system prompt (read-only)
- a series of docmems as system prompt that identify its capabilities and personality (read-only)
- a predecessor docmem that represents the chat that spawned it (read-only)
- the root ID of that chat (read-only) which identifies the calling agent
- "working" docmems that represent input (read-only)
- "work product" docmemems that the agent will work on (read/write)
- a docmem that represents the chat it's participating in (read/write)

An agent is identified by the root ID of its own chat docmem root ID

Each docmem is identified by its root id. In context history, read-only docmems are serialized, and modifiable docmems are expanded (i.e. include metadata)

An agent can contract work from a new agent by initializing the new agent's chat docmem (start_contract)

An agent can prompt its parent, who replies in the "user" role and prompts the agent as role "assistant"

When finished with its work, the agent has a call to transfer control back to its parent (end_contract)