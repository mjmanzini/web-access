export type AuthStackParamList = {
  PhoneEntry: undefined;
  OtpVerify: { phone: string };
};

// ── Bottom-tab roots ──
export type TabParamList = {
  ChatsTab: undefined;
  ZonesTab: undefined;
  SafeSpotsTab: undefined;
  ProfileTab: undefined;
};

// ── Stacks nested inside each tab ──
export type ChatsStackParamList = {
  ChatsList: undefined;
  Whisper: { targetUserId: string; targetUsername: string; conversationId?: string };
};

export type ZonesStackParamList = {
  ZonesDashboard: undefined;
  ZoneChat: { roomId: string; roomName: string };
  Whisper: { targetUserId: string; targetUsername: string; conversationId?: string };
};

export type SafeSpotsStackParamList = {
  SafeSpots: undefined;
  PairCheckin: { spotId: string; spotName: string };
};

export type ProfileStackParamList = {
  Profile: undefined;
  PointsHistory: undefined;
  PostMeetupReview: undefined;
  DataLightSettings: undefined;
  EmergencyContacts: undefined;
  SafetyCheckin: undefined;
  GhostMode: undefined;
  TermsOfService: undefined;
};
