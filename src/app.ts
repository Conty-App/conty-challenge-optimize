import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { listCreators } from "./list-creators.ts";

function pageNumber(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(parsed)));
}

export function createApp(db: DatabaseSync) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/campaigns/:id/creators", async (c) => {
    const limit = pageNumber(c.req.query("limit"), 20, 50);
    const offset = pageNumber(c.req.query("offset"), 0, Number.MAX_SAFE_INTEGER);
    const safeLimit = limit === 0 ? 20 : limit;
    const page = await listCreators(db, {
      campaignId: c.req.param("id"),
      limit: safeLimit,
      offset,
    });
    if (!page) return c.json({ error: "campanha não encontrada" }, 404);
    return c.json(page);
  });

  return app;
}
