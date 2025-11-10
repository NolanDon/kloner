// app/auth-provider.server.tsx
import { ReactNode } from 'react';
import { AuthProvider } from './auth-provider';

export default async function AuthProviderServer({ children }: { children: ReactNode }) {
    return (
        <AuthProvider>
            {children}
        </AuthProvider>
    );
}
