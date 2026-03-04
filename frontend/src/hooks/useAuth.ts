import { useEffect, useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import * as api from '../services/api';

export function useAuth() {
  const isAuthenticated = useChatStore((s) => s.isAuthenticated);
  const user = useChatStore((s) => s.user);
  const setAuth = useChatStore((s) => s.setAuth);
  const clearAuth = useChatStore((s) => s.clearAuth);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('session_token');
    if (!token) {
      setLoading(false);
      return;
    }

    api.getMe()
      .then((userData) => {
        setAuth(userData as any, token);
      })
      .catch(() => {
        clearAuth();
      })
      .finally(() => setLoading(false));
  }, []);

  return { isAuthenticated, loading, user };
}
