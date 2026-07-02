import { Building2, RefreshCw } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Input } from "@easytable/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@easytable/ui/components/table";

import type { Tenant, TenantInput } from "../../../lib/relay-sync-api";
import { formatDate } from "../utils";
import { TenantFormDialog } from "./TenantFormDialog";

type TenantsSectionProps = {
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  search: string;
  isLoading: boolean;
  onSearchChange: (search: string) => void;
  onSelect: (tenantId: string) => void;
  onReload: () => void;
  onCreate: (input: TenantInput) => Promise<void>;
  onUpdate: (tenantId: string, input: TenantInput) => Promise<void>;
};

export function TenantsSection({
  tenants,
  selectedTenant,
  search,
  isLoading,
  onSearchChange,
  onSelect,
  onReload,
  onCreate,
  onUpdate,
}: TenantsSectionProps) {
  return (
    <section className="rounded-md border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Tenants</h2>
          <p className="text-sm text-muted-foreground">Mandanten fuer lokale Standorte und spaeteren Sync verwalten.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isLoading} onClick={onReload} type="button" variant="outline">
            <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
            Laden
          </Button>
          <TenantFormDialog mode="create" onSubmit={onCreate} />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-10 pl-9"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Tenant, Slug, ID oder Status suchen"
            value={search}
          />
        </div>
      </div>

      <div className="p-2 sm:p-3">
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Kontakt</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Erstellt</TableHead>
                <TableHead className="w-24 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow className={tenant.id === selectedTenant?.id ? "bg-muted/50" : undefined} key={tenant.id} onClick={() => onSelect(tenant.id)}>
                  <TableCell>
                    <div className="grid gap-1">
                      <span className="font-medium">{tenant.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{tenant.id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{tenant.slug}</TableCell>
                  <TableCell>
                    <div className="grid gap-1 text-sm">
                      <span>{tenant.email ?? "Keine E-Mail"}</span>
                      <span className="text-muted-foreground">{tenant.phone ?? tenant.website ?? "Keine Kontaktdaten"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={tenant.status === "ACTIVE" ? "secondary" : "outline"}>{tenant.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatDate(tenant.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <TenantFormDialog mode="edit" onSubmit={(input) => onUpdate(tenant.id, input)} tenant={tenant} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {!isLoading && tenants.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>
                    Keine Tenants gefunden.
                  </TableCell>
                </TableRow>
              ) : null}

              {isLoading ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>
                    Tenants werden geladen.
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
