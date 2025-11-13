import { Suspense } from "react";
import KlonerVercelCallback from "./KlonerVercelCallback";

export default function VercelPage() {

    return (
        <Suspense fallback={null}>
            <KlonerVercelCallback />
        </Suspense>
    )
}

