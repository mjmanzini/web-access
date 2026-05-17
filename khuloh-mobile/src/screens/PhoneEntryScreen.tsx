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
import { AuthStackParamList } from "../navigation/types";
import { T } from "../lib/theme";

type Props = NativeStackScreenProps<AuthStackParamList, "PhoneEntry">;

export default function PhoneEntryScreen({ navigation }: Props) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    const trimmed = phone.trim();
    if (!trimmed.startsWith("+") || trimmed.length < 8) {
      Alert.alert("Invalid number", "Enter a phone number in E.164 format (e.g. +1234567890)");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: trimmed });
    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    navigation.navigate("OtpVerify", { phone: trimmed });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Khuloh</Text>
        <Text style={styles.subtitle}>Safe conversations start here</Text>

        <TextInput
          style={styles.input}
          placeholder="+1 234 567 8900"
          placeholderTextColor="#888"
          keyboardType="phone-pad"
          autoComplete="tel"
          value={phone}
          onChangeText={setPhone}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSendOtp}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Send Code</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  inner: { flex: 1, justifyContent: "center", paddingHorizontal: 32 },
  title: { fontSize: 36, fontWeight: "800", color: T.text, textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 16, color: T.textSecondary, textAlign: "center", marginBottom: 40 },
  input: {
    backgroundColor: T.inputBg,
    color: T.text,
    fontSize: 18,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: T.border,
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
