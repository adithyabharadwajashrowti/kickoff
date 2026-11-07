import { createClient } from "@supabase/supabase-js";

// The URL and publishable key are public values (they are sent to every
// visitor's browser). Hosting/.env variables override them if set.
// NEVER put the service_role / secret key here.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://yncguibhezkpfjbcnadt.supabase.co";

const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_pMWN5yPVBsGVzRCUOyDtbA_KRZGQnSS";

export const supabase = createClient(supabaseUrl, supabaseKey);
