"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  DJANGO,
  FASTAPI,
  UnauthorizedError,
  authFetch,
  errorMessage,
  getToken,
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
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [expectedStatus, setExpectedStatus] = useState("200-299");
  const [keyword, setKeyword] = useState("");
  const [interval, setIntervalSec] = useState(60);
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
    const id = setInterval(load, 60000); // fallback safety net
    return () => clearInterval(id);
  }, [load, router]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) return;
    const token = getToken();
    const es = new EventSource(`${FASTAPI}/stream?token=${token}`);

    es.onmessage = (event) => {
      if (event.data.startsWith(":")) return;
      try {
        const update = JSON.parse(event.data);
        setMonitors((prev) =>
          prev.map((m) =>
            m.id === update.monitor_id
              ? {
                  ...m,
                  is_up: update.is_up,
                  status_code: update.status_code,
                  response_time_ms: update.response_time_ms,
                  checked_at: new Date().toISOString(),
                }
              : m
          )
        );
      } catch {
        // ignore malformed messages
      }
    };

    return () => es.close();
  }, []);

  async function addMonitor(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setAdding(true);
    try {
      const res = await authFetch(`${DJANGO}/monitors/`, {
        method: "POST",
        body: JSON.stringify({
          name,
          url,
          expected_status: expectedStatus,
          keyword,
          interval_seconds: interval,
        }),
      });
      if (!res.ok) {
        setFormError(await errorMessage(res, "Could not add monitor"));
        return;
      }
      setName("");
      setUrl("");
      setExpectedStatus("200-299");
      setKeyword("");
      setIntervalSec(60);
      load();
      setTimeout(load, 3500);
    } catch (err) {
      if (err instanceof UnauthorizedError) router.replace("/login");
      else setFormError("Could not reach the server");
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit(id: number, patch: Partial<MonitorStatus> & { expected_status?: string; keyword?: string; interval_seconds?: number }) {
    try {
      const res = await authFetch(`${DJANGO}/monitors/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setEditingId(null);
        load();
      } else {
        alert(await errorMessage(res, "Could not save changes"));
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) router.replace("/login");
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

  const filtered = monitors.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.url.toLowerCase().includes(search.toLowerCase())
  );

  const allUp = monitors.length > 0 && monitors.every((m) => m.is_up);

  const chartData = monitors.map((m) => ({
    name: m.name,
    "Avg response (ms)": m.avg_response_ms ?? 0,
    "Uptime %": m.uptime_pct ?? 0,
  }));

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Uptime Monitor</h1>
        <button onClick={handleLogout} className="rounded border px-3 py-1 text-sm">
          Log out
        </button>
      </div>

      {!loading && !error && monitors.length > 0 && (
        <p className={`mt-2 font-medium ${allUp ? "text-green-600" : "text-red-600"}`}>
          {allUp ? "All systems operational" : "Some systems are down"}
        </p>
      )}

      <form
        onSubmit={addMonitor}
        className="mt-6 grid gap-2 rounded-lg border p-4 grid-cols-1 sm:grid-cols-3"
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
          placeholder="200-299 (or 200-299,401)"
          value={expectedStatus}
          onChange={(e) => setExpectedStatus(e.target.value)}
        />
        <input
          className="rounded border bg-white p-2 text-black"
          placeholder="Keyword (optional)"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <input
          className="rounded border col-span-2 bg-white p-2 text-black"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
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
          className="rounded cursor-pointer col-start-2 bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {adding ? "Adding..." : "Add monitor"}
        </button>
        {formError && <p className="text-sm text-red-600 sm:col-span-2">{formError}</p>}
      </form>

      {loading && <p className="mt-6 text-gray-500">Loading...</p>}
      {error && (
        <p className="mt-6 rounded bg-red-100 p-3 text-red-700">
          Could not reach the API: {error}
        </p>
      )}

      {!loading && !error && monitors.length > 0 && (
        <input
          className="mt-6 w-full rounded border bg-white p-2 text-black"
          placeholder="Search monitors by name or URL..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {!loading && !error && monitors.length === 0 && (
        <p className="mt-6 text-gray-500">No monitors yet. Add one above to get started.</p>
      )}

      <div className="mt-4 space-y-4">
        {filtered.map((m) =>
          editingId === m.id ? (
            <EditForm key={m.id} monitor={m} onSave={saveEdit} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={m.id} className="rounded-lg border p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <a href={`/monitors/${m.id}`} className="hover:underline">
                  <h2 className="text-lg font-semibold">{m.name}</h2>
                  <p className="text-sm text-gray-500">{m.url}</p>
                </a>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-medium ${
                      m.is_up === null
                        ? "bg-gray-200 text-gray-700"
                        : m.is_up
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {m.is_up === null ? "Pending" : m.is_up ? "Up" : "Down"}
                  </span>
                  <button
                    onClick={() => setEditingId(m.id)}
                    className="text-sm cursor-pointer text-gray-400 hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteMonitor(m.id, m.name)}
                    className="text-sm cursor-pointer text-gray-400 hover:text-white"
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
                    {m.response_time_ms !== null ? `${m.response_time_ms} ms` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Last checked</p>
                  <p className="font-semibold">{timeAgo(m.checked_at, now)}</p>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </main>
  );
}

function EditForm({
  monitor,
  onSave,
  onCancel,
}: {
  monitor: MonitorStatus;
  onSave: (id: number, patch: any) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(monitor.name);
  const [url, setUrl] = useState(monitor.url);
  const [expectedStatus, setExpectedStatus] = useState((monitor as any).expected_status ?? "200-299");
  const [keyword, setKeyword] = useState((monitor as any).keyword ?? "");
  const [interval, setIntervalSec] = useState((monitor as any).interval_seconds ?? 60);

  return (
    <div className="rounded-lg border-2 border-blue-500 p-4 shadow-sm">
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
        <input
          className="rounded border bg-white p-2 text-black sm:col-span-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
        <input
          className="rounded border bg-white p-2 text-black"
          value={expectedStatus}
          onChange={(e) => setExpectedStatus(e.target.value)}
          placeholder="Expected status"
        />
        <input
          className="rounded border bg-white p-2 text-black"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Keyword (optional)"
        />
        <input
          className="rounded border col-span-2 bg-white p-2 text-black"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL"
        />
        <input
          className="rounded border bg-white p-2 text-black"
          type="number"
          min={30}
          value={interval}
          onChange={(e) => setIntervalSec(Number(e.target.value))}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() =>
            onSave(monitor.id, {
              name,
              url,
              expected_status: expectedStatus,
              keyword,
              interval_seconds: interval,
            })
          }
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
        >
          Save
        </button>
        <button onClick={onCancel} className="rounded border px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}