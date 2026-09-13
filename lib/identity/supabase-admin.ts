import { createClient } from "@supabase/supabase-js";

/** Server-only Supabase client with the secret key (Auth admin API, Storage). Never in the browser. */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}
