#!/usr/bin/env bash
# mutation-guard.sh <module> <mutant> <testcmd>
# Exit 0 iff <testcmd> passes against the real <module> AND fails when <mutant>
# is swapped in. Proves the new test actually exercises the behavior (defeats
# vacuous/no-op tests). The module is restored before exit.
set -u
module="$1"; mutant="$2"; testcmd="$3"
if ! eval "$testcmd" >/dev/null 2>&1; then echo "guard: test failed against the REAL module"; exit 1; fi
cp "$module" "$module.realbak"
cp "$mutant" "$module"
eval "$testcmd" >/dev/null 2>&1; rc=$?
cp "$module.realbak" "$module"; rm -f "$module.realbak"
if [ "$rc" -eq 0 ]; then echo "guard: test PASSED against the MUTANT — test is too weak to catch the bug"; exit 1; fi
exit 0
