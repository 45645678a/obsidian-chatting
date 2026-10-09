/**
 * ChatGPT OAuth service.
 *
 * Implements the Device Authorization Flow only — no localhost callback
 * server, so it works on mobile Obsidian where Node modules and local
 * sockets aren't available.
 *
 * Flow:
 *   1. beginDeviceAuthorization()  → POST /api/accounts/deviceauth/usercode
 *      Returns { deviceAuthId, userCode, verificationUri, intervalMs }.
 *      The user opens `verificationUri` in any browser and enters `userCode`.
 *   2. pollDeviceAuthorization()   → POST /api/accounts/deviceauth/token
 *      Polls until success (200 with authorization_code), then exchanges
 *      for access/refresh tokens via /oauth/token. Stores the credential.
 *   3. refreshCredential()         → POST /oauth/token with grant_type=refresh_token
 *      Used transparently by getUsableCredential() when the access token
 *      is about to expire.
 *
 * All HTTP goes through Obsidian's `requestUrl()`, which is the only
 * cross-platform fetch API available in mobile Obsidian.
 */
import { requestUrl } from "obsidian";
import type {
  ChatGPTOAuthCredential,
  ChatGPTOAuthStore,
} from "./chatgptOAuthStore";

const ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_VERIFICATION_URI = `${ISSUER}/codex/device`;
const DEVICE_REDIRECT_URI = `${ISSUER}/deviceauth/callback`;
const POLL_MARGIN_MS = 3000;
const USER_AGENT = "chatting-with-ai/chatgpt-oauth";

export class ChatGPTOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatGPTOAuthError";
  }
}

export interface ChatGPTDeviceAuthorization {
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  intervalMs: number;
}

/** Public surface: a `cancel()` callback that aborts a running poll. */
export interface PollHandle {
  /** Resolves with the credential once the user authorizes. */
  promise: Promise<ChatGPTOAuthCredential>;
  /** Cancel the poll loop. */
  cancel: () => void;
}

interface IdTokenClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id?: string }>;
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
}

interface TokenResponse {
  access_token: string;
  /** A refresh answer may leave it out: the old refresh token stays valid. */
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

interface DeviceAuthorizationResponse {
  device_auth_id: string;
  user_code: string;
  interval?: string | number;
}

interface DeviceTokenSuccess {
  authorization_code: string;
  code_verifier: string;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const base64UrlDecode = (input: string): string => {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + padding);
};

const parseJwtClaims = (token: string): IdTokenClaims | undefined => {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as IdTokenClaims;
  } catch {
    return undefined;
  }
};

const extractAccountIdFromClaims = (claims: IdTokenClaims): string | undefined => {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
};

const extractAccountId = (
  tokens: Pick<TokenResponse, "id_token" | "access_token">,
): string | undefined => {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token);
    if (claims) {
      const accountId = extractAccountIdFromClaims(claims);
      if (accountId) return accountId;
    }
  }
  const accessClaims = parseJwtClaims(tokens.access_token);
  return accessClaims ? extractAccountIdFromClaims(accessClaims) : undefined;
};

const describeError = (response: { status: number; text?: string; json?: unknown }): string => {
  if (typeof response.text === "string" && response.text.trim()) {
    return ` — ${response.text.trim().slice(0, 300)}`;
  }
  if (response.json && typeof response.json === "object") {
    try {
      return ` — ${JSON.stringify(response.json)}`;
    } catch {
      return "";
    }
  }
  return "";
};

export class ChatGPTOAuthService {
  /** The refresh in flight; parallel requests share it. */
  private refreshing: Promise<ChatGPTOAuthCredential> | null = null;

  constructor(private readonly store: ChatGPTOAuthStore) {}

  /** Synchronous read of the stored credential (whether or not it's expired). */
  getCredential(): ChatGPTOAuthCredential | null {
    return this.store.get();
  }

  /** Wipe the stored credential. */
  clearCredential(): void {
    this.store.clear();
  }

  /**
   * Start the device authorization flow.
   * Returns the user-facing code + verification URL the user must visit.
   */
  async beginDeviceAuthorization(): Promise<ChatGPTDeviceAuthorization> {
    const response = await requestUrl({
      url: `${ISSUER}/api/accounts/deviceauth/usercode`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ client_id: CLIENT_ID }),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ChatGPTOAuthError(
        `Failed to start ChatGPT device authorization: HTTP ${response.status}${describeError(response)}`,
      );
    }

    const data = response.json as DeviceAuthorizationResponse;
    if (!data?.device_auth_id || !data?.user_code) {
      throw new ChatGPTOAuthError("Device authorization response was missing required fields.");
    }

    const intervalSec = Math.max(parseInt(String(data.interval ?? "5"), 10) || 5, 1);

