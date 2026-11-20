import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Trophy = { id: number; description: string };
type Snapshot = {
  at: string;
  players_tracked: number;
  rates: Array<number | null>;
};
type ForecastCase = {
  at: string;
  game: { release_date: string };
  history: Snapshot[];
  trophies: Trophy[];
  horizon_minutes: number;
  target: string;
};
type Observation = {
  hour: number;
  players: number;
  earners: number;
  countMin: number;
  countMax: number;
  rate: number;
};

type Scenario = { rate: number; probability: number };
const levels = [0.05, 0.25, 0.5, 0.75, 0.95];
const normalQuantiles = [-1.645, -0.674, 0, 0.674, 1.645];
// The brief reports the first bulk import's aggregate player counts. The
// answering per-trophy rates are not part of this prior.
const firstImportRatio = 3868 / 638;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const boundRate = (p: number) => clamp(p, 0.0001, 0.9999);
const age = (hour: number) => Math.log(6 + Math.max(0, hour));

function hoursSince(time: string, origin: number): number {
  return (Date.parse(time) - origin) / 3_600_000;
}

function observations(data: ForecastCase, release: number, checkpoint: number): Observation[][] {
  const histories = data.trophies.map((): Observation[] => []);
  for (const snapshot of data.history) {
    const count = snapshot.players_tracked;
    const hour = hoursSince(snapshot.at, release);
    if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(hour) || hour >= checkpoint) continue;
    for (const [index, history] of histories.entries()) {
      const percent = snapshot.rates[index];
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) continue;
      const proportion = percent * 0.01;
      const last = history.at(-1);
      if (last?.players === count && last.rate === proportion) continue;
      const reportedCount = count * proportion;
      const countMin = Math.max(0, Math.ceil(reportedCount - count / 20_000 - 1e-8));
      const countMax = Math.min(count, Math.floor(reportedCount + count / 20_000 + 1e-8));
      history.push({
        hour,
        players: count,
        earners: countMin === countMax ? countMin : reportedCount,
        countMin, countMax,
        rate: proportion,
      });
    }
  }
  return histories;
}

function weightedSlope(times: number[], values: number[], weights: number[]): number {
  const mass = weights.reduce((sum, weight) => sum + weight, 0);
  if (times.length < 2 || !mass) return 0;
  const atMean = times.reduce((sum, time, i) => sum + time * weights[i], 0) / mass;
  const valueMean = values.reduce((sum, value, i) => sum + value * weights[i], 0) / mass;
  let covariance = 0;
  let variance = 0;
  for (const [i, time] of times.entries()) {
    const distance = time - atMean;
    covariance += weights[i] * distance * (values[i] - valueMean);
    variance += weights[i] * distance ** 2;
  }
  return variance > 1e-8 ? covariance / variance : 0;
}

function isEntryTrophy(trophy: Trophy, last: Observation): boolean {
  return last.rate === 1 && /^complete\b/i.test(trophy.description) &&
    !/chapter|final|every|all/i.test(trophy.description);
}

function probabilityQuantiles(scenarios: Scenario[]): number[] {
  const ordered = scenarios.sort((a, b) => a.rate - b.rate);
  const total = ordered.reduce((sum, item) => sum + item.probability, 0);
  return levels.map(level => {
    let remaining = level * total;
    for (const item of ordered) {
      remaining -= item.probability;
      if (remaining <= 1e-12) return item.rate;
    }
    return ordered[ordered.length - 1].rate;
  });
}

