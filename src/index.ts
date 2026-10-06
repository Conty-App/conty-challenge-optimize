import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { BENCH_SEED, seed } from "./seed.ts";

const db = openDatabase();
seed(db, BENCH_SEED);
const port = Number(process.env.PORT ?? 3002);

serve({ fetch: createApp(db).fetch, port }, (info) => {
  console.log(`descoberta em http://127.0.0.1:${info.port}`);
});
