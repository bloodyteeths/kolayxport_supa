import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { supabase } from './supabase';

const AuthContext = createContext({
  user: null,
  session: null,
  isLoading: true,
  error: null,
  supabaseSignOut: async () => { throw new Error('AuthContext not ready'); },
  refreshUser: async () => { throw new Error('AuthContext not ready'); }
});

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();

  const getSessionData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
    } catch (e) {
      console.error('AuthContext getSessionData error:', e);
      setError(e);
      setSession(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    getSessionData();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      console.log('Auth State Change Event:', event, 'New Session:', newSession ? 'Exists' : 'Null');
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setIsLoading(false);
      setError(null);
      
      if (event === 'SIGNED_OUT') {
        router.push('/');
      }
      if (event === 'USER_DELETED'){
        router.push('/');
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [getSessionData, router]);

  const value = {
    session,
    user,
    isLoading,
    error,
    supabaseSignOut: async () => {
      setIsLoading(true);
      const { error: signOutError } = await supabase.auth.signOut();
      // Clear all Supabase-related localStorage and cookies
      if (typeof window !== 'undefined') {
        // Remove all sb-* tokens
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith('sb-')) localStorage.removeItem(key);
        });
        // Remove cookies (best effort, client-side only)
        document.cookie.split(';').forEach((c) => {
          document.cookie = c
            .replace(/^ +/, '')
            .replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
        });
      }
      if (signOutError) {
        console.error('Error signing out:', signOutError);
        setError(signOutError);
      } else {
        // Force a hard reload to clear in-memory state
        if (typeof window !== 'undefined') {
          window.location.href = '/';
      } else {
        router.push('/');
        }
      }
      setIsLoading(false);
    },
    refreshUser: useCallback(async () => {
      console.log('[AuthContext] Manual user refresh triggered');
      await getSessionData();
    }, [getSessionData]),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 