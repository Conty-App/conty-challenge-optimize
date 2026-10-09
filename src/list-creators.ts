
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

type CampaignRow = {
  id: string;
  niches_json: string;
};

type CreatorAggregateRow = {
  id: string;
  name: string;
  niches_json: string;
  latest_reach: number;
  deliveries_90d: number;
};

function compareCreators(left: CreatorMatch, right: CreatorMatch): number {
  if (right.niche_score !== left.niche_score) {
    return right.niche_score - left.niche_score;
  }

  if (right.latest_reach !== left.latest_reach) {
    return right.latest_reach - left.latest_reach;
  }

  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;

  return 0;
}

function calculateNicheScore(
  campaignNiches: string[],
  creatorNiches: string[],
): number {
  const creatorNicheSet = new Set(creatorNiches);
  let score = 0;

  for (const niche of campaignNiches) {
    if (creatorNicheSet.has(niche)) {
      score += 1;
    }
  }

  return score;
}

export async function listCreators(
  db: DatabaseSync,
  input: { campaignId: string; limit: number; offset: number },
): Promise<CreatorPage | null> {
  const campaign = await get<CampaignRow>(
    db,
    "SELECT id, niches_json FROM campaigns WHERE id = ?",
    input.campaignId,
  );

  if (!campaign) return null;

  const since = deliveriesSince();

  const rows = await all<CreatorAggregateRow>(
    db,
    `
      WITH latest_metrics AS (
        SELECT
          account_id,
          views,
          ROW_NUMBER() OVER (
            PARTITION BY account_id
            ORDER BY captured_at DESC, id DESC
          ) AS metric_rank
        FROM metrics
      ),
      creator_reach AS (
        SELECT
          accounts.creator_id,
          SUM(metrics.views) AS latest_reach
        FROM social_accounts AS accounts
        INNER JOIN latest_metrics AS metrics
          ON metrics.account_id = accounts.id
         AND metrics.metric_rank = 1
        GROUP BY accounts.creator_id
      ),
      creator_deliveries AS (
        SELECT
          creator_id,
          COUNT(*) AS deliveries_90d
        FROM deliveries
        WHERE delivered_at >= ?
        GROUP BY creator_id
      )
      SELECT
        creators.id,
        creators.name,
        creators.niches_json,
        COALESCE(creator_reach.latest_reach, 0) AS latest_reach,
        COALESCE(creator_deliveries.deliveries_90d, 0) AS deliveries_90d
      FROM creators
      LEFT JOIN creator_reach
        ON creator_reach.creator_id = creators.id
      LEFT JOIN creator_deliveries
        ON creator_deliveries.creator_id = creators.id
    `,
    since,
  );

  const campaignNiches = JSON.parse(campaign.niches_json) as string[];
  const scored: CreatorMatch[] = [];

  for (const creator of rows) {
    const creatorNiches = JSON.parse(creator.niches_json) as string[];
    const nicheScore = calculateNicheScore(campaignNiches, creatorNiches);

    if (nicheScore === 0) continue;

    scored.push({
      id: creator.id,
      name: creator.name,
      niche_score: nicheScore,
      latest_reach: Number(creator.latest_reach),
      deliveries_90d: Number(creator.deliveries_90d),
    });
  }

  scored.sort(compareCreators);

  return {
    campaign_id: input.campaignId,
    total: scored.length,
    creators: scored.slice(input.offset, input.offset + input.limit),
  };
}