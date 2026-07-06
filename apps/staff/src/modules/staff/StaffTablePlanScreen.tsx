import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Card, CardContent } from "@easytable/ui/components/card";
import { cn } from "@easytable/ui/lib/utils";

import type { StaffTableContext } from "../../layout/navigation";
import {
  loadTableLayoutForConnection,
  subscribeLocalMasterEvents,
  type TableLayout,
  type TableLayoutArea,
  type TableLayoutFloor,
  type TableLayoutTable,
} from "../../lib/local-master";
import { useConnectionModeMonitor } from "../../lib/useConnectionModeMonitor";
import { formatChf } from "./utils";

type StaffTablePlanScreenProps = {
  onSelectTable: (tableContext: StaffTableContext) => void;
};

const tablePlanReloadEvents = new Set(["ORDER_CREATED", "TABLE_UPDATED", "TABLE_LAYOUT_UPDATED"]);

export function StaffTablePlanScreen({ onSelectTable }: StaffTablePlanScreenProps) {
  const [layout, setLayout] = useState<TableLayout | null>(null);
  const [activeFloorId, setActiveFloorId] = useState("");
  const [activeAreaId, setActiveAreaId] = useState("");
  const [isLoadingLayout, setIsLoadingLayout] = useState(true);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);
  const { connectionMode } = useConnectionModeMonitor();

  const loadLayout = useCallback(async (showLoadingState = true) => {
    if (showLoadingState) {
      setIsLoadingLayout(true);
    }

    setLayoutNotice(null);

    try {
      const tableLayout = await loadTableLayoutForConnection(connectionMode);
      const firstFloor = tableLayout.floors[0];
      const firstArea = firstFloor?.areas[0];

      setLayout(tableLayout);
      setActiveFloorId((currentFloorId) =>
        tableLayout.floors.some((floor) => floor.id === currentFloorId)
          ? currentFloorId
          : firstFloor?.id ?? "",
      );
      setActiveAreaId((currentAreaId) => {
        const areas = tableLayout.floors.flatMap((floor) => floor.areas);

        return areas.some((area) => area.id === currentAreaId)
          ? currentAreaId
          : firstArea?.id ?? "";
      });
    } catch (error) {
      console.warn("Could not load table layout.", error);
      setLayout(null);
      setActiveFloorId("");
      setActiveAreaId("");
      setLayoutNotice(error instanceof Error ? error.message : "Tischplan konnte nicht geladen werden.");
    } finally {
      if (showLoadingState) {
        setIsLoadingLayout(false);
      }
    }
  }, [connectionMode]);

  useEffect(() => {
    void loadLayout();
  }, [loadLayout]);

  useEffect(() => {
    if (connectionMode !== "LOCAL") {
      return undefined;
    }

    return subscribeLocalMasterEvents((event) => {
      if (tablePlanReloadEvents.has(event.type)) {
        void loadLayout(false);
      }
    });
  }, [connectionMode, loadLayout]);

  useEffect(() => {
    if (connectionMode !== "RELAY") {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadLayout(false);
    }, 1_500);

    return () => window.clearInterval(timer);
  }, [connectionMode, loadLayout]);

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
    if (!layout || !activeFloor || !activeArea) {
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
    <section className="mx-auto flex h-[calc(100svh-6.5rem)] max-w-5xl touch-manipulation flex-col overflow-hidden rounded-md border bg-[#f7f8fc] text-slate-950 shadow-sm">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        </div>
        <Badge
          variant="secondary"
          className={cn(
            "h-8 shrink-0 rounded-[2rem] px-3 text-[0.7rem] font-black uppercase",
            connectionMode === "LOCAL"
              ? "bg-emerald-50 text-emerald-700"
              : connectionMode === "RELAY"
                ? "bg-sky-50 text-sky-700"
                : "bg-rose-50 text-rose-700",
          )}
        >
          {connectionMode === "LOCAL" ? "Lokal" : connectionMode === "RELAY" ? "Relay" : "Offline"}
        </Badge>
      </div>

      <div className="flex h-14 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 px-3 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden">
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
        {activeArea?.tables.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
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
                      "aspect-[1.04] min-h-32 w-full rounded-md bg-white py-0 shadow-md shadow-slate-200/80 transition group-hover/button:bg-white",
                      hasOpenOrder ? "ring-2 ring-emerald-300" : "ring-1 ring-slate-100",
                    )}
                  >
                    <CardContent className="flex h-full flex-col items-center justify-center p-3 text-center">
                      <span className="max-w-full truncate text-3xl font-black text-slate-950 sm:text-4xl">
                        {table.name}
                      </span>
                      <span className="mt-2 text-xs font-black uppercase text-slate-500 sm:text-sm">
                        {table.seats} Sitzplätze
                      </span>
                      {hasOpenOrder ? (
                        <Badge
                          variant="secondary"
                          className="mt-3 max-w-full truncate bg-emerald-50 text-xs font-black uppercase text-emerald-700"
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
          <div className="flex min-h-[45svh] items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/60 px-6 text-center">
            <p className="max-w-sm text-sm font-black uppercase text-slate-400">
              {isLoadingLayout
                ? "Tischplan wird geladen"
                : layoutNotice ?? "Keine Tische im Tischplan"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
