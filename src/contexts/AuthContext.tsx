import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface Profile {
    id: string;
    plan_type: 'basic' | 'pro';
    subscription_status: 'active' | 'inactive';
    subscription_start_date?: string;
    subscription_end_date?: string;
    timezone?: string;
}

interface AuthContextType {
    user: User | null;
    session: Session | null;
    profile: Profile | null;
    loading: boolean;
    signUp: (email: string, password: string) => Promise<void>;
    signIn: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
    updatePlan: (plan: 'basic' | 'pro', status: 'active' | 'inactive') => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                // Profile doesn't exist, create it (fallback for existing users before trigger)
                const { data: newProfile, error: createError } = await supabase
                    .from('profiles')
                    .insert({
                        id: userId,
                        plan_type: 'basic',
                        subscription_status: 'inactive',
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
                    })
                    .select()
                    .single();

                if (createError) throw createError;
                setProfile(newProfile);
            } else {
                setProfile(data);
            }
        } catch (error) {
            console.error('Error fetching profile:', error);
            setProfile(null);
        }
    };

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id);
            }
            setLoading(false);
        });

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id);
            } else {
                setProfile(null);
            }
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    const refreshProfile = async () => {
        if (user) await fetchProfile(user.id);
    };

    const signUp = async (email: string, password: string) => {
        if (!isSupabaseConfigured) {
            throw new Error('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables in your Vercel project settings.');
        }
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
    };

    const signIn = async (email: string, password: string) => {
        if (!isSupabaseConfigured) {
            throw new Error('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables in your Vercel project settings.');
        }
        try {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
        } catch (err: any) {
            // Convert cryptic network errors into actionable messages
            if (err?.message?.includes('fetch') || err?.name === 'TypeError') {
                throw new Error('Cannot connect to the database. Please check your Supabase environment variables are correctly set in Vercel.');
            }
            throw err;
        }
    };

    const signOut = async () => {
        if (!isSupabaseConfigured) return;
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    };

    const value = {
        user,
        session,
        profile,
        loading,
        signUp,
        signIn,
        signOut,
        refreshProfile,
        updatePlan: async (plan: 'basic' | 'pro', status: 'active' | 'inactive') => {
            if (!user) return;
            const { error } = await supabase
                .from('profiles')
                .update({
                    plan_type: plan,
                    subscription_status: status,
                    subscription_start_date: status === 'active' ? new Date().toISOString() : null
                })
                .eq('id', user.id);
            if (error) throw error;
            await refreshProfile();
        },
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
