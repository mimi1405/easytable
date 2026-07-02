import { useEffect, useMemo, useState } from "react";

import { ErrorBanner } from "../../components/ErrorBanner";
import {
  createLocation,
  createOutputStation,
  createTenant,
  getRelaySyncApiUrl,
  loadLocations,
  loadOutputStations,
  loadTenants,
  updateLocation,
  updateOutputStation,
  updateTenant,
  type Location,
  type OutputStation,
  type Tenant,
} from "../../lib/relay-sync-api";
import { LocationsSection } from "./components/LocationsSection";
import { OutputStationsSection } from "./components/OutputStationsSection";
import { TenantsSection } from "./components/TenantsSection";

export function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [outputStations, setOutputStations] = useState<OutputStation[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isLoadingStations, setIsLoadingStations] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredTenants = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return tenants;
    }

    return tenants.filter((tenant) =>
      [tenant.id, tenant.name, tenant.slug, tenant.email ?? "", tenant.phone ?? "", tenant.website ?? "", tenant.status].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [search, tenants]);

  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenants[0] ?? null;
  const selectedLocation = locations.find((location) => location.id === selectedLocationId) ?? locations[0] ?? null;

  async function refreshTenants() {
    setIsLoading(true);
    setError(null);

    try {
      const nextTenants = await loadTenants();
      setTenants(nextTenants);
      setSelectedTenantId((current) => current ?? nextTenants[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Tenants konnten nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  }

  async function runTenantAction(action: () => Promise<void>) {
    setError(null);

    try {
      await action();
      await refreshTenants();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Aktion fehlgeschlagen.");
      throw actionError;
    }
  }

  async function refreshLocations(tenantId = selectedTenant?.id) {
    if (!tenantId) {
      return;
    }

    setIsLoadingLocations(true);
    setError(null);

    try {
      const nextLocations = await loadLocations(tenantId);
      setLocations(nextLocations);
      setSelectedLocationId((current) =>
        current && nextLocations.some((location) => location.id === current) ? current : nextLocations[0]?.id ?? null,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Locations konnten nicht geladen werden.");
    } finally {
      setIsLoadingLocations(false);
    }
  }

  async function runLocationAction(action: () => Promise<void>) {
    if (!selectedTenant) {
      return;
    }

    setError(null);

    try {
      await action();
      await refreshLocations(selectedTenant.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Location-Aktion fehlgeschlagen.");
      throw actionError;
    }
  }

  async function refreshOutputStations(tenantId = selectedTenant?.id, locationId = selectedLocation?.id) {
    if (!tenantId || !locationId) {
      return;
    }

    setIsLoadingStations(true);
    setError(null);

    try {
      setOutputStations(await loadOutputStations(tenantId, locationId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Stationen konnten nicht geladen werden.");
    } finally {
      setIsLoadingStations(false);
    }
  }

  async function runStationAction(action: () => Promise<void>) {
    if (!selectedTenant || !selectedLocation) {
      return;
    }

    setError(null);

    try {
      await action();
      await refreshOutputStations(selectedTenant.id, selectedLocation.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Stations-Aktion fehlgeschlagen.");
      throw actionError;
    }
  }

  useEffect(() => {
    void refreshTenants();
  }, []);

  useEffect(() => {
    if (!selectedTenant) {
      setLocations([]);
      return;
    }

    void refreshLocations(selectedTenant.id);
  }, [selectedTenant?.id]);

  useEffect(() => {
    if (!selectedTenant || !selectedLocation) {
      setOutputStations([]);
      return;
    }

    void refreshOutputStations(selectedTenant.id, selectedLocation.id);
  }, [selectedTenant?.id, selectedLocation?.id]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-md border bg-card p-4 text-card-foreground shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Platform / Administration</p>
          <h2 className="text-2xl font-semibold tracking-normal">Tenants</h2>
        </div>
        <span className="max-w-full truncate rounded-md border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
          {getRelaySyncApiUrl()}
        </span>
      </section>

      {error ? <ErrorBanner message={error} onRetry={refreshTenants} /> : null}

      <TenantsSection
        isLoading={isLoading}
        onCreate={(input) => runTenantAction(async () => void (await createTenant(input)))}
        onReload={refreshTenants}
        onSearchChange={setSearch}
        onSelect={setSelectedTenantId}
        onUpdate={(tenantId, input) => runTenantAction(async () => void (await updateTenant(tenantId, input)))}
        search={search}
        selectedTenant={selectedTenant}
        tenants={filteredTenants}
      />

      <LocationsSection
        isLoading={isLoadingLocations}
        locations={locations}
        onCreate={(input) => runLocationAction(async () => void (await createLocation(selectedTenant?.id ?? "", input)))}
        onReload={() => refreshLocations()}
        onSelect={setSelectedLocationId}
        onUpdate={(locationId, input) => runLocationAction(async () => void (await updateLocation(selectedTenant?.id ?? "", locationId, input)))}
        selectedLocation={selectedLocation}
        tenant={selectedTenant}
      />

      <OutputStationsSection
        isLoading={isLoadingStations}
        location={selectedLocation}
        onCreate={(input) =>
          runStationAction(async () => void (await createOutputStation(selectedTenant?.id ?? "", selectedLocation?.id ?? "", input)))
        }
        onReload={() => refreshOutputStations()}
        onUpdate={(stationId, input) =>
          runStationAction(async () =>
            void (await updateOutputStation(selectedTenant?.id ?? "", selectedLocation?.id ?? "", stationId, input))
          )
        }
        stations={outputStations}
        tenant={selectedTenant}
      />
    </div>
  );
}
