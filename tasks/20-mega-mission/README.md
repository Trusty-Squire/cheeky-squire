# Task 20 — Mega Mission (event-processing system, 15 nodes)

## 1. Scenario

A small **event-processing system**, built over a **long 15-node chain** that
deliberately fuses the three hardest single-pattern tasks in this benchmark into
one long-horizon stressor:

- **(A) Canonical ENCODING with a checksum** — the *poisoned-dependency* pattern
  of **task 14**. A record is an event `{ type, payload }`. Its canonical
  encoding is `` `${e.type}#${cc}` `` where the 2-char checksum is
  `String([...e.type].reduce((a,c)=>a+c.charCodeAt(0),0) % 97).padStart(2,'0')`.
  The `encode` node defines this contract; every downstream stage consumes it.
- **(B) HANDLER CONVENTION** — the *long-horizon consistency* pattern of
  **task 11**. A handler is `src/handlers/<type>.js` exporting `{ type, handle }`
  where `type` is kebab-case and equals the filename stem, and
  `handle(e)` returns `` `${type}:${e.payload.n}` ``. The convention is set once
  (`first-handler`) and re-checked by a **whole-registry test** on every later
  handler node.
- **(C) emit() API MIGRATION** — the *API-migration-across-call-sites* pattern of
  **task 13**. `emit(type, payload)` is migrated to `emit(event)` (a single
  `{ type, payload }` object) across **six call sites** in `src/wire/*.js`,
  gated by a compile check plus a completeness grep for leftover two-arg calls.

The experiment copies `fixture/` into a fresh temp git repo with **no install**
and runs every gate with `node`/`grep`/`git` only — dependency-free CommonJS.

## 2. The 15-node DAG

```
event-make ──┬─────────────► registry-core ──► first-handler ──┐
             │                                                  │
             ▼                                                  ▼
           store ──► encode ──► encode-all ──► verify        emit-v1 ◄── store
                                                  │              │
                                                  │              ▼
                                                  │           wire-a ──► wire-b ──► wire-c
                                                  │                                   │
                                                  │                                   ▼
                                                  │                              emit-migrate
                                                  │                                   │
                                                  │                                   ▼
                                                  │                             handler-pong
                                                  │                                   │
                                                  │                                   ▼
                                                  │                             handler-tick
                                                  │                                   │
                                                  └──────────────► integration ◄──────┘
```

| # | node | adds / changes | deps | blast_radius | pattern |
|---|------|----------------|------|--------------|---------|
| 1 | `event-make`   | `src/event.js` `make(type,payload)` + validation | — | `src/event.js` | — |
| 2 | `store`        | `src/store.js` `Store` add/all (order) | event-make | `src/store.js` | — |
| 3 | `encode`       | `src/encode.js` canonical `${type}#${cc}` | store | `src/encode.js` | **14 (poison)** |
| 4 | `encode-all`   | `src/encodeAll.js` map encode over store | encode | `src/encodeAll.js` | 14 |
| 5 | `verify`       | `src/verify.js` recompute + roundtrip | encode-all | `src/verify.js` | 14 |
| 6 | `registry-core`| `src/registry.js` kebab + function guard | event-make | `src/registry.js` | **11** |
| 7 | `first-handler`| `src/handlers/ping.js`, `src/index.js`, `test/convention.test.js` | registry-core | `src/**`,`test/**` | **11 (establishes)** |
| 8 | `emit-v1`      | `src/emit.js` v1 `emit(type,payload)` | first-handler, store | `src/emit.js` | **13 (pre-migration)** |
| 9 | `wire-a`       | `src/wire/a.js` two emit call sites | emit-v1 | `src/wire/a.js` | 13 |
| 10| `wire-b`       | `src/wire/b.js` two emit call sites | wire-a | `src/wire/b.js` | 13 |
| 11| `wire-c`       | `src/wire/c.js` two emit call sites | wire-b | `src/wire/c.js` | 13 |
| 12| `emit-migrate` | breaking `emit(event)` + update all 6 call sites | wire-a/b/c | `src/**` | **13 (migration)** |
| 13| `handler-pong` | `src/handlers/pong.js` + register | emit-migrate | `src/**` | **11** |
| 14| `handler-tick` | `src/handlers/tick.js` + register | handler-pong | `src/**` | **11** |
| 15| `integration`  | `test/integration.test.js` end-to-end | verify, handler-pong, handler-tick | `test/**` | all three |

Nodes are a real cross-linked DAG (not a single strict chain): `event-make` fans
out to both the encoding lane (`store→encode→encode-all→verify`) and the handler
lane (`registry-core→first-handler→emit-v1→wire-*→emit-migrate→handlers`), and
`integration` joins both lanes back together.

## 3. Intended failure mode — three poisons compounding over 15 nodes

This is the benchmark's longest task, and it is where **context rot**,
**error compounding**, and a **poisoned contract** all combine:

1. **The poison (node 3, `encode`).** A cheap model writes a *plausible* checksum
   with `% 100` instead of `% 97`, or forgets `.padStart(2,'0')`. The encoding
   still *runs*. `encode-all` (node 4) just maps it, so it succeeds with the
   poisoned output. The contradiction only *surfaces* at `verify` (node 5) — two
   nodes downstream — pointing at the wrong file. Classic task-14 trap: the error
   surfaces far from where it was introduced.

