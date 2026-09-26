/**
 * The deployed relay (see relay/). In `npm run dev` the relay runs inside Vite at /relay.
 * Override at build time with VITE_RELAY_URL, or per browser in Settings → Data → Advanced.
 */
export const RELAY_URL: string =
  import.meta.env.VITE_RELAY_URL || (import.meta.env.DEV ? '/relay' : 'https://redcoast-relay.lproperty.workers.dev');
