# SPEC-v0.2.md — Castellan v0.2: the planning layer

> v0.1 (SPEC.md) built and proved the execution harness: gated loops turn a
> cheap model into a frontier-equal executor (35%→100% same-model; matched
> opus 20/20 at ~1/25th cost). v0.2 builds the layer above it: specs that
> compile into gated plans, a planner that refuses what it cannot gate, and
> gate types for work that exit codes cannot judge. v0.2 is still an
> experiment: every product claim below carries a falsification test.
>
> SPEC.md remains the authority for the execution engine. Where this document
> is silent on engine behavior, SPEC.md governs. Where silent entirely:
> decide, record in ASSUMPTIONS.md, proceed.

---

## 1. Product thesis (v0.2 increment)

Castellan: **you bring the inspiration; your castellan handles the rest — and
proves it.** Pillars: (1) verified execution, receipts attached, at ~1/20th
frontier cost; (2) loop-native — specs compile to gated loops, git is the
memory, tests are the judge; (3) open engine, any model, no lock-in.

The v0.1 bottleneck, proven by dogfood: **mission authoring is a skill** —
weak gates pass poisoned artifacts, and hand-written YAML cannot be the
product's front door. v0.2's bet: goal/spec → gated plan compilation can be
made good enough to trust by default, measured the same way v0.1 measured
execution. If the planner tax (§9) cannot be driven low, the goal-native
product thesis fails and we say so.

Unifying invariant, all layers: **the artifact is the state; the transcript
is disposable; progress is gated; failures escalate.** Execution: artifact =
repo. Planning: artifact = spec. Conversation is an input method, never a
state container.

---

## 2. Vocabulary and naming

- Product: **Castellan**. Binary: `ser` (alias `castellan`). Package: `castellan`.
- Internal identifiers (fine to use, build no persona features): **herald** =
  the derive pipeline (§6), **marshal** = blast enforcement (v0.1), **knight**
  = escalation target, **ledger** = the claims register (§5.3).
- v0.1 internal names (`.squire/`, `SquireError`) may be renamed in a
  dedicated housekeeping commit; renaming is not a v0.2 gate.

---

## 3. The lifecycle Castellan owns

| phase | artifact | Castellan's role |
|---|---|---|
| 1 genesis / thought partner | spec | `ser spec` (§5): delta-mapped construction, claims ledger, gates on thinking. Conversational *exploration* itself stays commodity — any chat tool may produce the spec; Castellan defines the contract it must land in |
| 2 build | plan + repo | `ser derive` (§6) compiles spec → mission; `ser run` executes (v0.1); `ser do` (§7) for single gated goals |
| 3 bug fix | repro + fix | repro-then-fix mission pack (§7) — the repro is the gate |
| 4 feature | mini-spec | condensed 1→2, same pipe |
| 5 closed loop | telemetry → goals | OUT OF SCOPE v0.2 (triggers/queue/ingestion are v0.3 candidates) |

---

## 4. Gate ladder (amends SPEC.md §5 "no prose evaluation")

The v0.1 rule's load-bearing properties were: the judge is **external to the
executor**, the verdict is **recorded with evidence**, and judging is **cheap
relative to generating**. Exit codes are the purest form, not the only form.
v0.2 admits four gate tiers:

| tier | type | judge | v0.2 status |
|---|---|---|---|
| 1 | `command` | shell exit code | default; unchanged from v0.1 |
| 2 | `metric` | frozen perceptual/statistical metric behind a shell command (FID, LPIPS, benchmark threshold) | supported (it IS a command gate; the tier is documentation + pattern library) |
| 3 | `judge` | pinned external model + structured rubric, vote-of-N | **soft gates only** in v0.2 (flag, never fail); hard tier-3 gates require a calibration set and are v0.3+ |
| 4 | `human` | a human verdict on an artifact | first-class in v0.2 |

Rules:
1. The executor's own model is NEVER a judge of its own node. (Unchanged.)
2. Tier-3 judges must be pinned (model id + version + temperature + rubric
   hash recorded in the trace) and run vote-of-N (N≥3, majority). Soft only:
   verdict lands in trace as `judge_flag`, does not fail the node.
