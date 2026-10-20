// Validate configuration without printing credentials or contacting providers.
export function validatePilotEnv(env) {
  const errors = [];
  const required = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'GOOGLE_GMAIL_CLIENT_ID', 'GOOGLE_GMAIL_CLIENT_SECRET', 'GOOGLE_GMAIL_REDIRECT_URI', 'GOOGLE_CALENDAR_REDIRECT_URI', 'GMAIL_TOKEN_ENCRYPTION_KEY', 'OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  for (const name of required) if (!env[name]?.trim()) errors.push(`${name}: required for the full pilot workflow.`);
  function https(name, originOnly = false) {
    if (!env[name]) return null;
    try {
      const url = new URL(env[name]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || (originOnly && url.pathname !== '/')) throw Error();
      return url;
    } catch { errors.push(`${name}: use a public HTTPS ${originOnly ? 'origin without a path' : 'URL'}.`); return null; }
  }
  const app = https('NEXT_PUBLIC_APP_URL', true);
  https('NEXT_PUBLIC_SUPABASE_URL', true);
  for (const [name, path] of [['GOOGLE_GMAIL_REDIRECT_URI', '/gmail/callback'], ['GOOGLE_CALENDAR_REDIRECT_URI', '/calendar/callback']]) {
    const url = https(name);
    if (url && (url.pathname !== path || (app && url.origin !== app.origin))) errors.push(`${name}: must use NEXT_PUBLIC_APP_URL followed by ${path}.`);
  }
  if (env.GMAIL_TOKEN_ENCRYPTION_KEY && !/^[a-f\d]{64}$/i.test(env.GMAIL_TOKEN_ENCRYPTION_KEY)) errors.push('GMAIL_TOKEN_ENCRYPTION_KEY: must be exactly 64 hexadecimal characters.');
  if (Boolean(env.GOOGLE_CALENDAR_CLIENT_ID) !== Boolean(env.GOOGLE_CALENDAR_CLIENT_SECRET)) errors.push('Set both Calendar client overrides, or omit both to reuse Gmail credentials.');
  for (const name of Object.keys(env)) if (name.startsWith('NEXT_PUBLIC_') && /SECRET|TOKEN|PRIVATE|SERVICE_ROLE|OPENAI.*KEY/i.test(name)) errors.push(`${name}: server credentials must not be public.`);
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (key) {
    let valid = key.startsWith('sb_publishable_');
    if (!valid) { try { valid = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {} }
    if (!valid) errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: use a publishable key or legacy anon key, never a service-role key.');
  }
  return errors;
}
