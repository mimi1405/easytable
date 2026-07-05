import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Edit3, Plus, RefreshCw, Save, Trash2, WifiOff, X } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Input } from "@easytable/ui/components/input";
import { cn } from "@easytable/ui/lib/utils";

import {
  createLayoutArea,
  createLayoutFloor,
  createLayoutTable,
  deleteLayoutArea,
  deleteLayoutFloor,
  deleteLayoutTable,
  detectConnectionMode,
  getLocalMasterUrl,
  getRelaySyncUrl,
  loadOwnerLocations,
  loadOwnerTableLayout,
  loadTableLayoutForConnection,
  subscribeLocalMasterEvents,
  updateLayoutArea,
  updateLayoutFloor,
  updateLayoutTable,
  type ConnectionMode,
  type OwnerLocation,
  type TableLayout,
  type TableLayoutArea,
  type TableLayoutFloor,
  type TableLayoutTable,
} from "../../../lib/local-master";

const layoutReloadEvents = new Set(["TABLE_LAYOUT_UPDATED", "TABLE_UPDATED", "ORDER_CREATED"]);

type Draft = {
  name: string;
  sortOrder: string;
  seats: string;
};

export function OwnerLocationsPage() {
  const [locations, setLocations] = useState<OwnerLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [layout, setLayout] = useState<TableLayout | null>(null);
  const [activeFloorId, setActiveFloorId] = useState("");
  const [activeAreaId, setActiveAreaId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("OFFLINE");

  const activeFloor = useMemo(
    () => layout?.floors.find((floor) => floor.id === activeFloorId),
    [activeFloorId, layout],
  );
  const activeArea = useMemo(
    () => activeFloor?.areas.find((area) => area.id === activeAreaId),
    [activeAreaId, activeFloor],
  );

  const refresh = useCallback(async (showLoadingState = true) => {
    if (showLoadingState) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const nextMode = await detectConnectionMode();
      setConnectionMode(nextMode);
      const nextLocations = nextMode === "LOCAL" ? await loadOwnerLocations() : [];
      const nextLocationId = selectedLocationId || nextLocations[0]?.id || "";
      const nextLayout = nextMode === "LOCAL"
        ? nextLocationId ? await loadOwnerTableLayout(nextLocationId) : null
        : await loadTableLayoutForConnection(nextMode);
      const resolvedLocations = nextMode === "LOCAL"
        ? nextLocations
        : nextLayout ? [{ id: nextLayout.location.id, tenant_id: nextLayout.location.tenant_id, name: nextLayout.location.name }] : [];
      const resolvedLocationId = nextMode === "LOCAL" ? nextLocationId : nextLayout?.location.id ?? "";
      const firstFloor = nextLayout?.floors[0];
      const nextFloorId = nextLayout?.floors.some((floor) => floor.id === activeFloorId)
        ? activeFloorId
        : firstFloor?.id ?? "";
      const nextFloor = nextLayout?.floors.find((floor) => floor.id === nextFloorId);
      const nextAreaId = nextFloor?.areas.some((area) => area.id === activeAreaId)
        ? activeAreaId
        : nextFloor?.areas[0]?.id ?? "";

      setLocations(resolvedLocations);
      setSelectedLocationId(resolvedLocationId);
      setLayout(nextLayout);
      setActiveFloorId(nextFloorId);
      setActiveAreaId(nextAreaId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Standorte konnten nicht geladen werden.");
      setLayout(null);
    } finally {
      if (showLoadingState) {
        setIsLoading(false);
      }
    }
  }, [activeAreaId, activeFloorId, selectedLocationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (connectionMode !== "LOCAL") {
      return undefined;
    }

    return subscribeLocalMasterEvents((event) => {
      if (layoutReloadEvents.has(event.type)) {
        void refresh(false);
      }
    });
  }, [connectionMode, refresh]);

  async function runAction(action: () => Promise<void>) {
    setError(null);

    try {
      if (connectionMode !== "LOCAL") {
        throw new Error("Standort- und Tischplan-Bearbeitung via Relay ist noch nicht verfuegbar.");
      }

      await action();
      setEditingId(null);
      await refresh(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Aktion fehlgeschlagen.");
    }
  }

  async function handleLocationChange(locationId: string) {
    setSelectedLocationId(locationId);
    setActiveFloorId("");
    setActiveAreaId("");
    setLayout(null);
    setIsLoading(true);

    try {
      const nextLayout = connectionMode === "LOCAL" ? await loadOwnerTableLayout(locationId) : await loadTableLayoutForConnection(connectionMode);
      setLayout(nextLayout);
      setActiveFloorId(nextLayout.floors[0]?.id ?? "");
      setActiveAreaId(nextLayout.floors[0]?.areas[0]?.id ?? "");
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Tischplan konnte nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-md border bg-card p-4 text-card-foreground shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Owner / Standorte</p>
          <h2 className="truncate text-2xl font-semibold tracking-normal">Tischplan verwalten</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm font-medium"
            value={selectedLocationId}
            onChange={(event) => void handleLocationChange(event.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <span className="max-w-full truncate rounded-md border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
            {connectionMode === "RELAY" ? getRelaySyncUrl() : getLocalMasterUrl()}
          </span>
        </div>
      </section>

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1fr_1.2fr]">
        <LayoutPanel
          title="Geschosse"
          emptyText={isLoading ? "Geschosse werden geladen" : "Noch keine Geschosse"}
          action={
            <FloorForm
              locationId={selectedLocationId}
              onCreate={(input) => runAction(async () => void (await createLayoutFloor(selectedLocationId, input)))}
            />
          }
        >
          {layout?.floors.map((floor) => (
            <FloorRow
              isActive={floor.id === activeFloorId}
              isEditing={editingId === floor.id}
              key={floor.id}
              floor={floor}
              onCancel={() => setEditingId(null)}
              onDelete={() => runAction(async () => void (await deleteLayoutFloor(selectedLocationId, floor.id)))}
              onEdit={() => setEditingId(floor.id)}
              onSelect={() => {
                setActiveFloorId(floor.id);
                setActiveAreaId(floor.areas[0]?.id ?? "");
              }}
              onUpdate={(input) => runAction(async () => void (await updateLayoutFloor(selectedLocationId, floor.id, input)))}
            />
          ))}
        </LayoutPanel>

        <LayoutPanel
          title="Bereiche"
          emptyText={activeFloor ? "Noch keine Bereiche" : "Geschoss auswaehlen"}
          action={
            <AreaForm
              floorId={activeFloorId}
              isDisabled={!activeFloor}
              onCreate={(input) => runAction(async () => void (await createLayoutArea(selectedLocationId, input)))}
            />
          }
        >
          {activeFloor?.areas.map((area) => (
            <AreaRow
              area={area}
              isActive={area.id === activeAreaId}
              isEditing={editingId === area.id}
              key={area.id}
              onCancel={() => setEditingId(null)}
              onDelete={() => runAction(async () => void (await deleteLayoutArea(selectedLocationId, area.id)))}
              onEdit={() => setEditingId(area.id)}
              onSelect={() => setActiveAreaId(area.id)}
              onUpdate={(input) => runAction(async () => void (await updateLayoutArea(selectedLocationId, area.id, input)))}
            />
          ))}
        </LayoutPanel>

        <LayoutPanel
          title="Tische"
          emptyText={activeArea ? "Noch keine Tische" : "Bereich auswaehlen"}
          action={
            <TableForm
              areaId={activeAreaId}
              isDisabled={!activeArea}
              onCreate={(input) => runAction(async () => void (await createLayoutTable(selectedLocationId, input)))}
            />
          }
        >
          {activeArea?.tables.map((table) => (
            <TableRow
              isEditing={editingId === table.id}
              key={table.id}
              onCancel={() => setEditingId(null)}
              onDelete={() => runAction(async () => void (await deleteLayoutTable(selectedLocationId, table.id)))}
              onEdit={() => setEditingId(table.id)}
              onUpdate={(input) => runAction(async () => void (await updateLayoutTable(selectedLocationId, table.id, input)))}
              table={table}
            />
          ))}
        </LayoutPanel>
      </section>
    </div>
  );
}

function LayoutPanel({ title, emptyText, action, children }: { title: string; emptyText: string; action: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-h-[34rem] flex-col rounded-md border bg-card text-card-foreground shadow-sm">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-base font-semibold tracking-normal">{title}</h3>
        {action}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {children && (Array.isArray(children) ? children.length > 0 : true) ? (
          children
        ) : (
          <div className="grid min-h-40 place-items-center rounded-md border border-dashed bg-muted/30 px-4 text-center text-sm font-medium text-muted-foreground">
            {emptyText}
          </div>
        )}
      </div>
    </section>
  );
}

function FloorForm({ locationId, onCreate }: { locationId: string; onCreate: (input: { name: string; sort_order?: number }) => void }) {
  return (
    <CreateForm
      isDisabled={!locationId}
      labels={{ name: "EG", sort: "10" }}
      onCreate={(draft) => onCreate({ name: draft.name, sort_order: optionalNumber(draft.sortOrder) })}
    />
  );
}

function AreaForm({ floorId, isDisabled, onCreate }: { floorId: string; isDisabled: boolean; onCreate: (input: { floor_id: string; name: string; sort_order?: number }) => void }) {
  return (
    <CreateForm
      isDisabled={isDisabled}
      labels={{ name: "Bar", sort: "10" }}
      onCreate={(draft) => onCreate({ floor_id: floorId, name: draft.name, sort_order: optionalNumber(draft.sortOrder) })}
    />
  );
}

function TableForm({ areaId, isDisabled, onCreate }: { areaId: string; isDisabled: boolean; onCreate: (input: { area_id: string; name: string; seats: number; sort_order?: number }) => void }) {
  return (
    <CreateForm
      hasSeats
      isDisabled={isDisabled}
      labels={{ name: "12", sort: "10", seats: "4" }}
      onCreate={(draft) => onCreate({ area_id: areaId, name: draft.name, seats: optionalNumber(draft.seats) ?? 1, sort_order: optionalNumber(draft.sortOrder) })}
    />
  );
}

function CreateForm({ labels, hasSeats = false, isDisabled, onCreate }: { labels: { name: string; sort: string; seats?: string }; hasSeats?: boolean; isDisabled: boolean; onCreate: (draft: Draft) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ name: "", sortOrder: "", seats: "" });

  if (!isOpen) {
    return (
      <Button disabled={isDisabled} onClick={() => setIsOpen(true)} size="sm" type="button">
        <Plus className="mr-2 size-4" />
        Neu
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input className="h-9 w-24" placeholder={labels.name} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      {hasSeats ? (
        <Input className="h-9 w-20" inputMode="numeric" placeholder={labels.seats} value={draft.seats} onChange={(event) => setDraft({ ...draft, seats: event.target.value })} />
      ) : null}
      <Input className="h-9 w-20" inputMode="numeric" placeholder={labels.sort} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} />
      <Button
        size="icon"
        type="button"
        onClick={() => {
          onCreate(draft);
          setDraft({ name: "", sortOrder: "", seats: "" });
        }}
      >
        <Save className="size-4" />
      </Button>
      <Button size="icon" type="button" variant="ghost" onClick={() => setIsOpen(false)}>
        <X className="size-4" />
      </Button>
    </div>
  );
}

function FloorRow(props: {
  floor: TableLayoutFloor;
  isActive: boolean;
  isEditing: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSelect: () => void;
  onUpdate: (input: { name: string; sort_order?: number }) => void;
}) {
  return (
    <EditableRow
      badge={`${props.floor.areas.length} Bereiche`}
      isActive={props.isActive}
      isEditing={props.isEditing}
      name={props.floor.name}
      sortOrder={props.floor.sort_order}
      onCancel={props.onCancel}
      onDelete={props.onDelete}
      onEdit={props.onEdit}
      onSelect={props.onSelect}
      onUpdate={(draft) => props.onUpdate({ name: draft.name, sort_order: optionalNumber(draft.sortOrder) })}
    />
  );
}

function AreaRow(props: {
  area: TableLayoutArea;
  isActive: boolean;
  isEditing: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSelect: () => void;
  onUpdate: (input: { name: string; sort_order?: number }) => void;
}) {
  return (
    <EditableRow
      badge={`${props.area.tables.length} Tische`}
      isActive={props.isActive}
      isEditing={props.isEditing}
      name={props.area.name}
      sortOrder={props.area.sort_order}
      onCancel={props.onCancel}
      onDelete={props.onDelete}
      onEdit={props.onEdit}
      onSelect={props.onSelect}
      onUpdate={(draft) => props.onUpdate({ name: draft.name, sort_order: optionalNumber(draft.sortOrder) })}
    />
  );
}

function TableRow(props: {
  table: TableLayoutTable;
  isEditing: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onUpdate: (input: { name: string; seats: number; sort_order?: number }) => void;
}) {
  return (
    <EditableRow
      badge={`${props.table.seats} Sitzplaetze`}
      hasOpenOrder={props.table.open_order_count > 0}
      isActive={false}
      isEditing={props.isEditing}
      name={props.table.name}
      seats={props.table.seats}
      sortOrder={props.table.sort_order}
      onCancel={props.onCancel}
      onDelete={props.onDelete}
      onEdit={props.onEdit}
      onUpdate={(draft) => props.onUpdate({ name: draft.name, seats: optionalNumber(draft.seats) ?? props.table.seats, sort_order: optionalNumber(draft.sortOrder) })}
    />
  );
}

function EditableRow(props: {
  name: string;
  sortOrder: number;
  seats?: number;
  badge: string;
  hasOpenOrder?: boolean;
  isActive: boolean;
  isEditing: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSelect?: () => void;
  onUpdate: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({ name: props.name, sortOrder: String(props.sortOrder), seats: String(props.seats ?? "") });

  useEffect(() => {
    setDraft({ name: props.name, sortOrder: String(props.sortOrder), seats: String(props.seats ?? "") });
  }, [props.name, props.seats, props.sortOrder]);

  if (props.isEditing) {
    return (
      <div className="rounded-md border bg-background p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_5rem_5rem_auto]">
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          {props.seats === undefined ? <span /> : <Input inputMode="numeric" value={draft.seats} onChange={(event) => setDraft({ ...draft, seats: event.target.value })} />}
          <Input inputMode="numeric" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} />
          <div className="flex gap-1">
            <Button size="icon" type="button" onClick={() => props.onUpdate(draft)}>
              <Save className="size-4" />
            </Button>
            <Button size="icon" type="button" variant="ghost" onClick={props.onCancel}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border bg-background p-3 transition",
        props.isActive ? "border-slate-950 shadow-sm" : "hover:border-muted-foreground/40",
      )}
    >
      <button className="min-w-0 flex-1 text-left" type="button" onClick={props.onSelect}>
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold">{props.name}</p>
          {props.hasOpenOrder ? <Badge className="bg-emerald-50 text-emerald-700">Offen</Badge> : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {props.badge} · Sortierung {props.sortOrder}
        </p>
      </button>
      <Button size="icon" type="button" variant="ghost" onClick={props.onEdit}>
        <Edit3 className="size-4" />
      </Button>
      <Button disabled={props.hasOpenOrder} size="icon" type="button" variant="ghost" onClick={props.onDelete}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-destructive sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <WifiOff className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">Standortaktion fehlgeschlagen</p>
          <p className="break-words text-sm opacity-80">{message}</p>
        </div>
      </div>
      <Button onClick={onRetry} type="button" variant="outline">
        <RefreshCw className="mr-2 size-4" />
        Erneut laden
      </Button>
    </div>
  );
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : undefined;
}
