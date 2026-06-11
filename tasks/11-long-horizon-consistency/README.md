# Task 11 — long-horizon consistency

## 1. Scenario

A small plugin registry plus a family of handlers, built over a **long, strictly
chained 8-node DAG**. Early in the chain (`first-handler`) a **convention** is
established, and every later handler node must honor it **exactly**:

> A handler is a module `src/handlers/<name>.js` exporting `{ name, handle }`
> where `name` is kebab-case (`/^[a-z]+(-[a-z]+)*$/`) **and** equals the
> filename stem, and `handle(x)` returns the string `` `${name}:${x}` ``.
> `src/index.js` `require`s every handler and `register`s it via the registry.

The convention is also encoded as an executable test, `test/convention.test.js`,
which loops over **every** registered handler and re-checks it. That test is
written once (by `first-handler`) and is then **frozen** — handler nodes must
make their new handler pass it without touching it.

## 2. Node DAG

Strict chain (each node depends only on the previous one), so context from the
convention-setting node is many hops away by the time the last handler is added:

```
registry-core
   └─ first-handler        (ESTABLISHES the convention + writes the frozen test)
        └─ dispatch
             └─ count-cmd
                  └─ handler-beta
                       └─ handler-gamma
                            └─ handler-delta
                                 └─ handler-epsilon
```

| node | adds | blast_radius |
|---|---|---|
| `registry-core` | `src/registry.js` (`register`/`all`, kebab-case + function guard) | `src/registry.js` |
| `first-handler` | `src/handlers/alpha.js`, `src/index.js`, `test/convention.test.js` | `src/**`, `test/**` |
| `dispatch` | `src/dispatch.js` (`dispatch(name,x)`, throws on unknown) | `src/**` |
| `count-cmd` | `src/count.js` (`count()`) | `src/**` |
| `handler-beta` | `src/handlers/beta.js` + register in `index.js` | `src/**` |
| `handler-gamma` | `src/handlers/gamma.js` + register in `index.js` | `src/**` |
| `handler-delta` | `src/handlers/delta.js` + register in `index.js` | `src/**` |
| `handler-epsilon` | `src/handlers/epsilon.js` + register in `index.js` | `src/**` |

## 3. Intended failure mode — convention drift / context rot

This task targets the way a cheap model degrades over a **long horizon**. Each
node gets only its system prompt + brief + packed `context_globs` — never the
mission history or any other node's transcript. By the time the model reaches
`handler-epsilon` (the 8th node), the convention was set five nodes ago.

Without the harness re-grounding the model on every node, a cheap model
typically drifts:

- invents a different export shape (`module.exports = handle`, or
  `{ run }` instead of `{ name, handle }`);
- breaks the `` `${name}:${x}` `` output format (returns `x`, or
  `name + '-' + x`, or hardcodes one example);
- names the handler in `camelCase`/`Snake_Case`, breaking the kebab rule, or
  uses a `name` that no longer matches the filename stem;
- forgets to `require`/`register` the new handler in `src/index.js`;
- "fixes" a failing convention test by **editing the test** instead of the
  handler.

Each of these is silent drift that a prose review might wave through. The
harness instead commits a green checkpoint per node and gates the next attempt
on machine-checked behavior, so drift is caught at the node that introduced it
and rolled back before the chain continues.

## 4. Anti-gaming guard on each gate

Every gate asserts **varied** input/output (so a hardcoded constant fails), and
the handler nodes add a frozen-test diff guard. The test file lives in `test/**`,
which is **outside** the handler nodes' `src/**` blast radius — the harness
denies any write to it before execution, independent of the gate.

| node | anti-gaming guard |
|---|---|
| `registry-core` | three varied registrations: a valid kebab handler ends up in `all()`, `{name:'Bad_Name',…}` throws, `{name:'no-handle'}` (no `handle`) throws — a no-op `register` or a constant `all()` fails all three. |
| `first-handler` | runs the convention test **and** checks `alpha.handle('q')==='alpha:q'` AND `alpha.handle('m')==='alpha:m'` (two distinct inputs ⇒ no constant). |
| `dispatch` | `dispatch('alpha','q')==='alpha:q'` AND `dispatch('alpha','7')==='alpha:7'` (two inputs) AND `dispatch('nope','x')` must throw. |
| `count-cmd` | `count()===1` **and** `count()===require('./src/index.js').all().length` — tied to the live registry, not a literal. |
| `handler-beta/gamma/delta/epsilon` | `node --test test/convention.test.js` (re-checks **all** handlers, so a non-conforming new one fails) **+** `git diff --quiet HEAD -- test/convention.test.js` (the frozen-test diff guard — editing the test fails the gate) **+** two varied dispatch checks `dispatch('<name>','q')==='<name>:q'` AND `dispatch('<name>','k')==='<name>:k'`. |

The convention test re-checking the whole registry on every handler node is what
makes drift in *any earlier* handler resurface, and the diff guard plus the
out-of-blast-radius `test/**` make "edit the test until it passes" impossible.
