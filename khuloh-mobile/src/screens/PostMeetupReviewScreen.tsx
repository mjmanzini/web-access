import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { getPendingReviews, submitReview } from "../lib/safeSpots";
import type { PendingReview, MeetupRating } from "../types/safespots";
import { RATING_LABELS, RATING_DESCRIPTIONS } from "../types/safespots";
import { T } from "../lib/theme";

export default function PostMeetupReviewScreen() {
  const { user, refreshProfile } = useAuth();
  const [pending, setPending] = useState<PendingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeReview, setActiveReview] = useState<PendingReview | null>(null);
  const [selectedRating, setSelectedRating] = useState<MeetupRating | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadPending();
  }, [user]);

  const loadPending = async () => {
    setLoading(true);
    const data = await getPendingReviews();
    setPending(data);
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!activeReview || !selectedRating) return;

    setSubmitting(true);
    const result = await submitReview(
      activeReview.other_user_id,
      selectedRating,
      comment,
      activeReview.pair_checkin_id ?? undefined,
    );
    setSubmitting(false);

    if (result.success) {
      Alert.alert("Thank You!", "Your review helps keep the community safe. +15 Vibe Points earned!");
      await refreshProfile();
      setActiveReview(null);
      setSelectedRating(null);
      setComment("");
      await loadPending();
    } else {
      Alert.alert("Error", result.error ?? "Failed to submit review.");
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={T.primary} size="large" />
      </View>
    );
  }

  // Review form mode
  if (activeReview) {
    return (
      <View style={styles.container}>
        <View style={styles.reviewHeader}>
          <Text style={styles.reviewTitle}>Rate Your Meetup</Text>
          <Text style={styles.reviewSubtitle}>
            How was your experience with {activeReview.other_username ?? "this person"}?
          </Text>
        </View>

        <View style={styles.ratingsSection}>
          {(["safe", "respectful", "unreliable"] as MeetupRating[]).map((rating) => (
            <TouchableOpacity
              key={rating}
              style={[
                styles.ratingCard,
                selectedRating === rating && styles.ratingCardActive,
                rating === "unreliable" && selectedRating === rating && styles.ratingCardDanger,
              ]}
              onPress={() => setSelectedRating(rating)}
            >
              <Text style={styles.ratingLabel}>{RATING_LABELS[rating]}</Text>
              <Text style={styles.ratingDesc}>{RATING_DESCRIPTIONS[rating]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.commentInput}
          placeholder="Optional private comment…"
          placeholderTextColor={T.textMuted}
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={500}
        />

        <TouchableOpacity
          style={[
            styles.submitBtn,
            (!selectedRating || submitting) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!selectedRating || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Submit Review</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => { setActiveReview(null); setSelectedRating(null); setComment(""); }}>
          <Text style={styles.cancelText}>← Back to list</Text>
        </TouchableOpacity>

        <Text style={styles.privacyNote}>
          🔒 Reviews are private. Only trust score changes are visible.
        </Text>
      </View>
    );
  }

  // Pending list mode
  return (
    <View style={styles.container}>
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>🤝 Post-Meetup Reviews</Text>
        <Text style={styles.infoDesc}>
          After meeting someone at a Safe-Spot, rate your experience. Your feedback
          keeps the community safe and earns you 15 Vibe Points!
        </Text>
      </View>

      <FlatList
        data={pending}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>✨</Text>
            <Text style={styles.emptyText}>No pending reviews.</Text>
            <Text style={styles.emptySubtext}>
              Meet someone at a Safe-Spot to unlock reviews!
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.pendingCard}
            onPress={() => setActiveReview(item)}
          >
            <View style={styles.pendingAvatar}>
              <Text style={styles.pendingAvatarText}>
                {(item.other_username ?? "?")?.[0]?.toUpperCase()}
              </Text>
            </View>
            <View style={styles.pendingInfo}>
              <Text style={styles.pendingName}>
                {item.other_username ?? "Anonymous"}
              </Text>
              <Text style={styles.pendingDate}>
                Met on {formatTime(item.prompted_at)}
              </Text>
            </View>
            <Text style={styles.pendingArrow}>Rate →</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg, padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: T.bg },
  infoCard: {
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: T.primaryMuted,
  },
  infoTitle: { fontSize: 16, fontWeight: "800", color: T.text },
  infoDesc: { fontSize: 13, color: T.textSecondary, marginTop: 6, lineHeight: 18 },
  list: { paddingBottom: 32 },
  emptyWrap: { alignItems: "center", marginTop: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: "700", color: T.text },
  emptySubtext: { fontSize: 13, color: T.textMuted, marginTop: 4 },
  pendingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  pendingAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  pendingAvatarText: { fontSize: 16, fontWeight: "800", color: T.text },
  pendingInfo: { flex: 1 },
  pendingName: { fontSize: 15, fontWeight: "700", color: T.text },
  pendingDate: { fontSize: 12, color: T.textMuted, marginTop: 2 },
  pendingArrow: { fontSize: 13, fontWeight: "700", color: T.primary },
  // Review form
  reviewHeader: { marginBottom: 20 },
  reviewTitle: { fontSize: 20, fontWeight: "800", color: T.text },
  reviewSubtitle: { fontSize: 14, color: T.textSecondary, marginTop: 4 },
  ratingsSection: { marginBottom: 16 },
  ratingCard: {
    backgroundColor: T.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: T.border,
  },
  ratingCardActive: { borderColor: T.primary, backgroundColor: T.primaryMuted },
  ratingCardDanger: { borderColor: T.danger, backgroundColor: T.danger + "22" },
  ratingLabel: { fontSize: 16, fontWeight: "700", color: T.text },
  ratingDesc: { fontSize: 13, color: T.textSecondary, marginTop: 4 },
  commentInput: {
    backgroundColor: T.inputBg,
    color: T.text,
    fontSize: 14,
    borderRadius: 12,
    padding: 14,
    height: 80,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: T.border,
    marginBottom: 16,
  },
  submitBtn: {
    backgroundColor: T.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cancelText: { color: T.textSecondary, fontSize: 14, textAlign: "center", marginBottom: 12 },
  privacyNote: {
    fontSize: 12,
    color: T.textMuted,
    textAlign: "center",
    marginTop: 8,
  },
});
