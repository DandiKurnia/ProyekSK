import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Klien browser. Supabase SSR menyimpan sesi di cookie httpOnly
// agar bisa dibaca middleware untuk guard route.
export const supabaseBrowser = () => createBrowserClient(url, key);
