import React, { useEffect } from "react";
import { ActivityIndicator, View, Text } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { AuthProvider, useAuth } from "./src/contexts/AuthContext";
import {
  AuthStackParamList,
  TabParamList,
  ChatsStackParamList,
  ZonesStackParamList,
  SafeSpotsStackParamList,
  ProfileStackParamList,
} from "./src/navigation/types";
import { T } from "./src/lib/theme";
import { startAutoFlush } from "./src/lib/offlineQueue";

import PhoneEntryScreen from "./src/screens/PhoneEntryScreen";
import OtpVerifyScreen from "./src/screens/OtpVerifyScreen";
import LivenessScreen from "./src/screens/LivenessScreen";
import ChatsListScreen from "./src/screens/ChatsListScreen";
import WhisperChatScreen from "./src/screens/WhisperChatScreen";
import ZonesDashboardScreen from "./src/screens/ZonesDashboardScreen";
import ZoneChatScreen from "./src/screens/ZoneChatScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import EmergencyContactsScreen from "./src/screens/EmergencyContactsScreen";
import SafetyCheckinScreen from "./src/screens/SafetyCheckinScreen";
import PointsHistoryScreen from "./src/screens/PointsHistoryScreen";
import SafeSpotsMapScreen from "./src/screens/SafeSpotsMapScreen";
import PairCheckinScreen from "./src/screens/PairCheckinScreen";
import PostMeetupReviewScreen from "./src/screens/PostMeetupReviewScreen";
import DataLightSettingsScreen from "./src/screens/DataLightSettingsScreen";
import GhostModeScreen from "./src/screens/GhostModeScreen";
import TermsOfServiceScreen from "./src/screens/TermsOfServiceScreen";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const ChatsStack = createNativeStackNavigator<ChatsStackParamList>();
const ZonesStack = createNativeStackNavigator<ZonesStackParamList>();
const SafeSpotsStack = createNativeStackNavigator<SafeSpotsStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const stackScreenOpts = {
  headerStyle: { backgroundColor: T.bg },
  headerTintColor: T.text,
  headerTitleStyle: { fontWeight: "800" as const },
};

// ── Tab icon helper (text-emoji for zero-dep simplicity) ──
function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{label}</Text>
  );
}

// ── Nested stacks ─────────────────────────────────────────
function ChatsStackScreen() {
  return (
    <ChatsStack.Navigator screenOptions={stackScreenOpts}>
      <ChatsStack.Screen
        name="ChatsList"
        component={ChatsListScreen}
        options={{ title: "Chats" }}
      />
      <ChatsStack.Screen
        name="Whisper"
        component={WhisperChatScreen}
        options={({ route }) => ({ title: route.params.targetUsername })}
      />
    </ChatsStack.Navigator>
  );
}

function ZonesStackScreen() {
  return (
    <ZonesStack.Navigator screenOptions={stackScreenOpts}>
      <ZonesStack.Screen
        name="ZonesDashboard"
        component={ZonesDashboardScreen}
        options={{ title: "Zones" }}
      />
      <ZonesStack.Screen
        name="ZoneChat"
        component={ZoneChatScreen}
        options={({ route }) => ({ title: route.params.roomName })}
      />
      <ZonesStack.Screen
        name="Whisper"
        component={WhisperChatScreen}
        options={({ route }) => ({ title: route.params.targetUsername })}
      />
    </ZonesStack.Navigator>
  );
}

function ProfileStackScreen() {
  return (
    <ProfileStack.Navigator screenOptions={stackScreenOpts}>
      <ProfileStack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: "Profile" }}
      />
      <ProfileStack.Screen
        name="PointsHistory"
        component={PointsHistoryScreen}
        options={{ title: "Vibe Points" }}
      />
      <ProfileStack.Screen
        name="PostMeetupReview"
        component={PostMeetupReviewScreen}
        options={{ title: "Meetup Reviews" }}
      />
      <ProfileStack.Screen
        name="DataLightSettings"
        component={DataLightSettingsScreen}
        options={{ title: "Data-Free Mode" }}
      />
      <ProfileStack.Screen
        name="EmergencyContacts"
        component={EmergencyContactsScreen}
        options={{ title: "Emergency Contacts" }}
      />
      <ProfileStack.Screen
        name="SafetyCheckin"
        component={SafetyCheckinScreen}
        options={{ title: "Safety Check-In" }}
      />
      <ProfileStack.Screen
        name="GhostMode"
        component={GhostModeScreen}
        options={{ title: "Ghost Mode" }}
      />
      <ProfileStack.Screen
        name="TermsOfService"
        component={TermsOfServiceScreen}
        options={{ title: "Terms & Privacy" }}
      />
    </ProfileStack.Navigator>
  );
}

function SafeSpotsStackScreen() {
  return (
    <SafeSpotsStack.Navigator screenOptions={stackScreenOpts}>
      <SafeSpotsStack.Screen
        name="SafeSpots"
        component={SafeSpotsMapScreen}
        options={{ title: "Safe-Spots" }}
      />
      <SafeSpotsStack.Screen
        name="PairCheckin"
        component={PairCheckinScreen}
        options={({ route }) => ({ title: `Check-In: ${route.params.spotName}` })}
      />
    </SafeSpotsStack.Navigator>
  );
}

// ── Root navigator ────────────────────────────────────────
function RootNavigator() {
  const { session, profile, isLoading } = useAuth();

  useEffect(() => {
    if (session && profile?.is_verified) startAutoFlush();
  }, [session, profile?.is_verified]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: T.bg }}>
        <ActivityIndicator color={T.primary} size="large" />
      </View>
    );
  }

  if (!session) {
    return (
      <AuthStack.Navigator screenOptions={{ headerShown: false }}>
        <AuthStack.Screen name="PhoneEntry" component={PhoneEntryScreen} />
        <AuthStack.Screen name="OtpVerify" component={OtpVerifyScreen} />
      </AuthStack.Navigator>
    );
  }

  if (!profile?.is_verified) {
    const LivenessStack = createNativeStackNavigator();
    return (
      <LivenessStack.Navigator screenOptions={{ headerShown: false }}>
        <LivenessStack.Screen name="Liveness" component={LivenessScreen} />
      </LivenessStack.Navigator>
    );
  }

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: T.tabBg,
          borderTopColor: T.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: T.tabActive,
        tabBarInactiveTintColor: T.tabInactive,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
      }}
    >
      <Tab.Screen
        name="ChatsTab"
        component={ChatsStackScreen}
        options={{
          tabBarLabel: "Chats",
          tabBarIcon: ({ focused }) => <TabIcon label="💬" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ZonesTab"
        component={ZonesStackScreen}
        options={{
          tabBarLabel: "Zones",
          tabBarIcon: ({ focused }) => <TabIcon label="🌍" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="SafeSpotsTab"
        component={SafeSpotsStackScreen}
        options={{
          tabBarLabel: "Safe-Spots",
          tabBarIcon: ({ focused }) => <TabIcon label="🛡️" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackScreen}
        options={{
          tabBarLabel: "Profile",
          tabBarIcon: ({ focused }) => <TabIcon label="👤" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