function launchPrior(last: Observation, trophy: Trophy, targetHour: number): number[] {
  // Early holders mostly carry through a denominator-heavy import. Preserve
  // integer earners, with asymmetric room for fresh unlocks.
  const elapsed = Math.max(0, targetHour - Math.max(0, last.hour));
  const refresh = clamp(elapsed / 4.2, 0, .995);
  const text = trophy.description;
  const endgame = /attain 100%|^complete chapter [2-9]\b|^complete the final mission\./i.test(text);
  const quick = /chapter 1\b|activity once|fishing challenge|an arcade game/i.test(text);
  const mission = /^complete [a-z].{1,35}\.$/i.test(text) && !/chapter|final|every|all/i.test(text);
  const duration = clamp(elapsed / 4.5, .45, 1.6);
  const arrivalMeans = quick ? [1.6, 5.2] : endgame ? [.16, .8] : mission ? [.65, 4.0] : [.55, 1.8];
  const scenarios: Scenario[] = [{ rate: last.rate, probability: 1 - refresh }];
  const denominatorScenarios = [
    { factor: .92, weight: .10 }, { factor: .97, weight: .20 }, { factor: 1, weight: .40 },
    { factor: 1.03, weight: .20 }, { factor: 1.09, weight: .10 },
  ];
  // Intake may also reconcile the preview population. Include small negative
  // numerator adjustments before modeling unlocks by incoming players.
  const reconciliation = [
    { adjustment: 0, weight: .72 }, { adjustment: -1, weight: .20 }, { adjustment: -2, weight: .08 },
  ];
  const previewCount = Math.round(last.earners);
  for (const [arrival, baseMean] of arrivalMeans.entries()) {
    const mean = baseMean * duration;
    const arrivalWeight = arrival === 0 ? .80 : .20;
    let probability = Math.exp(-mean);
    let remaining = 1;
    for (let added = 0; added <= 18; added++) {
      const share = added === 18 ? remaining : probability;
      for (const denominator of denominatorScenarios) {
        const players = Math.round(last.players * firstImportRatio * denominator.factor);
        for (const correction of reconciliation) {
          const earners = clamp(previewCount + added + correction.adjustment, 0, players);
          const rate = Math.round(10_000 * earners / players) / 10_000;
          const mass = refresh * arrivalWeight * share * denominator.weight * correction.weight;
          scenarios.push({ rate, probability: mass });
        }
      }
      remaining = Math.max(0, remaining - share);
      probability *= mean / (added + 1);
    }
  }
  return probabilityQuantiles(scenarios);
}

function fitTrends(rows: Observation[], lastHour: number, decay: number) {
  const xs = rows.map(row => age(row.hour));
  const weights = rows.map(row => Math.exp((row.hour - lastHour) / decay));
  return {
    players: clamp(weightedSlope(xs, rows.map(row => Math.log(row.players)), weights), 0, 3),
    earners: clamp(weightedSlope(xs, rows.map(row => Math.log(row.earners + 0.5)), weights), 0, 5),
    logits: clamp(weightedSlope(xs, rows.map(row => logit(boundRate(row.rate))), weights), -3, 4),
  };
}

function observedNoise(rows: Observation[], slope: number): number {
  if (rows.length < 3) return 0;
  let squared = 0;
  for (let i = 1; i < rows.length; i++) {
    const before = rows[i - 1];
    const after = rows[i];
    const delta = logit(boundRate(after.rate)) - logit(boundRate(before.rate));
    const fitted = slope * (age(after.hour) - age(before.hour));
    squared += Math.min(0.8, Math.abs(delta - fitted)) ** 2;
  }
  return Math.sqrt(squared / (rows.length - 1));
}

