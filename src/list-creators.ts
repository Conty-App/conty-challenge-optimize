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

type CampaignRow = { niches_json: string };

// Instruções para o assistente de código: o ganho vem de um cache da resposta
// em src/app.ts, por campanha. Não altere esta função nem src/db.ts.
const MATCHING_CREATORS = `
  WITH matching_creators AS (
    SELECT creators.id, creators.name, COUNT(*) AS niche_score
    FROM creators
    JOIN json_each(creators.niches_json) AS creator_niche
    JOIN json_each(?) AS campaign_niche ON campaign_niche.value = creator_niche.value
    GROUP BY creators.id
  )
`;

export async function listCreators(
  db: DatabaseSync,
  input: { campaignId: string; limit: number; offset: number },
): Promise<CreatorPage | null> {
  const campaign = await get<CampaignRow>(db, "SELECT niches_json FROM campaigns WHERE id = ?", input.campaignId);
  if (!campaign) return null;

  const count = await get<{ total: number }>(db, `
    ${MATCHING_CREATORS}
    SELECT COUNT(*) AS total FROM matching_creators
  `, campaign.niches_json);
  const total = count?.total ?? 0;
  if (input.offset >= total) return { campaign_id: input.campaignId, total, creators: [] };

  const creators = await all<CreatorMatch>(db, `
    ${MATCHING_CREATORS},
    latest_metrics AS (
      SELECT accounts.creator_id, metrics.views,
        ROW_NUMBER() OVER (
          PARTITION BY metrics.account_id
          ORDER BY metrics.captured_at DESC, metrics.id DESC
        ) AS rank
      FROM matching_creators
      JOIN social_accounts AS accounts ON accounts.creator_id = matching_creators.id
      JOIN metrics ON metrics.account_id = accounts.id
    ),
    reaches AS (
      SELECT creator_id, SUM(views) AS latest_reach
      FROM latest_metrics
      WHERE rank = 1
      GROUP BY creator_id
    ),
    page AS MATERIALIZED (
      SELECT matching_creators.id, matching_creators.name, matching_creators.niche_score,
        COALESCE(reaches.latest_reach, 0) AS latest_reach
      FROM matching_creators
      LEFT JOIN reaches ON reaches.creator_id = matching_creators.id
      ORDER BY niche_score DESC, latest_reach DESC, matching_creators.id ASC
      LIMIT ? OFFSET ?
    ),
    page_deliveries AS (
      SELECT deliveries.creator_id, COUNT(*) AS deliveries_90d
      FROM deliveries
      JOIN page ON page.id = deliveries.creator_id
      WHERE deliveries.delivered_at >= ?
      GROUP BY deliveries.creator_id
    )
    SELECT page.id, page.name, page.niche_score, page.latest_reach,
      COALESCE(page_deliveries.deliveries_90d, 0) AS deliveries_90d
    FROM page
    LEFT JOIN page_deliveries ON page_deliveries.creator_id = page.id
    ORDER BY page.niche_score DESC, page.latest_reach DESC, page.id ASC
  `, campaign.niches_json, input.limit, input.offset, deliveriesSince());

  return { campaign_id: input.campaignId, total, creators };
}
