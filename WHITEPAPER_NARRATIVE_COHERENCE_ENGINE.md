# DOCMEM: A Narrative Coherence Engine

## The Problem

Large language models can write beautiful paragraphs, compelling characters, and interesting plot hooks. What they cannot do is sustain coherent narrative across tens of thousands of words. The failure mode isn't generation quality — it's integration across sustained narrative.

The conventional framing (Mollick, 2025) identifies the bottleneck as the absence of a machine-verifiable reward signal for creative writing: math has proofs, code has tests, but "does this story land emotionally" doesn't reduce to a loss function. This is true but incomplete. The deeper issue is architectural — nobody has built the external scaffolding that makes long-range narrative coherence a tractable problem for current models.

DOCMEM is that scaffolding. It is a narrative coherence engine.

## The Insight

A novel is not a single generation task. It is approximately 29 scenes, each 1,000–3,000 words, totaling ~60,000 words of tight, propulsive narrative. Each scene is a tractable creative task for current LLMs. The hard problem — maintaining coherence of character, theme, and plot across all 29 scenes — is a memory and retrieval problem, not a generation problem.

This reframes "write a novel" from an impossible monolithic challenge into a structured pipeline:

1. Generate locally excellent scenes.
2. Enforce global consistency through queryable narrative state.

DOCMEM provides the queryable narrative state. Its hierarchical tree structure maps directly onto story architecture, and its vector-backed retrieval ensures that every scene generation has access to exactly the context it needs.

## The Narrative Landscape

The dominant mental model for long-form fiction — among both human writers and AI practitioners — is the **linear thread**. A novel is a sequence of words, sentences, scenes, chapters. You start at the beginning and generate forward. This is wrong, and it is the root cause of most failed attempts at AI-generated fiction.

A novel is not a thread. It is a **narrative landscape**.

A narrative landscape is a rich, concurrent state space. Characters exist within it, each carrying their own arcs, motivations, knowledge, and relationships — all operating simultaneously whether or not the reader is watching them. Events have causal relationships that ripple across the landscape. Thematic pressures build and release. Timelines run in parallel. Coincidences sit latent, waiting for a viewpoint to collide with them. Emotions accumulate in characters offstage. The landscape is alive before a single word of prose is written.

The novel — the actual text the reader encounters — is a **projection** through this landscape. A point of view (which is the actual craft term writers use) is a trajectory: it selects what to render, what to leave implied, what to reveal and when. The same landscape could yield multiple novels depending on the POV chosen, the path taken, the moments the author chooses to dramatize versus summarize.

This reframe has profound implications for the generation architecture:

**The linear model says:** outline → chapter 1 → chapter 2 → ... → chapter 29. Generate forward, maintain coherence through context.

**The landscape model says:** build the landscape → choose the POV → project the path → render the scenes along it.

These are fundamentally different operations. The linear model asks the generator to simultaneously invent and narrate — to build the world and traverse it in the same pass. The landscape model separates construction from projection. Build the world first. Populate it. Let characters develop motivations and conflicts that exist independently of the reader's gaze. Then choose a viewpoint and render what it sees.

This separation is why a novel can feel *deep* — the reader senses that things are happening beyond the edges of each scene, that characters have lives between their appearances on the page, that the world doesn't pause when the chapter ends. That depth comes from the landscape existing prior to and independent of the narration.

### DOCMEM as Landscape

DOCMEM's hierarchical tree structure is not a plan for a story. It is a **stored narrative landscape**.

Character nodes carry state that evolves whether or not a scene renders them — their offstage development is tracked, their motivations update, their knowledge of events accumulates. Thematic nodes exert pressure across the entire landscape, not just at the points where scenes explicitly address them. Timeline nodes maintain concurrent event streams. Relationship nodes track the evolving dynamics between characters, including tensions the characters themselves may not yet be aware of.

The projection operation — choosing a POV and rendering scenes along its path — becomes a series of queries against this landscape. For each scene, the generator asks: given this viewpoint, at this point in the trajectory, what slice of the landscape is visible? What does this character know, feel, want? What's just happened offstage that will create subtext? What thematic thread is resonating right now?

The scene is rendered from the answers. The landscape provides the coherence. The generator provides the prose.

And critically, the landscape is **re-projectable**. A different POV character yields a different novel from the same underlying world. A different thematic emphasis reshapes which scenes matter. The landscape is an asset that transcends any single rendering of it.

## The Unfolding Architecture

The faihelpers pipeline implements the landscape model through **progressive unfolding** — narrative structure that decomposes from abstract to concrete, from landscape to rendered text. The unfolding is not linear planning; it is the process of populating the landscape and then projecting a path through it.

### Level 1: Arcs

The highest level of narrative structure. An arc defines the throughline of the story — the central conflict, the transformation, the thematic question being explored. A novel may have one primary arc and several secondary arcs (character arcs, subplot arcs) that interweave.

Arcs are stored as compact, queryable nodes in DOCMEM. They carry:

- The core dramatic question
- The transformation (beginning state → end state)
- Thematic commitments
- Key turning points (broad strokes)

### Level 2: Summaries

