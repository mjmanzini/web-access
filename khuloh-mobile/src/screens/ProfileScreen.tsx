import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { Vibe, VIBE_COLORS } from "../types/profile";
import VibeToggle from "../components/VibeToggle";
import { T } from "../lib/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ProfileStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "Profile">;

export default function ProfileScreen({ navigation }: Props) {
  const { profile, refreshProfile, signOut, updateProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(profile?.username ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [vibe, setVibe] = useState<Vibe>(profile?.vibe ?? "chat");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUsername(profile?.username ?? "");
    setBio(profile?.bio ?? "");
    setVibe(profile?.vibe ?? "chat");
  }, [profile?.id, profile?.username, profile?.bio, profile?.vibe]);

  const handleSave = async () => {
    setSaving(true);
    const error = await updateProfile({
      username: username || null,
      bio: bio || null,
      vibe,
    });
    setSaving(false);

    if (error) {
      Alert.alert("Error", error);
      return;
    }

    await refreshProfile();
    setEditing(false);
  };

  const handleSignOut = async () => {
    await signOut();
  };

  if (!profile) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={T.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.avatarPlaceholder, { borderWidth: 3, borderColor: VIBE_COLORS[profile.vibe ?? 'chat'] }]}>
        <Text style={styles.avatarText}>
          {(profile.username ?? profile.phone)?.[0]?.toUpperCase() ?? "?"}
        </Text>
      </View>

      {profile.is_verified && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>✓ Verified</Text>
        </View>
      )}

      {editing ? (
        <>
          <VibeToggle value={vibe} onChange={setVibe} />
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="#888"
            value={username}
            onChangeText={setUsername}
          />
          <TextInput
            style={[styles.input, styles.bioInput]}
            placeholder="Bio"
            placeholderTextColor="#888"
            value={bio}
            onChangeText={setBio}
            multiline
          />
          <TouchableOpacity
            style={[styles.button, saving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Save</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              setEditing(false);
              setUsername(profile.username ?? "");
              setBio(profile.bio ?? "");
              setVibe(profile.vibe ?? "chat");
            }}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <VibeToggle value={profile.vibe ?? 'chat'} onChange={async (v) => {
            const error = await updateProfile({ vibe: v });
            if (error) {
              Alert.alert("Error", error);
              return;
            }
            await refreshProfile();
          }} />
          <Text style={styles.username}>{profile.username ?? "No username"}</Text>
          <Text style={styles.bio}>{profile.bio || "No bio yet"}</Text>
          <Text style={styles.trustScore}>Trust Score: {profile.trust_score}</Text>

          <TouchableOpacity
            style={styles.vibePointsCard}
            onPress={() => navigation.navigate("PointsHistory")}
          >
            <Text style={styles.vibePointsLabel}>⚡ Vibe Points</Text>
            <Text style={styles.vibePointsValue}>{profile.vibe_points ?? 0}</Text>
            <Text style={styles.vibePointsHint}>Tap to view history →</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={() => setEditing(true)}>
            <Text style={styles.buttonText}>Edit Profile</Text>
          </TouchableOpacity>

          <View style={styles.safetySection}>
            <Text style={styles.safetySectionTitle}>🛡️ Safety</Text>
            <TouchableOpacity
              style={styles.safetyLink}
              onPress={() => navigation.navigate("SafetyCheckin")}
            >
              <Text style={styles.safetyLinkText}>Safety Check-Ins</Text>
              <Text style={styles.safetyLinkArrow}>→</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.safetyLink}
              onPress={() => navigation.navigate("EmergencyContacts")}
            >
              <Text style={styles.safetyLinkText}>Emergency Contacts</Text>
              <Text style={styles.safetyLinkArrow}>→</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.safetyLink}
              onPress={() => navigation.navigate("PostMeetupReview")}
            >
              <Text style={styles.safetyLinkText}>🤝 Meetup Reviews</Text>
              <Text style={styles.safetyLinkArrow}>→</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.safetySection}>
            <Text style={styles.safetySectionTitle}>⚙️ Settings</Text>
            <TouchableOpacity
              style={styles.safetyLink}
              onPress={() => navigation.navigate("DataLightSettings")}
            >
              <Text style={styles.safetyLinkText}>📡 Data-Free Mode</Text>
              <Text style={styles.safetyLinkArrow}>→</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.safetyLink}
              onPress={() => navigation.navigate("GhostMode")}
            >
              <Text style={styles.safetyLinkText}>👻 Ghost Mode</Text>
              <Text style={styles.safetyLinkArrow}>→</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.safetyLink}
              onPress={() => navigation.navigate("TermsOfService")}
            >
              <Text style={styles.safetyLinkText}>📜 Terms & Privacy</Text>
              <Text style={styles.safetyLinkArrow}>→</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 32 },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: T.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  avatarText: { fontSize: 40, fontWeight: "800", color: T.text },
  badge: {
    backgroundColor: T.primaryMuted,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 20,
  },
  badgeText: { color: T.primary, fontWeight: "700", fontSize: 13 },
  username: { fontSize: 22, fontWeight: "700", color: T.text, marginBottom: 6 },
  bio: { fontSize: 15, color: T.textSecondary, textAlign: "center", marginBottom: 8 },
  trustScore: { fontSize: 14, color: T.textMuted, marginBottom: 24 },
  vibePointsCard: {
    width: "100%",
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: T.primaryMuted,
  },
  vibePointsLabel: { fontSize: 14, fontWeight: "700", color: T.primary },
  vibePointsValue: { fontSize: 36, fontWeight: "800", color: T.text, marginVertical: 4 },
  vibePointsHint: { fontSize: 12, color: T.textMuted },
  input: {
    width: "100%",
    backgroundColor: T.inputBg,
    color: T.text,
    fontSize: 16,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  bioInput: { height: 80, textAlignVertical: "top" },
  button: {
    backgroundColor: T.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: "center",
    width: "100%",
    marginBottom: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryButton: { paddingVertical: 12 },
  secondaryButtonText: { color: T.textSecondary, fontSize: 15 },
  signOutButton: { marginTop: 32, paddingVertical: 12 },
  signOutText: { color: T.danger, fontSize: 15, fontWeight: "600" },
  safetySection: {
    width: "100%",
    marginTop: 24,
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 16,
  },
  safetySectionTitle: { fontSize: 16, fontWeight: "700", color: T.text, marginBottom: 12 },
  safetyLink: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  safetyLinkText: { fontSize: 15, color: T.textSecondary },
  safetyLinkArrow: { fontSize: 16, color: T.primary, fontWeight: "700" },
});