    return {
      deviceAuthId: data.device_auth_id,
      userCode: data.user_code,
      verificationUri: DEVICE_VERIFICATION_URI,
      intervalMs: intervalSec * 1000,
    };
  }

  /**
   * Poll for completion of a device authorization. Resolves with the stored
   * credential when the user finishes authorizing, or rejects on cancel /
   * unrecoverable error. Use `cancel()` from the returned handle to stop.
   */
  pollDeviceAuthorization(authorization: ChatGPTDeviceAuthorization): PollHandle {
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };

    const promise = (async (): Promise<ChatGPTOAuthCredential> => {
      while (true) {
        if (cancelled) {
          throw new ChatGPTOAuthError("ChatGPT login was cancelled.");
        }

        const response = await requestUrl({
          url: `${ISSUER}/api/accounts/deviceauth/token`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
          },
          body: JSON.stringify({
            device_auth_id: authorization.deviceAuthId,
            user_code: authorization.userCode,
          }),
          throw: false,
        });

        if (response.status >= 200 && response.status < 300) {
          const data = response.json as Partial<DeviceTokenSuccess>;
          if (
            typeof data.authorization_code !== "string" ||
            typeof data.code_verifier !== "string"
          ) {
            throw new ChatGPTOAuthError("Device authorization returned an invalid token payload.");
          }

          const credential = await this.exchangeAuthorizationCode({
            code: data.authorization_code,
            codeVerifier: data.code_verifier,
            redirectUri: DEVICE_REDIRECT_URI,
          });
          this.store.set(credential);
          return credential;
        }

        // 403/404 = "still pending"; anything else is a hard failure.
        if (response.status !== 403 && response.status !== 404) {
          throw new ChatGPTOAuthError(
            `Device authorization polling failed: HTTP ${response.status}${describeError(response)}`,
          );
        }

        await sleep(authorization.intervalMs + POLL_MARGIN_MS);
      }
    })();

    return { promise, cancel };
  }

  /**
   * Refresh an expiring credential. Stores the new credential on success.
   * Parallel calls share one request: a refresh token may only be used once.
   */
  refreshCredential(
    credential: Pick<ChatGPTOAuthCredential, "refreshToken" | "accountId">,
  ): Promise<ChatGPTOAuthCredential> {
    this.refreshing ??= this.refresh(credential).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /**
   * Disconnect or a new sign-in may replace the stored credential while the
   * request runs: the result is then not stored, and the caller gets an error.
   */
  private async refresh(
    credential: Pick<ChatGPTOAuthCredential, "refreshToken" | "accountId">,
  ): Promise<ChatGPTOAuthCredential> {
    const response = await requestUrl({
      url: `${ISSUER}/oauth/token`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credential.refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
      throw: false,
    });

    if (this.store.get()?.refreshToken !== credential.refreshToken) {
      throw new ChatGPTOAuthError("The ChatGPT sign-in changed while the token was refreshed. Try again.");
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ChatGPTOAuthError(
        `ChatGPT token refresh failed: HTTP ${response.status}${describeError(response)}`,
      );
    }

    const data = response.json as TokenResponse;
    const next = this.toCredential(data, credential.accountId, credential.refreshToken);
    this.store.set(next);
    return next;
  }

  /**
   * Return a credential that is guaranteed to be currently valid, refreshing
   * if necessary. Returns null if there's no stored credential at all.
   * Throws if a refresh is needed but fails.
   */
  async getUsableCredential(): Promise<ChatGPTOAuthCredential | null> {
    const current = this.store.get();
    if (!current) return null;
    if (!this.store.isExpired(current)) return current;
    return this.refreshCredential(current);
  }

  /** Exchange an authorization code (from device flow) for tokens. */
  private async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<ChatGPTOAuthCredential> {
    const response = await requestUrl({
      url: `${ISSUER}/oauth/token`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: CLIENT_ID,
        code_verifier: input.codeVerifier,
      }).toString(),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ChatGPTOAuthError(
        `ChatGPT token exchange failed: HTTP ${response.status}${describeError(response)}`,
      );
    }

    return this.toCredential(response.json as TokenResponse | undefined);
  }

  /**
   * A refresh answer without a refresh token keeps `previousRefreshToken`.
   * Without an access token (or any refresh token) it is an error: storing
   * it would sign the user out silently.
   */
  private toCredential(
    tokens: TokenResponse | undefined,
    fallbackAccountId?: string,
    previousRefreshToken?: string,
  ): ChatGPTOAuthCredential {
    const refreshToken = tokens?.refresh_token || previousRefreshToken;
    if (!tokens || typeof tokens.access_token !== "string" || !tokens.access_token || typeof refreshToken !== "string" || !refreshToken) {
      throw new ChatGPTOAuthError("The ChatGPT token response is missing tokens.");
    }
    const now = Date.now();
    const accountId = extractAccountId(tokens) ?? fallbackAccountId;
    return {
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt: now + (tokens.expires_in ?? 3600) * 1000,
      updatedAt: now,
      ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
      ...(accountId ? { accountId } : {}),
    };
  }
}
