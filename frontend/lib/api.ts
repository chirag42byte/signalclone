const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export const WS = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';
export function token() { if (typeof window === 'undefined') return ''; return localStorage.getItem('signal_token') || ''; }
export async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token()) headers.set('Authorization', `Bearer ${token()}`);
  const res = await fetch(`${API}${path}`, { ...options, headers, cache: 'no-store' });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.detail || 'Request failed'); }
  return res.json();
}
