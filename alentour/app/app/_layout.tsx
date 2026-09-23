import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";
import { StoreProvider } from "../lib/store.tsx";
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
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: p.bg },
        headerTintColor: p.ink,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: p.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="browse" options={{ title: "Explorer" }} />
      <Stack.Screen name="saved" options={{ title: "Enregistrés" }} />
      <Stack.Screen name="activity/[id]" options={{ title: "", headerBackTitle: "Retour" }} />
    </Stack>
  );
}
