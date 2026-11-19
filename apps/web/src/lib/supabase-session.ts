import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Klien sesi staf di Route Handler / Server Component: membaca cookie
// Supabase yang diterbitkan browser client, memakai anon/publishable key.
export async function supabaseSession() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Dipanggil dari Server Component (cookie read-only) — abaikan.
          }
        },
      },
    }
  );
}
