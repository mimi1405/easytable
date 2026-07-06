import { RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@easytable/ui/components/table";

import type { Location, OutputStation, OutputStationInput, Tenant } from "../../../lib/relay-sync-api";
import { OutputStationFormDialog } from "./OutputStationFormDialog";

type OutputStationsSectionProps = {
  tenant: Tenant | null;
  location: Location | null;
  stations: OutputStation[];
  isLoading: boolean;
  onReload: () => void;
  onCreate: (input: OutputStationInput) => Promise<void>;
  onUpdate: (stationId: string, input: OutputStationInput) => Promise<void>;
  onDelete: (stationId: string) => Promise<void>;
};

export function OutputStationsSection({ tenant, location, stations, isLoading, onReload, onCreate, onUpdate, onDelete }: OutputStationsSectionProps) {
  const canManage = Boolean(tenant && location);

  return (
    <section className="rounded-md border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Stationen</h2>
          <p className="text-sm text-muted-foreground">
            {location ? `Ausgabe-Stationen fuer ${location.name}` : "Erst eine Location auswaehlen."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canManage || isLoading} onClick={onReload} type="button" variant="outline">
            <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
            Laden
          </Button>
          <OutputStationFormDialog disabled={!canManage} mode="create" onSubmit={onCreate} />
        </div>
      </div>

      <div className="p-2 sm:p-3">
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Fähigkeiten</TableHead>
                <TableHead className="text-right">Sortierung</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stations.map((station) => (
                <TableRow key={station.id}>
                  <TableCell>
                    <div className="grid gap-1">
                      <span className="font-medium">{station.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{station.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {station.has_kds ? <Badge variant="outline">KDS</Badge> : null}
                      {station.has_printer ? <Badge variant="outline">Bon</Badge> : null}
                      {!station.has_kds && !station.has_printer ? <Badge variant="outline">Keine Ausgabe</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{station.sort_order}</TableCell>
                  <TableCell>
                    <Badge variant={station.is_active ? "secondary" : "outline"}>
                      {station.is_active ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <OutputStationFormDialog mode="edit" onSubmit={(input) => onUpdate(station.id, input)} station={station} />
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          if (confirm(`Möchtest du die Station "${station.name}" wirklich löschen? Zugeordnete Produkte und Kategorien werden nicht gelöscht, aber deren Station wird auf NULL zurückgesetzt.`)) {
                            await onDelete(station.id);
                          }
                        }}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 w-8 p-0"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {!isLoading && stations.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                    {location ? "Keine Stationen gefunden." : "Keine Location ausgewaehlt."}
                  </TableCell>
                </TableRow>
              ) : null}

              {isLoading ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                    Stationen werden geladen.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
