"use client";

import { createClient } from "@supabase/supabase-js";

export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url: url ?? null, anonKey: anonKey ?? null, missing };
}

export function supabaseBrowser() {
  const cfg = getSupabasePublicConfig();
  if (cfg.missing.length || !cfg.url || !cfg.anonKey) return null;
  return createClient(cfg.url, cfg.anonKey);
}
