import "server-only";
import { cache } from "react";
import { loadIncomeStats } from "@/lib/server-api";

/**
 * Request-scoped (React `cache`) income analytics. The Income page gates on this payload
 * (error / empty states replace the whole page) and every streamed section reads the same
 * in-flight call, so splitting the page into sections costs no extra requests.
 */
export const incomeStatsOnce = cache(() => loadIncomeStats());
