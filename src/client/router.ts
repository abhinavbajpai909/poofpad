import { PAD_ID_PATTERN } from "../shared/limits";

export type Route =
  { kind: "landing" } | { kind: "privacy" } | { kind: "pad"; padId: string } | { kind: "notFound" };

export function parseRoute(pathname: string): Route {
  if (pathname === "/") {
    return { kind: "landing" };
  }
  if (pathname === "/privacy") {
    return { kind: "privacy" };
  }
  const match = /^\/p\/([^/]+)$/.exec(pathname);
  const padId = match?.[1];
  if (padId !== undefined && PAD_ID_PATTERN.test(padId)) {
    return { kind: "pad", padId };
  }
  return { kind: "notFound" };
}
