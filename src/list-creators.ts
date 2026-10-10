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
type CountRow = { n: number };

// Pontuação, alcance e entregas são calculados em uma única consulta, só com as
// colunas necessárias (sem raw_payload). O número de queries não depende do
// volume de criadores.
const SCORED_CTE = `
WITH matched AS (
  SELECT c.id, c.name, COUNT(*) AS niche_score
  FROM creators c
  JOIN json_each(c.niches_json) cn
  JOIN campaigns camp ON camp.id = ?
  JOIN json_each(camp.niches_json) kn ON kn.value = cn.value
  GROUP BY c.id
),
last_metric AS (
  SELECT account_id, views FROM (
    SELECT m.account_id, m.views,
           ROW_NUMBER() OVER (
             PARTITION BY m.account_id ORDER BY m.captured_at DESC, m.id DESC
           ) AS rn
    FROM metrics m
    WHERE m.account_id IN (
      SELECT a.id FROM social_accounts a JOIN matched mt ON mt.id = a.creator_id
    )
  ) WHERE rn = 1
),
reach AS (
  SELECT a.creator_id, SUM(lm.views) AS latest_reach
  FROM social_accounts a
  JOIN last_metric lm ON lm.account_id = a.id
  GROUP BY a.creator_id
),
deliveries_90d AS (
  SELECT d.creator_id, COUNT(*) AS n
  FROM deliveries d
  WHERE d.delivered_at >= ?
  GROUP BY d.creator_id
),
scored AS (
  SELECT mt.id, mt.name, mt.niche_score,
         COALESCE(r.latest_reach, 0) AS latest_reach,
         COALESCE(dl.n, 0) AS deliveries_90d
  FROM matched mt
  LEFT JOIN reach r ON r.creator_id = mt.id
  LEFT JOIN deliveries_90d dl ON dl.creator_id = mt.id
)
`;

const PAGE_SQL = `${SCORED_CTE}
SELECT id, name, niche_score, latest_reach, deliveries_90d, (SELECT COUNT(*) FROM scored) AS total
FROM scored
ORDER BY niche_score DESC, latest_reach DESC, id ASC
LIMIT ? OFFSET ?`;

const TOTAL_SQL = `${SCORED_CTE} SELECT COUNT(*) AS n FROM matched`;

type PageRow = CreatorMatch & { total: number };

export async function listCreators(
  db: DatabaseSync,
  input: { campaignId: string; limit: number; offset: number },
): Promise<CreatorPage | null> {
  const campaign = await get<CampaignRow>(db, "SELECT id FROM campaigns WHERE id = ?", input.campaignId);
  if (!campaign) return null;

  const rows = await all<PageRow>(db, PAGE_SQL, input.campaignId, deliveriesSince(), input.limit, input.offset);
  let total = rows[0] ? Number(rows[0].total) : 0;
  if (rows.length === 0 && input.offset > 0) {
    // offset além do fim: a página vem vazia, mas o total continua valendo
    const count = await get<CountRow>(db, TOTAL_SQL, input.campaignId, deliveriesSince());
    total = Number(count?.n ?? 0);
  }

  return {
    campaign_id: input.campaignId,
    total,
    creators: rows.map((row) => ({
      id: row.id,
      name: row.name,
      niche_score: Number(row.niche_score),
      latest_reach: Number(row.latest_reach),
      deliveries_90d: Number(row.deliveries_90d),
    })),
  };
}