3. Tier-4 `human` gates: the node's deliverable includes an **adjudication
   artifact** (image grid, diff, side-by-side) named by the gate; the run
   pauses that DAG branch (others proceed); the verdict (approve/reject +
   reason + who + ts) is a trace event; a rejection's reason enters FAILURE
   CONTEXT verbatim and the ladder proceeds as for any gate failure.
4. Human checkpoints are budgeted: mission schema gains
   `max_human_checks` (default 3); derive must surface the count in the
   readback ("this plan asks for ~2 minutes of your judgment").
5. The flywheel is intentional: tier-4 verdicts accumulate (trace archive) as
   the future calibration set that promotes tier-3 judges and tunes tier-2
   thresholds. Human gates are how subjective gates get born; metric gates
   are how they retire.

### 4.1 Mission schema v2 (backward compatible)

```yaml
nodes:
  - id: feathers
    brief: "..."
    # v0.1 form still valid — equivalent to gate: {type: command, run: ...}
    done_check: "pnpm vitest run test/feathers"
    # v2 form:
    gate:
      type: human            # command | metric | judge | human
      artifact: "renders/feathers-grid.png"   # human/judge: what to adjudicate
      soft: false            # judge gates: must be true in v0.2
      run: ""                # command/metric: the shell command
      judge: null            # {model, rubric, votes} — pinned, v0.3 for hard
```

Exactly one of `done_check` | `gate` per node. zod is the single source of
truth; `ser validate` covers both forms.

---

## 5. `ser spec` — gated spec construction (phase 1)

Conversation whose ONLY output is a spec artifact. The model's reply to each
user message is: proposed **deltas** to the spec + at most one terse
question. No prose essays. The transcript is discarded; each turn's context =
current spec + last user message (bounded forever — the spec IS the
compaction).

### 5.1 Spec file format

`<name>.spec.yaml`, zod-schema'd (decision: YAML, consistent with
mission.yaml; prose lives in string fields):

```yaml
thesis: "one paragraph — pinned; drift against it is flagged"
scope_fence: ["not building X", "no Y in this version"]
requirements:
  - id: R1
    statement: "..."
    acceptance: { tier: 1, gate: "pnpm vitest run test/r1" }
    # or: { tier: 4, artifact: "..." } — or: { tier: 0 }  # 0 = UNANCHORED (blocks compile)
decisions:
  - id: D1
    statement: "..."
    rationale: "..."
    claims: [C1, C3]      # load-bearing claims this decision rests on
claims:
  - id: C1
    statement: "falsifiable claim"
    status: unverified    # unverified | verified | refuted
    evidence: ""          # source URL or arithmetic; required for verified/refuted
open_questions:
  - { id: Q1, text: "...", blocking: true }
```

### 5.2 Turn loop

1. User message → model proposes deltas (add/modify/resolve/remove on the
   sections above), rendered as a diff.
2. User: accept / edit / reject. Accepted deltas apply; every accepted batch
   is a git commit (checkpointed thinking; resume = free).
3. Escalation: ≥2 consecutive rejected delta batches → next rung generates
   the following turn (cheap drafts, frontier on demonstrated failure).
   Acknowledged weakness: rejection is a sparse, noisy signal; disengagement
   is unmeasured. Record rejection counts in the trace regardless.
4. Drift check (flag-only): a delta contradicting the pinned `thesis` field
   is marked `drift_flag` in the proposal. (Motivated by observed
   strategy-level confabulation; cheap to compute, never blocks.)

### 5.3 Spec gates (`ser spec check`)

| gate | check |
|---|---|
| schema | spec parses against the zod schema |
| claims | no `unverified` claim referenced by any decision marked load-bearing; refutations/verifications carry evidence |
| adversarial | every decision's claims survived the review pipeline (§6.4) |
| executability | `ser derive --judge` compiles the spec to a plan that passes `ser validate`; every requirement has tier ≥1 acceptance or an explicit tier-4; tier-0 (unanchored) blocks with the three remediations (§6.5) |
| open questions | no `blocking: true` question remains |

"Done thinking" = all five exit 0.

### 5.4 Research

`ser spec research <claim-ids>`: fan-out search agents → claims ledger
updates with status + evidence + source. v0.2 minimal: per claim, 1 search
agent + 1 adversarial reviewer; vote-of-3 panels are v0.3. A refutation
without a source or arithmetic does not count (refutations are claims too).

