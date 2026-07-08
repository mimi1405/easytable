import { useEffect, useMemo, useState } from "react";

import { ErrorBanner } from "../../components/ErrorBanner";
import {
  createLocation,
  createLocationUser,
  createLocalMasterPairingSession,
  createOutputStation,
  deleteOutputStation,
  archiveLocationUser,
  createTenant,
  deleteLocationUser,
  getRelaySyncApiUrl,
  loadCurrentLocalMasterPairingSession,
  loadLocationUsers,
  loadLocations,
  loadOutputStations,
  loadTenants,
  resetLocationUserPassword,
  resetLocationUserPin,
  updateLocation,
  updateLocationUser,
  updateOutputStation,
  updateTenant,
  type Location,
  type LocalMasterPairingSession,
  type OutputStation,
  type Tenant,
  type TenantLocationUser,
} from "../../lib/relay-sync-api";
import { LocationUsersSection } from "./components/LocationUsersSection";
import { LocationsSection } from "./components/LocationsSection";
import { OutputStationsSection } from "./components/OutputStationsSection";
import { TenantsSection } from "./components/TenantsSection";

const pairingSessionStorageKey = "easytable.platformAdmin.localMasterPairingSessions";

export function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [outputStations, setOutputStations] = useState<OutputStation[]>([]);
  const [locationUsers, setLocationUsers] = useState<TenantLocationUser[]>([]);
  const [pairingSessions, setPairingSessions] = useState<Record<string, LocalMasterPairingSession | undefined>>(() => readCachedPairingSessions());
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isLoadingStations, setIsLoadingStations] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
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
      setPairingSessions((current) => keepSessionsForLocations(current, nextLocations));
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

  async function refreshLocationUsers(tenantId = selectedTenant?.id, locationId = selectedLocation?.id) {
    if (!tenantId || !locationId) {
      return;
    }

    setIsLoadingUsers(true);
    setError(null);

    try {
      setLocationUsers(await loadLocationUsers(tenantId, locationId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "User konnten nicht geladen werden.");
    } finally {
      setIsLoadingUsers(false);
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

  async function runUserAction<T>(action: () => Promise<T>): Promise<T> {
    if (!selectedTenant || !selectedLocation) {
      throw new Error("Erst Tenant und Location auswaehlen.");
    }

    setError(null);

    try {
      const result = await action();
      await refreshLocationUsers(selectedTenant.id, selectedLocation.id);
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "User-Aktion fehlgeschlagen.");
      throw actionError;
    }
  }

  async function refreshPairingSession(tenantId = selectedTenant?.id, locationId = selectedLocation?.id) {
    if (!tenantId || !locationId) {
      return;
    }

    try {
      const session = await loadCurrentLocalMasterPairingSession(tenantId, locationId);
      setPairingSessions((current) => cachePairingSessions({ ...current, [locationId]: mergePairingSession(current[locationId], session) }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Pairing-Status konnte nicht geladen werden.");
    }
  }

  async function runPairingAction(locationId: string) {
    if (!selectedTenant) {
      return;
    }

    setError(null);

    try {
      const session = await createLocalMasterPairingSession(selectedTenant.id, locationId);
      setPairingSessions((current) => cachePairingSessions({ ...current, [locationId]: session }));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Setup-Code konnte nicht erzeugt werden.");
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
      setLocationUsers([]);
      return;
    }

    void refreshOutputStations(selectedTenant.id, selectedLocation.id);
    void refreshLocationUsers(selectedTenant.id, selectedLocation.id);
    void refreshPairingSession(selectedTenant.id, selectedLocation.id);
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
        onCreatePairingSession={runPairingAction}
        onReload={() => refreshLocations()}
        onSelect={setSelectedLocationId}
        onUpdate={(locationId, input) => runLocationAction(async () => void (await updateLocation(selectedTenant?.id ?? "", locationId, input)))}
        pairingSessions={pairingSessions}
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
        onDelete={(stationId) =>
          runStationAction(async () =>
            void (await deleteOutputStation(selectedTenant?.id ?? "", selectedLocation?.id ?? "", stationId))
          )
        }
        stations={outputStations}
        tenant={selectedTenant}
      />

      <LocationUsersSection
        isLoading={isLoadingUsers}
        location={selectedLocation}
        onArchive={(userId) =>
          runUserAction(async () =>
            void (await archiveLocationUser(selectedTenant?.id ?? "", selectedLocation?.id ?? "", userId))
          )
        }
        onCreate={(input) =>
          runUserAction(async () => void (await createLocationUser(selectedTenant?.id ?? "", selectedLocation?.id ?? "", input)))
        }
        onDelete={(userId) =>
          runUserAction(async () =>
            void (await deleteLocationUser(selectedTenant?.id ?? "", selectedLocation?.id ?? "", userId))
          )
        }
        onReload={() => refreshLocationUsers()}
        onResetPassword={(userId) =>
          runUserAction(async () =>
            void (await resetLocationUserPassword(selectedTenant?.id ?? "", selectedLocation?.id ?? "", userId, {}))
          )
        }
        onResetPin={(userId) =>
          runUserAction(async () => {
            const result = await resetLocationUserPin(selectedTenant?.id ?? "", selectedLocation?.id ?? "", userId, {});
            return result.generated_pin;
          })
        }
        onUpdate={(userId, input) =>
          runUserAction(async () =>
            void (await updateLocationUser(selectedTenant?.id ?? "", selectedLocation?.id ?? "", userId, input))
          )
        }
        tenant={selectedTenant}
        users={locationUsers}
      />
    </div>
  );
}

function mergePairingSession(
  current: LocalMasterPairingSession | undefined,
  incoming: LocalMasterPairingSession
): LocalMasterPairingSession {
  if (
    incoming.status === "ACTIVE" &&
    incoming.setup_code === null &&
    current?.id === incoming.id &&
    current.setup_code
  ) {
    return { ...incoming, setup_code: current.setup_code };
  }

  return incoming;
}

function keepSessionsForLocations(
  current: Record<string, LocalMasterPairingSession | undefined>,
  locations: Location[]
) {
  const locationIds = new Set(locations.map((location) => location.id));
  const next: Record<string, LocalMasterPairingSession | undefined> = {};

  for (const [locationId, session] of Object.entries(current)) {
    if (locationIds.has(locationId)) {
      next[locationId] = session;
    }
  }

  return cachePairingSessions(next);
}

function readCachedPairingSessions() {
  try {
    const raw = window.sessionStorage.getItem(pairingSessionStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};

    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, LocalMasterPairingSession | undefined>)
      : {};
  } catch {
    return {};
  }
}

function cachePairingSessions(sessions: Record<string, LocalMasterPairingSession | undefined>) {
  try {
    window.sessionStorage.setItem(pairingSessionStorageKey, JSON.stringify(sessions));
  } catch {
    // The UI can still use in-memory state if sessionStorage is unavailable.
  }

  return sessions;
}
