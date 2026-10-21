import { timingSafeEqual } from 'node:crypto'
import { json, redirect } from './http'
import { loginPage } from './login'

const SESSION_SECONDS = 12 * 60 * 60
const ATTEMPT_WINDOW = 10 * 60
const ATTEMPT_LIMIT = 10
const TOKEN_PATTERN = /^[a-f0-9]{64}$/

export interface Session {
  tokenHash: string
  expiresAt: number
}

export function authConfigured(env: Env): boolean {
  return (
    !!env.AUTH_API_KEY?.trim() &&
    env.AUTH_API_KEY !== 'replace-with-a-long-random-login-key'
  )
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

async function hash(value: string): Promise<string> {
  return hex(await digest(value))
}

function cookieName(request: Request): string {
  return new URL(request.url).protocol === 'https:'
    ? '__Host-droplet_session'
    : 'droplet_session'
}

function sessionToken(request: Request): string | null {
  const values = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName(request)}=`))
  if (values.length !== 1) return null
  const token = values[0].slice(cookieName(request).length + 1)
  return TOKEN_PATTERN.test(token) ? token : null
}

export function sessionCookie(
  request: Request,
  token = '',
  maxAge = 0,
): string {
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
}

export function sameOrigin(request: Request): boolean {
  return (
    request.headers.get('Origin') === new URL(request.url).origin &&
    request.headers.get('Sec-Fetch-Site') !== 'cross-site'
  )
}

export async function getSession(
  request: Request,
  env: Env,
): Promise<Session | null> {
  const token = sessionToken(request)
  if (!token || !authConfigured(env)) return null
  const tokenHash = await hash(token)
  const row = await env.SESSIONS_DB.prepare(
    'SELECT expires_at FROM sessions WHERE token_hash = ?1 AND key_hash = ?2 AND expires_at > ?3',
  )
    .bind(
      tokenHash,
      await hash(env.AUTH_API_KEY),
      Math.floor(Date.now() / 1000),
    )
    .first<{ expires_at: number }>()
  return row ? { tokenHash, expiresAt: row.expires_at } : null
}

class LoginError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function readKey(request: Request): Promise<string> {
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim()
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/x-www-form-urlencoded'
  ) {
    throw new LoginError(415, 'Submit the API key as JSON or a form.')
  }
  if (!request.body) throw new LoginError(400, 'Enter your dashboard API key.')
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let text = '',
    bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > 4096) {
      await reader.cancel()
      throw new LoginError(413, 'The sign-in request is too large.')
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  let key: unknown
  if (contentType === 'application/json') {
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new LoginError(400, 'The sign-in request is invalid.')
    }
    key =
      body && typeof body === 'object' && 'apiKey' in body
        ? body.apiKey
        : undefined
  } else key = new URLSearchParams(text).get('apiKey')
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024)
    throw new LoginError(400, 'Enter your dashboard API key.')
  return key
}

async function allowAttempt(
  request: Request,
  env: Env,
  now: number,
): Promise<boolean> {
  const windowStart = Math.floor(now / ATTEMPT_WINDOW) * ATTEMPT_WINDOW
  const clientHash = await hash(
    `${env.AUTH_API_KEY}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`,
  )
  const result = await env.SESSIONS_DB.batch<{ attempts: number }>([
    env.SESSIONS_DB.prepare(
      'DELETE FROM login_attempts WHERE window_start < ?1',
    ).bind(windowStart - ATTEMPT_WINDOW),
    env.SESSIONS_DB.prepare(
      'INSERT INTO login_attempts (client_hash, window_start, attempts) VALUES (?1, ?2, 1) ON CONFLICT (client_hash, window_start) DO UPDATE SET attempts = attempts + 1 RETURNING attempts',
    ).bind(clientHash, windowStart),
  ])
  return (result[1].results[0]?.attempts ?? Infinity) <= ATTEMPT_LIMIT
}

export async function login(request: Request, env: Env): Promise<Response> {
  const form = new URL(request.url).pathname === '/login'
  const failure = (status: number, message: string) =>
    form
      ? loginPage(message, status)
      : json({ code: 'login_failed', message }, status)
  if (!sameOrigin(request))
    return failure(403, 'Sign in from this site to continue.')
  if (!authConfigured(env))
    return failure(
      503,
      'Sign-in is not configured. Add AUTH_API_KEY to the Worker secrets.',
    )
  try {
    const key = await readKey(request)
    const now = Math.floor(Date.now() / 1000)
    if (!(await allowAttempt(request, env, now))) {
      const response = failure(
        429,
        'Too many sign-in attempts. Try again in 10 minutes.',
      )
      response.headers.set('Retry-After', String(ATTEMPT_WINDOW))
      return response
    }
    const [provided, expected] = await Promise.all([
      digest(key),
      digest(env.AUTH_API_KEY),
    ])
    if (!timingSafeEqual(provided, expected))
      return failure(401, 'The API key is incorrect.')
    const token = hex(crypto.getRandomValues(new Uint8Array(32)))
    const tokenHash = await hash(token)
    const expiresAt = now + SESSION_SECONDS
    const previous = sessionToken(request)
    await env.SESSIONS_DB.batch([
      env.SESSIONS_DB.prepare(
        'DELETE FROM sessions WHERE expires_at <= ?1 OR token_hash = ?2',
      ).bind(now, previous ? await hash(previous) : ''),
      env.SESSIONS_DB.prepare(
        'INSERT INTO sessions (token_hash, key_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
      ).bind(tokenHash, hex(expected), now, expiresAt),
    ])
    const cookie = sessionCookie(request, token, SESSION_SECONDS)
    return form
      ? redirect('/', cookie)
      : json({ authenticated: true, expiresAt }, 200, { 'Set-Cookie': cookie })
  } catch (error) {
    if (error instanceof LoginError) return failure(error.status, error.message)
    console.error(JSON.stringify({ event: 'login_storage_failed' }))
    return failure(
      503,
      'Sign-in is temporarily unavailable. Check the session database migrations and try again.',
    )
  }
}

export async function logout(
  request: Request,
  env: Env,
  session: Session,
): Promise<Response> {
  if (!sameOrigin(request))
    return json(
      { code: 'forbidden', message: 'Sign out from this site to continue.' },
      403,
    )
  await env.SESSIONS_DB.prepare('DELETE FROM sessions WHERE token_hash = ?1')
    .bind(session.tokenHash)
    .run()
  return redirect('/login', sessionCookie(request))
}
