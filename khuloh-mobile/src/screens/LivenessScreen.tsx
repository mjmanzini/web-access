import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { T } from "../lib/theme";

export default function LivenessScreen() {
  const { refreshProfile } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Camera Access Required</Text>
        <Text style={styles.subtitle}>
          Khuloh requires a selfie scan to verify you are a real person.
        </Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleCapture = async () => {
    if (!cameraRef.current) return;

    setLoading(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });

      if (!photo?.base64) {
        Alert.alert("Error", "Failed to capture image. Please try again.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("verify-liveness", {
        body: { image_base64: photo.base64 },
      });

      if (error) {
        Alert.alert("Verification Error", "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      if (data?.match) {
        await refreshProfile();
        // Navigation handled automatically by AuthContext + nav guard
      } else {
        Alert.alert("Verification Failed", "Liveness check did not pass. Please try again.");
      }
    } catch {
      Alert.alert("Error", "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify Your Identity</Text>
      <Text style={styles.subtitle}>
        Look directly at the camera and tap the button below.
      </Text>

      <View style={styles.cameraWrapper}>
        <CameraView ref={cameraRef} style={styles.camera} facing="front" />
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleCapture}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Scan My Face</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bg,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  title: { fontSize: 24, fontWeight: "800", color: T.text, marginBottom: 8, textAlign: "center" },
  subtitle: { fontSize: 15, color: T.textSecondary, textAlign: "center", marginBottom: 24 },
  cameraWrapper: {
    width: 260,
    height: 260,
    borderRadius: 130,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: T.primary,
    marginBottom: 32,
  },
  camera: { flex: 1 },
  button: {
    backgroundColor: T.primary,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 40,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
