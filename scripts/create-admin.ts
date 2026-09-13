import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

/**
 * Creates (or updates) a Mairie user: the Supabase Auth login plus its `app.admin_users` row.
 * Works in production (this is how the first Administrateur is created, docs/DEPLOY-AWS.md).
 *
 *   pnpm admin:create --email admin@lubumbashi.cd --name "Nom Prénom" --role administrateur [--password ...]
 *
 * Without --password a random one is generated and printed once.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { ADMIN_ROLES } = await import("@/lib/identity/roles");
  const { createDb } = await import("@/lib/db/client");
  const { admins } = await import("@/lib/db/schema");
  const email = arg("email")?.trim().toLowerCase();
  const fullName = arg("name")?.trim();
  const role = arg("role")?.trim() as (typeof ADMIN_ROLES)[number] | undefined;
  const password = arg("password") ?? randomBytes(12).toString("base64url");
  if (!email || !fullName || !role || !ADMIN_ROLES.includes(role)) {
    console.error(
      `usage: pnpm admin:create --email <e-mail> --name "<nom>" --role <${ADMIN_ROLES.join("|")}> [--password <mot de passe>]`,
    );
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!url || !secret || !dbUrl) {
    console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL are required");
    process.exit(1);
  }
  const auth = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: list, error: listError } = await auth.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  let user = list.users.find((u) => u.email?.toLowerCase() === email);
  let generated = false;
  if (!user) {
    const { data, error } = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("auth user not created");
    user = data.user;
    generated = !arg("password");
  } else if (arg("password")) {
    const { error } = await auth.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
  }
  const db = createDb(dbUrl);
  try {
    const [existing] = await db.select().from(admins).where(eq(admins.email, email));
    if (existing) {
      await db
        .update(admins)
        .set({
          authUserId: user.id,
          fullName,
          role,
          active: true,
          disabledAt: null,
          updatedAt: new Date(),
        })
        .where(eq(admins.id, existing.id));
      console.log(`admin updated: ${email} (${role})`);
    } else {
      await db.insert(admins).values({ authUserId: user.id, email, fullName, role });
      console.log(`admin created: ${email} (${role})`);
    }
    if (generated) console.log(`temporary password (shown once): ${password}`);
  } finally {
    await db.$client.end();
  }
}

void main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
