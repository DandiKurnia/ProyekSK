import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://crflhxkaqqsrywqtfjef.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_yB5BHHd9ZpvZt4HuFr_lsw_bEVTQJg6";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
