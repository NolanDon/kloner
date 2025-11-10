// page.tsx (or wherever this wrapper lives)
import { Suspense } from "react";
import LoginPage from "./LoginForm";

export default function Page() {
    return (
        <Suspense fallback={null}>
            <LoginPage />
        </Suspense>
    );
}
