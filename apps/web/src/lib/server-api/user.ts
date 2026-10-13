import { notFound } from "next/navigation";
import type { User, UserPreferences, ApiToken } from "@portfolio/api-client";
import { classifyFailure, type DataFailure } from "@/lib/data-status";
import { getServerApi, meCached } from "./_shared";

export async function loadPreferences(): Promise<UserPreferences | null> {
  const api = await getServerApi();
  if (!api) return null;
  try {
    return await api.getPreferences();
  } catch {
    return null;
  }
}

export async function loadMe(): Promise<User | null> {
  const api = await getServerApi();
  if (!api) return null;
  try {
    return await meCached();
  } catch {
    return null;
  }
}

export type MeResult = { status: "ok"; me: User } | DataFailure;

/**
 * `loadMe` with the failure kept. Anything that *gates* on the user must use this (or
 * `requireAdmin`), never `loadMe`: a transient 429/5xx collapsed into `null` reads as
 * "not an admin" and would 404 a page that exists.
 */
export async function loadMeResult(): Promise<MeResult> {
  const api = await getServerApi();
  if (!api) return { status: "unauthorized" };
  try {
    const me = await meCached();
    return me ? { status: "ok", me } : { status: "unauthorized" };
  } catch (err) {
    return classifyFailure(err);
  }
}

/**
 * The admin gate. Only a *successful* non-admin answer is "this page does not exist"
 * (`notFound()`); a failed lookup comes back as a `DataFailure` for the caller to render
 * with `<AdminGateFailure>`.
 */
export async function requireAdmin(): Promise<MeResult> {
  const result = await loadMeResult();
  if (result.status === "ok" && !result.me.isAdmin) notFound();
  return result;
}

export async function loadApiTokens(): Promise<ApiToken[]> {
  const api = await getServerApi();
  if (!api) return [];
  try {
    return await api.listApiTokens();
  } catch {
    return [];
  }
}
