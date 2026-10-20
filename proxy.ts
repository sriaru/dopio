import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  if (!isSupabaseConfigured()) return response;
  const { url, key } = supabaseConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });
  // Verify signatures and refresh expired sessions. Authorization is repeated
  // in server pages/actions and enforced again by database policies.
  await supabase.auth.getClaims();
  return response;
}
export const config = {
  matcher: [
    "/",
    "/login",
    "/onboarding",
    "/artists/:path*",
    "/projects/:path*",
    "/test-supabase",
    "/auth/:path*",
    "/gmail/:path*",
    "/calendar/:path*",
    "/gmail-setup",
    "/get-started",
    "/company",
  ],
};
