import { createContext, useContext, type ReactNode } from "react";
import type { HostClient } from "./hostClient.js";

const HostClientContext = createContext<HostClient | null>(null);

export function HostClientProvider({
  client,
  children,
}: {
  client: HostClient;
  children: ReactNode;
}) {
  return <HostClientContext.Provider value={client}>{children}</HostClientContext.Provider>;
}

export function useHostClient(): HostClient {
  const client = useContext(HostClientContext);
  if (!client) throw new Error("Squad Pod host client is not available.");
  return client;
}
