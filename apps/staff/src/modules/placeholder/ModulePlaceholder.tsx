import { ChefHat, Users } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";

import type { StaffModule } from "../../layout/navigation";

export function ModulePlaceholder({ module }: { module: Exclude<StaffModule, "owner"> }) {
  const isKds = module === "kds";
  const Icon = isKds ? ChefHat : Users;
  const title = isKds ? "KDS" : "Staff";
  const badge = isKds ? "Stationen" : "Service";

  return (
    <div className="mx-auto grid min-h-[calc(100svh-7rem)] max-w-4xl place-items-center">
      <section className="w-full rounded-md border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-md bg-muted">
            <Icon className="size-5" />
          </div>
          <div>
            <Badge variant="outline">{badge}</Badge>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal">{title}</h2>
          </div>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">Noch nicht angebunden.</p>
      </section>
    </div>
  );
}
