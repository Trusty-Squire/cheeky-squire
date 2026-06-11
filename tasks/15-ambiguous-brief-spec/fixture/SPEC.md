# SPEC — roundHalfEven

`roundHalfEven(x)` rounds a number to the nearest integer.

Rounding MUST use round-half-to-even (banker's rounding): when the fractional part is exactly 0.5, round to the nearest EVEN integer.

Examples: 0.5→0, 1.5→2, 2.5→2, 3.5→4, -0.5→0, -1.5→-2. Non-half values round normally (2.4→2, 2.6→3).
