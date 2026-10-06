import type { DatabaseSync } from "node:sqlite";
import { AS_OF } from "./clock.ts";

export const CAMPAIGN_ID = "cmp_01";
export const FIXTURE_SEED = { creators: 80, seed: 7 } as const;
export const BENCH_SEED = { creators: 2000, seed: 7 } as const;

const NICHES = ["beleza", "tech", "comida", "games", "moda", "fitness"];

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickUnique(source: string[], count: number, rand: Rng): string[] {
  const pool = [...source];
  const picked: string[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(rand() * pool.length);
    const [item] = pool.splice(index, 1);
    if (item) picked.push(item);
  }
  return picked;
}

export function seed(db: DatabaseSync, options: { creators: number; seed: number }): void {
  const rand = mulberry32(options.seed);
  const payload = "x".repeat(1500);
  const insertCampaign = db.prepare("INSERT INTO campaigns (id, name, niches_json) VALUES (?, ?, ?)");
  const insertCreator = db.prepare(
    "INSERT INTO creators (id, name, niches_json, raw_payload) VALUES (?, ?, ?, ?)",
  );
  const insertAccount = db.prepare(
    "INSERT INTO social_accounts (id, creator_id, platform) VALUES (?, ?, ?)",
  );
  const insertMetric = db.prepare(
    "INSERT INTO metrics (id, account_id, views, captured_at, raw_payload) VALUES (?, ?, ?, ?, ?)",
  );
  const insertDelivery = db.prepare(
    "INSERT INTO deliveries (id, creator_id, delivered_at) VALUES (?, ?, ?)",
  );
  const asOf = Date.parse(AS_OF);

  db.exec("BEGIN");
  insertCampaign.run(CAMPAIGN_ID, "Verao beleza", JSON.stringify(["beleza", "moda"]));

  for (let i = 0; i < options.creators; i += 1) {
    const id = `crt_${String(i + 1).padStart(4, "0")}`;
    const nicheCount = 1 + Math.floor(rand() * 3);
    insertCreator.run(id, `Criador ${i + 1}`, JSON.stringify(pickUnique(NICHES, nicheCount, rand)), payload);

    const accountCount = 1 + Math.floor(rand() * 2);
    for (let accountIndex = 0; accountIndex < accountCount; accountIndex += 1) {
      const accountId = `acc_${id}_${accountIndex}`;
      insertAccount.run(accountId, id, accountIndex === 0 ? "instagram" : "tiktok");
      const metricCount = 1 + Math.floor(rand() * 3);
      for (let metricIndex = 0; metricIndex < metricCount; metricIndex += 1) {
        const capturedAt = new Date(asOf - (metricIndex + 1) * 86_400_000 - i * 1000).toISOString();
        insertMetric.run(
          `met_${accountId}_${metricIndex}`,
          accountId,
          Math.floor(rand() * 100_000),
          capturedAt,
          payload,
        );
      }
    }

    const deliveryCount = Math.floor(rand() * 4);
    for (let deliveryIndex = 0; deliveryIndex < deliveryCount; deliveryIndex += 1) {
      const daysAgo = Math.floor(rand() * 120);
      const deliveredAt = new Date(asOf - daysAgo * 86_400_000).toISOString();
      insertDelivery.run(`del_${id}_${deliveryIndex}`, id, deliveredAt);
    }
  }

  db.exec("COMMIT");
}
