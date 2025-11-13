import { Suspense } from "react";
import KlonerVercelConfigure from "./KlonerVercelConfigure";

export default function VercelPage() {

    return (
        <Suspense fallback={null}>
            <KlonerVercelConfigure />
        </Suspense>
    )
}

