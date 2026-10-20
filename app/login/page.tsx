import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseConfig } from "@/lib/supabase/config";
export const metadata: Metadata = { title: "Sign in or create an account — Dopio" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  let googleEnabled = false;
  if (configured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/");
    try {
      const { url, key } = supabaseConfig();
      const response = await fetch(`${url}/auth/v1/settings`, {
        headers: { apikey: key },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const settings = await response.json();
        googleEnabled = settings.external?.google === true;
      }
    } catch {
      /* Email sign-in stays available if provider discovery fails. */
    }
  }
  return (
    <LoginForm
      configured={configured}
      googleEnabled={googleEnabled}
      expiredLink={params.error === "link"}
    />
  );
}
