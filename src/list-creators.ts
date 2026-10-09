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

type CampaignRow = { id: string };
type PageRow = CreatorMatch & { total: number };
type CountRow = { n: number };

// niche_score conta pares (nicho da campanha, nicho do criador), como o laço original.
const MATCHED = `
campaign_niches AS (
  SELECT j.value AS niche FROM campaigns, json_each(campaigns.niches_json) j WHERE campaigns.id = ?
),
matched AS (
  SELECT c.id, c.name, COUNT(*) AS niche_score
  FROM creators c, json_each(c.niches_json) cn
  JOIN campaign_niches ON campaign_niches.niche = cn.value
  GROUP BY c.id
)`;

// latest_reach só é calculado para quem casa com o nicho, com um seek por conta em metrics_latest.
// deliveries_90d não entra na ordenação, então só é contado para a página.
const PAGE_SQL = `
WITH ${MATCHED},
scored AS (
  SELECT m.id, m.name, m.niche_score,
    COALESCE((
      SELECT SUM((
        SELECT views FROM metrics
        WHERE account_id = sa.id
        ORDER BY captured_at DESC, id DESC
        LIMIT 1
      ))
      FROM social_accounts sa
      WHERE sa.creator_id = m.id
    ), 0) AS latest_reach
  FROM matched m
),
page AS (
  SELECT s.*, COUNT(*) OVER () AS total
  FROM scored s
  ORDER BY niche_score DESC, latest_reach DESC, id ASC
  LIMIT ? OFFSET ?
)
SELECT p.id, p.name, p.niche_score, p.latest_reach,
  (SELECT COUNT(*) FROM deliveries d WHERE d.creator_id = p.id AND d.delivered_at >= ?) AS deliveries_90d,
  p.total
FROM page p
ORDER BY p.niche_score DESC, p.latest_reach DESC, p.id ASC`;

const TOTAL_SQL = `WITH ${MATCHED} SELECT COUNT(*) AS n FROM matched`;

export async function listCreators(
  db: DatabaseSync,
  input: { campaignId: string; limit: number; offset: number },
): Promise<CreatorPage | null> {
  const campaign = await get<CampaignRow>(db, "SELECT id FROM campaigns WHERE id = ?", input.campaignId);
  if (!campaign) return null;

  const rows = await all<PageRow>(
    db,
    PAGE_SQL,
    input.campaignId,
    input.limit,
    input.offset,
    deliveriesSince(),
  );

  // Página vazia não traz o COUNT(*) OVER (); só então o total sai de uma query à parte.
  let total = rows[0]?.total ?? 0;
  if (rows.length === 0 && input.offset > 0) {
    const count = await get<CountRow>(db, TOTAL_SQL, input.campaignId);
    total = Number(count?.n ?? 0);
  }

  return {
    campaign_id: input.campaignId,
    total,
    creators: rows.map(({ id, name, niche_score, latest_reach, deliveries_90d }) => ({
      id,
      name,
      niche_score,
      latest_reach,
      deliveries_90d,
    })),
  };
}
