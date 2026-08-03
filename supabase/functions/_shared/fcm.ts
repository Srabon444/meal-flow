import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (const b of buf) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pkcs8 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// Exchanges the service-account key for a short-lived OAuth2 access token
// (JWT bearer flow, signed with Web Crypto - avoids the npm:google-auth-library
// Deno-compat issues, and the app already had zero deps for VAPID's own crypto).
async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
      })
    )
  );
  const unsigned = `${header}.${claims}`;
  const key = await importPrivateKey(account.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!res.ok) throw new Error(`FCM token exchange failed: ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  cachedToken = { value: access_token, expiresAt: now + expires_in };
  return access_token;
}

function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('FCM_SERVICE_ACCOUNT_JSON is not set');
  return JSON.parse(raw);
}

// Sends an FCM `notification`-type message to every token owned by userIds,
// and prunes tokens FCM reports as gone (UNREGISTERED/NOT_FOUND) - same
// hygiene as sendToUsers() in webpush.ts. `notification`-type payloads are
// what let Android show the system notification with zero app code when the
// app is backgrounded or fully killed - see plan doc for why this matters.
export async function sendFcmToUsers(
  client: SupabaseClient,
  userIds: string[],
  payload: { title: string; body: string }
): Promise<{ sent: number; stale: number; failed: number }> {
  if (userIds.length === 0) return { sent: 0, stale: 0, failed: 0 };

  const { data: tokens, error } = await client
    .from('fcm_tokens')
    .select('id, token')
    .in('user_id', userIds);
  if (error) throw error;
  if (!tokens || tokens.length === 0) return { sent: 0, stale: 0, failed: 0 };

  const account = loadServiceAccount();
  const accessToken = await getAccessToken(account);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  for (const row of tokens) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { token: row.token, notification: payload }
      })
    });
    if (res.ok) {
      sent++;
      continue;
    }
    const body = await res.json().catch(() => ({}));
    const status = body?.error?.status;
    if (status === 'UNREGISTERED' || status === 'NOT_FOUND' || status === 'INVALID_ARGUMENT') {
      staleIds.push(row.id);
    } else {
      failed++;
      console.error('fcm send failed', row.id, body);
    }
  }

  if (staleIds.length > 0) {
    await client.from('fcm_tokens').delete().in('id', staleIds);
  }

  return { sent, stale: staleIds.length, failed };
}
