import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Profile } from "../types/profile";
import {
  BackendUser,
  clearBackendToken,
  fetchMe,
  fetchMyProfile,
  getStoredBackendToken,
  registerBackendSession,
  storeBackendToken,
  updateMyProfile,
} from "../lib/backend-client";

type Session = {
  token: string;
  user: BackendUser;
  source: "backend" | "supabase";
};

type AuthState = {
  session: Session | null;
  user: BackendUser | null;
  profile: Profile | null;
  isLoading: boolean;
  refreshProfile: () => Promise<void>;
  bootstrapBackendSession: (input: { phone?: string; email?: string; displayName?: string }) => Promise<string | null>;
  updateProfile: (input: {
    username?: string | null;
    bio?: string | null;
    vibe?: Profile["vibe"];
    city?: string | null;
    dataLightMode?: boolean;
  }) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  isLoading: true,
  refreshProfile: async () => {},
  bootstrapBackendSession: async () => null,
  updateProfile: async () => null,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLegacyProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    setProfile(data as Profile | null);
  };

  const refreshProfile = async () => {
    if (!session?.user?.id) return;
    if (session.source === "backend") {
      try {
        setProfile(await fetchMyProfile(session.token));
      } catch {
        setProfile(null);
      }
      return;
    }
    await fetchLegacyProfile(session.user.id);
  };

  const activateBackendSession = async (token: string) => {
    const [user, nextProfile] = await Promise.all([
      fetchMe(token),
      fetchMyProfile(token),
    ]);
    await storeBackendToken(token);
    setSession({ token, user, source: "backend" });
    setProfile(nextProfile);
  };

  const bootstrapBackendSession = async (input: { phone?: string; email?: string; displayName?: string }) => {
    try {
      const displayName = String(input.displayName || input.phone || input.email || "Khuloh User").trim();
      const sessionUser = await registerBackendSession({
        phone: input.phone,
        email: input.email,
        displayName,
      });
      await activateBackendSession(sessionUser.token);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Backend session bootstrap failed";
    }
  };

  const updateProfile = async (input: {
    username?: string | null;
    bio?: string | null;
    vibe?: Profile["vibe"];
    city?: string | null;
    dataLightMode?: boolean;
  }) => {
    if (!session?.user?.id) return "Not signed in";

    if (session.source === "backend") {
      try {
        const nextProfile = await updateMyProfile(session.token, input);
        setProfile(nextProfile);
        const nextUser = {
          ...session.user,
          username: nextProfile.username,
        };
        setSession({ ...session, user: nextUser });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : "Profile update failed";
      }
    }

    try {
      const { error } = await supabase.rpc("update_own_profile", {
        _username: input.username ?? undefined,
        _bio: input.bio ?? undefined,
        _avatar: null,
        _vibe: input.vibe ?? undefined,
      });
      if (error) return error.message;
      await refreshProfile();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Profile update failed";
    }
  };

  const signOut = async () => {
    await clearBackendToken().catch(() => {});
    await supabase.auth.signOut().catch(() => {});
    setSession(null);
    setProfile(null);
  };

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      const backendToken = await getStoredBackendToken();
      if (backendToken) {
        try {
          const user = await fetchMe(backendToken);
          const nextProfile = await fetchMyProfile(backendToken);
          if (!cancelled) {
            setSession({ token: backendToken, user, source: "backend" });
            setProfile(nextProfile);
            setIsLoading(false);
          }
          return;
        } catch {
          await clearBackendToken().catch(() => {});
        }
      }

      const { data: { session: legacySession } } = await supabase.auth.getSession();
      if (!cancelled && legacySession?.user?.id) {
        setSession({
          token: legacySession.access_token,
          source: "supabase",
          user: {
            id: legacySession.user.id,
            username: legacySession.user.user_metadata?.username ?? null,
            displayName: legacySession.user.user_metadata?.display_name ?? null,
            phone: legacySession.user.phone ?? null,
          },
        });
        await fetchLegacyProfile(legacySession.user.id);
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, s) => {
      const backendToken = await getStoredBackendToken();
      if (backendToken) return;

      if (s?.user?.id) {
        setSession({
          token: s.access_token,
          source: "supabase",
          user: {
            id: s.user.id,
            username: s.user.user_metadata?.username ?? null,
            displayName: s.user.user_metadata?.display_name ?? null,
            phone: s.user.phone ?? null,
          },
        });
        fetchLegacyProfile(s.user.id).catch(() => setProfile(null));
      } else {
        setSession(null);
        setProfile(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user || null,
        profile,
        isLoading,
        refreshProfile,
        bootstrapBackendSession,
        updateProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
