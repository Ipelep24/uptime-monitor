"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  DJANGO,
  FASTAPI,
  UnauthorizedError,
  authFetch,
  errorMessage,
  isLoggedIn,
  logout,
} from "@/lib/api";

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
  const router = useRouter();
  const [monitors, setMonitors] = useState<MonitorStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [interval, setIntervalSec] = useState(60);
  const [expectedStatus, setExpectedStatus] = useState("200-299");
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${FASTAPI}/status`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      setMonitors(await res.json());
      setError(null);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        router.replace("/login");
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, router]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function addMonitor(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setAdding(true);
    try {
      const res = await authFetch(`${DJANGO}/monitors/`, {
        method: "POST",
        body: JSON.stringify({ name, url, expected_status: expectedStatus, interval_seconds: interval }),
      });
      if (!res.ok) {
        setFormError(await errorMessage(res, "Could not add monitor"));
        return;
      }
      setName("");
      setUrl("");
      setIntervalSec(60);
      load();
      setTimeout(load, 3500); // the status endpoint caches for ~3s
    } catch (err) {
      if (err instanceof UnauthorizedError) router.replace("/login");
      else setFormError("Could not reach the server");
    } finally {
      setAdding(false);
    }
  }

  async function deleteMonitor(id: number, monitorName: string) {
    if (!confirm(`Delete "${monitorName}" and its history?`)) return;
    try {
      const res = await authFetch(`${DJANGO}/monitors/${id}/`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMonitors((prev) => prev.filter((m) => m.id !== id));
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) router.replace("/login");
    }
  }

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  const allUp = monitors.length > 0 && monitors.every((m) => m.is_up);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Uptime Monitor</h1>
        <button
          onClick={handleLogout}
          className="rounded border px-3 py-1 text-sm"
        >
          Log out
        </button>
      </div>

      {!loading && !error && monitors.length > 0 && (
        <p
          className={`mt-2 font-medium ${allUp ? "text-green-600" : "text-red-600"
            }`}
        >
          {allUp ? "All systems operational" : "Some systems are down"}
        </p>
      )}

      <form
        onSubmit={addMonitor}
        className="mt-6 grid gap-2 rounded-lg border p-4 sm:grid-cols-[1fr_2fr_6rem_auto]"
      >
        <input
          className="rounded border bg-white p-2 text-black"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="rounded border bg-white p-2 text-black"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <input
          className="rounded border bg-white p-2 text-black"
          placeholder="200-299 (or 200-299,401)"
          value={expectedStatus}
          onChange={(e) => setExpectedStatus(e.target.value)}
        />
        <input
          className="rounded border bg-white p-2 text-black"
          type="number"
          min={30}
          value={interval}
          onChange={(e) => setIntervalSec(Number(e.target.value))}
          title="Check interval in seconds (min 30)"
        />
        <button
          type="submit"
          disabled={adding}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {adding ? "Adding..." : "Add"}
        </button>
        {formError && (
          <p className="text-sm text-red-600 sm:col-span-4">{formError}</p>
        )}
      </form>

      {loading && <p className="mt-6 text-gray-500">Loading...</p>}

      {error && (
        <p className="mt-6 rounded bg-red-100 p-3 text-red-700">
          Could not reach the API: {error}
        </p>
      )}

      {!loading && !error && monitors.length === 0 && (
        <p className="mt-6 text-gray-500">
          No monitors yet. Add one above to get started.
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
              <div className="flex items-center gap-3">
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
                <button
                  onClick={() => deleteMonitor(m.id, m.name)}
                  className="text-sm text-red-600 underline"
                >
                  Delete
                </button>
              </div>
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