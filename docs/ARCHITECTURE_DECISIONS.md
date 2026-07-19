# Architecture decisions

This record describes the implementation as it exists today. It separates shipped behavior from
bounded behavior and future work; a roadmap item is not presented as a finished feature.

The product is intentionally a **local-first rollout debugger**, not a hosted observability
catalog. Its primary journey is: find a suspicious slice at corpus level, open one trace, then
move between the conversation, timing, score, token, metadata, evolution, and raw evidence. The
existing corpus-to-trace design remains the foundation; denser reference-viewer patterns are only
adopted when they improve that journey.

## Capability matrix

| Area | Current capability | Status and boundary |
|---|---|---|
| Get value quickly | A committed example corpus loads on startup. Aggregates, filters, search, the trace table, and preview drawer lead into the full debugger. | **Shipped.** No account, project setup, or API key is required. There is no guided onboarding or saved-view catalog. |
| Load traces | Paste text, choose/drop one or more files, fetch an HTTP(S) URL, or place files in watched data directories. | **Shipped, local.** Browser files are read as text and posted to the local server. URL responses are capped at 25 MB; JSON request bodies are capped at 5 MB. |
| Multiple formats | Native JSON/JSONL, OpenAI chat JSON, and raw Harmony text are auto-detected through connectors. | **Shipped.** Adding a format still requires code plus a registry entry; there is no runtime plugin discovery or schema-version migration layer. |
| Read the conversation | Role/channel styling, assistant-step grouping, reasoning folds, tool call/result blocks, rich/raw/token message views, in-trace search, and a timing minimap. An optional compact mode adds a warning rail, focused unit reader, and metrics pane. | **Shipped.** Chat-first remains the default; compact mode is a second lens rather than a replacement information architecture. |
| Trace statistics | One normalization pass computes token, turn, tool, sandbox, error, and duration metrics; home aggregates and trace-level score/timing views reuse the normalized model. | **Shipped.** Exact source values may override estimates; otherwise token counts use a documented approximation. |
| Long traces | Trace rows, conversation units, span rows, and large raw files use virtualized rendering. Content/search/token/minimap caps prevent pathological DOM work. | **Bounded.** The API and browser still load a full normalized trace, and the raw endpoint still transfers the full source. Virtualization reduces rendering cost, not transfer or total memory. |
| Raw evidence | Raw source is fetched only when the Raw tab opens, can be downloaded, and large sources render as virtualized lines. | **Shipped when a source file exists.** In-memory-only fixtures have no raw payload; very long single lines are visibly clamped in the viewer, not altered on disk. |
| Persistence | Imported bytes are written to `data/imported/`; startup scanning and file watching rebuild/update an in-memory store. Small display preferences use `localStorage`. | **Bounded local persistence.** Files are durable; indexes and normalized objects are rebuilt. There is no database, delete/manage-import UI, user workspace, or server-side catalog. |
| Share with a teammate | Filters, sort/grouping, selected preview, trace id, and active tab are represented in the URL. Raw source can be downloaded separately. | **Pointer sharing only.** A link works only when the recipient can reach an app instance containing the same trace id and corpus. It is not a self-contained permalink or hosted upload. |
| Security and privacy | URL import allows HTTP(S), rejects initially resolved private addresses by default, and applies timeout/size limits. API keys remain server-side. | **Local-tool baseline.** There is no auth, tenancy, redaction, encryption-at-rest, or hardened public-deployment boundary. Optional AI actions can send trace content to Anthropic. |

## Decisions and rationale

### 1. Normalize once, preserve a route back to the source

**Choice.** Connectors implement a small `detect`/`parse` contract and return traces plus warnings
instead of throwing. All parsed traces pass through `finalizeTrace`, which assigns message/step
identity and applies one metrics definition. The UI and API consume only the normalized
`Trace`/`Message` model. Selected unrecognized top-level fields are retained in `meta.extra`, and
the original file remains available through the Raw view.

**Why.** Renderers, filters, aggregates, and tests do not branch on source format. A new connector
has one responsibility: map source semantics into the stable contract. Warnings and raw malformed
tool arguments remain debugging evidence rather than being silently repaired.

**Boundary.** Normalization is deliberately lossy for some provider-specific or per-message
fields. Raw source is the fidelity escape hatch; there is not yet a formal provenance map from
every normalized field back to byte offsets, schema versioning, or streaming parsers.

### 2. Optimize the first useful minute

**Choice.** The app opens on a usable deterministic corpus, then follows a value-first path:

1. use curves, component aggregates, filters, or keyword search to locate a suspicious slice;
2. inspect a trace in the preview drawer without losing that slice;
3. expand to the full trace for conversation, timing, evolution, tokens, metadata, or raw bytes;
4. import external data through the same normalization path when ready.

**Why.** An evaluator or engineer can test the product before learning its schema. Corpus context
answers “where should I look?” and the trace view answers “why did it fail?”. Import is prominent
but does not block the demo.

### 3. Add compact mode as a lens, not a redesign

