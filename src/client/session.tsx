import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "../shared/types";
import { api } from "./api";

// Lightweight "who am I" context. Users pick one of the seeded demo identities
// (customer / designer / manager); the whole app reacts to the active role.
interface SessionCtx {
  users: User[];
  current: User | null;
  setCurrentId: (id: string) => void;
}
const Ctx = createContext<SessionCtx>({ users: [], current: null, setCurrentId: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [currentId, setCurrentId] = useState<string>(() => localStorage.getItem("idmatch.user") || "u_cust");

  useEffect(() => {
    api.users().then(setUsers).catch(() => setUsers([]));
  }, []);
  useEffect(() => {
    localStorage.setItem("idmatch.user", currentId);
  }, [currentId]);

  const current = users.find((u) => u.id === currentId) ?? null;
  return <Ctx.Provider value={{ users, current, setCurrentId }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
