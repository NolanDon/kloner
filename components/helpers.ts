// components/helpers.ts
import {
    updateDoc, runTransaction, collection, DocumentData, getDocs, query, QueryDocumentSnapshot, where, QuerySnapshot, getFirestore,
    doc,
    serverTimestamp,
    addDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { SeoMeta } from "./PreviewEditor";
import { DeploymentDoc } from "@/app/dashboard/deployments/page";

export function sanitizeName(raw: string): string {
    if (!raw) return "";

    let out = raw.toLowerCase().trim();

    // strip protocol
    out = out.replace(/^https?:\/\//, "");

    // strip www.
    out = out.replace(/^www\./, "");

    // strip trailing slash
    out = out.replace(/\/+$/, "");

    // strip common TLDs explicitly (now includes .ca) when they appear as the
    // domain ending (before a slash or end-of-string)
    out = out.replace(
        /\.(com|net|org|io|app|dev|site|co|ai|info|xyz|me|ca)(?=\/|$)/g,
        ""
    );

    // generic safety net: strip any remaining ".xxxx" that looks like a TLD
    // (2–10 letters) when it's at the end of the host portion
    out = out.replace(/\.[a-z]{2,10}(?=\/|$)/g, "");

    // remove query strings or fragments
    out = out.replace(/[\?#].*$/, "");

    // collapse any leftover slashes to spaces
    out = out.replace(/[\/]+/g, " ");

    // trim spaces
    out = out.trim();

    // capitalize first letter for aesthetics
    if (out.length > 1) {
        out = out[0].toUpperCase() + out.slice(1);
    }

    return out || "Untitled";
}

export function sanitizeImageName(name: string) {
    const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    return base.slice(-64) || "image";
}

// Derive archived routes for this render from Firestore shape
export function getArchivedRoutesForRender(
    renderId: string | null,
    renders: any[],
): string[] {
    if (!renderId) return [];

    const target = renders.find((r) => r.id === renderId);
    if (!target) return [];

    const out = new Set<string>();

    const topLevel = (target as any).archivedPageIds;
    if (Array.isArray(topLevel)) {
        for (const v of topLevel) {
            if (typeof v === "string" && v.trim()) {
                out.add(v.trim());
            }
        }
    }

    const meta = (target as any).meta;
    if (meta && Array.isArray((meta as any).archivedPageIds)) {
        for (const v of (meta as any).archivedPageIds) {
            if (typeof v === "string" && v.trim()) {
                out.add(v.trim());
            }
        }
    }

    return Array.from(out);
}

export function scrubArchivedRoutes(html: string, archivedRoutes: string[]): string {
    if (!archivedRoutes || archivedRoutes.length === 0) return html;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const normalized = new Set(
            archivedRoutes
                .filter(Boolean)
                .map((r) => {
                    let path = r.trim();
                    if (!path.startsWith("/")) path = "/" + path;
                    if (path.length > 1 && path.endsWith("/")) {
                        path = path.slice(0, -1);
                    }
                    return path;
                })
        );

        doc.querySelectorAll("main.page-root[data-route]").forEach((el) => {
            const raw = (el.getAttribute("data-route") || "").trim();
            let route = raw;
            if (!route.startsWith("/")) route = "/" + route;
            if (route.length > 1 && route.endsWith("/")) {
                route = route.slice(0, -1);
            }
            if (normalized.has(route)) {
                el.remove();
            }
        });

        return doc.documentElement.outerHTML;
    } catch {
        return html;
    }
}



export function extractArchivedPageIdsFromRender(render: any): string[] {


    if (!render) return [];

    const root = render as any;
    const meta = (root.meta ?? {}) as any;

    const candidate =
        root.archivedPageIds ??
        meta.archivedPageIds ??
        [];

    if (!Array.isArray(candidate)) return [];

    let result = candidate.filter(
        (v) => typeof v === "string" && v.trim().length > 0
    );

    return result;
}



export interface RenderLike {
    id: string;
    archivedPageIds?: string[];
    meta?: {
        archivedPageIds?: string[];
        archived?: boolean;
        [key: string]: any;
    };
    [key: string]: any;
}

export async function persistArchivedPageIds(opts: {
    userId: string;
    renderId: string;
    ids: string[];
}) {
    const { userId, renderId, ids } = opts;

    const dref = doc(db, "kloner_users", userId, "kloner_renders", renderId);

    await updateDoc(dref, {
        archivedPageIds: ids,
        "meta.archivedPageIds": ids,
        archived: ids.length > 0,
        "meta.archived": ids.length > 0,
        updatedAt: serverTimestamp(),
    });
}

export function withArchivedPageIds<T extends RenderLike>(
    renders: T[],
    renderId: string,
    ids: string[]
): T[] {
    return renders.map((r) =>
        r.id === renderId
            ? {
                ...r,
                archivedPageIds: ids,
                meta: {
                    ...(r.meta || {}),
                    archivedPageIds: ids,
                    archived: ids.length > 0,
                },
            }
            : r
    );
}

export function normalizeKlonerPaddingForExport(html: string): string {
    if (typeof window === "undefined" || !html) return html;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // 1) editor-only attribute: drop it so we don't lock the live site to "desktop"
        if (doc.documentElement.hasAttribute("data-kl-device")) {
            doc.documentElement.removeAttribute("data-kl-device");
        }

        // 2) inject a single responsive rule that maps the per-device vars to real breakpoints
        //    id is stable so we never duplicate on re-exports
        let styleEl = doc.getElementById("kloner-responsive-pad") as HTMLStyleElement | null;

        if (!styleEl) {
            styleEl = doc.createElement("style");
            styleEl.id = "kloner-responsive-pad";
            styleEl.textContent = `
/* Kloner responsive padding – uses per-device vars written by the editor */
[data-kl-pad] {
  padding: var(--kl-pad-desktop, 0px);
}

@media (max-width: 1023px) {
  [data-kl-pad] {
    padding: var(--kl-pad-tablet, var(--kl-pad-desktop, 0px));
  }
}

@media (max-width: 767px) {
  [data-kl-pad] {
    padding: var(--kl-pad-mobile, var(--kl-pad-tablet, var(--kl-pad-desktop, 0px)));
  }
}
            `.trim();
            doc.head.appendChild(styleEl);
        }

        return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    } catch {
        // if DOMParser explodes for any reason, fall back to original HTML
        return html;
    }
}


export function toDate(v: any): Date | null {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
    if (typeof v === "string") {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

export function formatDate(v: any): string {
    const d = toDate(v);
    if (!d) return "";
    return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}


export function pickNewest(
    snap: QuerySnapshot<DocumentData>
): QueryDocumentSnapshot<DocumentData> | null {
    if (snap.empty) return null;

    let best: QueryDocumentSnapshot<DocumentData> | null = null;
    let bestTs = -Infinity;

    snap.forEach((docSnap: QueryDocumentSnapshot<DocumentData, DocumentData>) => {
        const data = docSnap.data() as any;
        const ts =
            (data.lastExportedAt &&
                toDate(data.lastExportedAt)?.getTime()) ||
            (data.updatedAt && toDate(data.updatedAt)?.getTime()) ||
            (data.createdAt && toDate(data.createdAt)?.getTime()) ||
            0;

        if (ts > bestTs) {
            bestTs = ts;
            best = docSnap as QueryDocumentSnapshot<DocumentData>;
        }
    });

    return best;
}


export async function fetchRenderForDeployment(opts: {
    uid: string;
    deployment: { id: string } & DeploymentDoc;
}): Promise<{
    id: string;
    html: string;
    referenceImage?: string;
    seoMetaByPage?: Record<string, SeoMeta> | null;
    archivedPageIds: string[];
}> {
    const { uid, deployment } = opts;
    const colRef = collection(db, "kloner_users", uid, "kloner_renders");

    const tryQueries: Array<
        () => Promise<QueryDocumentSnapshot<DocumentData> | null>
    > = [];

    if (deployment.vercelProjectId) {
        const projectId = deployment.vercelProjectId;
        tryQueries.push(async () => {
            const qy = query(colRef, where("vercelProjectId", "==", projectId));
            const snap = await getDocs(qy);
            return pickNewest(snap);
        });
    }

    if (deployment.vercelProjectName) {
        const projectName = deployment.vercelProjectName;
        tryQueries.push(async () => {
            const qy = query(
                colRef,
                where("vercelProjectName", "==", projectName)
            );
            const snap = await getDocs(qy);
            return pickNewest(snap);
        });
    }

    if (deployment.vercelUrl) {
        const url = deployment.vercelUrl;
        tryQueries.push(async () => {
            const qy = query(colRef, where("lastDeployUrl", "==", url));
            const snap = await getDocs(qy);
            return pickNewest(snap);
        });
    }

    // last resort: match by base URL used in the render
    tryQueries.push(async () => {
        const baseUrl = deployment.vercelUrl?.split("?")[0] || null;
        if (!baseUrl) return null;
        const qy = query(colRef, where("url", "==", baseUrl));
        const snap = await getDocs(qy);
        return pickNewest(snap);
    });

    for (const fn of tryQueries) {
        const docSnap = await fn();
        if (!docSnap) continue;

        const data = docSnap.data() as any;

        const rawHtml =
            typeof data.html === "string" ? data.html.trim() : "";
        if (!rawHtml) {
            throw new Error(
                "Reference render exists but has no HTML. Open this URL in the Preview Builder and re-export."
            );
        }

        const refImg =
            typeof data.referenceImage === "string" &&
                data.referenceImage.trim().length > 0
                ? data.referenceImage
                : undefined;

        const seoMetaByPage: Record<string, SeoMeta> | null =
            data.seoMetaByPage && typeof data.seoMetaByPage === "object"
                ? (data.seoMetaByPage as Record<string, SeoMeta>)
                : null;

        const archivedPageIds = extractArchivedPageIdsFromRender(data);

        return {
            id: docSnap.id,
            html: rawHtml,
            referenceImage: refImg,
            seoMetaByPage,
            archivedPageIds,
        };
    }

    throw new Error(
        "No reference render found for this deployment. Open this site in the Preview Builder and export at least one render."
    );
}

export const IS_MOBILE =
    typeof window !== "undefined" &&
    /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) &&
    !/iPad|Tablet/i.test(navigator.userAgent);