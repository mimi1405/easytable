import { useCallback, useEffect, useState } from "react";

import { detectConnectionMode, type ConnectionMode } from "./local-master";

export function useConnectionModeMonitor(intervalMs = 5_000) {
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("OFFLINE");

  const refreshConnectionMode = useCallback(async () => {
    try {
      setConnectionMode(await detectConnectionMode());
    } catch (error) {
      console.warn("Could not detect Staff connection mode.", error);
      setConnectionMode("OFFLINE");
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function refreshIfMounted() {
      try {
        const mode = await detectConnectionMode();
        if (isMounted) {
          setConnectionMode(mode);
        }
      } catch (error) {
        console.warn("Could not detect Staff connection mode.", error);
        if (isMounted) {
          setConnectionMode("OFFLINE");
        }
      }
    }

    void refreshIfMounted();
    const timer = window.setInterval(refreshIfMounted, intervalMs);
    window.addEventListener("online", refreshIfMounted);
    window.addEventListener("offline", refreshIfMounted);
    document.addEventListener("visibilitychange", refreshIfMounted);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
      window.removeEventListener("online", refreshIfMounted);
      window.removeEventListener("offline", refreshIfMounted);
      document.removeEventListener("visibilitychange", refreshIfMounted);
    };
  }, [intervalMs]);

  return { connectionMode, refreshConnectionMode, setConnectionMode };
}
