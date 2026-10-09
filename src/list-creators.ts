import type { DatabaseSync } from "node:sqlite";
import { deliveriesSince } from "./clock.ts";
import { all, get } from "./db.ts";

export type CreatorMatch = {
  id: string;
  name: string;
  niche_score: number;
  latest_reach: number;
  deliveries_90d: number;
};

export type CreatorPage = {
  campaign_id: string;
  total: number;
  creators: CreatorMatch[];
};

type CampaignRow = { id: string; niches_json: string; raw_payload?: string };
type CreatorRow = { id: string; name: string; niches_json: string; raw_payload: string };
type ReachRow = { creator_id: string; latest_reach: number };
type DeliveryCountRow = { creator_id: string; n: number };

function compareCreators(left: CreatorMatch, right: CreatorMatch): number {
  if (right.niche_score !== left.niche_score) return right.niche_score - left.niche_score;
  if (right.latest_reach !== left.latest_reach) return right.latest_reach - left.latest_reach;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export async function listCreators(
  db: DatabaseSync,
  input: { campaignId: string; limit: number; offset: number },
): Promise<CreatorPage | null> {
  const campaign = await get<CampaignRow>(db, "SELECT * FROM campaigns WHERE id = ?", input.campaignId);
  if (!campaign) return null;

  const creators = await all<CreatorRow>(db, "SELECT * FROM creators");
  const since = deliveriesSince();

  // Busca em lote o alcance mais recente por criador em 1 única query
  const reachRows = await all<ReachRow>(
    db,
    `
    WITH latest_metrics AS (
      SELECT
        m.account_id,
        m.views,
        ROW_NUMBER() OVER (
          PARTITION BY m.account_id
          ORDER BY m.captured_at DESC, m.id DESC
        ) AS rn
      FROM metrics m
    )
    SELECT
      sa.creator_id,
      SUM(lm.views) AS latest_reach
    FROM social_accounts sa
    JOIN latest_metrics lm
      ON sa.id = lm.account_id AND lm.rn = 1
    GROUP BY sa.creator_id
    `,
  );
  const reachMap = new Map<string, number>();
  for (const row of reachRows) {
    reachMap.set(row.creator_id, Number(row.latest_reach));
  }

  // Busca em lote a contagem de entregas recentes por criador em 1 única query
  const deliveryRows = await all<DeliveryCountRow>(
    db,
    "SELECT creator_id, COUNT(*) AS n FROM deliveries WHERE delivered_at >= ? GROUP BY creator_id",
    since,
  );
  const deliveryMap = new Map<string, number>();
  for (const row of deliveryRows) {
    deliveryMap.set(row.creator_id, Number(row.n));
  }

  const campaignNiches = JSON.parse(campaign.niches_json) as string[];
  const scored: CreatorMatch[] = [];

  for (const creator of creators) {
    const creatorNiches = JSON.parse(creator.niches_json) as string[];
    let nicheScore = 0;
    for (const campaignNiche of campaignNiches) {
      for (const creatorNiche of creatorNiches) {
        if (campaignNiche === creatorNiche) nicheScore += 1;
      }
    }
    if (nicheScore === 0) continue;

    scored.push({
      id: creator.id,
      name: creator.name,
      niche_score: nicheScore,
      latest_reach: reachMap.get(creator.id) ?? 0,
      deliveries_90d: deliveryMap.get(creator.id) ?? 0,
    });
  }

  scored.sort(compareCreators);

  return {
    campaign_id: input.campaignId,
    total: scored.length,
    creators: scored.slice(input.offset, input.offset + input.limit),
  };
}