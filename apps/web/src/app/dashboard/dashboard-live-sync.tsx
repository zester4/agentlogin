"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function DashboardLiveSync({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const lastEventId = useRef("");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let outageStartedAt = 0;
    let retryAttempt = 0;

    const refresh = () => {
      if (refreshTimer.current || stopped) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        if (!stopped) router.refresh();
      }, 250);
    };

    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
      outageStartedAt = 0;
    };

    const startFallback = () => {
      if (fallbackTimer) return;
      outageStartedAt = outageStartedAt || Date.now();
      fallbackTimer = setInterval(() => {
        if (Date.now() - outageStartedAt > 5 * 60_000) {
          if (fallbackTimer) clearInterval(fallbackTimer);
          fallbackTimer = null;
          return;
        }
        refresh();
      }, 30_000);
    };

    const connect = () => {
      if (stopped) return;
      const url = lastEventId.current
        ? "/api/dashboard/events?cursor=" + encodeURIComponent(lastEventId.current)
        : "/api/dashboard/events";
      source = new EventSource(url);
      source.onopen = () => {
        retryAttempt = 0;
        setConnected(true);
        stopFallback();
      };
      source.addEventListener("dashboard.invalidate", (event: Event) => {
        const message = event as MessageEvent<string>;
        if (message.lastEventId) lastEventId.current = message.lastEventId;
        refresh();
      });
      source.onerror = () => {
        source?.close();
        source = null;
        setConnected(false);
        startFallback();
        if (reconnectTimer) return;
        const baseDelay = Math.min(30_000, 1_000 * (2 ** Math.min(retryAttempt, 5)));
        retryAttempt += 1;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, baseDelay + Math.floor(Math.random() * 500));
      };
    };

    connect();
    return () => {
      stopped = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    };
  }, [enabled, router]);

  if (!enabled) return null;
  return (
    <span className="topbar-session" aria-live="polite" data-live-sync={connected ? "connected" : "reconnecting"}>
      <i /> {connected ? "LIVE UPDATES" : "RECONNECTING"}
    </span>
  );
}
