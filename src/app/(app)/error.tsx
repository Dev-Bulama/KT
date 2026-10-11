"use client";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const safe = error.name === "AppError" || error.name === "ForbiddenError" || error.name === "NotFoundError";
  return (
    <div className="max-w-xl space-y-4">
      <Alert tone="danger" title="This page could not be displayed">
        {safe ? error.message : "An unexpected error occurred. The problem has been logged."}
        {error.digest && <span className="mt-1 block text-xs">Reference: {error.digest}</span>}
      </Alert>
      <Button variant="secondary" onClick={reset}>Try again</Button>
    </div>
  );
}
