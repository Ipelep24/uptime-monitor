"use client";

import { useEffect, useState } from "react";

type MonitorStatus = {
  id: number;
  name: string;
  url: string;
  is_up: boolean | null;
  status_code: number | null;
  response_time_ms: number | null;
  checked_at: string | null;
  uptime_pct: number | null;
  avg_response_ms: number | null;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function timeAgo(iso: string | null, now: number) {
  if (!iso) return "never";
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(iso.replace(" ", "T")).getTime()) / 1000)
  );
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function Home() {
  const [monitors, setMonitors] = useState<MonitorStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API}/status`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data: MonitorStatus[] = await res.json();
        if (!cancelled) {
          setMonitors(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = setInterval(load, 5000); // refresh every 10s
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const allUp = monitors.length > 0 && monitors.every((m) => m.is_up);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-3xl font-bold">Uptime Monitor</h1>

      {!loading && !error && monitors.length > 0 && (
        <p
          className={`mt-2 font-medium ${allUp ? "text-green-600" : "text-red-600"
            }`}
        >
          {allUp ? "All systems operational" : "Some systems are down"}
        </p>
      )}

      {loading && <p className="mt-6 text-gray-500">Loading...</p>}

      {error && (
        <p className="mt-6 rounded bg-red-100 p-3 text-red-700">
          Could not reach the API: {error}
        </p>
      )}

      <div className="mt-6 space-y-4">
        {monitors.map((m) => (
          <div key={m.id} className="rounded-lg border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{m.name}</h2>
                <p className="text-sm text-gray-500">{m.url}</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${m.is_up === null
                    ? "bg-gray-200 text-gray-700"
                    : m.is_up
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
              >
                {m.is_up === null ? "Pending" : m.is_up ? "Up" : "Down"}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Uptime (24h)</p>
                <p className="font-semibold">
                  {m.uptime_pct !== null ? `${m.uptime_pct}%` : "-"}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Response time</p>
                <p className="font-semibold">
                  {m.response_time_ms !== null
                    ? `${m.response_time_ms} ms`
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Last checked</p>
                <p className="font-semibold">{timeAgo(m.checked_at, now)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}