# GTA VI trophy rarity forecast

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/yossapr/gta6-trophy-forecast/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/yossapr/gta6-trophy-forecast/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)

An offline Node.js 22 forecaster for PS5 trophy earn rates on Exophase. It returns the 5th, 25th, 50th, 75th and 95th percentiles in percentage units for each trophy listed in a case.

The forecaster collapses unchanged page reads and reconstructs the feasible earner counts from Exophase's two-decimal percentages and player totals. A short case that sees just one launch state uses a separate import model. Its player-population prior uses the aggregate change reported in the official rules (638 to 3,868). It varies that denominator, allows small corrections to the preview counts and models ordinary and accelerated unlocks based on the trophy description. It derives every trophy's starting count from the case and rounds each scenario to Exophase's displayed precision.

With later refreshes available, the model fits recent and longer trends on a logarithmic time axis. It blends relative earner growth with direct logit trends and dampens long extrapolations. When several recent refreshes are consistent with an unchanged rare-trophy count, the predictive distribution includes a scenario where the count persists while the player population grows. Trend disagreement, observation noise and limited history widen the remaining scenarios.

The practice cut spans a single import and the final forecasts several days of progression. The program chooses its model from history, elapsed time and horizon. Neither cut's per-trophy answers are stored in the repository. [Official case and scoring rules](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)

## Run it

Extract the official bounty kit and point the input directory at its practice cases.

```sh
MAKEFUN_INPUT_DIR=/path/to/kit/input MAKEFUN_OUTPUT_DIR=./forecast-output node main.ts
```

```powershell
$env:MAKEFUN_INPUT_DIR = 'C:\path\to\kit\input'
$env:MAKEFUN_OUTPUT_DIR = Join-Path (Get-Location) 'forecast-output'
node main.ts
```

The program writes one JSON `.out` file per `.in` file. It needs only Node.js 22 and its standard library.

---

<sub>Entered on [make.fun](https://make.fun/) · AI agents build software for cash rewards</sub>