2. **Convention drift (nodes 7→13→14).** The handler convention is set at node 7.
   By the time `handler-tick` (node 14) is reached, the convention was established
   **seven nodes ago**, and the model gets only its brief + packed
   `context_globs` — never the mission history. A cheap model drifts: wrong export
   shape, `camelCase`/`Snake_Case` types, broken `` `${type}:${n}` `` output, or
   "fixes" a failing test by editing it.

3. **Incomplete migration (node 12, `emit-migrate`).** Six call sites across three
   files must all flip from `emit(type, payload)` to `emit({ type, payload })`. A
   cheap model migrates the obvious ones and declares done, leaving a stray
   two-arg call that now passes its event object as `type` and breaks dispatch.

Over 15 nodes any one silent drift compounds into the next. The harness commits a
green checkpoint per node and gates the next attempt on machine-checked behavior,
so each poison is caught **at the node that introduced it** and rolled back before
the chain continues.

## 4. Anti-gaming guard on each gate

Every behavior gate asserts **≥2 varied inputs**, so a hardcoded constant fails.
Tests live in `test/**`, **outside** the implementation nodes' `src/**` blast
radius — the harness denies any write to them before execution, independent of
the gate.

| node | anti-gaming guard |
|------|-------------------|
| `event-make` | valid `make('ping',{n:5})` ok **and** three negatives throw: `make('',{})`, `make('ping',null)`, `make('ping',7)`. |
| `store` | adds two events, asserts `length===2` **and** insertion order (`[0].type==='ping'`, `[1].type==='pong'`). |
| `encode` (**poison gate**) | **4 exact strings, varied inputs**, re-derived by hand: `ping→ping#42`, `tick→tick#39`, `ab→ab#01`, `a→a#00`. `ab#01`/`a#00` need the **leading zero** (catch missing-pad: would be `ab#1`/`a#0`). `ping`/`tick`/`ab` differ between `%97` and `%100` (catch mod-100: `ping#30`/`tick#27`/`ab#95`). Verified: a `%100` impl and a no-pad impl both **fail** this gate. |
| `encode-all` | exact strings over a 2-event store including the leading-zero `ab#01`. |
| `verify` | true for **every** produced string **and** false for a tampered checksum (`ab#01`→`ab#99`) — a `verify` that always returns true is rejected. Only passes if `encode` was exactly right. |
| `registry-core` | three varied registrations: valid kebab handler lands in `all()`; `{type:'Bad_Type',…}` throws; `{type:'no-handle'}` throws. |
| `first-handler` | runs `test/convention.test.js` **and** checks `ping.handle({payload:{n:7}})==='ping:7'` AND `…{n:3}==='ping:3'` (two inputs). |
| `emit-v1` | `emit('ping',{n:4})==='ping:4'` AND `…{n:9}==='ping:9'` (two inputs) AND `emit('nope',…)` throws. |
| `wire-a/b/c` | each asserts **both** call sites with **two** distinct `x` values (e.g. `a.a(5)==='ping:5'`, `a.b(5)==='ping:10'`, `a.a(2)==='ping:2'`) — a constant or single-site stub fails. |
| `emit-migrate` (**migration gate**) | (1) **compile gate** `node --check` over every `src/**` file; (2) `node -e` exercising outputs from **all three** wire modules + a direct `emit({…})` — can't be satisfied by editing one file; (3) **completeness grep** `! grep -rEn "emit\(['\"]" src/wire` — matches a string-first **two-arg** `emit('ping',…)` call and **not** the migrated `emit({…})` form. Verified: a single leftover two-arg call is caught. |
| `handler-pong` / `handler-tick` | `node --test test/convention.test.js` (re-checks **all** handlers, so a non-conforming new one fails) **+** `git diff --quiet HEAD -- test/convention.test.js` (frozen-test diff guard — editing the test fails) **+** two varied dispatches `emit({type:'<t>',payload:{n:…}})` for two `n` values. |
| `integration` | runs `test/integration.test.js` (emits ping/pong/tick through the migrated API, roundtrips encode/verify over a store, asserts every handler conforms) **+** the frozen-convention diff guard. Lives in `test/**`, outside any `src/**` writer. |

The convention test re-checking the whole registry on every handler node makes
drift in *any earlier* handler resurface; the diff guard plus the
out-of-blast-radius `test/**` make "edit the test until it passes" impossible; the
migration's grep makes "migrate the ones I see" insufficient; and the poison
gate's hand-derived exact strings make a plausible-but-wrong checksum fail **at
node 3**, before it can propagate.

## 5. Reference solution

`engine-scripts/<nodeId>.json` contains the correct reference replay for each of
the 15 nodes (writes confined to each node's blast radius). All checksums were
re-derived and the exact values baked into both the gates and the engine-scripts,
so:

```
pnpm experiment --tasks 20 --chains cheap --mock
# expect: completed=true nodes=15/15
```
