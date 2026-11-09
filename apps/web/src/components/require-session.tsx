"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { readSession, type Session } from "../lib/session";

const SessionContext = createContext<Session | null>(null);

export function useAdminSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("لا توجد جلسة إدارة.");
  }
  return session;
}

export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const current = readSession();
    if (!current) {
      router.replace("/login");
      return;
    }
    setSession(current);
  }, [router]);

  if (!session) {
    return <p className="p-6 text-muted">جارٍ التحقق من الجلسة.</p>;
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