---

## 6. `ser derive` v2 — the herald pipeline

Replaces the v0.1 single frontier call. Planning is itself a gated loop:

```
spec/goal → survey → decompose → infer-gates → extract-claims
          → adversarial-review → compile+validate → readback
```

### 6.1 Stages

1. **survey** — repo facts: `git ls-files`, manifests, detected check
   commands (extends v0.1 `detectCheckCommands`: test/lint/build/typecheck
   runners, coverage tooling, benchmark scripts). Mechanical, no LLM.
2. **decompose** — cheap model proposes nodes (DAG, briefs, radii, budgets)
   from the spec's requirements. Gate: mission schema parses; every
   requirement maps to ≥1 node.
3. **infer-gates** — for each node, SELECT from the gate-pattern library
   (§6.3); free-written shell commands are allowed only when no pattern
   applies and are flagged in the readback. Gate: every node gated; tier-0
   remainder triggers §6.5 routing.
4. **extract-claims** — decompile each plan decision into the falsifiable
   claims it rests on; include one "implicit assumptions" pass (what
   unstated premise would make this plan fail?). Cheap model, structured
   output.
5. **adversarial-review** — per load-bearing claim, cheap refuters; v0.2
   lenses: feasibility-arithmetic and prior-art (one pass each, evidence
   required). Refuted claim → dependent decision blocked → pipeline returns
   structured feedback instead of a plan. (The poker test, §9.3, is this
   stage's falsification.)
6. **compile+validate** — emit mission.yaml; run `ser validate`; zod; DAG;
   budget distribution.
7. **readback** — plan summary: nodes, gates by tier, human-checkpoint count
   and estimated judgment-minutes, budget, claim badges
   ("D2: survived 2/2 lenses"), flagged free-form gates. `proceed? [y/edit/N]`.

Each LLM stage runs on the executor model with the v0.1 ladder behind it;
stage gates are mechanical.

### 6.2 Judge mode

`ser derive --judge <spec>`: run stages 1–6 without writing the mission;
exit 0 iff compilable. This is `ser spec`'s executability gate. Output on
failure: per-requirement diagnosis ("R4 unanchored", "D3's claim C7 refuted:
<evidence>").

### 6.3 Gate-pattern library

Shipped patterns, each parameterized and each born from a measured failure
(AUDIT.md / DOGFOOD.md):

- `tests-pass` (+ diff-guard on test files outside the writer's radius)
- `fail-for-the-right-reason` (tests-first: suite fails AND failure output
  matches the missing-impl signature; fixture crashes rejected)
- `varied-input` (node -e batteries; ≥2 input/output pairs, constants lose)
- `mutation-guard` (new test must kill a planted mutant)
- `completeness-grep` (migrations: zero old-API calls remain)
- `compile-gate` (node --check / tsc over the radius)
- `output-content-smoke` (dist runs AND output matches; exit codes alone
  insufficient — the fg.sync lesson)
- `perf-threshold` (tier 2: benchmark script under wall/metric budget)
- `metric-threshold` (tier 2: FID/LPIPS/etc. behind a command)
- `human-adjudication` (tier 4: artifact + pause + verdict)

### 6.4 Adversarial review contract

Refutations must carry evidence (source URL or shown arithmetic); evidence-
free refutations are discarded. Verdicts, lenses, and evidence land in the
spec's claims ledger and the derive trace. Survival badges propagate to the
readback.

### 6.5 Refusal and routing (no silent fallbacks)

An unanchorable requirement is a compile error with exactly three
remediations, presented to the user:
(a) **anchor** — supply references → tier-2 metric gate;
(b) **proxy** — accept a tier-1 conformance battery (catches defects, not
quality; labeled as such);
(c) **own** — insert a tier-4 human checkpoint (counted against
`max_human_checks`).
A spec that cannot be decomposed at all → structured refusal (v0.1 semantics,
now with the failing requirement named). NEVER emit an ungated node.

---

## 7. `ser do` and mission packs

- `ser do "<goal>" [--gate "<cmd>"] [--radius <glob>]` — a 1-node mission:
  derive infers the gate from the library if not given; full
  checkpoint/reconcile/ladder semantics. The bit-by-bit developer's front
  door; zero YAML.
- **Mission packs** — parameterized mission templates shipped in-repo.
  v0.2 ships one: `repro-then-fix` (phase 3): node 1 writes a failing repro
  test (`fail-for-the-right-reason` gate), node 2 fixes (repro passes + suite
  green + repro diff-guard). Invocation: `ser fix "<bug description>"`.

---

## 8. Out of scope for v0.2 (building these = drift)

TUI/ink renderer · PR-native GitHub App/Action · MCP server · hosted
tier/control plane · triggers/queue/telemetry ingestion (phase 5) ·
leaderboard/referee harness (v0.3 candidate; its engine prerequisite —
external-CLI engines — may land if trivial) · hard tier-3 judge gates ·
vote-of-3 research panels · per-model prompt tuning (BANNED — pillar 3 is
"one prompt, any executor"; a model needing bespoke prompts fails the
gauntlet and we publish that) · account-signup automation · persona features
(vocabulary stays internal).

---

## 9. Success contract — ALL must hold before declaring v0.2 done

v0.1's gates 1–6 (CLAUDE.md) stay green throughout. New gates:

1. **Planner tax** — `ser derive` compiles each benchmark task's goal text
   (tasks 01–20, fixture repos, zero hand-edits) into missions; cheap chain
   runs them. Derived-mission node completion ≥ **90%** of the hand-written
   baseline (baseline = 100%). Measured by `scripts/derive-bench.ts`,
   results archived like any experiment.
2. **Gameability** — the AUDIT.md null-solution attack set, run against
   derived gates: **0** attacks pass. (Attack harness automated; new attacks
   added to the set rather than fixed silently.)
3. **Poker test** — a fixture set of ≥5 plausible-but-infeasible specs (the
   GTO bot included). Derive must refuse or flag the infeasible premise in
   ≥**4/5**, with evidence, at total cost ≤ $1. False-positive check: the 20
   feasible benchmark goals must NOT be refused (≤1 spurious refusal).
4. **Spec dogfood** — `ser spec` produces one real spec end-to-end (candidate:
   the v0.3 leaderboard spec) with ≥10 ledger claims incl. ≥2 refuted-with-
   evidence, all five spec gates exiting 0, and the session resumable across
   process restarts (state-in-artifact proof).
5. **Human gate demo** — a mock mission with a tier-4 node: pauses, records
   a verdict + reason in the trace, rejection drives a rung-2 retry whose
   FAILURE CONTEXT contains the reason. Exit 0 end-to-end.
6. **Cross-executor gauntlet** (in flight) — results recorded in RESULTS.md.
   Pillar-3 phrasing in README must match the measured outcome: keep "any
   model" only if ≥3 executors complete ≥90% with the identical prompt;
   otherwise publish the compatibility bar honestly.
7. All new file formats zod-validated; zero network in tests; no
   OPENROUTER_API_KEY required for gates except 1, 3, 6 (which the human
   runs, like v0.1's real experiment).

## 10. Kill conditions (recorded so we can't narrative past them)

- Planner tax > 25 points after one focused iteration → the goal-native
  product thesis is wrong as specced; stop and rethink the front door
  (hand-written missions + packs remain viable).
- Gauntlet scatter (an executor < 60% on the identical prompt) → pillar 3
  rewritten before any public claim.
- `ser spec` dogfood feels worse than freeform chat + manual spec writing
  (the stenographer outcome) → keep derive-v2 + judge mode, drop the
  conversational layer, revisit shape.

---

## Appendix A — delta-mapper instruction (ser spec, draft, NOT yet verbatim-frozen)

```
You maintain a spec under construction. The spec is the only state; this
conversation is disposable. For each user message, output:
(1) a list of deltas to the spec (add/modify/resolve/remove, by section and
id) in the structured format provided — nothing the user said may change the
spec without appearing as a delta;
(2) at most one question, chosen as the highest-information open question.
Total reply ≤ 120 words outside the delta block. If a delta contradicts the
pinned thesis, mark it drift:true rather than hiding the conflict. Never
restate the spec. Never summarize the conversation.
```

(Verbatim-freeze after the dogfood, like Appendix A/B in SPEC.md.)
