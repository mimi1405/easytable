import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  completeAccountSetup,
  loadAccountSetupContext,
  type AccountSetupContext,
} from "../../lib/relay-sync-api";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; context: AccountSetupContext }
  | { status: "error"; message: string }
  | { status: "done"; email: string };

export function AccountSetupPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [pin, setPin] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!token) {
        setState({ status: "error", message: "Der Setup-Link ist unvollstaendig." });
        return;
      }

      try {
        const context = await loadAccountSetupContext(token);
        if (isMounted) {
          if (context.kind !== "platform_admin") {
            setState({ status: "error", message: "Dieser Setup-Link gehoert zur Staff App." });
            return;
          }

          setState({ status: "ready", context });
        }
      } catch (error) {
        if (isMounted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Der Setup-Link ist ungueltig oder abgelaufen.",
          });
        }
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (state.status !== "ready") {
      return;
    }

    const normalizedPin = pin.trim();

    if (password.length < 8) {
      setFormError("Das Passwort muss mindestens 8 Zeichen enthalten.");
      return;
    }

    if (password !== passwordConfirm) {
      setFormError("Die Passwoerter stimmen nicht ueberein.");
      return;
    }

    if (state.context.requires_pin && !/^\d{4,8}$/.test(normalizedPin)) {
      setFormError("Die POS-PIN muss aus 4 bis 8 Ziffern bestehen.");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await completeAccountSetup(token, {
        password,
        pin: state.context.requires_pin ? normalizedPin : undefined,
      });
      setState({ status: "done", email: state.context.email });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Der Zugang konnte nicht eingerichtet werden.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10 text-slate-100">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-8">
          <p className="text-xl font-semibold tracking-[0.18em] text-black">easyTable</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Zugang einrichten</h1>
        </div>

        <div className="rounded-lg border border-slate-800 bg-white p-6 text-slate-950 shadow-xl">
          {state.status === "loading" ? (
            <p className="text-sm text-black">Setup-Link wird geprüft...</p>
          ) : null}

          {state.status === "error" ? (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Link nicht nutzbar</h2>
              <p className="text-sm text-slate-600">{state.message}</p>
              <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white" onClick={() => (window.location.href = "/")}>
                Zum Login
              </button>
            </div>
          ) : null}

          {state.status === "done" ? (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Zugang ist bereit</h2>
              <p className="text-sm text-black">
                Dein Passwort wurde gesetzt. Du kannst dich jetzt mit {state.email} anmelden.
              </p>
              <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white" onClick={() => (window.location.href = "/")}>
                Zum Login
              </button>
            </div>
          ) : null}

          {state.status === "ready" ? (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <h2 className="text-xl font-semibold">Hallo {state.context.display_name}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Lege dein Passwort fuer {state.context.email} fest.
                  {state.context.requires_pin ? " Danach nutzt du deine PIN an der Kasse." : ""}
                </p>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Neues Passwort</span>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Passwort bestaetigen</span>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                  minLength={8}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  required
                  type="password"
                  value={passwordConfirm}
                />
              </label>

              {state.context.requires_pin ? (
                <label className="block space-y-2">
                  <span className="text-sm font-medium">POS-PIN</span>
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                    inputMode="numeric"
                    onChange={(event) => setPin(event.target.value)}
                    pattern="[0-9]{4,8}"
                    required
                    value={pin}
                  />
                </label>
              ) : null}

              {formError ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{formError}</p> : null}

              <button
                className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Wird gespeichert..." : "Zugang speichern"}
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
