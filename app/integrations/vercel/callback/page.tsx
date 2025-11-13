import { Suspense } from "react";
import KlonerVercelCallback from "./KlonerVercelCallback";

export function VercelPage() {

    return (
        <Suspense>
            <KlonerVercelCallback />
        </Suspense>
    )
}