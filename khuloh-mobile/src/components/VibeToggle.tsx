import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Vibe, VIBE_COLORS, VIBE_LABELS } from "../types/profile";
import { T } from "../lib/theme";

const VIBES: Vibe[] = ["chat", "connect", "ignite"];

const VIBE_ICONS: Record<Vibe, string> = {
  chat: "💚",
  connect: "💛",
  ignite: "🔥",
};

const VIBE_DESCRIPTIONS: Record<Vibe, string> = {
  chat: "Friendship",
  connect: "Dating",
  ignite: "Casual",
};

type Props = {
  value: Vibe;
  onChange: (vibe: Vibe) => void;
  disabled?: boolean;
};

export default function VibeToggle({ value, onChange, disabled }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Your Vibe</Text>
      <View style={styles.row}>
        {VIBES.map((v) => {
          const active = value === v;
          const color = VIBE_COLORS[v];
          return (
            <TouchableOpacity
              key={v}
              style={[
                styles.option,
                active && { borderColor: color, backgroundColor: color + "18" },
              ]}
              onPress={() => onChange(v)}
              disabled={disabled}
              activeOpacity={0.7}
            >
              <Text style={styles.icon}>{VIBE_ICONS[v]}</Text>
              <Text style={[styles.optionLabel, active && { color }]}>
                {VIBE_LABELS[v]}
              </Text>
              <Text style={styles.optionDesc}>{VIBE_DESCRIPTIONS[v]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {value === "ignite" && (
        <View style={styles.privacyNote}>
          <Text style={styles.privacyText}>
            🔒 Whispers auto-delete after 24h • Screenshot blocking active
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", marginBottom: 20 },
  label: { fontSize: 14, fontWeight: "700", color: T.textSecondary, marginBottom: 10, textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "center", gap: 10 },
  option: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: T.border,
    backgroundColor: T.surface,
  },
  icon: { fontSize: 20, marginBottom: 4 },
  optionLabel: { fontSize: 13, fontWeight: "800", color: T.textSecondary },
  optionDesc: { fontSize: 10, color: T.textMuted, marginTop: 2 },
  privacyNote: {
    marginTop: 10,
    backgroundColor: T.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: T.danger + "33",
  },
  privacyText: { fontSize: 11, color: T.danger, textAlign: "center" },
});
