# DOCMEM Atomicity Specification

## Overview

Docmem MUST support concurrent access by multiple agents while maintaining data integrity. Operations MUST be atomic and consistent, even when multiple agents modify the tree structure simultaneously. Transaction boundaries MUST be explicit to prevent partial updates and conflicts.

Docmem MUST use optimistic locking for write operations. Multiple agents may read and modify nodes concurrently; conflicts are detected at commit time rather than blocking operations. Failed operations due to conflicts are retriable.

The core requirement: When multiple agents operate on the same docmem instance, their operations MUST either complete fully or not at all, without corrupting the tree structure or leaving the database in an inconsistent state.

## ACID Properties

Docmem transactions MUST guarantee ACID properties (Atomicity, Consistency, Isolation, Durability) using optimistic locking.

### Atomicity
- All operations that modify the tree structure MUST be atomic (all-or-nothing).
- Transactions provide atomicity guarantees: either all changes commit, or all changes are rolled back.
- With optimistic locking, transactions do not block concurrent operations; they ensure atomicity and detect conflicts at commit time.
- Partial failures MUST NOT leave the database in an inconsistent state.
- Write-Ahead Logging (WAL) ensures atomicity even if the process crashes mid-transaction.

### Consistency
- The database MUST remain in a consistent state before and after every transaction.
- Referential integrity MUST be maintained: foreign key constraints MUST be validated within transactions before commit.
- Tree structure integrity MUST be maintained: cycle detection MUST occur within transactions before commit.
- Business rule consistency MUST be maintained: node type constraints, ordering constraints, and token count accuracy MUST be validated.
- Consistency violations detected during transaction commit MUST cause the transaction to roll back.
- With optimistic locking, consistency checks occur at commit time; concurrent operations may temporarily observe intermediate states, but committed states are always consistent.

### Isolation
- Default isolation level SHOULD be READ COMMITTED to prevent dirty reads (reading uncommitted data).
- Long-running read operations (like serialization) MAY use snapshot isolation to provide consistent read views.
- With optimistic locking, isolation is achieved without blocking:
  - Reads never block writes (non-blocking reads).
  - Writes never block reads (non-blocking writes).
  - Write-write conflicts are detected at commit time, not during the operation.
- Non-repeatable reads (a value changing between reads in the same transaction) MAY occur with READ COMMITTED isolation.
- Phantom reads (new rows appearing between reads) MAY occur with READ COMMITTED isolation.
- Applications requiring strict isolation MAY use snapshot isolation for read operations, accepting the performance tradeoff.

### Durability
- Once a transaction commits, its changes MUST persist and survive system crashes.
- WAL mode MUST be used to ensure durability.
- All committed changes MUST be written to persistent storage before the commit completes.
- When IndexedDB persistence is implemented, durability guarantees MUST apply to persistent storage as well.
- Durability is independent of optimistic locking; committed transactions are durable regardless of concurrency model.

## Design Principles

### Concurrent Agent Safety
- Multiple agents MAY read the same nodes simultaneously without blocking.
- Multiple agents MAY attempt to modify nodes simultaneously; conflicts are detected at commit time (last write wins for the first to commit).
- Operations that modify parent-child relationships MUST prevent cycles and maintain referential integrity even under concurrency.

## Transaction Boundaries

### Explicit Transactions
- All write operations (append, insert, delete, update, move, add_summary) MUST execute within explicit transactions.
- The implementation MUST provide transaction begin/commit/rollback primitives.
- Nested transactions SHOULD NOT be required (single-level transactions are sufficient).

### Transaction Scope
- Single-node operations (update_content, update_context) MUST be transactional.
- Multi-node operations (add_summary, move, delete subtree) MUST be transactional.
- Read operations (serialize, expand_to_length, structure, find) SHOULD be transactional but MAY execute outside transactions for performance.

### Transaction Lifetime
- Transactions MUST be short-lived to minimize conflict probability.
- Long-running operations (like LLM-based summarization) SHOULD prepare changes outside the transaction, then apply atomically.

## Conflict Resolution

### Write-Write Conflicts
- When multiple agents attempt to modify the same node simultaneously, one operation MUST succeed and others MUST fail with a conflict error.
- The implementation SHOULD use optimistic locking (check-and-set) rather than pessimistic locking.
- Optimistic locking allows concurrent reads and reduces lock contention, with conflict detection at commit time.
- Failed operations MUST be retriable by the caller.

