import * as Device from "expo-device";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { mobileApi } from "@/lib/mobile-api";
import type { AuthChallenge, AuthSession, MobileRole, MobileSessionUser } from "@/lib/mobile-types";

const SESSION_KEY = "artur-pro-mobile-session-v2";
const APP_LOCK_KEY = "artur-pro-mobile-lock-enabled";
const INSTALLATION_ID_KEY = "artur-pro-mobile-installation-id";
const RELOCK_AFTER_MS = 30_000;

type StoredSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

type SessionContextValue = {
  isReady: boolean;
  token: string | null;
  user: MobileSessionUser | null;
  isLocked: boolean;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  requestChallenge: (payload: { role: MobileRole; name: string; phone: string }) => Promise<AuthChallenge>;
  verifyChallenge: (payload: { challengeId: string; code: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  unlockApp: () => Promise<boolean>;
  setBiometricLockEnabled: (enabled: boolean) => Promise<boolean>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const getStoredValue = async (key: string) => {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
};

const setStoredValue = async (key: string, value: string | null) => {
  if (Platform.OS === "web") {
    if (value == null) {
      globalThis.localStorage?.removeItem(key);
    } else {
      globalThis.localStorage?.setItem(key, value);
    }
    return;
  }

  if (value == null) {
    await SecureStore.deleteItemAsync(key);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
};

const parseBoolean = (value: string | null) => value === "true";

const parseStoredSession = (value: string | null): StoredSession | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as StoredSession;
    if (!parsed.accessToken || !parsed.refreshToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const buildInstallationId = () =>
  `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const isUnauthorizedError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  (error as { status?: number }).status === 401;

const resolveBiometricAvailability = async () => {
  if (Platform.OS === "web") {
    return false;
  }

  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);

  return hasHardware && isEnrolled;
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [user, setUser] = useState<MobileSessionUser | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const backgroundedAtRef = useRef<number | null>(null);
  const installationIdRef = useRef<string | null>(null);

  const persistSession = useCallback(async (session: StoredSession | null) => {
    await setStoredValue(SESSION_KEY, session ? JSON.stringify(session) : null);
  }, []);

  const clearSessionState = useCallback(async () => {
    setToken(null);
    setRefreshToken(null);
    setSessionExpiresAt(null);
    setUser(null);
    setIsLocked(false);
    await persistSession(null);
  }, [persistSession]);

  const applySession = useCallback(async (session: AuthSession) => {
    const snapshot: StoredSession = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    };

    setToken(session.accessToken);
    setRefreshToken(session.refreshToken);
    setSessionExpiresAt(session.expiresAt);
    setUser(session.user);
    setIsLocked(false);
    await persistSession(snapshot);
  }, [persistSession]);

  const authenticateAppLock = async () => {
    if (!biometricEnabled || !biometricAvailable || Platform.OS === "web") {
      setIsLocked(false);
      return true;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Разблокировать ARTUR PRO",
      cancelLabel: "Позже",
      disableDeviceFallback: false,
      biometricsSecurityLevel: "strong",
    });

    if (result.success) {
      setIsLocked(false);
      return true;
    }

    return false;
  };

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      const [storedSessionValue, storedLockValue, installationIdValue, canUseBiometric] = await Promise.all([
        getStoredValue(SESSION_KEY),
        getStoredValue(APP_LOCK_KEY),
        getStoredValue(INSTALLATION_ID_KEY),
        resolveBiometricAvailability(),
      ]);

      const nextInstallationId = installationIdValue ?? buildInstallationId();
      installationIdRef.current = nextInstallationId;
      setBiometricAvailable(canUseBiometric);
      setBiometricEnabled(parseBoolean(storedLockValue));

      if (!installationIdValue) {
        await setStoredValue(INSTALLATION_ID_KEY, nextInstallationId);
      }

      const storedSession = parseStoredSession(storedSessionValue);
      if (!storedSession) {
        if (isMounted) {
          setIsReady(true);
        }
        return;
      }

      try {
        let activeSession = storedSession;
        let profile: MobileSessionUser;

        try {
          profile = await mobileApi.me(activeSession.accessToken);
        } catch (error) {
          if (!isUnauthorizedError(error)) {
            throw error;
          }

          const refreshed = await mobileApi.refreshSession(activeSession.refreshToken);
          activeSession = {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          };
          profile = refreshed.user;
          await persistSession(activeSession);
        }

        if (isMounted) {
          setToken(activeSession.accessToken);
          setRefreshToken(activeSession.refreshToken);
          setSessionExpiresAt(activeSession.expiresAt);
          setUser(profile);
          setIsLocked(parseBoolean(storedLockValue) && canUseBiometric);
        }
      } catch {
        await clearSessionState();
      } finally {
        if (isMounted) {
          setIsReady(true);
        }
      }
    };

    void bootstrap();
    return () => {
      isMounted = false;
    };
  }, [clearSessionState, persistSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        backgroundedAtRef.current = Date.now();
        return;
      }

      if (
        nextState === "active" &&
        biometricEnabled &&
        token &&
        backgroundedAtRef.current &&
        Date.now() - backgroundedAtRef.current >= RELOCK_AFTER_MS
      ) {
        setIsLocked(true);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [biometricEnabled, token]);

  useEffect(() => {
    if (!refreshToken || !sessionExpiresAt) {
      return;
    }

    const expiresAtTimestamp = new Date(sessionExpiresAt).getTime();
    if (Number.isNaN(expiresAtTimestamp)) {
      return;
    }

    const refreshInMs = Math.max(expiresAtTimestamp - Date.now() - 2 * 60 * 1000, 5_000);
    const timeout = setTimeout(() => {
      void mobileApi
        .refreshSession(refreshToken)
        .then((session) => applySession(session))
        .catch(() => clearSessionState());
    }, refreshInMs);

    return () => {
      clearTimeout(timeout);
    };
  }, [applySession, clearSessionState, refreshToken, sessionExpiresAt]);

  const requestChallenge = async (payload: { role: MobileRole; name: string; phone: string }) =>
    mobileApi.requestChallenge(payload);

  const verifyChallenge = async (payload: { challengeId: string; code: string }) => {
    const session = await mobileApi.verifyChallenge({
      ...payload,
      deviceId: installationIdRef.current ?? buildInstallationId(),
      deviceName: Device.modelName ?? Device.deviceName ?? Platform.OS,
      platform: Platform.OS,
    });
    await applySession(session);
  };

  const signOut = async () => {
    try {
      if (token) {
        await mobileApi.logout(token);
      }
    } catch {
      // Ignore logout transport errors and clear local state anyway.
    } finally {
      await clearSessionState();
    }
  };

  const refresh = async () => {
    if (!token) {
      return;
    }

    try {
      const profile = await mobileApi.me(token);
      setUser(profile);
    } catch (error) {
      if (!refreshToken || !isUnauthorizedError(error)) {
        throw error;
      }

      const session = await mobileApi.refreshSession(refreshToken);
      await applySession(session);
    }
  };

  const unlockApp = async () => authenticateAppLock();

  const setBiometricLockEnabled = async (enabled: boolean) => {
    if (!enabled) {
      setBiometricEnabled(false);
      setIsLocked(false);
      await setStoredValue(APP_LOCK_KEY, "false");
      return true;
    }

    if (!biometricAvailable) {
      return false;
    }

    const authenticated = await authenticateAppLock();
    if (!authenticated) {
      return false;
    }

    setBiometricEnabled(true);
    setIsLocked(false);
    await setStoredValue(APP_LOCK_KEY, "true");
    return true;
  };

  return (
    <SessionContext.Provider
      value={{
        isReady,
        token,
        user,
        isLocked,
        biometricAvailable,
        biometricEnabled,
        requestChallenge,
        verifyChallenge,
        signOut,
        refresh,
        unlockApp,
        setBiometricLockEnabled,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return value;
};
