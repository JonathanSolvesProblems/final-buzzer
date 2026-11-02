/** PayPal REST auth: client-credentials token, cached until a minute before it expires. */

export const PAYPAL_BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

let cached: { token: string; expiresAt: number } | null = null;

export async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set (see .env.example)");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  const body = await res.json() as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return cached.token;
}

export async function paypalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch(`${PAYPAL_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
}
