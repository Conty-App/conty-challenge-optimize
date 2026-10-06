import { performance } from "node:perf_hooks";
import { listCreators } from "../src/list-creators.ts";
import { getQueryCount, openDatabase, resetQueryCount } from "../src/db.ts";
import { BENCH_SEED, CAMPAIGN_ID, seed } from "../src/seed.ts";

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

const db = openDatabase(":memory:");
const seededAt = performance.now();
seed(db, BENCH_SEED);
console.log(`seed_ms ${Math.round(performance.now() - seededAt)}`);

resetQueryCount();
await listCreators(db, { campaignId: CAMPAIGN_ID, limit: 20, offset: 0 });

const samples: number[] = [];
let queries = 0;
for (let i = 0; i < 5; i += 1) {
  resetQueryCount();
  const started = performance.now();
  await listCreators(db, { campaignId: CAMPAIGN_ID, limit: 20, offset: 0 });
  samples.push(performance.now() - started);
  queries = getQueryCount();
}

console.log(`criadores ${BENCH_SEED.creators}`);
console.log(`queries ${queries}`);
console.log(`p50_ms ${percentile(samples, 0.5).toFixed(1)}`);
console.log(`p95_ms ${percentile(samples, 0.95).toFixed(1)}`);
