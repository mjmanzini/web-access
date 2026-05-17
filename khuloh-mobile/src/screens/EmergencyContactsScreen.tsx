import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { EmergencyContact } from "../types/safety";
import { T } from "../lib/theme";

export default function EmergencyContactsScreen() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchContacts = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("emergency_contacts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    setContacts((data as EmergencyContact[]) ?? []);
  };

  useFocusEffect(
    useCallback(() => {
      fetchContacts().finally(() => setLoading(false));
    }, [user]),
  );

  const handleAdd = async () => {
    const trimName = name.trim();
    const trimPhone = phone.trim();
    if (!trimName || !trimPhone) {
      Alert.alert("Missing info", "Enter both a name and phone number.");
      return;
    }
    if (!trimPhone.startsWith("+") || trimPhone.length < 8) {
      Alert.alert("Invalid number", "Use E.164 format (e.g. +27821234567).");
      return;
    }
    if (!user) return;

    setAdding(true);
    const { error } = await supabase.from("emergency_contacts").insert({
      user_id: user.id,
      name: trimName,
      phone: trimPhone,
    });
    setAdding(false);

    if (error) {
      if (error.code === "23505") {
        Alert.alert("Duplicate", "This phone number is already in your contacts.");
      } else {
        Alert.alert("Error", error.message);
      }
      return;
    }

    setName("");
    setPhone("");
    await fetchContacts();
  };

  const handleDelete = (contact: EmergencyContact) => {
    Alert.alert("Remove Contact", `Remove ${contact.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await supabase
            .from("emergency_contacts")
            .delete()
            .eq("id", contact.id);
          await fetchContacts();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={T.primary} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={contacts}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Emergency Contacts</Text>
            <Text style={styles.headerSub}>
              These people are alerted if you don't check in after meeting someone.
            </Text>

            <View style={styles.addForm}>
              <TextInput
                style={styles.input}
                placeholder="Contact name"
                placeholderTextColor="#666"
                value={name}
                onChangeText={setName}
              />
              <TextInput
                style={styles.input}
                placeholder="+27 82 123 4567"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
              <TouchableOpacity
                style={[styles.addBtn, adding && styles.addBtnDisabled]}
                onPress={handleAdd}
                disabled={adding}
              >
                {adding ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.addBtnText}>Add Contact</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>No emergency contacts yet.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardInfo}>
              <Text style={styles.contactName}>{item.name}</Text>
              <Text style={styles.contactPhone}>{item.phone}</Text>
            </View>
            <TouchableOpacity onPress={() => handleDelete(item)}>
              <Text style={styles.deleteText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: T.bg,
  },
  list: { flex: 1 },
  listContent: { paddingBottom: 32 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 22, fontWeight: "800", color: T.text },
  headerSub: { fontSize: 13, color: T.textSecondary, marginTop: 4, marginBottom: 16 },
  addForm: { gap: 10, marginBottom: 16 },
  input: {
    backgroundColor: T.inputBg,
    color: T.text,
    fontSize: 15,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: T.border,
  },
  addBtn: {
    backgroundColor: T.primary,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  addBtnDisabled: { opacity: 0.6 },
  addBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  emptyText: { color: T.textMuted, fontSize: 14, textAlign: "center", marginTop: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.surface,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 14,
    padding: 16,
  },
  cardInfo: { flex: 1 },
  contactName: { fontSize: 16, fontWeight: "700", color: T.text },
  contactPhone: { fontSize: 13, color: T.textSecondary, marginTop: 2 },
  deleteText: { fontSize: 13, color: T.danger, fontWeight: "600" },
});
