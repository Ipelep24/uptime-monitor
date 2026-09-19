export const DJANGO =
  process.env.NEXT_PUBLIC_DJANGO_URL ?? "http://localhost:8001/api";
export const FASTAPI =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ACCESS = "access_token";
const REFRESH = "refresh_token";

export class UnauthorizedError extends Error {}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS);
}

export function isLoggedIn(): boolean {
  return getToken() !== null;
}

export function logout() {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
}

function saveTokens(access: string, refresh?: string) {
  localStorage.setItem(ACCESS, access);
  if (refresh) localStorage.setItem(REFRESH, refresh);
}

// Turns a Django REST error response into a readable message.
export async function errorMessage(res: Response, fallback: string) {
  try {
    const data = await res.json();
    const first = Object.values(data)[0];
    if (Array.isArray(first)) return String(first[0]);
    if (typeof first === "string") return first;
    return fallback;
  } catch {
    return fallback;
  }
}

export async function login(username: string, password: string) {
  const res = await fetch(`${DJANGO}/auth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Invalid username or password");
  const data = await res.json();
  saveTokens(data.access, data.refresh);
}

export async function register(username: string, password: string) {
  const res = await fetch(`${DJANGO}/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Could not register"));
  await login(username, password);
}

async function refreshAccess(): Promise<boolean> {
  const refresh = localStorage.getItem(REFRESH);
  if (!refresh) return false;
  const res = await fetch(`${DJANGO}/auth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  saveTokens(data.access);
  return true;
}

// fetch() that adds the login token, and refreshes it once if it expired.
export async function authFetch(url: string, init: RequestInit = {}) {
  const send = () =>
    fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...((init.headers as Record<string, string>) ?? {}),
        Authorization: `Bearer ${getToken()}`,
      },
    });

  let res = await send();
  if (res.status === 401 && (await refreshAccess())) {
    res = await send();
  }
  if (res.status === 401) {
    logout();
    throw new UnauthorizedError("Session expired");
  }
  return res;
}