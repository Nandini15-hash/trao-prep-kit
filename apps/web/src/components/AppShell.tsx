"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href={user ? "/kits" : "/"} className="font-semibold tracking-tight text-slate-900">
            Interview Prep Kit
          </Link>
          {user ? (
            <nav className="flex items-center gap-4 text-sm">
              <span className="hidden text-slate-500 sm:inline">{user.email}</span>
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  router.push("/login");
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Log out
              </button>
            </nav>
          ) : (
            <nav className="flex items-center gap-3 text-sm">
              <Link href="/login" className="text-slate-700 hover:underline">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-brand px-3 py-1.5 text-brand-foreground hover:bg-brand/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Sign up
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