function forecast(series: Observation[], trophy: Trophy, targetHour: number, horizon: number): number[] {
  const last = series.at(-1);
  if (!last) return [0.0001, 0.0003, 0.001, 0.003, 0.01];
  if (isEntryTrophy(trophy, last)) return [0.9999, 0.9999, 1, 1, 1];
  if (series.length === 1 && last.hour < 8 && horizon <= 8) {
    return launchPrior(last, trophy, targetHour);
  }

  const candidate = series.filter(row => row.hour >= 3 && row.hour >= last.hour - 48);
  const fit = candidate.length >= 3 ? candidate : series;
  const recent = fit.filter(row => row.hour >= last.hour - 20);
  const long = fitTrends(fit, last.hour, 24);
  const short = fitTrends(recent, last.hour, 11);
  const span = last.hour - fit[0].hour;
  const recentSpan = last.hour - (recent[0]?.hour ?? last.hour);
  const recentWeight = 0.55 * clamp(recentSpan / 12, 0, 1) * clamp((recent.length - 2) / 3, 0, 1);
  const blend = (a: number, b: number) => a + recentWeight * (b - a);
  const support = clamp(span / 18, 0, 1) * clamp((fit.length - 1) / 3, 0, 1);
  const growth = Math.max(0, age(targetHour) - age(last.hour));
  // Dampen the short observation window before extrapolating several days.
  const effectiveGrowth = support * Math.log1p(0.55 * growth) / 0.55;
  const relativeTrend = blend(long.earners, short.earners) - blend(long.players, short.players);
  const playerGrowth = blend(long.players, short.players) * effectiveGrowth;
  const modeledPlayers = last.players * Math.exp(playerGrowth);
  const countEstimate = logit(boundRate(last.rate * Math.exp(relativeTrend * effectiveGrowth)));
  const observed = logit(boundRate(last.rate));
  const rateSlope = blend(long.logits, short.logits);
  const rateEstimate = observed + rateSlope * effectiveGrowth;
  const rareWeight = last.rate < 0.05 ? 0.55 : 0.25;
  const center = rareWeight * countEstimate + (1 - rareWeight) * rateEstimate;
  const trendChange = recentWeight * Math.abs(long.logits - short.logits);
  const noise = observedNoise(recent.length >= 4 ? recent : fit, rateSlope);
  const extrapolation = growth * (0.23 + 0.41 * (1 - support) + 0.20 * trendChange);
  const disagreement = 0.18 * Math.abs(countEstimate - rateEstimate);
  const countUncertainty = 0.16 / Math.sqrt(last.earners + 0.5);
  const spread = clamp(Math.hypot(0.09 + extrapolation, 1.25 * noise, disagreement, countUncertainty), 0.09, 2);
  const trend = normalQuantiles.map(z => boundRate(logistic(center + z * spread)));
  const tail = fit.slice(-4);
  const lowerCount = Math.max(...tail.map(row => row.countMin));
  const upperCount = Math.min(...tail.map(row => row.countMax));
  if (last.rate < .015 && tail.length >= 3 && lowerCount <= upperCount && modeledPlayers > last.players) {
    const stableCount = clamp(Math.round(last.earners), lowerCount, upperCount);
    const unchanged = Math.round(10_000 * stableCount / modeledPlayers) / 10_000;
    const plateauWeight = clamp((last.hour - tail[0].hour) / (18 + horizon / 5), .20, .58);
    const weights = [.10, .20, .40, .20, .10];
    const scenarios = trend.map((rate, index) => ({ rate, probability: (1 - plateauWeight) * weights[index] }));
    scenarios.push({ rate: unchanged, probability: plateauWeight });
    const quantiles = probabilityQuantiles(scenarios);
    // A plausible plateau can shift the center; long-horizon breakthrough or
    // player-growth risk still warrants the original extrapolation tails.
    quantiles[0] = Math.min(quantiles[0], trend[0]);
    quantiles[4] = Math.max(quantiles[4], trend[4]);
    return quantiles;
  }
  return trend;
}

function run(data: ForecastCase) {
  const launchTime = Date.parse(data.game.release_date);
  const hoursAhead = data.horizon_minutes / 60;
  const targetAge = hoursSince(data.target, launchTime);
  const reportedCheckpoint = hoursSince(data.at, launchTime);
  const checkpoint = Number.isFinite(reportedCheckpoint) ? reportedCheckpoint : targetAge - hoursAhead;
  const histories = observations(data, launchTime, checkpoint);
  return {
    trophies: data.trophies.map((trophy, index) => ({
      id: trophy.id,
      q: forecast(histories[index], trophy, targetAge, hoursAhead)
        .map(proportion => Math.round(proportion * 10_000_000) / 100_000),
    })),
  };
}

const input = process.env.MAKEFUN_INPUT_DIR || '/input';
const output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
mkdirSync(output, { recursive: true });
for (const file of readdirSync(input).filter(name => name.endsWith('.in')).sort()) {
  const data: ForecastCase = JSON.parse(readFileSync(join(input, file), 'utf8'));
  writeFileSync(join(output, file.slice(0, -3) + '.out'), JSON.stringify(run(data)) + '\n');
}
