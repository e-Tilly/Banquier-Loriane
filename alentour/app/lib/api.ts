/**
 * API client and session storage.
 *
 * The session token lives in the OS keychain (expo-secure-store) on iOS/Android. The web has
 * no keychain, so it falls back to local storage there — acceptable for a companion surface,
 * and the only option a browser offers.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { config } from "./config.ts";

const TOKEN_KEY = "alentour.session";

export interface ApiUser {
  id: string;
  email: string | null;
  displayName: string | null;
  birthYear: number | null;
  locale: string;
  trustLevel: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;
  constructor(status: number, code: string, body: Record<string, unknown> = {}) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export const apiEnabled = () => !!config.apiUrl;

export async function loadToken(): Promise<string | null> {
  try {
    return Platform.OS === "web" ? await AsyncStorage.getItem(TOKEN_KEY) : await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string | null): Promise<void> {
  try {
    if (Platform.OS === "web") {
      await (token ? AsyncStorage.setItem(TOKEN_KEY, token) : AsyncStorage.removeItem(TOKEN_KEY));
    } else {
      await (token ? SecureStore.setItemAsync(TOKEN_KEY, token) : SecureStore.deleteItemAsync(TOKEN_KEY));
    }
  } catch { /* nothing sensible to do; the user signs in again */ }
}

export async function api<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  token?: string | null,
): Promise<T> {
  if (!config.apiUrl) throw new ApiError(0, "api_disabled");
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "http_error", data as Record<string, unknown>);
  return data as T;
}