Each arc unfolds into summaries — chapter-level or act-level narrative blocks that describe what happens, to whom, and what shifts. Summaries are the planning layer. They are detailed enough to guide scene generation but abstract enough to allow creative flexibility in execution.

Summaries carry:

- Characters present and their motivations in this segment
- The narrative beat (setup, escalation, reversal, resolution)
- Continuity constraints (what must be true based on prior scenes)
- Thematic threads being advanced

### Level 3: Notes and Scenes

Summaries unfold into the working layer — a mix of notes (authorial intentions, tonal guidance, research, worldbuilding details) and scenes (the actual prose).

Scenes are the atomic unit of the novel. Each scene is generated with access to:

- Its parent summary (what this scene needs to accomplish)
- Relevant arc-level context (thematic commitments, character states)
- Cross-references from DOCMEM (prior scenes involving the same characters, established details, unresolved tensions)
- Notes attached to this narrative position (tonal guidance, specific imagery, dialogue beats)

### The Filter: From Landscape to Novel

The full DOCMEM tree contains the narrative landscape — arcs, summaries, notes, character states, timelines, thematic threads. The novel itself is extracted by projection: **select on scenes along the chosen POV path, filter out the rest**. The arcs, summaries, and notes are the landscape. The scenes, read in sequence, are the book.

This separation is powerful. It means the authorial intelligence (structure, planning, thematic tracking, offstage character development) lives in the landscape, while the reader experience (prose, pacing, emotional impact) lives in the scene sequence. They can be developed and refined independently. And the landscape persists — available for re-projection, sequel generation, or alternative POV explorations through the same world.

## Why This Works Now

### The Serial Insight

The serial fiction format demonstrates that readers will engage with narratives delivered in discrete installments — and that compelling installments can be composed into larger wholes. The serial format also provides a natural, machine-verifiable reward signal that novels lack: reader retention between installments. Did they come back for the next chapter? That's measurable. That's the missing RL signal, emerging naturally from the medium.

A serial-first development strategy allows iterative refinement of the generation pipeline against real reader feedback before attempting novel-scale integration.

### DOCMEM as Narrative Coherence Engine

DOCMEM's hierarchical memory with vector-backed retrieval solves the specific technical problem that makes novel-length generation fail — not by making the generator smarter, but by externalizing the narrative landscape into a queryable structure:

- **Character coherence**: Character state is a living node in the landscape. Every scene generation retrieves the current state of each character present — their established voice, unresolved conflicts, knowledge, relationships — including offstage developments the reader hasn't witnessed yet.
- **Thematic consistency**: Thematic commitments are landscape-level pressures that propagate across every scene. A scene doesn't need to "remember" the theme — it queries it.
- **Continuity enforcement**: Established facts, settings, and prior events are retrievable context, not things the model must hold in its context window. The landscape remembers what the generator doesn't need to.
- **Pacing control**: The summary layer encodes narrative beats. Each scene knows whether it's setup, escalation, or payoff, and can be evaluated against that intention.
- **Depth through concurrency**: Because the landscape tracks concurrent state — what's happening offstage, what characters don't yet know, what tensions are building elsewhere — the generated scenes inherit the feeling of depth that distinguishes good fiction from flat sequence generation.

### The Tractability Argument

Current frontier models can write a compelling 2,000-word scene when given clear context: who's in it, what needs to happen, what came before, what tone to strike. That's a solved problem. The unsolved problem was providing that context reliably across 29 scenes. DOCMEM solves it.

The novel is not a generation moonshot. It is an engineering problem with identifiable components, and the components are ready to be assembled.

## What Remains

- **Landscape population pipeline**: Tooling for efficiently building out the concurrent state space — character arcs, timelines, offstage events, relationship dynamics — before scene generation begins.
- **Projection mechanics**: Formalizing how a POV path is chosen through the landscape, and how the relevant slice of landscape state is assembled as context for each scene.
- **Scene-level reward signal**: Developing reliable evaluation of individual scene quality (engagement, prose, emotional resonance) — potentially through reader feedback in serial format.
- **Arc-level coherence evaluation**: Automated or semi-automated assessment of whether the scene sequence, taken as a whole, delivers on the promises made at the arc level.
- **Revision pipeline**: First drafts are first drafts. The unfolding architecture needs a complementary folding-back mechanism — revision passes that tighten, cut, and refine with access to the full landscape.
- **Voice consistency**: Maintaining a distinctive authorial voice across 29 individually generated scenes. This may require fine-tuning or careful prompt engineering anchored to style exemplars.

## The Vision

Build the landscape. Populate it with characters, arcs, motivations, concurrent timelines, thematic pressures. Choose a point of view. Project a path. Render 29 compelling scenes along that path. Maintain coherence in character and theme — not through brute-force context management, but because the landscape holds it all.

There's your novel.

The pieces are on the table. DOCMEM provides the narrative landscape as a queryable, persistent structure. The unfolding hierarchy provides the progressive construction process. Current models provide the generative capability for locally excellent scenes. The serial format provides the iterative proving ground. The projection model provides the conceptual clarity that separates world-construction from narration.

We are a short hop from the threshold.