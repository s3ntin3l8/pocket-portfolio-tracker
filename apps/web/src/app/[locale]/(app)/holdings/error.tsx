"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-2">Couldn&apos;t load this page</h2>
      <p className="text-muted-foreground mb-4">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </Card>
  );
}
