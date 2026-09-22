# Real-time updates

**Core idea:** nobody notifies anybody directly. Every writer commits **data + a domain event in the same transaction**; the database is the event log; the one process that holds browser connections (the server) tails the log and relays. Two browsers, ten browsers, or a CLI in the middle — same mechanism.

## The outbox

- **`events` table** — `id INTEGER PRIMARY KEY AUTOINCREMENT, session_id, kind, payload, actor, at`. Appended by the use case inside the same `BEGIN IMMEDIATE` transaction as the write: no event without data, no data without event.
- **Event kinds** (union in `domain/events/`): `RevisionCreated`, `RecordDecided`, `CommentAdded`, `NoteAdded`, `ReviewFinished`, `ReviewClosed`, … (plus the frozen names nothing writes any more — `ChangesRequested`, `HoldSet`/`HoldCleared`, `Request*` — which every reader must still parse)
- **Published through an `event-publisher.port`** — in-process pub/sub with a durable transport. Late subscribers replay; the log survives restarts.

## The tailer (server only)

- **Created once** in `serve()` (`createTailer(store, app)`), started before traffic, stopped on SIGTERM. Never exists in the CLI.
- **Loop every ~300 ms:** `PRAGMA data_version` — unchanged → do nothing (idle cost = one pragma). Changed → `SELECT * FROM events WHERE id > lastId ORDER BY id`, advance the cursor, hand each event to every in-process listener.
- **Cursor persisted** in a `cursors` table so a restart resumes, never re-emits history.
- **`listen(sessionId, signal)`** — async iterator per open subscription; listener registered on subscribe, removed on abort (browser closed). The server does not special-case its own writes — one path covers every writer, present and future.

## SSE to the browser

- **One stream per page**, opened on load: tRPC v11 subscription (`events.onSession`) over `httpSubscriptionLink`; plain HTTP, which needs no TLS because the server listens on this machine only and a remote reader reaches it through an SSH tunnel that is already encrypted; browsers cap HTTP/1.1 connections, so one multiplexed stream, filtered by session.
- **`tracked(id, event)`** sets the SSE `id:` field. `EventSource` auto-reconnects with `Last-Event-ID`; the subscription replays `events WHERE id > lastEventId` from the table before joining live. A page closed for an hour catches up in one request.
- **Queries are normal request/response** — they finish. The stream is the only long-lived connection; events tell the query cache what to refetch.

## Browser reaction — `useLiveSession`

- **Every query has a cache key** (procedure path + input). The event→invalidation mapping lives in ONE file (`apps/web/src/lib/live.ts`); components never know SSE exists.
- **Mapping:** `RecordDecided`/`CommentAdded` → invalidate `records.get{id}` + `records.list{session}` · `ReviewFinished` → invalidate broadly · `RevisionCreated` → set a banner query — **announce, don't swap**: when the AI files revision 3 while the human reads revision 2, the page shows "Revision 3 available" and the human clicks to switch. Content never moves under the reader.
- **Fallback:** `refetchInterval` (~30 s) stays on as the safety net; invalidate-and-refetch keeps every page reading the same rows, so browsers cannot drift.

## CLI waiting

- **`retro review wait`** tails the same events table from its own process (500 ms poll) and returns on `ReviewFinished` — one name, because the page has one terminal button and what the round was about is read from the round. No server involvement — works even if the server is down.

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant CLI as CLI process<br/>(retro …, actor=ai)
    participant App as App use cases<br/>(same code in both processes)
    participant DB as SQLite<br/>data + events table
    participant Tailer as Server: tailer<br/>(300 ms data_version loop)
    participant API as Server: tRPC<br/>(mutations / queries / SSE)
    participant Laptop as Laptop page
    participant Second as Second page<br/>(another tab, or one over an SSH tunnel)

    Note over Laptop,Second: Page load: queries fetch & finish; ONE SSE stream per page stays open
    Laptop->>API: GET /trpc/events.onSession (SSE, stays open)
    Second->>API: GET /trpc/events.onSession (SSE, stays open)

    rect rgb(235,245,255)
    Note over CLI,Second: A — the AI files revision 2
    CLI->>App: createRevision({session, records}, 'ai')
    App->>DB: BEGIN IMMEDIATE · INSERT revision · INSERT event RevisionCreated · COMMIT
    App-->>CLI: {revision: 2}  (CLI prints JSON and exits — never talks to the server)
    Tailer->>DB: PRAGMA data_version  → changed
    Tailer->>DB: SELECT events WHERE id > lastId
    Tailer->>API: emit RevisionCreated to every listener
    API-->>Laptop: SSE  id:812  RevisionCreated{rev:2}
    API-->>Second: SSE  id:812  RevisionCreated{rev:2}
    Laptop->>Laptop: onData → banner "Revision 2 available" (content not swapped)
    Second->>Second: onData → same banner
    end

    rect rgb(240,255,240)
    Note over CLI,Second: B — the human approves record #4 on the second page
    Second->>API: POST records.decide {recordId:4, approved}
    API->>App: decideRecord(input, 'human')
    App->>DB: BEGIN IMMEDIATE · UPDATE record · INSERT event RecordDecided · COMMIT
    API-->>Second: 200 (mutation done; request over)
    Tailer->>DB: data_version changed → SELECT new events
    Tailer->>API: emit RecordDecided{recordId:4}
    API-->>Laptop: SSE  id:813  RecordDecided
    API-->>Second: SSE  id:813  RecordDecided
    Laptop->>Laptop: onData → invalidate records.get{id:4} → refetch → card re-renders
    Second->>Second: same invalidate → refetch → confirms its own click
    end

    rect rgb(255,245,235)
    Note over CLI,Second: C — Finish review; the waiting CLI continues
    CLI->>App: (earlier) review wait — polls eventsSince every 500 ms
    Second->>API: POST review.finish
    API->>App: finishReview(session, 'human')
    App->>DB: tx: mark finished · INSERT event ReviewFinished · COMMIT
    Tailer->>API: emit ReviewFinished
    API-->>Laptop: SSE ReviewFinished → refetch all
    API-->>Second: SSE ReviewFinished → refetch all
    CLI->>DB: eventsSince → sees ReviewFinished
    App-->>CLI: exits with event JSON → skill proceeds to export
    end

    Note over Laptop,API: Reconnect (the page slept): EventSource reopens with Last-Event-ID=813 → server replays events > 813, then goes live
```

## Distributed note (context only)

The shape is the transactional-outbox pattern: if Retro ever needed a hosted edition, the outbox stays, the tailer becomes a stream consumer, and SSE becomes a connection registry + fan-out. **Not a goal** — local-first is the promise; the note exists to show the design is not a local-only hack.
