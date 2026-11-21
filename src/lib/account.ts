// Optional account on your own Pi server (server/server.py). The app works fully without it; sync (sync.ts) uses this session.
const KEY = 'tracker-account'

export type Account = { server: string; token: string; username: string; expiresAt: number; isAdmin?: boolean }

export const getAccount = (): Account | null => {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Account | null
    return a && a.expiresAt * 1000 > Date.now() ? a : null
  } catch { return null }
}
/** The session is no longer valid (expired, or the server forgot it). */
export const forgetAccount = () => localStorage.removeItem(KEY)

/** '192.168.1.13:8787' becomes 'http://192.168.1.13:8787'; an empty address means the one this app was loaded from. */
const clean = (s: string) => { const v = s.trim().replace(/\/+$/, ''); return v && !/^https?:\/\//i.test(v) ? `http://${v}` : v }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function call(server: string, path: string, init?: RequestInit) {
  let r: Response
  try { r = await fetch(`${clean(server)}${path}`, init) } catch { throw new ApiError('Cannot reach the server. Check the address and that you are on the same network or Tailscale.', 0) }
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError((body as { error?: string }).error ?? `Server error ${r.status}`, r.status)
  return body as Record<string, unknown>
}

/** An authenticated JSON POST to the account's server. */
export const apiPost = (a: Account, path: string, body: object) =>
  call(a.server, path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }, body: JSON.stringify(body) })

/** Send a photo's JPEG; the server keeps it under this name (the photo's uid). Sending one it already has is fine. */
export const uploadPhoto = (a: Account, name: string, blob: Blob) =>
  call(a.server, `/api/photo/${name}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${a.token}` }, body: blob })

/** A photo's JPEG from the server, or null if it has none by that name. */
export async function downloadPhoto(a: Account, name: string): Promise<Blob | null> {
  let r: Response
  try { r = await fetch(`${clean(a.server)}/api/photo/${name}`, { headers: { Authorization: `Bearer ${a.token}` } }) } catch { throw new ApiError('Cannot reach the server. Check the address and that you are on the same network or Tailscale.', 0) }
  if (r.status === 404) return null
  if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Server error ${r.status}`, r.status)
  return await r.blob()
}

const post = (server: string, path: string, body: object) => call(server, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, device: navigator.platform || 'browser' }) })

/** mode 'register' creates the account (the server says so if the name is taken). */
export async function authenticate(mode: 'login' | 'register', server: string, username: string, password: string): Promise<Account> {
  const d = await post(server, mode === 'login' ? '/api/login' : '/api/register', { username, password })
  const a: Account = { server: clean(server), token: d.token as string, username: d.username as string, expiresAt: d.expiresAt as number, isAdmin: !!d.isAdmin }
  localStorage.setItem(KEY, JSON.stringify(a))
  return a
}

export type AdminUser = { username: string; isAdmin: boolean; createdAt: number; lastLogin: number | null; sessions: number }
export async function adminUsers(a: Account): Promise<AdminUser[]> {
  const d = await call(a.server, '/api/admin/users', { headers: { Authorization: `Bearer ${a.token}` } })
  return d.users as AdminUser[]
}

export async function signOut() {
  const a = getAccount()
  localStorage.removeItem(KEY)
  if (a) await call(a.server, '/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${a.token}` } }).catch(() => undefined)
}
