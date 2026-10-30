import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { SessionProvider } from "@/providers/session-provider";

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Slot />
    </SessionProvider>
  );
}
