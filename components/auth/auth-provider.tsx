"use client";

import { useState, useEffect, createContext, useContext } from 'react';
import { onIdTokenChanged, getIdTokenResult } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export type UserTier = 'free' | 'pro' | 'agency' | 'enterprise' | null;

interface AuthContextType {
    user: any | null;
    loading: boolean;
    isAdmin: boolean;
    userTier: UserTier;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({
    children,
}: {
    children: React.ReactNode;
}) => {
    const [user, setUser] = useState<any | null>();
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [userTier, setUserTier] = useState<UserTier>(null);

    useEffect(() => {

        if (!auth) {
            setLoading(false);
            return;
        }

        const unsubscribe = onIdTokenChanged(auth, async (authUser) => {
            if (authUser) {
                const tokenResult = await getIdTokenResult(authUser, true);

                let firestoreData = {};
                try {
                    const userDoc = await getDoc(doc(db, 'users', authUser.uid));
                    if (userDoc.exists()) {
                        firestoreData = userDoc.data();
                    }
                } catch (e) {
                    console.error('❌ Failed to fetch Firestore user:', e);
                }

                setUser({
                    uid: authUser.uid,
                    email: authUser.email,
                    ...firestoreData,
                });

                setIsAdmin(!!tokenResult.claims.admin);
                setUserTier((tokenResult.claims.userTier as UserTier) || 'free');
            } else {
                setUser(null);
                setIsAdmin(false);
                setUserTier(null);
            }
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const value: AuthContextType = {
        user,
        loading,
        isAdmin,
        userTier,
    };
    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    return useContext(AuthContext);
};

