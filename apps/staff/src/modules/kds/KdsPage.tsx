import { CheckCircleIcon, ChefHatIcon, ClockIcon, FlameIcon, GripVerticalIcon, PlayIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Card, CardContent } from "@easytable/ui/components/card";
import { cn } from "@easytable/ui/lib/utils";

import {
  loadCatalogOutputStationsForConnection,
  loadKdsTicketsForConnection,
  subscribeLocalMasterEvents,
  updateKdsTicketStatusForConnection,
  type CatalogOutputStation,
  type KdsTicket,
  type KdsTicketStatus,
} from "../../lib/local-master";
import { useConnectionModeMonitor } from "../../lib/useConnectionModeMonitor";

const kdsReloadEvents = new Set(["ORDER_CREATED", "KDS_TICKET_CREATED", "KDS_TICKET_UPDATED", "KDS_TICKETS_REBUILT"]);

const columns: Array<{
  status: KdsTicketStatus;
  title: string;
  icon: typeof ClockIcon;
  span: number;
}> = [
  { status: "OPEN", title: "Offen", icon: ClockIcon, span: 5 },
  { status: "IN_PROGRESS", title: "In Bearbeitung", icon: FlameIcon, span: 5 },
  { status: "DONE", title: "Erledigt", icon: CheckCircleIcon, span: 3 },
];

