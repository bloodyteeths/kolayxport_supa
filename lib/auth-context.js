import { createContext, useContext, useEffect, useState, useCallback } from 'react';
// import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'; // REMOVED
import { createClient } from '@/lib/supabase/client'; // ADDED
import { useRouter } from 'next/router';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  // const supabase = createClientComponentClient(); // REMOVED
  const [supabase] = useState(() => createClient()); // MODIFIED to use the new client
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();

  const supabaseSignInWithGoogle = useCallback(async () => {
    setAuthLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/app`,
        },
      });
      if (signInError) throw signInError;
      // The user will be redirected to Google, then back to the app.
      // The onAuthStateChange listener below will handle setting user and session.
    } catch (e) {
      console.error('Error signing in with Google:', e);
      setError(e.message || 'Failed to sign in with Google.');
      setAuthLoading(false);
    }
  }, [supabase]);

  const supabaseSignOut = useCallback(async () => {
    setAuthLoading(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setUser(null);
      setSession(null);
      // No explicit redirect here, relying on page/component logic to handle unauthenticated state
    } catch (e) {
      console.error('Error signing out:', e);
      setError(e.message || 'Failed to sign out.');
    } finally {
      setAuthLoading(false);
    }
  }, [supabase]);

 useEffect(() => {
    setAuthLoading(true);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth event:', event, 'Session:', session);
      setSession(session);
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setError(null);

      if (event === 'SIGNED_IN' && session && router.pathname === '/') {
        // Optional: redirect to /app if signed in on homepage, adjust as needed
        // router.push('/app');
      } else if (event === 'SIGNED_OUT') {
        // Optional: redirect to home or login page on sign out
        // if (router.pathname.startsWith('/app')) {
        //   router.push('/');
        // }
      }
    });

    // Initial check in case the event listener fires after initial render
    // (though createBrowserClient is supposed to handle this from storage)
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!session && currentSession) { // If context session is null but a session exists
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
      }
      // Ensure loading is false even if no session change initially
      // but onAuthStateChange should set it to false once it runs.
      // To avoid race conditions, let onAuthStateChange primarily control setAuthLoading(false)
      // but ensure it happens if no initial event occurs quickly.
      setTimeout(() => {
        if (authLoading) setAuthLoading(false);
      }, 500); // Give onAuthStateChange a moment to fire
    }).catch(err => {
        console.error("Error getting initial session:", err);
        setAuthLoading(false);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [supabase, router]);

  // Function to manually refresh user data from the server if needed
  const refreshUser = useCallback(async () => {
    setAuthLoading(true);
    const { data: { user: refreshedUser }, error: refreshError } = await supabase.auth.refreshSession(); // refreshSession also updates the user
    if (refreshError) {
      console.error("Error refreshing user session:", refreshError);
      setError(refreshError.message);
      // If refresh fails (e.g. refresh token expired), it might sign the user out.
      // The onAuthStateChange listener should pick this up.
    } else {
      setUser(refreshedUser ?? null);
      // The session is also updated by refreshSession, onAuthStateChange will reflect it.
    }
    setAuthLoading(false);
  }, [supabase]);

  const value = {
    user,
    session,
    authLoading,
    error,
    supabaseSignInWithGoogle,
    supabaseSignOut,
    refreshUser, // Expose refreshUser
    isAuthenticated: !!user,
    supabase, // Exposing supabase client directly for other operations if needed
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