export function privateResponse(response: Response): Response {
  if (response.status === 101) return response
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'same-origin')
  headers.set('X-Frame-Options', 'DENY')
  const vary = new Set(
    (headers.get('Vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  vary.add('Cookie')
  headers.set('Vary', [...vary].join(', '))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function json(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return privateResponse(Response.json(body, { status, headers }))
}

export function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location })
  if (cookie) headers.set('Set-Cookie', cookie)
  return privateResponse(new Response(null, { status: 303, headers }))
}