export function KdsPage() {
  const [stations, setStations] = useState<CatalogOutputStation[]>([]);
  const [selectedStation, setSelectedStation] = useState("");
  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null);
  const [activeDropStatus, setActiveDropStatus] = useState<KdsTicketStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingTicketId, setUpdatingTicketId] = useState<string | null>(null);
  const { connectionMode, refreshConnectionMode } = useConnectionModeMonitor();

  useEffect(() => {
    let isMounted = true;

    async function loadStations() {
      try {
        if (!isMounted) {
          return;
        }

        if (connectionMode === "OFFLINE") {
          setStations([]);
          setSelectedStation("");
          setNotice("LocalMaster ist nicht erreichbar und Relay ist nicht bereit.");
          return;
        }

        const outputStations = await loadCatalogOutputStationsForConnection(connectionMode);
        const kdsStations = outputStations.filter((station) => station.is_active && (station.kind === "KDS" || station.kind === "KDS_AND_PRINTER"));

        if (isMounted) {
          setStations(kdsStations);
          setSelectedStation((current) =>
            kdsStations.some((station) => station.name === current)
              ? current
              : kdsStations[0]?.name ?? ""
          );
          setNotice(null);
        }
      } catch (error) {
        console.warn("Could not load output stations.", error);

        if (isMounted) {
          setNotice("Stationen konnten nicht geladen werden.");
        }
        void refreshConnectionMode();
      }
    }

    void loadStations();

    return () => {
      isMounted = false;
    };
  }, [connectionMode, refreshConnectionMode]);

  const loadTickets = useCallback(async (showLoadingState = true) => {
    if (!selectedStation) {
      setTickets([]);
      setIsLoading(false);
      return;
    }

    if (connectionMode === "OFFLINE") {
      setTickets([]);
      setIsLoading(false);
      return;
    }

    if (showLoadingState) {
      setIsLoading(true);
    }

    try {
      setTickets(await loadKdsTicketsForConnection(connectionMode, selectedStation));
    } catch (error) {
      console.warn("Could not load KDS tickets.", error);
      setNotice("KDS Tickets konnten nicht geladen werden.");
      void refreshConnectionMode();
    } finally {
      if (showLoadingState) {
        setIsLoading(false);
      }
    }
  }, [connectionMode, selectedStation]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (connectionMode !== "LOCAL") {
      return undefined;
    }

    return subscribeLocalMasterEvents((event) => {
      if (kdsReloadEvents.has(event.type)) {
        void loadTickets(false);
      }
    });
  }, [connectionMode, loadTickets]);

  useEffect(() => {
    if (connectionMode !== "RELAY" || !selectedStation) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadTickets(false);
    }, 1_500);

    return () => window.clearInterval(timer);
  }, [connectionMode, loadTickets, selectedStation]);

  const ticketsByStatus = useMemo(() => {
    return columns.reduce<Record<KdsTicketStatus, KdsTicket[]>>(
      (groups, column) => ({
        ...groups,
        [column.status]: tickets.filter((ticket) => ticket.status === column.status),
      }),
      { OPEN: [], IN_PROGRESS: [], DONE: [] },
    );
  }, [tickets]);

  async function moveTicket(ticket: KdsTicket, status: KdsTicketStatus) {
    if (ticket.status === status || updatingTicketId) {
      return;
    }

    setUpdatingTicketId(ticket.id);
    setNotice(null);

    try {
      const updatedTicket = await updateKdsTicketStatusForConnection(connectionMode, ticket.id, status);
      setTickets((current) => current.map((entry) => entry.id === updatedTicket.id ? updatedTicket : entry));

      if (status === "DONE") {
        setNotice(`Tisch ${ticket.table_name} ist abholbereit.`);
      }
    } catch (error) {
      console.error("Could not update KDS ticket.", error);
      setNotice(error instanceof Error ? error.message : "Ticket konnte nicht verschoben werden.");
      void refreshConnectionMode();
    } finally {
      setUpdatingTicketId(null);
    }
  }

  function handleDrop(status: KdsTicketStatus) {
    const ticket = tickets.find((entry) => entry.id === draggedTicketId);
    setDraggedTicketId(null);
    setActiveDropStatus(null);

    if (ticket) {
      void moveTicket(ticket, status);
    }
  }

  return (
    <section className="mx-auto flex h-[calc(100svh-6.5rem)] max-w-[94rem] touch-manipulation flex-col overflow-hidden rounded-md border bg-[#f7f8fc] text-slate-950 shadow-sm">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white">
              <ChefHatIcon className="size-6" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-black text-slate-950">KDS</h2>
              <p className="truncate text-xs font-bold uppercase text-slate-400">Offen · In Bearbeitung · Erledigt</p>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Badge variant={connectionMode === "LOCAL" ? "default" : connectionMode === "RELAY" ? "secondary" : "destructive"} className="h-10 shrink-0 rounded-[2rem] px-3 font-black uppercase">
              {connectionMode === "LOCAL" ? "Lokal" : connectionMode === "RELAY" ? "Relay" : "Offline"}
            </Badge>
            {stations.map((station) => (
              <button
                key={station.id}
                className={cn(
                  "h-10 shrink-0 rounded-[2rem] px-4 text-sm font-extrabold uppercase tracking-normal transition active:scale-[0.98]",
                  station.name === selectedStation
                    ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                    : "bg-slate-100 text-slate-500 active:bg-slate-200",
                )}
                onClick={() => setSelectedStation(station.name)}
              >
                {station.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3 sm:p-4">
        <div
          className="grid h-full min-w-[58rem] gap-3"
          style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
        >
          {columns.map((column) => {
            const Icon = column.icon;
            const columnTickets = ticketsByStatus[column.status];

            return (
              <section
                key={column.status}
                className={cn(
                  "flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white/80",
                  activeDropStatus === column.status ? "ring-2 ring-indigo-500" : "",
                )}
                style={{ gridColumn: `span ${column.span} / span ${column.span}` }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setActiveDropStatus(column.status);
                }}
                onDragLeave={() => setActiveDropStatus(null)}
                onDrop={() => handleDrop(column.status)}
              >
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="size-5 shrink-0 text-slate-500" />
                    <h3 className="truncate text-sm font-black uppercase text-slate-950">{column.title}</h3>
                  </div>
                  <Badge variant="secondary" className="font-black">{columnTickets.length}</Badge>
                </header>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
                  {columnTickets.length > 0 ? (
                    columnTickets.map((ticket) => (
                      <KdsTicketCard
                        key={ticket.id}
                        ticket={ticket}
                        isUpdating={updatingTicketId === ticket.id}
                        onDragStart={() => setDraggedTicketId(ticket.id)}
                        onDragEnd={() => {
                          setDraggedTicketId(null);
                          setActiveDropStatus(null);
                        }}
                        onMove={(status) => void moveTicket(ticket, status)}
                      />
                    ))
                  ) : (
                    <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/60 px-4 text-center">
                      <p className="text-xs font-black uppercase text-slate-400">
                        {isLoading ? "Tickets werden geladen" : "Keine Tickets"}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {notice ? (
        <div className="fixed bottom-6 left-4 right-4 z-40 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-lg shadow-slate-900/10 sm:right-auto sm:max-w-sm">
          {notice}
        </div>
      ) : null}
    </section>
  );
}

function KdsTicketCard({
  ticket,
  isUpdating,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  ticket: KdsTicket;
  isUpdating: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (status: KdsTicketStatus) => void;
}) {
  const itemCount = ticket.items.reduce((total, item) => total + item.quantity, 0);

  return (
    <Card
      draggable
      className="cursor-grab rounded-md bg-white py-0 shadow-md shadow-slate-200/80 ring-1 ring-slate-200 active:cursor-grabbing"
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", ticket.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <CardContent className="p-0">
        <div className="border-b border-slate-100 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-black text-slate-950">Tisch {ticket.table_name}</p>
              <p className="mt-1 truncate text-xs font-bold uppercase text-slate-400">
                {ticket.order_number} · {formatAge(ticket.created_at)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge className="bg-slate-950 text-white hover:bg-slate-950">{itemCount}</Badge>
              <GripVerticalIcon className="size-5 text-slate-300" />
            </div>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {ticket.items.map((item, index) => (
            <div key={`${ticket.id}:${item.product_id}:${index}`} className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-sm font-black text-slate-700">
                {item.quantity}x
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-950">{item.product_name}</p>
                {item.variants.length > 0 ? (
                  <p className="mt-0.5 truncate text-xs font-bold text-slate-500">
                    {item.variants.map((variant) => variant.variant_item_name).join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 border-t border-slate-200">
          <Button
            className="h-12 rounded-none bg-slate-100 text-xs font-black uppercase text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-300"
            disabled={isUpdating || ticket.status === "IN_PROGRESS"}
            onClick={() => onMove("IN_PROGRESS")}
          >
            <PlayIcon className="size-4" />
            Starten
          </Button>
          <Button
            className="h-12 rounded-none bg-emerald-300 text-xs font-black uppercase text-emerald-900 hover:bg-emerald-300 active:bg-emerald-400 disabled:bg-slate-100 disabled:text-slate-300"
            disabled={isUpdating || ticket.status === "DONE"}
            onClick={() => onMove("DONE")}
          >
            <CheckCircleIcon className="size-4" />
            Erledigt
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function formatAge(createdAt: number) {
  const ageInSeconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));

  if (ageInSeconds < 60) {
    return "gerade eben";
  }

  const ageInMinutes = Math.floor(ageInSeconds / 60);

  if (ageInMinutes < 60) {
    return `${ageInMinutes} min`;
  }

  return `${Math.floor(ageInMinutes / 60)} h`;
}
