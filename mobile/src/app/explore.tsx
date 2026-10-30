import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";

const FLOW_STEPS = [
  "Customer creates an order and confirms route, date, and price.",
  "Approved carriers see the lead, respond with their own price or take it at the customer price.",
  "Customer accepts the offer, and the order moves into deposit mode.",
  "Carrier submits a payment reference, admin verifies the deposit, and contacts unlock automatically.",
  "The trip can be moved to in-progress, completed, and then extended into a return trip.",
];

export default function ExploreScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="subtitle">Flow Overview</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.lead}>
          This screen is a quick walkthrough of the core marketplace scenario we test locally.
        </ThemedText>

        {FLOW_STEPS.map((step) => (
          <ThemedView key={step} type="backgroundSelected" style={styles.step}>
            <ThemedText type="small">{step}</ThemedText>
          </ThemedView>
        ))}
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 24,
  },
  card: {
    borderRadius: 24,
    padding: 20,
    gap: 12,
  },
  lead: {
    lineHeight: 22,
  },
  step: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
