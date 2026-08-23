"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthConfig, getCurrentUser, type AuthUser } from "@/lib/api";

const AuthUserContext = createContext<AuthUser | null>(null);

export function useAuthUser(): AuthUser | null {
  return useContext(AuthUserContext);
}

/**
 * No-ops entirely (renders children immediately, no fetch delay) once
 * /auth/config reports sso_enabled: false -- which is the case until real
 * Microsoft Entra ID credentials are configured on the backend. Once
 * enabled, this is what actually enforces the login wall on the frontend
 * (the backend's own session middleware is the real boundary; this just
 * keeps the UI from flashing protected pages before redirecting).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await getAuthConfig();
        if (!config.sso_enabled) {
          if (!cancelled) setReady(true);
          return;
        }
        try {
          const me = await getCurrentUser();
          if (!cancelled) {
            setUser(me);
            setReady(true);
          }
        } catch {
          if (!cancelled) router.replace("/login");
        }
      } catch {
        // Couldn't even reach /auth/config -- fail open rather than lock
        // everyone out over a transient network blip.
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="h-[100dvh] w-full flex items-center justify-center bg-white dark:bg-gray-950">
        <div className="w-8 h-8 rounded-full border-2 border-jman-midnight/20 border-t-jman-midnight animate-spin" />
      </div>
    );
  }

  return <AuthUserContext.Provider value={user}>{children}</AuthUserContext.Provider>;
}
