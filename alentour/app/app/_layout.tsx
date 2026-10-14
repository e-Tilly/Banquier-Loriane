import React from "react";
import { Stack, ThemeProvider, DefaultTheme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View } from "react-native";
import { AppBackground } from "../components/AppBackground.tsx";
import { AmbientProvider } from "../lib/ambient.tsx";
import { StoreProvider, useStore } from "../lib/store.tsx";
import { usePalette } from "../lib/theme.ts";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <AmbientProvider>
        <View style={{ flex: 1, backgroundColor: "#EEF1F8" }}>
          <AppBackground />
          <ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: "transparent", card: "transparent" } }}>
            <Screens />
          </ThemeProvider>
        </View>
        </AmbientProvider>
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
        headerStyle: { backgroundColor: "transparent" }, headerShadowVisible: false,
        headerTintColor: p.ink,
        headerTitleStyle: { fontWeight: "700" },
        headerBackTitle: t("nav.back"),
        contentStyle: { backgroundColor: "transparent" },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="browse" options={{ headerShown: false }} />
      <Stack.Screen name="map" options={{ headerShown: false }} />
      <Stack.Screen name="saved" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ title: t("nav.settings") }} />
      <Stack.Screen name="signin" options={{ title: t("signin.title"), presentation: "modal" }} />
      <Stack.Screen name="activity/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="add" options={{ title: t("nav.add"), presentation: "modal" }} />
      <Stack.Screen name="outings/index" options={{ headerShown: false }} />
      <Stack.Screen name="outings/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="outings/setup" options={{ title: t("setup.title"), presentation: "modal" }} />
    </Stack>
  );
}
