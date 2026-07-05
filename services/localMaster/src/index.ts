import "dotenv/config";

import { startRelayCommandPolling, stopRelayCommandPolling } from "./relayCommandWorker.js";
import { buildServer } from "./server.js";

const port = Number(process.env.LOCAL_MASTER_PORT ?? process.env.LOCAL_REALTIME_PORT ?? 3000);
const host = process.env.LOCAL_MASTER_HOST ?? process.env.LOCAL_REALTIME_HOST ?? "0.0.0.0";

const app = await buildServer();

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, "Shutting down localMaster");
  stopRelayCommandPolling();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ port, host });
  startRelayCommandPolling();
} catch (error) {
  app.log.error({ error }, "Failed to start localMaster");
  process.exit(1);
}

