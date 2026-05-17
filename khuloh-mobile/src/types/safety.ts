export type EmergencyContact = {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  created_at: string;
};

export type SafetyCheckin = {
  id: string;
  user_id: string;
  met_user_id: string;
  latitude: number | null;
  longitude: number | null;
  status: 'pending' | 'safe' | 'alerted' | 'expired';
  check_at: string;
  responded_at: string | null;
  created_at: string;
};

export type UserReport = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  created_at: string;
};

export type ScanResult = {
  flagged: boolean;
  flags: string[];
};