**Choice.** The existing virtualized chat view stays the default. A persisted Compact toggle swaps
only the conversation body for three panes: a scannable unit rail with derived warning badges, the
selected unit rendered by the existing message/step cards, and a whole-trace metrics panel.

**Why.** Dense agent traces benefit from a failure map and focused reading, but copying another
viewer's full interaction model would discard the current corpus-to-trace journey and familiar
conversation semantics. Reusing the same normalized units, cards, and metrics also avoids a second
renderer drifting from the primary view.

**Boundary.** Compact mode intentionally disables the standard search, expand/collapse-all, and
timing-minimap controls while active. Its rail currently renders every unit, so the standard
virtualized conversation remains the stronger path for pathological trace lengths; rail
virtualization and responsive narrow-screen behavior are deferred.

### 4. Use files for durability and memory for the working set

**Choice.** Plain source files are durable state. Imports persist their original bytes under
`data/imported/`; the server progressively scans configured roots in batches, watches for file
changes, and keeps normalized traces in memory. UI-only preferences such as sidebar/minimap state
live in `localStorage`; shareable investigation state lives in the URL instead.

**Why.** This keeps setup to one command, makes traces greppable and portable, and avoids a schema
migration burden for a take-home-sized local corpus. Restart cost is accepted in exchange for a
transparent source of truth.

**Boundary.** `TraceStore` centralizes storage access, but routes currently depend on the concrete
class, so a SQLite/DuckDB backend would be a localized refactor rather than a drop-in adapter.
Import naming is trace-id based and there is no catalog UX for ownership, retention, deduplication,
or deletion.

### 5. Share investigation state, not data implicitly

**Choice.** The URL is the investigation pointer: list filters/sort/grouping, drawer selection,
trace route, and active tab survive refresh and can be copied. The raw payload has an explicit
download action.

**Why.** A URL reproduces “what I was looking at” cheaply and keeps navigation/back behavior
coherent. It also avoids quietly uploading potentially sensitive traces merely to create a link.

**Boundary.** The current URL does not contain the trace. Team sharing therefore requires a
shared server/data directory or an out-of-band raw-file transfer. A self-contained export bundle,
content-addressed artifact, expiring hosted link, access control, and comments are deferred.

### 6. Keep domain logic pure and boundaries explicit

The code is divided by responsibility:

- `shared/`: normalized schema, connectors, stats, filters, and aggregates; pure TypeScript used
  by both server and browser;
- `server/`: filesystem scanning, in-memory store/search, REST routes, URL import, and optional AI;
- `src/`: React views, URL codecs, React Query server state, and small local interaction state;
- `generator/`: seeded corpus generation and failure scenarios used as executable fixtures.

Repeated behavior is concentrated in small seams: one connector registry, one finalization point,
one list filtering/sorting pipeline, one app factory with explicit test dependencies, and store
versions that invalidate derived caches. Most view-feeding logic is testable without rendering a
browser. This favors direct functions and typed data over framework-specific indirection.

### 7. Spend optimization effort where traces are unbounded

Implemented safeguards include virtualized list/conversation/timeline/raw rendering, lazy Raw-tab
fetching, batched startup scanning, cached summaries, a lazily rebuilt MiniSearch index, bounded
search/index text, and explicit token/content/minimap render caps. The deterministic corpus includes
a multi-megabyte, 400-turn stress trace so these paths are exercised rather than theoretical.

These are UI-scale optimizations, not a claim of million-trace architecture. The list API still
sorts/filter scans an in-memory summary set, the UI requests a bounded batch, full trace messages
arrive in one response, and raw text is materialized before line virtualization.

## Deferred long-trace roadmap

The next scale step should preserve the normalized contract while changing transport and storage:

1. return trace metadata first and page/chunk message bodies, token arrays, spans, and raw byte
   ranges on demand;
2. place metadata and full-text search behind SQLite/DuckDB with cursor pagination and aggregate
   pushdown;
3. move parsing/indexing to workers and add cancellation, progress, and backpressure;
4. add incremental ingest/live tail only after partial-trace semantics and reconnect behavior are
   specified.

Until those steps exist, the honest target is a large local debugging corpus and individual
multi-megabyte traces—not an unbounded production telemetry stream.

## Security and privacy boundary

The supported deployment is a trusted developer machine or trusted internal environment. URL
fetching has useful SSRF defenses (protocol allowlist, DNS/private-address rejection, timeout, and
byte cap), but it is not a hardened egress proxy: redirect/DNS-rebinding policy, content-type
validation, malware scanning, and per-user quotas are deferred. Setting `ALLOW_PRIVATE_URLS=1`
explicitly weakens the private-address guard.

Imported traces are stored as plaintext local files and are available through unauthenticated API
routes. The app has no secret/PII scrubber. When optional AI features are invoked, natural-language
filtering sends the query/context labels, while trace chat, analysis, and playground can send
bounded trace content to the configured Anthropic model. The API key stays on the server, but data
egress still occurs; sensitive deployments need consent/redaction controls and an allowlisted or
self-hosted model before these features are enabled.
