import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";
import { StoreProvider, useStore } from "../lib/store.tsx";
import { usePalette } from "../lib/theme.ts";

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Screens />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

function Screens() {
  const p = usePalette();
  const { t } = useStore();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: p.bg },
        headerTintColor: p.ink,
        headerTitleStyle: { fontWeight: "700" },
        headerBackTitle: t("nav.back"),
        contentStyle: { backgroundColor: p.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="browse" options={{ title: t("nav.explore") }} />
      <Stack.Screen name="map" options={{ title: t("nav.map") }} />
      <Stack.Screen name="saved" options={{ title: t("nav.saved") }} />
      <Stack.Screen name="settings" options={{ title: t("nav.settings") }} />
      <Stack.Screen name="signin" options={{ title: t("signin.title"), presentation: "modal" }} />
      <Stack.Screen name="activity/[id]" options={{ title: "" }} />
      <Stack.Screen name="add" options={{ title: t("nav.add"), presentation: "modal" }} />
      <Stack.Screen name="outings/index" options={{ title: t("nav.outings") }} />
      <Stack.Screen name="outings/[id]" options={{ title: "" }} />
      <Stack.Screen name="outings/setup" options={{ title: t("setup.title"), presentation: "modal" }} />
    </Stack>
  );
}
