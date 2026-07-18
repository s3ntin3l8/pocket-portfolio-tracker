"use client";

import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FileStatus } from "./types";

export interface ParsingStepProps {
  fileStatuses: FileStatus[];
}

export function ParsingStep({ fileStatuses }: ParsingStepProps) {
  const t = useTranslations("Import");

  return (
    <Card>
      <CardContent className="py-8">
        {fileStatuses.length > 1 ? (
          <ul className="space-y-2">
            {fileStatuses.map((fs) => (
              <li key={fs.filename} className="flex items-center gap-3 text-sm">
                {fs.status === "parsing" && <Spinner size="sm" className="shrink-0 text-primary" />}
                {fs.status === "done" && <CheckCircle2 className="size-4 shrink-0 text-success" />}
                {fs.status === "failed" && (
                  <AlertCircle className="size-4 shrink-0 text-destructive" />
                )}
                {fs.status === "pending" && (
                  <span className="size-4 shrink-0 rounded-full border border-border" />
                )}
                <span
                  className={cn(
                    "min-w-0 truncate",
                    fs.status === "failed" && "text-muted-foreground line-through",
                    fs.status === "pending" && "text-muted-foreground",
                  )}
                >
                  {fs.filename}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {t(`fileStatus.${fs.status}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" className="text-primary" />
            <p className="text-sm text-muted-foreground">{t("parsing")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
