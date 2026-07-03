import { MinusIcon, ReceiptTextIcon, Trash2Icon } from "lucide-react";
import { Button } from "@easytable/ui/components/button";
import { Card, CardContent } from "@easytable/ui/components/card";
import { cn } from "@easytable/ui/lib/utils";

import { formatChf } from "../../lib/money";
import type { BasketLine } from "../../lib/pos-types";

type BasketPanelProps = {
  lines: BasketLine[];
  total: number;
  isSubmitting: boolean;
  bookLabel: string;
  payLabel: string;
  showBookAction?: boolean;
  onDecreaseLine: (lineId: string) => void;
  onRemoveLine: (lineId: string) => void;
  onCreateOrder: () => void;
  onStartPayment: () => void;
};

export function BasketPanel({
  lines,
  total,
  isSubmitting,
  bookLabel,
  payLabel,
  showBookAction = true,
  onDecreaseLine,
  onRemoveLine,
  onCreateOrder,
  onStartPayment,
}: BasketPanelProps) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ReceiptTextIcon className="mb-4 size-14 text-slate-300" />
            <p className="text-base font-black text-slate-400">
              Warenkorb leer
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {lines.map((line) => (
              <Card
                key={line.id}
                className="rounded-md bg-slate-50 py-0 ring-slate-200"
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">
                        {line.quantity}x {line.product_name}
                      </p>
                      {line.variants.length > 0 ? (
                        <p className="mt-1 truncate text-xs font-bold text-slate-500">
                          {line.variants
                            .map((variant) => variant.variant_item_name)
                            .join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-sm font-black text-slate-950">
                      {formatChf(line.line_total)}
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      className="h-10 rounded-md bg-white text-xs font-black uppercase text-slate-600 transition active:scale-[0.98]"
                      onClick={() => onDecreaseLine(line.id)}
                    >
                      <MinusIcon className="size-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      className="h-10 rounded-md border border-red-100 bg-red-50 text-xs font-black uppercase text-red-700 transition active:scale-[0.98] hover:bg-red-100"
                      onClick={() => onRemoveLine(line.id)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      <div className="flex h-12 shrink-0 items-center justify-between border-t border-slate-200 px-4 text-sm font-black">
        <span>Total</span>
        <span>{formatChf(total)}</span>
      </div>
      <div className={cn("grid h-18 shrink-0 border-t border-slate-200", showBookAction ? "grid-cols-2" : "grid-cols-1")}>
        {showBookAction ? (
          <Button
            className={cn(
              "h-full rounded-none bg-amber-300 text-base font-black uppercase text-amber-900 transition hover:bg-amber-300 active:bg-amber-400",
              "disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400",
            )}
            disabled={lines.length === 0 || isSubmitting}
            onClick={onCreateOrder}
          >
            {isSubmitting ? "Speichern..." : bookLabel}
          </Button>
        ) : null}
        <Button
          className={cn(
            "h-full rounded-none bg-emerald-300 text-base font-black uppercase text-emerald-900 transition hover:bg-emerald-300 active:bg-emerald-400",
            "disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400",
          )}
          disabled={lines.length === 0 || isSubmitting}
          onClick={onStartPayment}
        >
          {payLabel}
        </Button>
      </div>
    </aside>
  );
}
