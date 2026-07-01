import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.LOCAL_MASTER_DB_PATH ?? resolve(process.cwd(), "data", "local-master.sqlite3")
  }
});
