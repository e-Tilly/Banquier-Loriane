/**
 * Push registration for outing reminders (T−24h, T−2h, confirmations). The server's inbox is
 * the source of truth; push is a copy. Skipped on web, in Expo Go, and until the project has
 * an EAS project id (`eas init` writes it to app.json → extra.eas.projectId).
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { api } from "./api.ts";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function registerForPush(token: string): Promise<void> {
  if (Platform.OS === "web" || Constants.executionEnvironment === "storeClient") return;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return;
  try {
    const current = await Notifications.getPermissionsAsync();
    const status = current.granted ? "granted" : (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    const push = await Notifications.getExpoPushTokenAsync({ projectId });
    await api("POST", "/v1/me/push-tokens", { token: push.data, platform: Platform.OS }, token);
  } catch { /* push is best-effort */ }
}
