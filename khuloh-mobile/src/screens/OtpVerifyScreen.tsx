import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { AuthStackParamList } from "../navigation/types";
import { T } from "../lib/theme";

type Props = NativeStackScreenProps<AuthStackParamList, "OtpVerify">;

export default function OtpVerifyScreen({ route }: Props) {
  const { phone } = route.params;
  const { bootstrapBackendSession } = useAuth();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    const trimmed = token.trim();
    if (trimmed.length !== 6) {
      Alert.alert("Invalid code", "Please enter the 6-digit code sent to your phone.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: trimmed,
      type: "sms",
    });
    setLoading(false);

    if (error) {
      Alert.alert("Verification failed", error.message);
      return;
    }

    const backendError = await bootstrapBackendSession({
      phone,
      displayName: `Khuloh ${phone.slice(-4)}`,
    });

    if (backendError) {
      Alert.alert(
        "Backend Sync Pending",
        "Phone verification succeeded, but the app could not mint a Node backend session yet. You can continue on the legacy session for now.",
      );
    }
    // On success, AuthContext switches to backend session; otherwise legacy session remains active.
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Verify Your Number</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to {phone}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="000000"
          placeholderTextColor="#888"
          keyboardType="number-pad"
          maxLength={6}
          value={token}
          onChangeText={setToken}
          autoFocus
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Verify</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  inner: { flex: 1, justifyContent: "center", paddingHorizontal: 32 },
  title: { fontSize: 28, fontWeight: "800", color: T.text, textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 15, color: T.textSecondary, textAlign: "center", marginBottom: 40 },
  input: {
    backgroundColor: T.inputBg,
    color: T.text,
    fontSize: 28,
    fontWeight: "700",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: T.border,
    textAlign: "center",
    letterSpacing: 12,
  },
  button: {
    backgroundColor: T.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
