import { useCallback, useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

import { Button } from "@easytable/ui/components/button";

import {
  archiveOwnerUserForConnection,
  createOwnerUserForConnection,
  deleteOwnerUserForConnection,
  detectConnectionMode,
  loadOwnerUsersForConnection,
  resetOwnerUserPasswordForConnection,
  resetOwnerUserPinForConnection,
  updateOwnerUserForConnection,
  type ConnectionMode,
  type TenantLocationUser,
  type TenantLocationUserInput,
} from "../../../lib/local-master";
import { EmployeesView } from "./EmployeesView";

export function OwnerEmployeesPage() {
  const [users, setUsers] = useState<TenantLocationUser[]>([]);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("OFFLINE");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextMode = await detectConnectionMode();
      setConnectionMode(nextMode);
      setUsers(await loadOwnerUsersForConnection(nextMode));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Mitarbeiter konnten nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  async function runUserAction<T>(action: () => Promise<T>): Promise<T> {
    setError(null);

    try {
      const result = await action();
      await refreshUsers();
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Mitarbeiter-Aktion fehlgeschlagen.");
      throw actionError;
    }
  }

  useEffect(() => {
    void refreshUsers();
  }, [refreshUsers]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      {error ? <ErrorBanner message={error} onRetry={refreshUsers} /> : null}
      <EmployeesView
        isLoading={isLoading}
        onArchive={(userId) =>
          runUserAction(async () => void (await archiveOwnerUserForConnection(connectionMode, userId)))
        }
        onCreate={(input: TenantLocationUserInput) => runUserAction(async () => void (await createOwnerUserForConnection(connectionMode, input)))}
        onDelete={(userId) =>
          runUserAction(async () => void (await deleteOwnerUserForConnection(connectionMode, userId)))
        }
        onReload={refreshUsers}
        onResetPassword={(userId) =>
          runUserAction(async () => void (await resetOwnerUserPasswordForConnection(connectionMode, userId)))
        }
        onResetPin={(userId) =>
          runUserAction(async () => {
            const result = await resetOwnerUserPinForConnection(connectionMode, userId);
            return result.generated_pin;
          })
        }
        onUpdate={(userId, input) =>
          runUserAction(async () => void (await updateOwnerUserForConnection(connectionMode, userId, input)))
        }
        users={users}
      />
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-destructive sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <WifiOff className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">Mitarbeiterverwaltung nicht verfuegbar</p>
          <p className="break-words text-sm opacity-80">{message}</p>
        </div>
      </div>
      <Button onClick={onRetry} type="button" variant="outline">
        Erneut laden
      </Button>
    </div>
  );
}
