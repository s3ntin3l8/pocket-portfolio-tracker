"use client";

import { useState, useEffect, useRef } from "react";
import { useApiClient } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { AdminJob } from "@portfolio/api-client";

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Design: capitalized "Completed"/"Failed" pills, distinct from the generic shadcn
 *  `Badge` (which showed the raw lowercase status in the old table layout). */
function StatusBadge({ status }: { status: AdminJob["lastStatus"] }) {
  const t = useTranslations("Admin");
  if (!status) return <span className="text-xs text-text-3">—</span>;
  const failed = status === "failed";
  return (
    <span
      className={cn(
        "shrink-0 rounded-[8px] px-2.5 py-1 text-[10px] font-bold tracking-wide",
        failed ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
      )}
    >
      {failed ? t("jobStatusFailed") : t("jobStatusCompleted")}
    </span>
  );
}

interface TriggerButtonProps {
  name: string;
  supportsForce?: boolean;
  onTriggered: (priorLastRunAt: string | null, force: boolean) => void;
  currentLastRunAt: string | null;
}

function TriggerButton({ name, supportsForce, onTriggered, currentLastRunAt }: TriggerButtonProps) {
  const t = useTranslations("Admin");
  const api = useApiClient();
  const [pending, setPending] = useState(false);
  const [forcePending, setForcePending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trigger(force: boolean) {
    setError(null);
    if (force) setForcePending(true);
    else setPending(true);
    try {
      await api.triggerAdminJob(name, force ? { force: true } : undefined);
      onTriggered(currentLastRunAt, force);
    } catch {
      setError(t("jobTriggerFailed"));
    } finally {
      if (force) setForcePending(false);
      else setPending(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void trigger(false)}
          disabled={pending || forcePending}
          className="flex items-center gap-1 rounded-[10px] bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60"
        >
          {pending && <Spinner size="sm" />}
          {pending ? t("jobRunning") : t("jobRunNow")}
        </button>
        {supportsForce && (
          <button
            type="button"
            onClick={() => void trigger(true)}
            disabled={pending || forcePending}
            aria-label={t("jobForce")}
            title={t("jobForce")}
            className="flex items-center gap-1 rounded-[10px] border border-border bg-card px-3.5 py-1.5 text-xs font-bold disabled:opacity-60"
          >
            {forcePending && <Spinner size="sm" />}
            {forcePending ? t("jobRunning") : t("jobForce")}
          </button>
        )}
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

interface PendingEntry {
  priorLastRunAt: string | null;
  timedOut?: boolean;
  /** In-flight count on the job's own queue, as of the last poll. */
  inProgress?: number;
  /** For a job that fans out per-portfolio (backfill-stale-history → backfill-portfolio,
   *  see #745): in-flight count on the fan-out queue, as of the last poll. */
  fanOutRemaining?: number;
}

const POLL_INTERVAL_MS = 3_000;
/**
 * Safety-net ceiling, not the expected completion time — a job that reports real
 * inProgress/fanOutRemaining counts keeps polling past this as long as those counts are
 * moving, since it means the harness knows it's still doing something. This only trips
 * for a job that never reports progress at all (older API build) or one that's genuinely
 * wedged. ~2 minutes at the 3s poll interval — long enough that a real force re-run's
 * per-portfolio fan-out (#745) isn't mistaken for stuck.
 */
const MAX_POLLS = 40;

interface AdminJobsProps {
  initialJobs: AdminJob[];
  schedulerAvailable: boolean;
}

/**
 * Design (`Admin Settings.dc.html`, JOBS section): one `rounded-2xl` card-row list —
 * replacing the old desktop `<table>` / mobile-card split — with capitalized status
 * pills and a green "Run now" / white-bordered "Force re-run". The poll-for-completion
 * state machine (queued/timed-out) is unchanged from the old layout, just restyled.
 */
export function AdminJobs({ initialJobs, schedulerAvailable }: AdminJobsProps) {
  const t = useTranslations("Admin");
  const api = useApiClient();
  const [jobs, setJobs] = useState<AdminJob[]>(initialJobs);
  const [pending, setPending] = useState<Record<string, PendingEntry>>({});
  const pollCounts = useRef<Record<string, number>>({});

  const hasPending = Object.values(pending).some((e) => !e.timedOut);

  useEffect(() => {
    if (!hasPending) return;

    const id = setInterval(async () => {
      let fresh: AdminJob[] | null = null;
      try {
        const result = await api.getAdminJobs();
        fresh = result.jobs;
      } catch {
        return;
      }

      setPending((prev) => {
        const next = { ...prev };
        for (const [name, entry] of Object.entries(prev)) {
          if (entry.timedOut) continue;
          const freshJob = fresh?.find((j) => j.name === name);

          if (!freshJob) {
            delete next[name];
            delete pollCounts.current[name];
            continue;
          }

          const inProgress = freshJob.inProgress ?? 0;
          const fanOutRemaining = freshJob.fanOutRemaining ?? 0;
          const remaining = inProgress + fanOutRemaining;
          const finished = remaining === 0 && freshJob.lastRunAt !== entry.priorLastRunAt;

          if (finished) {
            delete next[name];
            delete pollCounts.current[name];
            continue;
          }

          // Reset the timeout counter whenever the backend reports ANY in-flight/fan-out
          // work, not just when that count has strictly decreased since the last poll —
          // a large force re-run's hundreds of portfolios can hold a flat or even
          // temporarily rising `remaining` for many polls in a row while genuinely
          // working (they don't drain one at a time in lockstep with our 3s interval).
          // Requiring a decrease made a real large fan-out false-timeout at MAX_POLLS
          // even though the server was actively reporting progress the whole time. The
          // counter only ever advances when `remaining` is 0 (i.e. the server reports no
          // tracked work at all) — that's the "older API build or genuinely wedged" case
          // MAX_POLLS' own doc comment describes.
          pollCounts.current[name] = remaining > 0 ? 0 : (pollCounts.current[name] ?? 0) + 1;

          next[name] =
            pollCounts.current[name] >= MAX_POLLS
              ? { ...entry, timedOut: true }
              : { ...entry, inProgress, fanOutRemaining };
        }
        return next;
      });

      if (fresh) {
        setJobs((prev) => prev.map((job) => fresh!.find((f) => f.name === job.name) ?? job));
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [hasPending, api]);

  if (!schedulerAvailable) {
    return <p className="text-sm italic text-muted-foreground">{t("schedulerUnavailable")}</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card">
      {jobs.map((job, i) => {
        const entry = pending[job.name];
        const isPending = Boolean(entry) && !entry?.timedOut;
        const timedOut = Boolean(entry?.timedOut);
        return (
          <div
            key={job.name}
            className={i > 0 ? "border-t border-line px-4 py-3.5" : "px-4 py-3.5"}
          >
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{job.label}</div>
                {job.description && (
                  <div className="mt-0.5 text-xs text-muted-foreground">{job.description}</div>
                )}
              </div>
              <StatusBadge status={job.lastStatus} />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <code className="rounded-[7px] bg-background px-2 py-1 font-mono text-[11px] text-text-2">
                {job.cron ?? "on-demand"}
              </code>
              <span className="text-xs text-text-3">·</span>
              <span aria-live="polite">
                {isPending ? (
                  <span className="text-xs font-bold text-primary">
                    {entry?.fanOutRemaining
                      ? t("jobFanOutRemaining", { count: entry.fanOutRemaining })
                      : entry?.inProgress
                        ? t("jobInProgress")
                        : t("jobQueued")}
                  </span>
                ) : timedOut ? (
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {t("jobPollTimedOut")}
                  </span>
                ) : (
                  <span className="text-xs text-text-3">{formatRelative(job.lastRunAt)}</span>
                )}
              </span>
              <span className="flex-1" />
              <TriggerButton
                name={job.name}
                supportsForce={job.supportsForce}
                currentLastRunAt={job.lastRunAt}
                onTriggered={(priorLastRunAt) => {
                  pollCounts.current[job.name] = 0;
                  setPending((prev) => ({
                    ...prev,
                    [job.name]: { priorLastRunAt },
                  }));
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
