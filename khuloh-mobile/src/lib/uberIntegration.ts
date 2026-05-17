import { Linking, Alert } from "react-native";
import { supabase } from "./supabase";
import type { SafeSpot } from "../types/safespots";

/**
 * Build an Uber deep-link to a Safe-Spot destination.
 * Also shares trip details with the user's emergency contacts.
 */
export async function bookUberToSafeSpot(spot: SafeSpot): Promise<void> {
  // 1. Build Uber deep link with destination
  const uberUrl =
    `uber://?action=setPickup&pickup=my_location` +
    `&dropoff[latitude]=${spot.latitude}` +
    `&dropoff[longitude]=${spot.longitude}` +
    `&dropoff[nickname]=${encodeURIComponent(spot.name)}`;

  // Fallback web URL for users without the Uber app
  const webUrl =
    `https://m.uber.com/ul/?action=setPickup&pickup=my_location` +
    `&dropoff[latitude]=${spot.latitude}` +
    `&dropoff[longitude]=${spot.longitude}` +
    `&dropoff[nickname]=${encodeURIComponent(spot.name)}`;

  // 2. Share trip info with emergency contacts
  await shareTripWithContacts(spot);

  // 3. Open Uber (app or web fallback)
  const canOpenUber = await Linking.canOpenURL(uberUrl);
  if (canOpenUber) {
    await Linking.openURL(uberUrl);
  } else {
    await Linking.openURL(webUrl);
  }
}

/**
 * Notify emergency contacts about the trip via SMS deep link.
 */
async function shareTripWithContacts(spot: SafeSpot): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Fetch emergency contacts
  const { data: contacts } = await supabase
    .from("emergency_contacts")
    .select("name, phone")
    .eq("user_id", user.id);

  if (!contacts || contacts.length === 0) {
    Alert.alert(
      "No Emergency Contacts",
      "Add emergency contacts in your profile to auto-share trip details.",
    );
    return;
  }

  // Fetch profile for username
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  const name = profile?.username ?? "A Khuloh user";
  const message =
    `🛡️ Khuloh Safety Alert: ${name} is heading to ${spot.name} (${spot.address}). ` +
    `GPS: ${spot.latitude}, ${spot.longitude}. ` +
    `This trip was booked through Khuloh Safe-Spots.`;

  // Open SMS with all emergency contacts
  const phones = contacts.map((c: any) => c.phone).join(",");
  const smsUrl = `sms:${phones}?body=${encodeURIComponent(message)}`;

  try {
    await Linking.openURL(smsUrl);
  } catch {
    // Silently fail — the trip still opens
  }
}

/**
 * Open Google Maps / Apple Maps directions to a Safe-Spot.
 */
export async function navigateToSafeSpot(spot: SafeSpot): Promise<void> {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${spot.latitude},${spot.longitude}&destination_place_id=${encodeURIComponent(spot.name)}`;
  await Linking.openURL(url);
}
