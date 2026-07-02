import { WifiOff } from "lucide-react";

import { Button } from "@easytable/ui/components/button";

type ErrorBannerProps = {
  message: string;
  onRetry: () => void;
};

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-destructive sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <WifiOff className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">RelaySyncApi nicht erreichbar</p>
          <p className="break-words text-sm opacity-80">{message}</p>
        </div>
      </div>
      <Button onClick={onRetry} type="button" variant="outline">
        Erneut laden
      </Button>
    </div>
  );
}
