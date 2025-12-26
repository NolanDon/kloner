// components/helpers.ts
import {
    updateDoc, runTransaction, collection, DocumentData, getDocs, query, QueryDocumentSnapshot, where, QuerySnapshot, getFirestore,
    doc,
    serverTimestamp,
    addDoc,
    getDoc,
    limit,
    orderBy,
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
    if (!html) return html;

    // 1) Remove editor-only device lock on <html ... data-kl-device="...">
    //    Remove both single and double quoted forms
    let out = html
        .replace(/\sdata-kl-device="[^"]*"/i, "")
        .replace(/\sdata-kl-device='[^']*'/i, "");

    // 2) Inject stable padding mapping style (only once)
    const styleId = "kloner-responsive-pad";
    if (!new RegExp(`id=["']${styleId}["']`, "i").test(out)) {
        const css = `
            /* Kloner responsive padding – uses per-device vars written by the editor */
            [data-kl-pad] { padding: var(--kl-pad-desktop, 0px); }
            @media (max-width: 1023px) { [data-kl-pad] { padding: var(--kl-pad-tablet, var(--kl-pad-desktop, 0px)); } }
            @media (max-width: 767px) { [data-kl-pad] { padding: var(--kl-pad-mobile, var(--kl-pad-tablet, var(--kl-pad-desktop, 0px))); } }
            `.trim();

        const inject = `<style id="${styleId}">\n${css}\n</style>\n`;

        // Prefer inject right before </head>, otherwise prepend to document
        if (/<\/head\s*>/i.test(out)) {
            out = out.replace(/<\/head\s*>/i, `${inject}</head>`);
        } else {
            out = inject + out;
        }
    }

    // 3) Ensure doctype exists (without reserializing everything)
    if (!/^\s*<!doctype/i.test(out)) {
        out = "<!DOCTYPE html>\n" + out;
    }

    return out;
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

    const normStr = (v: any) => (typeof v === "string" ? v.trim() : "");
    const stripSlash = (u: string) => u.replace(/\/+$/, "");

    const safeUrlHost = (u?: string | null): string | null => {
        const raw = normStr(u);
        if (!raw) return null;
        try {
            return new URL(raw).hostname.toLowerCase();
        } catch {
            // allow already-host-ish values
            return raw.toLowerCase();
        }
    };

    const safeUrlFull = (u?: string | null): string | null => {
        const raw = normStr(u);
        if (!raw) return null;
        return stripSlash(raw);
    };

    const getComparableTs = (v: any): number => {
        // Firestore Timestamp
        if (v && typeof v === "object" && typeof v.toMillis === "function") {
            try {
                return v.toMillis();
            } catch {
                return 0;
            }
        }
        // number ms
        if (typeof v === "number" && Number.isFinite(v)) return v;
        // ISO string
        if (typeof v === "string") {
            const t = Date.parse(v);
            return Number.isFinite(t) ? t : 0;
        }
        return 0;
    };

    const pickBestDoc = (
        docs: Array<QueryDocumentSnapshot<DocumentData>>
    ): QueryDocumentSnapshot<DocumentData> | null => {
        if (!docs || docs.length === 0) return null;

        let best: QueryDocumentSnapshot<DocumentData> | null = null;
        let bestScore = -Infinity;

        for (const d of docs) {
            const data = d.data() as any;

            // strongly prefer ready / non-archived if present
            const archived = data?.archived === true;
            const status = normStr(data?.status).toLowerCase();
            const isReady = status ? status === "ready" : true;

            const html = normStr(data?.html);
            const hasHtml = html.length > 0;

            // timestamps (your doc has createdAt number + updatedAt Timestamp + lastExportedAt Timestamp)
            const tUpdated = getComparableTs(data?.updatedAt);
            const tExported = getComparableTs(data?.lastExportedAt);
            const tCreated = getComparableTs(data?.createdAt);

            const t = Math.max(tUpdated, tExported, tCreated);

            // score
            // - must have html (otherwise worthless)
            // - prefer ready + not archived
            // - newest wins
            const score =
                (hasHtml ? 1_000_000_000_000 : -1_000_000_000_000) +
                (isReady ? 10_000_000 : -10_000_000) +
                (archived ? -10_000_000 : 0) +
                t;

            if (score > bestScore) {
                bestScore = score;
                best = d;
            }
        }

        return best;
    };

    const parseRender = (
        docSnap: QueryDocumentSnapshot<DocumentData>
    ): {
        id: string;
        html: string;
        referenceImage?: string;
        seoMetaByPage?: Record<string, SeoMeta> | null;
        archivedPageIds: string[];
    } => {
        const data = docSnap.data() as any;

        const rawHtml = normStr(data?.html);
        if (!rawHtml) {
            throw new Error(
                "Reference render exists but has no HTML. Open this URL in the Preview Builder and re-export."
            );
        }

        const refImg =
            typeof data?.referenceImage === "string" &&
                data.referenceImage.trim().length > 0
                ? data.referenceImage
                : undefined;

        const seoMetaByPage: Record<string, SeoMeta> | null =
            data?.seoMetaByPage && typeof data.seoMetaByPage === "object"
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
    };

    const tryQueries: Array<
        () => Promise<QueryDocumentSnapshot<DocumentData> | null>
    > = [];

    // 0) if deployments ever store a direct render id, honor it (supports community templates)
    // (does nothing unless you add one later)
    tryQueries.push(async () => {
        const direct = (deployment as any)?.renderId || (deployment as any)?.sourceRenderId;
        const rid = normStr(direct);
        if (!rid) return null;
        const dref = doc(db, "kloner_users", uid, "kloner_renders", rid);
        const snap = await getDoc(dref);
        return snap.exists() ? (snap as any) : null;
    });

    // 1) existing matches
    if (deployment.vercelProjectId) {
        const projectId = deployment.vercelProjectId;
        tryQueries.push(async () => {
            const qy = query(colRef, where("vercelProjectId", "==", projectId));
            const snap = await getDocs(qy);
            return pickBestDoc(snap.docs);
        });
    }

    if (deployment.vercelProjectName) {
        const projectName = deployment.vercelProjectName;
        tryQueries.push(async () => {
            const qy = query(colRef, where("vercelProjectName", "==", projectName));
            const snap = await getDocs(qy);
            return pickBestDoc(snap.docs);
        });
    }

    // 2) your render stores lastDeployUrl. deployments may have vercelUrl OR publicUrl.
    const depPublicUrl = safeUrlFull((deployment as any)?.publicUrl ?? null);
    const depVercelUrl = safeUrlFull(deployment.vercelUrl ?? null);

    if (depVercelUrl) {
        tryQueries.push(async () => {
            const qy = query(colRef, where("lastDeployUrl", "==", depVercelUrl));
            const snap = await getDocs(qy);
            return pickBestDoc(snap.docs);
        });

        // tolerate trailing slash mismatch
        tryQueries.push(async () => {
            const qy = query(colRef, where("lastDeployUrl", "==", `${depVercelUrl}/`));
            const snap = await getDocs(qy);
            return pickBestDoc(snap.docs);
        });
    }

    if (depPublicUrl && depPublicUrl !== depVercelUrl) {
        tryQueries.push(async () => {
            const qy = query(colRef, where("lastDeployUrl", "==", depPublicUrl));
            const snap = await getDocs(qy);
            return pickBestDoc(snap.docs);
        });

        tryQueries.push(async () => {
            const qy = query(colRef, where("lastDeployUrl", "==", `${depPublicUrl}/`));
            const snap = await getDocs(qy);
            return pickBestDoc(snap.docs);
        });
    }

    // 3) last resort: match by base URL used in the render (your render "url" is https://cookies.com/)
    tryQueries.push(async () => {
        const baseUrl = safeUrlFull(deployment.vercelUrl?.split("?")[0] || null);
        if (!baseUrl) return null;
        const qy = query(colRef, where("url", "==", baseUrl));
        const snap = await getDocs(qy);
        return pickBestDoc(snap.docs);
    });

    // 4) new: host-based fallback (handles cases where deployment doc is missing vercelUrl but has publicDomain/publicUrl)
    tryQueries.push(async () => {
        const depHost =
            safeUrlHost((deployment as any)?.publicUrl ?? null) ||
            safeUrlHost((deployment as any)?.publicDomain
                ? `https://${(deployment as any)?.publicDomain}`
                : null) ||
            safeUrlHost(deployment.vercelUrl ?? null);

        if (!depHost) return null;

        // pull a small recent window and match in-memory by host
        const qy = query(colRef, orderBy("updatedAt", "desc"), limit(40));
        const snap = await getDocs(qy);

        const candidates = snap.docs.filter((d) => {
            const data = d.data() as any;
            const h =
                safeUrlHost(data?.lastDeployUrl ?? null) ||
                safeUrlHost(data?.url ?? null) ||
                null;
            if (!h) return false;
            return h === depHost;
        });

        return pickBestDoc(candidates);
    });

    // 5) final fallback: if this is a community template deployment with no identifiers,
    // open the newest READY render for the user (still requires html).
    tryQueries.push(async () => {
        const qy = query(colRef, orderBy("updatedAt", "desc"), limit(40));
        const snap = await getDocs(qy);
        return pickBestDoc(snap.docs);
    });

    for (const fn of tryQueries) {
        const docSnap = await fn();
        if (!docSnap) continue;

        const parsed = parseRender(docSnap);

        // extra guard: some renders might be "ready" but have whitespace html
        if (!parsed.html || !parsed.html.trim()) continue;

        return parsed;
    }

    throw new Error(
        "No reference render found for this deployment. Open this site in the Preview Builder and export at least one render."
    );
}


