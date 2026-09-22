"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

/** Wraps a protected page. While the initial /auth/me check is in
 *  flight, shows a loading state rather than flashing the page's real
 *  content or a premature redirect (Section 12: "clear loading, empty
 *  and error states"). Once resolved, a signed-out visitor is bounced to
 *  /login rather than shown a 401 from every subsequent request. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-slate-500" role="status" aria-live="polite">
        Loading...
      </div>
    );
  }

  if (!user) {
    // Redirect is already underway via the effect above; render nothing
    // rather than a flash of protected content.
    return null;
  }

  return <>{children}</>;
}
