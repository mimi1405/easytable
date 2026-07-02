import { RefreshCw } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@easytable/ui/components/table";

import type { Location, LocationInput, Tenant } from "../../../lib/relay-sync-api";
import { LocationFormDialog } from "./LocationFormDialog";

type LocationsSectionProps = {
  tenant: Tenant | null;
  selectedLocation: Location | null;
  locations: Location[];
  isLoading: boolean;
  onReload: () => void;
  onCreate: (input: LocationInput) => Promise<void>;
  onUpdate: (locationId: string, input: LocationInput) => Promise<void>;
  onSelect: (locationId: string) => void;
};

export function LocationsSection({ tenant, selectedLocation, locations, isLoading, onReload, onCreate, onUpdate, onSelect }: LocationsSectionProps) {
  return (
    <section className="rounded-md border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Locations</h2>
          <p className="text-sm text-muted-foreground">
            {tenant ? `Standorte fuer ${tenant.name}` : "Erst einen Tenant auswaehlen."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!tenant || isLoading} onClick={onReload} type="button" variant="outline">
            <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
            Laden
          </Button>
          <LocationFormDialog disabled={!tenant} mode="create" onSubmit={onCreate} />
        </div>
      </div>

      <div className="p-2 sm:p-3">
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead>LocalMaster</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((location) => (
                <TableRow className={location.id === selectedLocation?.id ? "bg-muted/50" : undefined} key={location.id} onClick={() => onSelect(location.id)}>
                  <TableCell>
                    <div className="grid gap-1">
                      <span className="font-medium">{location.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{location.id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{location.slug}</TableCell>
                  <TableCell>{location.address ?? "Keine Adresse"}</TableCell>
                  <TableCell className="font-mono text-xs">{location.local_master_instance_id ?? "Nicht gekoppelt"}</TableCell>
                  <TableCell>
                    <Badge variant={location.status === "ACTIVE" ? "secondary" : "outline"}>{location.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <LocationFormDialog location={location} mode="edit" onSubmit={(input) => onUpdate(location.id, input)} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {!isLoading && locations.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>
                    Keine Locations gefunden.
                  </TableCell>
                </TableRow>
              ) : null}

              {isLoading ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>
                    Locations werden geladen.
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