export const IS_MOBILE =
    typeof window !== "undefined" &&
    /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) &&
    !/iPad|Tablet/i.test(navigator.userAgent);



export function secureHtmlForPreviewIframe(rawHtml: string): string {
    if (!rawHtml) return rawHtml;

    // must run in browser
    if (typeof window === "undefined" || typeof DOMParser === "undefined") return rawHtml;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawHtml, "text/html");

        // ensure <head>
        if (!doc.head) {
            const head = doc.createElement("head");
            doc.documentElement.insertBefore(head, doc.body || null);
        }

        // 1) kill script execution + script gadgets
        doc.querySelectorAll("script, noscript").forEach((n) => n.remove());

        // meta refresh can navigate
        doc.querySelectorAll('meta[http-equiv="refresh" i]').forEach((n) => n.remove());

        // remove <base> entirely (it can rewrite all links + target)
        doc.querySelectorAll("base").forEach((n) => n.remove());

        // 2) strip inline event handlers + JS urls
        doc.querySelectorAll<HTMLElement>("*").forEach((el) => {
            // remove on* handlers
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                const val = (attr.value || "").trim();

                if (name.startsWith("on")) el.removeAttribute(attr.name);

                // javascript: urls
                if ((name === "href" || name === "src") && /^javascript:/i.test(val)) {
                    el.setAttribute(attr.name, "#");
                }

                // data:text/html or other active payloads
                if ((name === "href" || name === "src") && /^data:text\/html/i.test(val)) {
                    el.setAttribute(attr.name, "#");
                }
            }
        });

        // 3) FIX the hash-route links your generator is producing
        //    "#/path" -> "/path" and "#/" -> "/"
        doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
            const href = (a.getAttribute("href") || "").trim();

            if (href.startsWith("#/")) {
                const next = href.slice(1); // remove leading "#"
                a.setAttribute("href", next || "/");
            }

            // if you also ever generate "#/news/hotfixes?x=y", keep it:
            // handled by slice(1) above

            // harden target=_blank safety if any exist
            const target = (a.getAttribute("target") || "").toLowerCase();
            if (target === "_blank") {
                const rel = (a.getAttribute("rel") || "").toLowerCase();
                const needed = ["noopener", "noreferrer"];
                const parts = new Set(rel.split(/\s+/).filter(Boolean));
                needed.forEach((p) => parts.add(p));
                a.setAttribute("rel", Array.from(parts).join(" "));
            }
        });

        // 4) inject preview CSP (scriptless, no network, no forms, no frames)
        const cspContent = [
            "default-src 'none'",
            "img-src https: data: blob:",
            "style-src 'unsafe-inline' https:",
            "font-src https: data:",
            "media-src https: data: blob:",
            "connect-src 'none'",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "script-src 'none'",
        ].join("; ");

        let csp = doc.querySelector('meta[http-equiv="Content-Security-Policy" i]');
        if (!csp) {
            csp = doc.createElement("meta");
            csp.setAttribute("http-equiv", "Content-Security-Policy");
            doc.head.prepend(csp);
        }
        csp.setAttribute("content", cspContent);

        return "<!doctype html>\n" + doc.documentElement.outerHTML;
    } catch {
        return rawHtml;
    }
}
