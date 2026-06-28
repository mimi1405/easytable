import { DoorOpenIcon, EllipsisIcon, ReceiptTextIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Card, CardContent } from "@easytable/ui/components/card";
import { cn } from "@easytable/ui/lib/utils";

import type { PosScreen } from "../App";
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

const fallbackLayout: TableLayout = {
  tenant: { id: "tenant_basilica", name: "Basilica" },
  location: {
    id: "loc_basilica_main",
    tenant_id: "tenant_basilica",
    name: "Basilica",
  },
  floors: [
    {
      id: "floor_basilica_eg",
      location_id: "loc_basilica_main",
      name: "EG",
      sort_order: 10,
      areas: [
        {
          id: "area_basilica_fumoir",
          floor_id: "floor_basilica_eg",
          name: "Fumoir",
          sort_order: 20,
          tables: [
            {
              id: "table_basilica_fumoir_2",
              area_id: "area_basilica_fumoir",
              name: "2",
              seats: 4,
              sort_order: 10,
              open_order_id: null,
              open_order_number: null,
              open_total: 0,
              open_order_count: 0,
            },
          ],
        },
      ],
    },
  ],
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

export function TablePlanScreen({
  onNavigate,
  onSelectTable,
}: TablePlanScreenProps) {
  const [layout, setLayout] = useState<TableLayout>(fallbackLayout);
  const [activeFloorId, setActiveFloorId] = useState<string>(
    fallbackLayout.floors[0]?.id ?? "",
  );
  const [activeAreaId, setActiveAreaId] = useState<string>(
    fallbackLayout.floors[0]?.areas[0]?.id ?? "",
  );

  useEffect(() => {
    let isMounted = true;

    async function loadLayout() {
      try {
        await invoke("initialize_pos_database");
        const tableLayout = await invoke<TableLayout>("list_table_layout");
        const firstFloor = tableLayout.floors[0];
        const firstArea = firstFloor?.areas[0];

        if (isMounted) {
          setLayout(tableLayout);
          setActiveFloorId(firstFloor?.id ?? "");
          setActiveAreaId(firstArea?.id ?? "");
        }
      } catch (error) {
        console.warn(
          "Using fallback table layout because SQLite is unavailable.",
          error,
        );
      }
    }

    void loadLayout();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeFloor = useMemo<TableLayoutFloor | undefined>(
    () => layout.floors.find((floor) => floor.id === activeFloorId),
    [activeFloorId, layout.floors],
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
      <section className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-300 px-5">
        {layout.floors.map((floor) => (
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-7">
          {activeArea?.tables.map((table) => {
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
                    "aspect-[1.05] min-h-36 w-full rounded-md bg-white py-0 shadow-xl shadow-slate-200/70 transition group-hover/button:bg-white",
                    hasOpenOrder ? "ring-emerald-300" : "ring-slate-100",
                  )}
                >
                  <CardContent className="flex h-full flex-col items-center justify-center p-4 text-center">
                    <span className="text-4xl font-black text-slate-950">
                      {table.name}
                    </span>
                    <span className="mt-3 text-sm font-black text-slate-500">
                      {table.seats} Sitzplatze
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
