import { createContext, useContext, useCallback } from 'react';
import { useSession, signOut as nextAuthSignOut, signIn as nextAuthSignIn } from 'next-auth/react';

const AuthContext = createContext({
  user: null,
  session: null,
  isLoading: true,
  error: null,
  supabaseSignOut: async () => { throw new Error('AuthContext not ready'); },
  refreshUser: async () => { throw new Error('AuthContext not ready'); }
});

export const AuthProvider = ({ children }) => {
  const { data: session, status, update } = useSession();

  const isLoading = status === 'loading';
  const user = session?.user ?? null;

  const value = {
    session,
    user,
    isLoading,
    error: null,
    supabaseSignOut: async () => {
      await nextAuthSignOut({ callbackUrl: '/' });
    },
    signOut: async () => {
      await nextAuthSignOut({ callbackUrl: '/' });
    },
    signIn: async (provider = 'google', options = {}) => {
      await nextAuthSignIn(provider, { callbackUrl: '/app', ...options });
    },
    refreshUser: async () => {
      await update();
    },
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
