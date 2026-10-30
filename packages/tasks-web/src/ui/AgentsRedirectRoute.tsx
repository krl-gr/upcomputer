import { Navigate, useLocation } from "@tanstack/react-router";

/** `/agents` was the Workers page's path: old links and saved views keep their `?agent=`. */
export function redirectFromAgents(search: Readonly<Record<string, unknown>>) {
  return { to: "/$", params: { _splat: "workers" }, search, replace: true } as const;
}

export default function AgentsRedirectRoute() {
  const search = useLocation({ select: (location) => location.search as Record<string, unknown> });
  return <Navigate {...redirectFromAgents(search)} />;
}
