# Task 14 — Poisoned Dependency (ledger encoder)

## Scenario
A tiny ledger pipeline. A record is `{ id: number, amountCents: number }`.
The **canonical encoding** of a record is the string:

```
`${id}|${amountCents}|${cc}`
```

where `cc` is the 2-character, zero-padded checksum:

```js
String((id + amountCents) % 97).padStart(2, "0")
```

Seven modules are built in a strict chain. The middle module (`encode`,
node 4) defines a **contract** — the exact byte string — that every
downstream stage (`encodeAll`, `buildIndex`, `verify`) consumes. If node 4
gets a subtle detail wrong, the whole tail of the pipeline is built on a
poisoned dependency.

## DAG (strict chain n1 → n2 → … → n7)

```
record → store → total → encoder → encode-all → index → verify
  (1)     (2)     (3)      (4)         (5)        (6)      (7)
```

| node | file | depends on |
|------|------|-----------|
| 1 `record`     | `src/record.js`     | —            |
| 2 `store`      | `src/store.js`      | record       |
| 3 `total`      | `src/total.js`      | store        |
| 4 `encoder`    | `src/encode.js`     | total        |
| 5 `encode-all` | `src/encodeAll.js`  | encoder      |
| 6 `index`      | `src/buildIndex.js` | encode-all   |
| 7 `verify`     | `src/verify.js`     | index        |

## Intended failure mode (the "poison")
A cheap model implementing `encode` (node 4) falls into one of two subtle
traps:

1. **Wrong modulus** — using `% 100` instead of `% 97`.
2. **Missing pad** — forgetting `.padStart(2, "0")`, so single-digit
   checksums render as one character.

Either mistake produces an `encode` that *looks plausible* and *runs without
error*. Nodes 5 and 6 (`encodeAll`, `buildIndex`) just call `encode`, so they
**also succeed** with the poisoned output — they never recompute the
checksum, so they cannot notice it is wrong.

The contradiction only becomes observable at **node 7 (`verify`)**, which
independently recomputes the checksum and compares. A roundtrip
`verify(encode(record))` is then `false` for valid records — but by that
point the bug is three modules upstream and the failing symptom ("verify
rejects its own output") points at the wrong file. That is the classic
poisoned-dependency debugging trap: the error **surfaces** far from where it
was **introduced**.

## How the node-4 gate catches the poison AT node 4 (not node 7)
The harness runs a per-node `done_check` (a shell command judged purely by
exit code) before a node may commit. Node 4's gate asserts **four exact
output strings with varied inputs**, hand-picked so that each poison trap is
caught immediately:

```
encode(make(7,50))  === '7|50|57'   // (7+50)%97   = 57
encode(make(90,90)) === '90|90|83'  // (90+90)%97  = 180-97 = 83   ← differs from %100 (=80)
encode(make(1,0))   === '1|0|01'    // (1+0)%97    = 1  → '01'      ← catches MISSING PAD (would be '1')
encode(make(50,50)) === '50|50|03'  // (50+50)%97  = 100-97 = 3 → '03'
```

- The `50,50 → '03'` case catches **both** traps at once: with `% 100` the
  checksum would be `100 % 100 = 0` → `'00'`; without padding it would be
  `'0'` (or `'3'`). Only the exact contract yields `'03'`.
- The `1,0 → '01'` case isolates the **missing-pad** trap: the value `1` is
  already `< 97`, so the modulus is irrelevant here; only padding turns it
  into `'01'`.
- The `90,90 → '83'` case isolates the **mod-100** trap: `% 100` would give
  `80`, not `83`.

Because these run as node 4's gate, a poisoned `encode` **fails to commit at
node 4**. The harness resets to the last green checkpoint and escalates
(re-attempt with more guidance) until node 4 is exactly correct — *before*
nodes 5–7 are ever attempted. The poison never propagates.

Node 7's gate then provides defense-in-depth: it builds a store, encodes it,
asserts `verify` is `true` for every produced string, **and** `false` for a
string with a tampered trailing checksum (`'50|50|03'` → `'50|50|00'`). That
final assertion only passes if `encode` (node 4) was exactly correct, so even
the roundtrip is pinned to the true spec.

## Anti-gaming guards
- **Varied inputs, exact outputs.** Every behavior gate asserts ≥ 2 distinct
  inputs mapped to their exact expected outputs (node 4 uses 4 inputs). A stub
  that returns a constant, or that hard-codes one case, cannot pass.
- **Cross-checked checksum.** Node 7 recomputes the checksum independently of
  `encode` and demands both a true (valid) and a false (tampered) result, so a
  `verify` that always returns `true` is rejected.
- **Validation is exercised.** Node 1's gate asserts that `make(-1,0)` and
  `make(1,2.5)` throw, so an unvalidated factory fails.
- **Order preserved.** Nodes 2/5 assert insertion order, not just length.
- **Blast radius.** Implementation nodes are confined to `src/**`; the gates
  themselves live in `mission.yaml` (`node -e`), outside any writable path, so
  a node cannot weaken its own check.

## Reference solution
`engine-scripts/<nodeId>.json` contains the correct reference steps for each
node (used by `--mock`). They write the exactly-correct modules inside
`src/**` and make every `done_check` pass, so
`pnpm experiment --tasks 14 --chains cheap --mock` completes **7/7**.

## Run
```
pnpm experiment --tasks 14 --chains cheap --mock
# expect: completed=true nodes=7/7
```
