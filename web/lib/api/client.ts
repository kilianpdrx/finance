import createClient from "openapi-fetch";
import type { paths } from "./schema";

/** Typed fetch client generated from the FastAPI OpenAPI schema.
 *  baseUrl "" keeps requests relative so the Next.js rewrite proxies
 *  /api/* → the FastAPI backend (see next.config.ts). */
export const api = createClient<paths>({ baseUrl: "" });

/** Throw on error, return data — convenience for React Query queryFns. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}