### Structural Conflicts (Consistency Validation)
- Operations that modify tree structure (move, delete, add_summary) MUST validate tree integrity before committing.
- Cycle detection MUST occur within the transaction before commit (consistency requirement).
- Foreign key constraints MUST be validated atomically within the transaction (consistency requirement).
- Consistency violations MUST cause transaction rollback, not conflict errors (these are validation failures, not concurrency conflicts).

### Read-Write Conflicts
- Reads and writes proceed concurrently without blocking each other.
- Snapshot isolation SHOULD be used to provide consistent read views even while writes proceed.
- Write conflicts are detected only at commit time, so reads are never blocked by in-progress writes.

## Journaling and Recovery (Durability Implementation)

### Write-Ahead Logging
- Write-Ahead Logging (WAL) MUST be used to ensure atomicity and durability.
- The WAL ensures atomicity and durability: all changes MUST be logged before being applied to the database.
- Committed transactions are durable; uncommitted transactions are automatically rolled back on crash.
- See SQLite section for SQLite-specific WAL details.

### Crash Recovery
- After a crash or unexpected termination, the system MUST automatically recover to the last consistent state.
- Partial transactions MUST be rolled back automatically (atomicity guarantee).
- No manual recovery procedures SHOULD be required.
- Recovery is transparent and does not affect optimistic locking semantics.

### Persistence Guarantees
- When IndexedDB persistence is implemented, the same ACID guarantees MUST apply.
- Persistence operations MUST be transactional and atomic.
- Partial writes to IndexedDB MUST NOT occur.
- Durability guarantees extend to persistent storage when implemented.

## Implementation Notes

### Conflict Detection Granularity
- Conflict detection operates at the node level (row level).
- Optimistic locking means no locks are held during operations; conflicts are only detected at commit time.

### Deadlock Prevention
- With optimistic locking, deadlocks are unlikely since no locks are held during the operation phase.
- Conflicts are detected at commit time, eliminating the conditions that cause deadlocks.
- Timeouts SHOULD be configured for transactions as a safety measure.
- Transaction ordering remains important for multi-node operations (e.g., always modify parent before child to maintain consistency) to ensure logical correctness.

## Future Considerations

### Distributed Scenarios
- Current specification assumes a single SQLite instance.
- Future distributed scenarios (multiple docmem instances, network synchronization) WILL require additional coordination mechanisms (not yet specified).

### Optimistic Locking Implementation
- Optimistic locking will require version fields or timestamps on nodes to detect conflicts.
- Each node SHOULD have a version field (or use `updated_at` timestamp) that is checked before updates.
- On update: read version, modify, check version hasn't changed, commit or fail with conflict.
- Version fields or `updated_at` timestamps will need to be added to the node schema.

## SQLite

### Transaction Usage
- SQLite transactions MUST be used for all write operations.
- With optimistic locking, standard `BEGIN` transactions are sufficient (no need for IMMEDIATE/EXCLUSIVE).
- Conflicts will be detected at commit time via constraint violations or version checks.
- Commit MUST be explicit; auto-commit mode SHOULD NOT be used for multi-statement operations.
- SQLite's transaction mechanism detects conflicts when commits occur.

### WAL Mode
- SQLite provides WAL mode by default, which docmem MUST utilize for durability.
- WAL mode enables concurrent reads and writes without blocking.
- The WAL ensures atomicity and durability: all changes MUST be logged before being applied to the database.

### Recovery
- After a crash or unexpected termination, SQLite MUST automatically recover to the last consistent state.
- Partial transactions MUST be rolled back automatically (atomicity guarantee).
- No manual recovery procedures SHOULD be required.

## Open Questions

### Transaction API Surface
- SHOULD the API expose explicit transaction control to callers, or hide it behind operation methods?
- Current implementation likely hides transactions; explicit control MAY be needed for complex multi-operation workflows.

### Retry Strategies
- SHOULD the implementation provide automatic retry for conflict failures, or require callers to handle retries?
- What exponential backoff or retry limits SHOULD be applied?

### Snapshot Isolation Performance
- For large serialization operations, snapshot isolation may have performance implications.
- SHOULD serialization use snapshot isolation, or accept that it may read inconsistent intermediate states?
