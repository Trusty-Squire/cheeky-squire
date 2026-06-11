# demo-fixture

A throwaway micro-project used by `squire run examples/demo.yaml --mock`.
The harness copies this directory into a temp git repo and drives three
mock nodes that build `src/config.json`, `src/sum.js`, and `src/report.txt`.

The `checks/` scripts are the objective gates and live OUTSIDE the nodes'
blast_radius (`src/**`), so a node cannot edit its own gate.
