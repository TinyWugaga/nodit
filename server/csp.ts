/**
 * Content-Security-Policy for the app shell. Rendered markdown (cards, reviews, architecture) can be
 * written by an AI agent, so nothing it contains may make the browser reach another host (decision 0010).
 */
const RESOURCE_DIRECTIVES = {
  'img-src': ["'self'", 'data:'],
  'media-src': ["'self'"],
}

const APP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  // mermaid injects <style> into the SVGs it renders
  'style-src': ["'self'", "'unsafe-inline'"],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
  ...RESOURCE_DIRECTIVES,
}

const serialize = (d: Record<string, string[]>) =>
  Object.entries(d)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ')

export const CSP = serialize(APP_DIRECTIVES)

/** Vite dev needs inline scripts and a websocket for HMR, so dev only enforces the resource directives. */
export const DEV_CSP = serialize(RESOURCE_DIRECTIVES)
