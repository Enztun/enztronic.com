import "server-only";

import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

import { getCloudflareAccessEnv } from "@/lib/env";

const MAX_ACCESS_TOKEN_LENGTH = 16 * 1024;
const jwksByIssuer = new Map<string, JWTVerifyGetKey>();

export type AccessAuthenticationErrorCode =
  | "missing_token"
  | "invalid_token"
  | "email_not_allowed"
  | "misconfigured";

export interface AccessIdentity {
  email: string;
  subject: string;
  issuer: string;
  audience: readonly string[];
  issuedAt: number;
  expiresAt: number;
  developmentBypass: boolean;
}

export class AccessAuthenticationError extends Error {
  readonly code: AccessAuthenticationErrorCode;
  readonly status: 401 | 403 | 500;

  constructor(
    code: AccessAuthenticationErrorCode,
    status: 401 | 403 | 500,
    message = "Access authentication failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AccessAuthenticationError";
    this.code = code;
    this.status = status;
  }
}

function remoteKeySet(issuer: string): JWTVerifyGetKey {
  const existing = jwksByIssuer.get(issuer);
  if (existing) return existing;

  const jwksUrl = new URL("/cdn-cgi/access/certs", `${issuer}/`);
  const keySet = createRemoteJWKSet(jwksUrl, {
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  });
  jwksByIssuer.set(issuer, keySet);
  return keySet;
}

function validTokenShape(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ACCESS_TOKEN_LENGTH &&
    !/\s/.test(value) &&
    value.split(".").length === 3
  );
}

function cookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export function getAccessTokenFromHeaders(headers: Headers): string | null {
  const assertion = headers.get("cf-access-jwt-assertion")?.trim();
  const candidate =
    assertion || cookieValue(headers.get("cookie") ?? "", "CF_Authorization");

  return candidate && validTokenShape(candidate) ? candidate : null;
}

function configError(cause: unknown): AccessAuthenticationError {
  return new AccessAuthenticationError(
    "misconfigured",
    500,
    "Access authentication is not configured",
    { cause },
  );
}

export async function verifyCloudflareAccessToken(
  token: string,
): Promise<AccessIdentity> {
  if (!validTokenShape(token)) {
    throw new AccessAuthenticationError("invalid_token", 401);
  }

  let config;
  try {
    config = getCloudflareAccessEnv();
  } catch (error) {
    throw configError(error);
  }

  if (config.developmentBypass || !config.issuer) {
    throw configError(new Error("JWT verification is unavailable during bypass"));
  }

  try {
    const { payload } = await jwtVerify(token, remoteKeySet(config.issuer), {
      algorithms: ["RS256"],
      issuer: config.issuer,
      audience: [...config.audience],
      requiredClaims: ["exp", "iat", "sub", "email"],
      clockTolerance: 5,
    });

    const email =
      typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email || email.length > 254) {
      throw new AccessAuthenticationError("invalid_token", 401);
    }
    if (!config.allowedEmails.has(email)) {
      throw new AccessAuthenticationError("email_not_allowed", 403);
    }
    if (
      typeof payload.sub !== "string" ||
      typeof payload.iss !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      throw new AccessAuthenticationError("invalid_token", 401);
    }

    const audience = Array.isArray(payload.aud)
      ? payload.aud.filter((value): value is string => typeof value === "string")
      : typeof payload.aud === "string"
        ? [payload.aud]
        : [];

    return {
      email,
      subject: payload.sub,
      issuer: payload.iss,
      audience,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      developmentBypass: false,
    };
  } catch (error) {
    if (error instanceof AccessAuthenticationError) throw error;
    if (error instanceof joseErrors.JOSEError || error instanceof Error) {
      throw new AccessAuthenticationError("invalid_token", 401, undefined, {
        cause: error,
      });
    }
    throw new AccessAuthenticationError("invalid_token", 401);
  }
}

export async function authenticateAccessHeaders(
  headers: Headers,
): Promise<AccessIdentity> {
  let config;
  try {
    config = getCloudflareAccessEnv();
  } catch (error) {
    throw configError(error);
  }

  if (config.developmentBypass && config.developmentEmail) {
    return {
      email: config.developmentEmail,
      subject: `development:${config.developmentEmail}`,
      issuer: "development-only-bypass",
      audience: [],
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      developmentBypass: true,
    };
  }

  const token = getAccessTokenFromHeaders(headers);
  if (!token) {
    throw new AccessAuthenticationError("missing_token", 401);
  }
  return verifyCloudflareAccessToken(token);
}
