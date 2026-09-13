import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { adminApi, apiError, setCsrfToken } from "@/admin/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: "loading", session: null, error: null });

  const clearSession = useCallback(() => {
    setCsrfToken("");
    setState({ status: "unauthenticated", session: null, error: null });
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    let active = true;
    adminApi.auth.me()
      .then((session) => {
        if (!active) return;
        setCsrfToken(session.csrf_token);
        setState({ status: "authenticated", session, error: null });
      })
      .catch((error) => {
        if (!active) return;
        const normalized = apiError(error);
        setCsrfToken("");
        setState({
          status: "unauthenticated",
          session: null,
          error: normalized.status === 401 ? null : normalized,
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    window.addEventListener("suvi-admin:unauthorized", clearSession);
    return () => window.removeEventListener("suvi-admin:unauthorized", clearSession);
  }, [clearSession]);

  const login = useCallback(async (credentials) => {
    const session = await adminApi.auth.login(credentials);
    setCsrfToken(session.csrf_token);
    setState({ status: "authenticated", session, error: null });
    return session;
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminApi.auth.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(() => ({
    ...state,
    user: state.session?.user || null,
    login,
    logout,
  }), [state, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAdminAuth must be used inside AuthProvider");
  return context;
}
