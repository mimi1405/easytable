import "dotenv/config";

import { eq, sql } from "drizzle-orm";

import { auth } from "../auth.js";
import { closeDatabase, getDrizzleDatabase, initializeDatabase } from "../db/client.js";
import { users } from "../db/schema.js";

const adminEmail = (process.env.PLATFORM_ADMIN_EMAIL ?? "maksim.momcilovic@icloud.com").trim().toLowerCase();
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? "+Badcompany2";
const adminName = process.env.PLATFORM_ADMIN_NAME ?? "Maksim Momcilovic";

await initializeDatabase();

const db = getDrizzleDatabase();
const existingUser = (await db
  .select()
  .from(users)
  .where(sql`lower(${users.email}) = ${adminEmail}`)
  .limit(1))[0];

if (!existingUser) {
  await auth.api.signUpEmail({
    body: {
      email: adminEmail,
      password: adminPassword,
      name: adminName,
    },
  });
}

const admin = (await db
  .select()
  .from(users)
  .where(sql`lower(${users.email}) = ${adminEmail}`)
  .limit(1))[0];

if (!admin) {
  throw new Error("Platform admin user was not created.");
}

await db
  .update(users)
  .set({
    email: adminEmail,
    name: admin.name || adminName,
    role: "platform_admin",
    status: "ACTIVE",
    emailVerified: true,
    updatedAt: new Date(),
  })
  .where(eq(users.id, admin.id));

console.log(JSON.stringify({
  ok: true,
  email: adminEmail,
  role: "platform_admin",
  status: "ACTIVE",
  created: !existingUser,
}, null, 2));

await closeDatabase();
