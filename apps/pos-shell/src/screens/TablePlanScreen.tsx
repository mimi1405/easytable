import { DoorOpenIcon, EllipsisIcon, ReceiptTextIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Card, CardContent } from "@easytable/ui/components/card";
import { cn } from "@easytable/ui/lib/utils";

import type { PosScreen } from "../App";
import {
  loadTableLayout,
  subscribeLocalMasterEvents,
} from "../lib/local-master-client";
import { formatChf } from "../lib/money";
import type {
  TableContext,
  TableLayout,
  TableLayoutArea,
  TableLayoutFloor,
  TableLayoutTable,
} from "../lib/pos-types";

type TablePlanScreenProps = {
  onNavigate: (screen: PosScreen) => void;
  onSelectTable: (context: TableContext) => void;
};

const navItems = [
  { label: "Kasse", icon: ReceiptTextIcon, screen: "tables", active: true },
  { label: "Mehr", icon: EllipsisIcon, screen: "more", active: false },
  { label: "Abmelden", icon: DoorOpenIcon, screen: "logout", active: false },
] as const satisfies readonly {
  label: string;
  icon: typeof ReceiptTextIcon;
  screen: PosScreen;
  active: boolean;
}[];

const tablePlanReloadEvents = new Set(["ORDER_CREATED", "TABLE_UPDATED"]);

export function TablePlanScreen({
  onNavigate,
  onSelectTable,
}: TablePlanScreenProps) {
  const [layout, setLayout] = useState<TableLayout | null>(null);
  const [activeFloorId, setActiveFloorId] = useState("");
  const [activeAreaId, setActiveAreaId] = useState("");
  const [isLoadingLayout, setIsLoadingLayout] = useState(true);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);

  const loadLayout = useCallback(async (showLoadingState = true) => {
    if (showLoadingState) {
      setIsLoadingLayout(true);
    }

    setLayoutNotice(null);

    try {
      const tableLayout = await loadTableLayout();
      const firstFloor = tableLayout.floors[0];
      const firstArea = firstFloor?.areas[0];

      setLayout(tableLayout);
      setActiveFloorId((currentFloorId) => {
        if (tableLayout.floors.some((floor) => floor.id === currentFloorId)) {
          return currentFloorId;
        }

        return firstFloor?.id ?? "";
      });
      setActiveAreaId((currentAreaId) => {
        const areas = tableLayout.floors.flatMap((floor) => floor.areas);

        if (areas.some((area) => area.id === currentAreaId)) {
          return currentAreaId;
        }

        return firstArea?.id ?? "";
      });
    } catch (error) {
      console.warn("Could not load table layout from Local Master.", error);
      setLayout(null);
      setActiveFloorId("");
      setActiveAreaId("");
      setLayoutNotice("Tischplan konnte nicht geladen werden.");
    } finally {
      if (showLoadingState) {
        setIsLoadingLayout(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadLayout();
  }, [loadLayout]);

  useEffect(() => {
    return subscribeLocalMasterEvents((event) => {
      if (tablePlanReloadEvents.has(event.type)) {
        void loadLayout(false);
      }
    });
  }, [loadLayout]);

  const activeFloor = useMemo<TableLayoutFloor | undefined>(
    () => layout?.floors.find((floor) => floor.id === activeFloorId),
    [activeFloorId, layout],
  );
  const activeArea = useMemo<TableLayoutArea | undefined>(
    () => activeFloor?.areas.find((area) => area.id === activeAreaId),
    [activeAreaId, activeFloor],
  );

  function handleFloorSelect(floor: TableLayoutFloor) {
    setActiveFloorId(floor.id);
    setActiveAreaId(floor.areas[0]?.id ?? "");
  }

  function handleTableSelect(table: TableLayoutTable) {
    if (!activeFloor || !activeArea) {
      return;
    }

    if (!layout) {
      return;
    }

    onSelectTable({
      tenant_id: layout.tenant.id,
      location_id: layout.location.id,
      floor_id: activeFloor.id,
      area_id: activeArea.id,
      table_id: table.id,
      table_name: table.name,
      area_name: activeArea.name,
      floor_name: activeFloor.name,
      seats: table.seats,
    });
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-[#f7f8fc] text-slate-950">
      {layout?.floors.length === 1 ? (
          <></>
        ) : (
          <section className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-300 px-5">
            {layout?.floors.map((floor) => (
              <Button
                key={floor.id}
                variant={floor.id === activeFloorId ? "default" : "secondary"}
                className={cn(
                  "h-10 shrink-0 rounded-[2rem] px-4 text-sm font-extrabold uppercase tracking-normal transition active:scale-[0.98]",
                  floor.id === activeFloorId
                    ? "bg-slate-950 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-950"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                )}
                onClick={() => handleFloorSelect(floor)}
              >
                {floor.name}
              </Button>
            ))}
          </section>
        )}

      <section className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-300 px-5">
        {activeFloor?.areas.map((area) => (
          <Button
            key={area.id}
            variant={area.id === activeAreaId ? "default" : "secondary"}
            className={cn(
              "h-10 shrink-0 rounded-[2rem] px-4 text-sm font-extrabold uppercase tracking-normal transition active:scale-[0.98]",
              area.id === activeAreaId
                ? "bg-slate-950 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-950"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200",
            )}
            onClick={() => setActiveAreaId(area.id)}
          >
            {area.name}
          </Button>
        ))}
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-9 py-9">
        {activeArea?.tables.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-7">
            {activeArea.tables.map((table) => {
              const hasOpenOrder = table.open_order_count > 0;

              return (
                <Button
                  key={table.id}
                  variant="ghost"
                  className="h-auto rounded-md p-0 text-slate-950 transition active:scale-[0.985]"
                  onClick={() => handleTableSelect(table)}
                >
                  <Card
                    className={cn(
                      "aspect-[1.05] min-h-36 w-full rounded-md bg-white py-0 shadow-xl border border-slate-300 transition group-hover/button:bg-white",
                      hasOpenOrder ? "ring-emerald-300" : "ring-slate-100",
                    )}
                  >
                    <CardContent className="flex h-full flex-col items-center justify-center p-4 text-center">
                      <span className="text-4xl font-black text-slate-950">
                        {table.name}
                      </span>
                      {hasOpenOrder ? (
                        <Badge
                          variant="secondary"
                          className="mt-4 bg-emerald-50 text-xs font-black uppercase text-emerald-700"
                        >
                          {formatChf(table.open_total)}
                        </Badge>
                      ) : null}
                    </CardContent>
                  </Card>
                </Button>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[50svh] items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/60 px-6 text-center">
            <p className="max-w-sm text-sm font-black uppercase text-slate-400">
              {isLoadingLayout
                ? "Tischplan wird geladen"
                : layoutNotice ?? "Keine Tische im Tischplan"}
            </p>
          </div>
        )}
      </section>

      <footer className="grid h-16 shrink-0 grid-cols-3 border-t border-slate-200 bg-white">
        {navItems.map(({ label, icon: Icon, screen, active }) => (
          <Button
            key={label}
            variant="ghost"
            className={cn(
              "flex h-full flex-col items-center justify-center gap-0.5 rounded-none text-xs font-black uppercase transition active:bg-slate-100",
              active ? "text-indigo-800" : "text-slate-500",
            )}
            onClick={() => onNavigate(screen)}
          >
            <Icon className="size-5" />
            {label}
          </Button>
        ))}
      </footer>
    </main>
  );
}
