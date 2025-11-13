import { Suspense } from "react";
import KlonerVercelConfigure from "./KlonerVercelConfigure";

export default function VercelConfigurePage() {
    return (
        <Suspense fallback={null}>
            <KlonerVercelConfigure />
        </Suspense>
    );
}
