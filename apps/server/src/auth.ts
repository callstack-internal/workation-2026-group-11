// Verifies that a request came from a signed-in @callstack.com Google
// account. The Chrome extension gets an OAuth access token via
// chrome.identity (see apps/extension/src/background.ts) and sends it as
// `Authorization: Bearer <token>`; we ask Google to vouch for it rather than
// trusting anything the client claims.
//
// No Google Workspace admin access is required for this — it's a plain
// server-side check against Google's public tokeninfo endpoint.

import type { NextFunction, Request, Response } from "express";

const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const ALLOWED_EMAIL_DOMAIN = "callstack.com";
const CACHE_TTL_MS = 60_000;

// Must match the extension's OAuth client ID (apps/extension/.env) so a
// token minted for some other app with `email` scope can't be replayed here.
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
if (!clientId) {
  throw new Error(
    "GOOGLE_OAUTH_CLIENT_ID is not set. Copy apps/server/.env.example to " +
      "apps/server/.env and set it to the same value as the extension's " +
      "GOOGLE_OAUTH_CLIENT_ID."
  );
}

interface TokenInfo {
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  scope?: string;
}

// The extension polls every few seconds; re-verifying every request against
// Google would be wasteful and risks tokeninfo's rate limit, so a verified
// token is trusted for a short window.
const verifiedUntil = new Map<string, { email: string; expiresAt: number }>();

function isAllowedEmail(email: string): boolean {
  return email.trim().toLowerCase().split("@")[1] === ALLOWED_EMAIL_DOMAIN;
}

async function verifyToken(token: string): Promise<string | null> {
  const cached = verifiedUntil.get(token);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.email;
    verifiedUntil.delete(token);
  }

  const res = await fetch(
    `${TOKENINFO_URL}?access_token=${encodeURIComponent(token)}`
  );
  if (!res.ok) return null; // expired, revoked, or malformed token

  const info = (await res.json()) as TokenInfo;
  if (info.aud !== clientId) return null;
  if (info.email_verified !== true && info.email_verified !== "true") return null;
  if (!info.email || !isAllowedEmail(info.email)) return null;

  verifiedUntil.set(token, { email: info.email, expiresAt: Date.now() + CACHE_TTL_MS });
  return info.email;
}

export async function requireCallstackAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const [scheme, token] = (req.header("authorization") ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let email: string | null;
  try {
    email = await verifyToken(token);
  } catch {
    // Fail closed: if Google's endpoint is unreachable, deny rather than
    // trust the caller.
    res.status(503).json({ error: "Auth check unavailable, try again shortly" });
    return;
  }

  if (!email) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}
