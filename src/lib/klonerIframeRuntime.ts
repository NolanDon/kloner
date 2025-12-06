// src/lib/installKlonerIframeApi.ts

import { Device } from "@/components/PreviewEditor";

export function installKlonerIframeApi(
    doc: Document,
    onChange: (updatedHtml: string) => void,
    initialDevice: Device = "desktop"
) {
    // Remove old editor artifacts
    doc.querySelectorAll("[data-kloner-style]").forEach((n) => n.remove());
    doc.querySelectorAll("[data-kloner-sel]").forEach((n) =>
        (n as HTMLElement).removeAttribute("data-kloner-sel")
    );
    doc.querySelectorAll("[contenteditable]").forEach((n) =>
        (n as HTMLElement).removeAttribute("contenteditable")
    );

    const style = doc.createElement("style");
    style.setAttribute("data-kloner-style", "1");
    style.textContent = `
    :root {
      --amber-50:#FFFBEB;
      --amber-200:#FDE68A;
      --amber-700:#B45309;
      --rose-50:#FFF1F2;
      --rose-200:#FECDD3;
      --rose-700:#BE123C;
      --slate-700:#334155;
      --slate-300:#cbd5e1;
    }


      /* generic alignment hook */
    [data-kl-align] {
        text-align: var(--kl-align-desktop, inherit);
    }

    /* block positioning based on the same var */
    [data-kl-align][style*="--kl-align-desktop: center"] {
        display: block;
        margin-left: auto !important;
        margin-right: auto !important;
    }

    [data-kl-align][style*="--kl-align-desktop: right"] {
        display: block;
        margin-left: auto !important;
        margin-right: 0 !important;
    }

    [data-kl-align][style*="--kl-align-desktop: left"] {
        display: block;
        margin-left: 0 !important;
        margin-right: 0 !important;
    }

    /* =========================================
       Nav link → page mapping badges
       ========================================= */
    a[data-kloner-nav-page-id]{
      position: relative;
      outline: 1px dashed rgba(59,130,246,0.75);
      outline-offset: 2px;
      transition:
        outline-color 120ms ease-out,
        background-color 120ms ease-out;
    }

    a[data-kloner-nav-page-id]::after{
      content: attr(data-kloner-nav-label);
      position: absolute;
      top: -0.9rem;
      right: 0;
      transform: translateY(-2px);
      padding: 2px 6px;
      border-radius: 999px;
      background: rgba(15,23,42,0.96);
      color: #e5e7eb;
      font-size: 10px;
      line-height: 1;
      white-space: nowrap;
      box-shadow: 0 4px 10px rgba(15,23,42,0.45);
      pointer-events: none;
    }

    a[data-kloner-nav-page-id][data-kloner-nav-active="1"]{
      outline: 2px solid rgba(16,185,129,0.95);
      background: rgba(16,185,129,0.08);
    }

    a[data-kloner-nav-page-id][data-kloner-nav-active="1"]::after{
      background: rgba(16,185,129,0.98);
      color: #022c22;
    }

    /* =========================================
       Selected block styling (single border)
       ========================================= */
    [data-kloner-sel]{
      position: relative;
      outline: 2px solid rgba(16,185,129,0.95) !important;
      border-radius: 10px;
      box-shadow: 0 10px 24px rgba(15,23,42,0.18);
      background-image: none;
      transition:
        box-shadow 140ms ease-out,
        background-color 140ms ease-out,
        transform 120ms ease-out;
    }

    [data-kloner-sel]:hover{
      box-shadow: 0 14px 32px rgba(15,23,42,0.25);
      transform: translateY(-1px);
    }

    /* kill extra corner dots / rings */
    [data-kloner-sel]::before,
    [data-kloner-sel]::after{
      content: none;
    }

    /* Make sure native text selection inside blocks still looks OK */
    [data-kloner-sel] ::selection{
      background: rgba(16,185,129,0.22);
    }

    /* Textbox behaviour */
    [data-kloner-textbox]{
      cursor: text;
      outline: none;
      border-radius: 10px;
      box-shadow: 0 12px 28px rgba(15,23,42,0.35);
      transition:
        box-shadow 140ms ease-out,
        background-color 140ms ease-out,
        transform 120ms ease-out;
    }

    [data-kloner-textbox]:hover{
      background-color: rgba(15,23,42,0.84);
      box-shadow: 0 14px 32px rgba(15,23,42,0.4);
      transform: translateY(-0.5px);
    }

    /* when textbox is selected, reuse same single-outline look */
    [data-kloner-textbox][data-kloner-sel]{
      box-shadow: 0 10px 24px rgba(15,23,42,0.18);
    }

    /* =========================================
       Per-device padding driven by editor device toggle
       ========================================= */
    :root[data-kl-device="desktop"] [data-kl-pad]{
      padding-top: var(--kl-pad-desktop, 24px);
      padding-bottom: var(--kl-pad-desktop, 24px);
    }

    :root[data-kl-device="tablet"] [data-kl-pad]{
      padding-top: var(--kl-pad-tablet, var(--kl-pad-desktop, 24px));
      padding-bottom: var(--kl-pad-tablet, var(--kl-pad-desktop, 24px));
    }

    :root[data-kl-device="mobile"] [data-kl-pad]{
      padding-top: var(
        --kl-pad-mobile,
        var(--kl-pad-tablet, var(--kl-pad-desktop, 24px))
      );
      padding-bottom: var(
        --kl-pad-mobile,
        var(--kl-pad-tablet, var(--kl-pad-desktop, 24px))
      );
    }

    /* =========================================
    Per-device text alignment, driven by editor device
    ========================================= */
    :root[data-kl-device="desktop"] [data-kl-align]{
    text-align: var(--kl-align-desktop, inherit);
    }

    :root[data-kl-device="tablet"] [data-kl-align]{
    text-align: var(
        --kl-align-tablet,
        var(--kl-align-desktop, inherit)
    );
    }

    :root[data-kl-device="mobile"] [data-kl-align]{
    text-align: var(
        --kl-align-mobile,
        var(--kl-align-tablet, var(--kl-align-desktop, inherit))
    );
    }

    .khint {
      position:fixed;
      z-index:2147483646;
      padding:6px 8px;
      background:#111827;
      color:#fff;
      border-radius:8px;
      font:12px/1.2 system-ui;
      max-width:320px;
    }
  `;

    doc.head.appendChild(style);

    // tie CSS to current editor device, not viewport width
    doc.documentElement.setAttribute("data-kl-device", initialDevice);

    const hint = doc.createElement("div");
    hint.className = "khint";
    hint.style.display = "none";
    hint.setAttribute("data-kloner-hint", "1");
    doc.body.appendChild(hint);

    function showHint(text: string, near: HTMLElement) {
        hint.textContent = text;
        const r = near.getBoundingClientRect();
        hint.style.left = `${Math.min(
            r.left,
            doc.defaultView!.innerWidth - 340
        )}px`;
        hint.style.top = `${r.bottom + 8}px`;
        hint.style.display = "block";
        setTimeout(() => (hint.style.display = "none"), 4000);
    }

    function cssBox(el: HTMLElement) {
        const cs = doc.defaultView!.getComputedStyle(el);
        return {
            w: el.getBoundingClientRect().width,
            h: el.getBoundingClientRect().height,
            fontSize: (cs as any).fontSize as string,
            textAlign: (cs as any).textAlign as string,
            fontFamily: (cs as any).fontFamily as string,
            color: (cs as any).color as string,
            backgroundColor: (cs as any).backgroundColor as string,
        };
    }

    const texty = new Set([
        "P",
        "SPAN",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "LI",
        "SMALL",
        "STRONG",
        "EM",
        "LABEL",
        "BUTTON",
        "A",
        "DIV",
    ]);

    function markEditable(root: ParentNode) {
        const w = doc.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT);
        while (w.nextNode()) {
            const el = w.currentNode as HTMLElement;
            if (texty.has(el.tagName)) el.contentEditable = "true";
        }
    }
    markEditable(doc.body);

    function ensureButtonHasContent(target: HTMLElement | null) {
        if (!target) return;
        const buttonLike = target.closest("button, a") as HTMLElement | null;
        if (!buttonLike || !buttonLike.isContentEditable) return;

        const raw = buttonLike.textContent || "";
        const normalized = raw.replace(/\u00A0/g, " ").trim();
        if (normalized.length === 0) {
            buttonLike.innerHTML = "\u00A0";
        }
    }

    doc
        .querySelectorAll<HTMLElement>("button[contenteditable], a[contenteditable]")
        .forEach((el) => {
            ensureButtonHasContent(el);
        });

    function serializeClean(): string {
        // Clone the whole document element
        const htmlClone = doc.documentElement.cloneNode(true) as HTMLHtmlElement;
        const head = htmlClone.querySelector("head");
        const bodyClone = htmlClone.querySelector("body")!;

        // 1) Bake per-device padding into the clone so export has real padding
        try {
            const livePadNodes = doc.body.querySelectorAll<HTMLElement>("[data-kl-pad]");
            const clonePadNodes = bodyClone.querySelectorAll<HTMLElement>("[data-kl-pad]");

            livePadNodes.forEach((liveEl, idx) => {
                const cloneEl = clonePadNodes[idx];
                if (!cloneEl) return;

                const cs = doc.defaultView!.getComputedStyle(liveEl);
                const pt = cs.paddingTop;
                const pb = cs.paddingBottom;

                if (pt && pt !== "0px") {
                    cloneEl.style.paddingTop = pt;
                }
                if (pb && pb !== "0px") {
                    cloneEl.style.paddingBottom = pb;
                }

                // Drop editor-specific vars / flags from export
                cloneEl.style.removeProperty("--kl-pad-desktop");
                cloneEl.style.removeProperty("--kl-pad-tablet");
                cloneEl.style.removeProperty("--kl-pad-mobile");
                cloneEl.removeAttribute("data-kl-pad");
            });
        } catch {
            // best-effort only; ignore failures
        }

        // 2) The exported HTML doesn’t need the editor device flag
        htmlClone.removeAttribute("data-kl-device");

        // 3) Remove injected overlay UI and helpers from body
        bodyClone.querySelectorAll(".khint").forEach((n) => n.remove());

        // 4) Strip selection + edit attributes
        bodyClone.querySelectorAll("[data-kloner-sel]").forEach((n) =>
            (n as HTMLElement).removeAttribute("data-kloner-sel")
        );
        bodyClone.querySelectorAll("[contenteditable]").forEach((n) =>
            (n as HTMLElement).removeAttribute("contenteditable")
        );
        bodyClone
            .querySelectorAll("[data-kloner-nav-page-id]")
            .forEach((n) =>
                (n as HTMLElement).removeAttribute("data-kloner-nav-page-id")
            );
        bodyClone
            .querySelectorAll("[data-kloner-nav-label]")
            .forEach((n) =>
                (n as HTMLElement).removeAttribute("data-kloner-nav-label")
            );
        bodyClone
            .querySelectorAll("[data-kloner-nav-active]")
            .forEach((n) =>
                (n as HTMLElement).removeAttribute("data-kloner-nav-active")
            );

        // 5) Remove injected editor style blocks from head
        if (head) {
            head.querySelectorAll("[data-kloner-style]").forEach((n) => n.remove());
        }

        return "<!doctype html>\n" + (htmlClone as any).outerHTML;
    }

    let hist: string[] = [];
    let idx = -1;

    function updateUndoRedoState() {
        // placeholder for future UI
    }

    function saveHistory() {
        const snap = serializeClean();
        if (idx >= 0 && hist[idx] === snap) return;
        hist = hist.slice(0, idx + 1);
        hist.push(snap);
        idx = hist.length - 1;
        updateUndoRedoState();
    }

    function restoreHistory(nextIndex: number) {
        if (nextIndex < 0 || nextIndex >= hist.length) return;
        idx = nextIndex;
        const parser = new DOMParser();
        const doc2 = parser.parseFromString(hist[idx], "text/html");

        const newBody = doc2.body;
        doc.body.replaceWith(doc.importNode(newBody, true));

        doc.body.appendChild(hint);
        markEditable(doc.body);

        doc
            .querySelectorAll<HTMLElement>("button[contenteditable], a[contenteditable]")
            .forEach((el) => {
                ensureButtonHasContent(el);
            });

        select(null);
        updateUndoRedoState();
        notify();
    }

    function undo() {
        restoreHistory(idx - 1);
    }

    function redo() {
        restoreHistory(idx + 1);
    }

    const notify = (() => {
        let t = 0 as unknown as number;
        let raf = 0 as unknown as number;
        return () => {
            clearTimeout(t as any);
            if (raf) cancelAnimationFrame(raf as any);
            t = window.setTimeout(() => {
                raf = requestAnimationFrame(() => {
                    saveHistory();
                    onChange(serializeClean());
                });
            }, 250);
        };
    })();

    // initial history snapshot
    saveHistory();

    let selected: HTMLElement | null = null;
    let activeDevice: Device = initialDevice;

    function getPaddingVarName(device: Device) {
        if (device === "tablet") return "--kl-pad-tablet";
        if (device === "mobile") return "--kl-pad-mobile";
        return "--kl-pad-desktop";
    }

    function getAlignVarName(device: Device) {
        if (device === "tablet") return "--kl-align-tablet";
        if (device === "mobile") return "--kl-align-mobile";
        return "--kl-align-desktop";
    }

    function getCurrentDevicePadding(block: HTMLElement, device: Device): number {
        const varName = getPaddingVarName(device);
        const raw = block.style.getPropertyValue(varName)?.trim();

        if (raw && raw.endsWith("px")) {
            const n = parseFloat(raw.slice(0, -2));
            if (!Number.isNaN(n)) return n;
        }

        // Fallback: use computed paddingTop as base
        const cs = doc.defaultView!.getComputedStyle(block);
        const fromComputed = parseFloat(cs.paddingTop || "0") || 0;
        if (fromComputed > 0) return fromComputed;

        return 24;
    }

    function normalizeAllDevicePadding(block: HTMLElement) {
        const desktop = getCurrentDevicePadding(block, "desktop");

        const tabletRaw = block.style.getPropertyValue("--kl-pad-tablet");
        const mobileRaw = block.style.getPropertyValue("--kl-pad-mobile");

        const tablet =
            tabletRaw && tabletRaw.endsWith("px")
                ? parseFloat(tabletRaw)
                : Math.round(desktop * 0.85);

        const mobile =
            mobileRaw && mobileRaw.endsWith("px")
                ? parseFloat(mobileRaw)
                : Math.round(desktop * 0.7);

        // Switch block to responsive padding mode
        block.setAttribute("data-kl-pad", "1");
        // Let stylesheet control padding so device rules can work
        block.style.removeProperty("padding");

        block.style.setProperty("--kl-pad-desktop", `${desktop}px`);
        block.style.setProperty("--kl-pad-tablet", `${tablet}px`);
        block.style.setProperty("--kl-pad-mobile", `${mobile}px`);
    }

    function publishSelection() {
        if (selected) {
            const r = selected.getBoundingClientRect();
            const payload = {
                has: true,
                tagName: selected.tagName,
                rect: {
                    top: r.top,
                    left: r.left,
                    right: r.right,
                    bottom: r.bottom,
                    width: r.width,
                    height: r.height,
                },
            };
            doc.defaultView?.parent?.postMessage(
                { type: "kloner:selection", meta: payload },
                "*"
            );
        } else {
            doc.defaultView?.parent?.postMessage(
                { type: "kloner:selection", meta: { has: false } },
                "*"
            );
        }
    }

    function select(el: HTMLElement | null) {
        if (selected) {
            selected.removeAttribute("data-kloner-sel");
        }
        selected = el;
        if (selected) {
            selected.setAttribute("data-kloner-sel", "1");
        }
        publishSelection();
    }

    function applyStyleCommand(cmd: any) {
        if (!selected || !cmd || typeof cmd.kind !== "string") return;

        let didChange = false;

        if (cmd.kind === "fontFamily" && typeof cmd.value === "string") {
            selected.style.fontFamily = cmd.value;
            didChange = true;
        } else if (cmd.kind === "fontSizePx" && typeof cmd.value === "number") {
            selected.style.fontSize = `${cmd.value}px`;
            didChange = true;
        } else if (cmd.kind === "align") {
            const v = cmd.value;
            if (v === "left" || v === "center" || v === "right") {
                const block = selected;
                const varName = getAlignVarName(activeDevice);

                // mark this element as alignment-managed by the editor
                block.setAttribute("data-kl-align", "1");

                // per-device alignment via CSS var
                block.style.setProperty(varName, v);

                // clear inline textAlign on descendants so parent wins
                block.querySelectorAll<HTMLElement>("*").forEach((child) => {
                    if (child !== block && child.style.textAlign) {
                        child.style.removeProperty("text-align");
                    }
                });

                // special handling: physically center headings inside this block
                const headings = block.querySelectorAll<HTMLElement>(
                    "h1,h2,h3,h4,h5,h6,.section-title"
                );

                if (v === "center") {
                    headings.forEach((h) => {
                        // drop captured fixed widths so centering isn’t offset
                        if (h.style.width) h.style.removeProperty("width");
                        // optional: if you want max-width free too
                        // if (h.style.maxWidth) h.style.removeProperty("max-width");

                        // make the block itself center inside the parent
                        h.style.display = h.style.display || "block";
                        h.style.marginLeft = "auto";
                        h.style.marginRight = "auto";
                    });
                } else if (v === "left") {
                    // reset auto margins when aligning left
                    headings.forEach((h) => {
                        if (h.style.marginLeft === "auto") {
                            h.style.removeProperty("margin-left");
                        }
                        if (h.style.marginRight === "auto") {
                            h.style.removeProperty("margin-right");
                        }
                    });
                }

                didChange = true;
            }
        } else if (cmd.kind === "textColor" && typeof cmd.value === "string") {
            selected.style.color = cmd.value;
            didChange = true;
        } else if (cmd.kind === "bgColor" && typeof cmd.value === "string") {
            selected.style.backgroundColor = cmd.value;
            didChange = true;
        } else if (cmd.kind === "transform") {
            if (cmd.value === "uppercase") {
                selected.style.textTransform = "uppercase";
                didChange = true;
            } else if (cmd.value === "none") {
                selected.style.textTransform = "none";
                didChange = true;
            }
        } else if (
            cmd.kind === "weight" &&
            (typeof cmd.value === "string" || typeof cmd.value === "number")
        ) {
            (selected.style as any).fontWeight = String(cmd.value);
            didChange = true;
        } else if (
            cmd.kind === "letterSpacing" &&
            typeof cmd.value === "string"
        ) {
            (selected.style as any).letterSpacing = cmd.value;
            didChange = true;
        }

        if (didChange) {
            saveHistory();
            notify();
            publishSelection();
        }
    }

    const api: any = (doc.defaultView as any).__klonerApi || {};

    // core
    api.clear = () => {
        select(null);
        (doc.activeElement as HTMLElement | null)?.blur?.();
    };
    api.style = (cmd: any) => applyStyleCommand(cmd);
    api.select = (el: HTMLElement | null) => {
        select(el);
    };

    // device (for per-device padding etc.)
    api.setDevice = (next: Device) => {
        if (!next || next === activeDevice) return;
        activeDevice = next;
        doc.documentElement.setAttribute("data-kl-device", next);
    };

    // block ops
    api.deleteBlock = () => {
        if (!selected) return;
        deleteAssetsForElement(selected);
        const p = selected.parentElement;
        selected.remove();
        select(null);
        p?.focus?.();
        saveHistory();
        notify();
    };

    api.duplicateBlock = () => {
        if (!selected) return;
        const clone = selected.cloneNode(true) as HTMLElement;
        selected.insertAdjacentElement("afterend", clone);
        markEditable(clone);
        select(clone);
        saveHistory();
        notify();
    };

    api.addTextBox = () => {
        if (!selected) return;
        createTextBox(selected);
    };

    api.moveBlockUp = () => {
        if (!selected) return;
        moveBlock(selected, "up");
    };

    api.moveBlockDown = () => {
        if (!selected) return;
        moveBlock(selected, "down");
    };

    api.moveBlockLeft = () => {
        if (!selected) return;
        moveBlock(selected, "left");
    };

    api.moveBlockRight = () => {
        if (!selected) return;
        moveBlock(selected, "right");
    };

    api.padMore = () => {
        if (!selected) return;
        adjustBlockPadding(selected, 8);
    };

    api.blockGrow = () => {
        if (!selected) return;
        growBlock(selected, 1.1);
    };

    api.blockShrink = () => {
        if (!selected) return;
        shrinkBlock(selected, 0.9);
    };

    api.padLess = () => {
        if (!selected) return;
        adjustBlockPadding(selected, -8);
    };

    // image ops
    api.insertImage = () => {
        if (!selected) return;
        insertImageIntoBlock(selected).catch(() => { });
    };

    api.setBackgroundImage = () => {
        if (!selected) return;
        setBlockBackgroundImage(selected).catch(() => { });
    };

    api.replaceImage = () => {
        if (!selected) return;
        const img = getImageFromSelection(selected);
        if (!img) return;
        replaceImage(img);
    };

    api.deleteImage = () => {
        if (!selected) return;
        deleteImageOnBlock(selected);
    };

    api.setAltText = () => {
        if (!selected) return;
        const img = getImageFromSelection(selected);
        if (!img) return;
        const next = prompt("Alt text:", img.getAttribute("alt") || "");
        if (next !== null) {
            img.setAttribute("alt", next);
            saveHistory();
            notify();
            showHint("ALT updated.", img);
        }
    };

    api.bringImageForward = () => {
        if (!selected) return;
        const img = getImageFromSelection(selected);
        if (!img) return;
        moveImageLayer(img, "forward");
        saveHistory();
        notify();
    };

    api.sendImageBackward = () => {
        if (!selected) return;
        const img = getImageFromSelection(selected);
        if (!img) return;
        moveImageLayer(img, "backward");
        saveHistory();
        notify();
    };

    api.growImage = () => {
        if (!selected) return;
        resizeImage(selected, 1.1);
    };

    api.shrinkImage = () => {
        if (!selected) return;
        resizeImage(selected, 0.9);
    };

    // links
    api.editLink = () => {
        if (!selected) return;
        editLink(selected);
    };

    // history
    api.undo = () => {
        undo();
    };

    api.redo = () => {
        redo();
    };

    // selection/meta/export
    api.getSelectionMeta = () => {
        return selected
            ? { has: true, tagName: selected.tagName }
            : { has: false };
    };

    api.exportCleanHtml = () => {
        return serializeClean();
    };

    api.syncHeaderNav = (
        pages: { id: string; label: string; path?: string }[]
    ) => {
        if (!Array.isArray(pages) || pages.length === 0) return;

        let navRoot =
            doc.querySelector<HTMLElement>("[data-kloner-nav]") ||
            doc.querySelector<HTMLElement>("header nav") ||
            doc.querySelector<HTMLElement>("nav");

        if (!navRoot) return;

        const links = Array.from(navRoot.querySelectorAll<HTMLAnchorElement>("a"));
        if (!links.length) return;

        const makeSlug = (raw: string) => {
            const base = raw.toLowerCase().trim();
            const stripped = base
                .replace(/^https?:\/\//, "")
                .replace(/^www\./, "")
                .replace(/\.(com|net|org|io|app|dev|site|co|ai|info|xyz|me)$/, "");
            const slug = stripped
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
            return slug || "page";
        };

        pages.forEach((p, idx) => {
            const link = links[idx];
            if (!link) return;

            const label = (p.label || "").trim() || `Page ${idx + 1}`;

            // label text
            link.textContent = label;

            // href
            if (p.path && p.path.trim()) {
                link.setAttribute("href", p.path.trim());
            } else {
                const slug = makeSlug(label);
                const href = idx === 0 ? "/" : `/${slug}`;
                link.setAttribute("href", href);
            }

            // mapping attributes used for badges
            link.setAttribute("data-kloner-nav-page-id", p.id);
            link.setAttribute("data-kloner-nav-label", label);
        });

        // clear any stale active marker
        links.forEach((lnk) =>
            lnk.removeAttribute("data-kloner-nav-active")
        );

        saveHistory();
        notify();
    };

    api.highlightNavForPage = (pageId: string) => {
        if (!pageId) return;

        let navRoot =
            doc.querySelector<HTMLElement>("[data-kloner-nav]") ||
            doc.querySelector<HTMLElement>("header nav") ||
            doc.querySelector<HTMLElement>("nav");
        if (!navRoot) return;

        const links = Array.from(navRoot.querySelectorAll<HTMLAnchorElement>("a"));
        if (!links.length) return;

        links.forEach((link) => {
            const linkedId = link.getAttribute("data-kloner-nav-page-id");
            if (linkedId === pageId) {
                link.setAttribute("data-kloner-nav-active", "1");
            } else {
                link.removeAttribute("data-kloner-nav-active");
            }
        });
    };

    // aliases for React toolbar
    api.blockDelete = api.deleteBlock;
    api.blockDuplicate = api.duplicateBlock;

    api.blockMoveUp = api.moveBlockUp;
    api.blockMoveDown = api.moveBlockDown;
    api.blockMoveLeft = api.moveBlockLeft;
    api.blockMoveRight = api.moveBlockRight;

    api.imgInsert = api.insertImage;
    api.imgDelete = api.deleteImage;
    api.imgBg = api.setBackgroundImage;
    api.imgGrow = api.growImage;
    api.imgShrink = api.shrinkImage;

    api.textboxAdd = api.addTextBox;
    api.linkEdit = api.editLink;

    api.historyUndo = api.undo;
    api.historyRedo = api.redo;

    (doc.defaultView as any).__klonerApi = api;

    doc.addEventListener(
        "click",
        (e) => {
            const t = e.target as HTMLElement;
            const block = t.closest(
                "section, article, header, footer, main, button, a, div, li, p, h1, h2, h3, h4, h5"
            ) as HTMLElement | null;

            if (block) select(block);
            else select(null);
        },
        true
    );

    // no drag / drag-to-resize / drag-and-drop layout logic anymore

    /* asset + image helpers, padding, moveBlock etc. */

    function deleteAssetsForElement(root: HTMLElement) {
        const paths = new Set<string>();

        if (root.tagName === "IMG") {
            const p = (root as HTMLImageElement).getAttribute("data-kloner-path");
            if (p) paths.add(p);
        }

        if (root.hasAttribute("data-kloner-bg-path")) {
            const p = root.getAttribute("data-kloner-bg-path");
            if (p) paths.add(p);
        }

        root.querySelectorAll("img[data-kloner-path]").forEach((img) => {
            const p = img.getAttribute("data-kloner-path");
            if (p) paths.add(p);
        });

        root.querySelectorAll<HTMLElement>("[data-kloner-bg-path]").forEach((el) => {
            const p = el.getAttribute("data-kloner-bg-path");
            if (p) paths.add(p);
        });

        if (paths.size > 0) {
            doc.defaultView?.parent?.postMessage(
                {
                    type: "kloner:delete-assets",
                    paths: Array.from(paths),
                },
                "*"
            );
        }
    }

    const pendingImagePaths: Set<string> = new Set();

    function deleteAssetsByPaths(paths: string[]) {
        if (!paths.length) return;

        for (const p of paths) {
            pendingImagePaths.delete(p);
        }

        doc.defaultView?.parent?.postMessage(
            {
                type: "kloner:delete-assets",
                paths,
            },
            "*"
        );
    }

    function deleteImageOnBlock(block: HTMLElement) {
        const img =
            (block.tagName === "IMG"
                ? (block as HTMLImageElement)
                : (block.querySelector("img") as HTMLImageElement | null)) ?? null;

        if (!img) {
            showHint("Select a block with an <img> to delete.", block);
            return;
        }

        const path = img.getAttribute("data-kloner-path");
        if (path) {
            try {
                deleteAssetsByPaths([path]);
            } catch (err) {
                console.warn(
                    "[deleteImageOnBlock] deleteAssetsByPaths threw synchronously",
                    { path },
                    err
                );
            }
        }

        if (img.hasAttribute("data-kloner-old-path")) {
            img.removeAttribute("data-kloner-old-path");
        }

        if (img.dataset.localImageId) {
            const tempUrl = img.src;
            try {
                URL.revokeObjectURL(tempUrl);
            } catch {
                // ignore
            }
            img.removeAttribute("data-local-image-id");
            img.removeAttribute("data-local-filename");
        }

        img.remove();
        saveHistory();
        notify();
        showHint("Image deleted.", block);
    }

    function pickLocalFile(): Promise<File | null> {
        return new Promise((resolve) => {
            const input = doc.createElement("input");
            input.type = "file";
            input.accept = "image/*";

            input.onchange = () => {
                const file = input.files?.[0] || null;
                resolve(file);
            };

            input.click();
        });
    }

    async function insertImageIntoBlock(block: HTMLElement) {
        const file = await pickLocalFile();
        if (!file) return;

        const tempUrl = URL.createObjectURL(file);
        const img = doc.createElement("img");
        const localId = crypto.randomUUID();

        img.src = tempUrl;
        img.alt = "";
        img.style.display = "block";

        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.removeAttribute("height");

        img.dataset.localImageId = localId;
        img.dataset.localFilename = file.name || "image";

        const box = cssBox(block);
        if (box.w > 4) {
            img.style.width = `${Math.round(box.w)}px`;
            img.setAttribute("width", String(Math.round(box.w)));
        }

        if (block.firstChild) block.insertBefore(img, block.firstChild);
        else block.appendChild(img);

        saveHistory();
        notify();
        showHint("Image inserted (pending upload).", block);
    }

    async function replaceImage(el: HTMLImageElement) {
        const file = await pickLocalFile();
        if (!file) return;

        const box = cssBox(el);
        const oldPath = el.getAttribute("data-kloner-path") || undefined;

        const tempUrl = URL.createObjectURL(file);
        const localId = crypto.randomUUID();

        el.src = tempUrl;
        el.dataset.localImageId = localId;
        el.dataset.localFilename = file.name || "image";

        if (oldPath) {
            el.setAttribute("data-kloner-old-path", oldPath);
            el.removeAttribute("data-kloner-path");
        }

        if (!el.style.width && !el.getAttribute("width") && box.w > 4) {
            el.style.width = `${Math.round(box.w)}px`;
            el.setAttribute("width", String(Math.round(box.w)));
        }

        el.style.maxWidth = "100%";
        el.style.height = "auto";
        el.removeAttribute("height");

        saveHistory();
        notify();
        showHint("Image replaced (pending upload).", el);
    }

    async function setBlockBackgroundImage(block: HTMLElement) {
        const file = await pickLocalFile();
        if (!file) return;

        const tempUrl = URL.createObjectURL(file);

        const oldPath = block.getAttribute("data-kloner-bg-path") || undefined;
        if (oldPath) {
            block.setAttribute("data-kloner-bg-old-path", oldPath);
            block.removeAttribute("data-kloner-bg-path");
        }

        const cs = doc.defaultView!.getComputedStyle(block);
        if (cs.position === "static") {
            block.style.position = "relative";
        }

        block.style.backgroundImage = `url("${tempUrl}")`;
        block.style.backgroundSize = "cover";
        block.style.backgroundPosition = "center center";
        block.style.backgroundRepeat = "no-repeat";

        const localId =
            typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : String(Date.now());

        (block.dataset as any).localImageId = localId;
        (block.dataset as any).localFilename = file.name || "background";

        saveHistory();
        notify();
        showHint("Background image set (pending upload).", block);
    }

    function adjustBlockPadding(block: HTMLElement, deltaPx: number) {
        // ensure block is using responsive padding vars
        normalizeAllDevicePadding(block);

        const varName = getPaddingVarName(activeDevice);
        const current = getCurrentDevicePadding(block, activeDevice);
        let next = current + deltaPx;

        if (next < 0) next = 0;
        if (next > 160) next = 160;

        const rounded = Math.round(next);

        block.style.setProperty(varName, `${rounded}px`);
        block.setAttribute("data-kl-pad", "1");

        saveHistory();
        notify();
        showHint(`Padding (${activeDevice}) set to ${rounded}px.`, block);
    }

    function growBlock(block: HTMLElement, factor: number = 1.1) {
        const rect = block.getBoundingClientRect();
        const parent = block.parentElement;
        const parentRect = parent?.getBoundingClientRect();

        const baseWidth = rect.width;
        let nextWidth = baseWidth * factor;

        if (parentRect) {
            const maxWidth = parentRect.width;
            if (nextWidth > maxWidth) nextWidth = maxWidth;
        }

        const minWidth = 120;
        if (nextWidth < minWidth) nextWidth = minWidth;

        block.style.width = `${Math.round(nextWidth)}px`;
        block.style.maxWidth = "100%";

        saveHistory();
        notify();
        showHint("Block resized.", block);
    }

    function shrinkBlock(block: HTMLElement, factor: number = 0.9) {
        growBlock(block, factor);
    }

    function moveBlock(
        block: HTMLElement,
        direction: "up" | "down" | "left" | "right"
    ) {
        const parent = block.parentElement;
        if (!parent) return;

        const children = Array.from(parent.children) as HTMLElement[];
        const index = children.indexOf(block);
        if (index === -1) return;

        const isBackward = direction === "up" || direction === "left";
        const isForward = direction === "down" || direction === "right";

        if (isBackward && index === 0) {
            showHint("This block is already at the start of its group.", block);
            return;
        }
        if (isForward && index === children.length - 1) {
            showHint("This block is already at the end of its group.", block);
            return;
        }

        let targetIndex = index;
        if (isBackward) targetIndex = index - 1;
        if (isForward) targetIndex = index + 1;

        const target = children[targetIndex];
        if (!target) return;

        if (isBackward) {
            parent.insertBefore(block, target);
        } else {
            target.after(block);
        }

        saveHistory();
        notify();
        showHint("Block moved in the layout.", block);
    }

    function editLink(target: HTMLElement) {
        let linkEl: HTMLAnchorElement | null = null;
        if (target.tagName === "A") {
            linkEl = target as HTMLAnchorElement;
        } else {
            linkEl = target.closest("a") as HTMLAnchorElement | null;
        }
        if (!linkEl) {
            showHint("No link found here.", target);
            return;
        }
        const current = linkEl.getAttribute("href") || "";
        const next = prompt("Link URL (href):", current);
        if (next === null) return;
        if (next.trim() === "") {
            linkEl.removeAttribute("href");
            showHint("Link cleared.", linkEl);
        } else {
            linkEl.setAttribute("href", next.trim());
            showHint("Link updated.", linkEl);
        }
        saveHistory();
        notify();
    }

    function getImageFromSelection(sel: HTMLElement | null): HTMLImageElement | null {
        if (!sel) return null;
        if (sel.tagName === "IMG") return sel as HTMLImageElement;
        return (sel.querySelector("img") as HTMLImageElement | null) ?? null;
    }

    function moveImageLayer(img: HTMLImageElement, direction: "forward" | "backward") {
        const parent = img.parentElement;
        if (!parent) return;

        const siblings = Array.from(parent.children) as HTMLElement[];
        const index = siblings.indexOf(img);
        if (index === -1) return;

        if (direction === "forward") {
            if (index === siblings.length - 1) return;
            const next = siblings[index + 1];
            next.after(img);
        } else {
            if (index === 0) return;
            const prev = siblings[index - 1];
            parent.insertBefore(img, prev);
        }
    }

    function resizeImage(target: HTMLElement, factor: number) {
        const img =
            (target.tagName === "IMG"
                ? (target as HTMLImageElement)
                : (target.querySelector("img") as HTMLImageElement | null)) ?? null;

        if (!img) {
            showHint("Select a block with an <img> to resize.", target);
            return;
        }

        const naturalW =
            Number(img.dataset.klonerBaseWidth) ||
            img.naturalWidth ||
            parseInt(img.getAttribute("width") || "0", 10) ||
            0;
        const naturalH =
            Number(img.dataset.klonerBaseHeight) ||
            img.naturalHeight ||
            parseInt(img.getAttribute("height") || "0", 10) ||
            0;

        if (!naturalW || !naturalH) {
            showHint("Can't determine image size.", img);
            return;
        }

        if (!img.dataset.klonerBaseWidth) {
            img.dataset.klonerBaseWidth = String(naturalW);
            img.dataset.klonerBaseHeight = String(naturalH);
        }

        const currentW =
            parseInt(
                (img.style.width && img.style.width.endsWith("px")
                    ? img.style.width.slice(0, -2)
                    : img.getAttribute("width") || "") || "0",
                10
            ) || naturalW;

        let nextW = Math.round(currentW * factor);
        const minW = Math.max(80, Math.round(naturalW * 0.25));
        const maxW = Math.round(naturalW * 2.5);

        if (nextW < minW) nextW = minW;
        if (nextW > maxW) nextW = maxW;

        img.style.width = `${nextW}px`;
        img.setAttribute("width", String(nextW));
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.removeAttribute("height");

        saveHistory();
        notify();
        showHint("Image resized.", img);
    }

    function createTextBox(anchor: HTMLElement) {
        let container: HTMLElement = anchor;
        if (anchor.tagName === "IMG" && anchor.parentElement) {
            container = anchor.parentElement as HTMLElement;
        }

        const cs = doc.defaultView!.getComputedStyle(container);
        if (cs.position === "static") {
            container.style.position = "relative";
        }

        const box = doc.createElement("div");
        box.setAttribute("data-kloner-textbox", "1");
        box.contentEditable = "true";
        box.textContent = "Edit text";

        box.style.position = "absolute";
        box.style.left = "50%";
        box.style.top = "50%";
        box.style.transform = "translate(-50%, -50%)";

        box.style.minWidth = "140px";
        box.style.minHeight = "40px";
        box.style.padding = "10px 12px";
        box.style.borderRadius = "8px";
        box.style.background = "rgba(15,23,42,0.78)";
        box.style.color = "#f9fafb";
        box.style.fontSize = "16px";
        box.style.lineHeight = "1.4";
        box.style.boxShadow = "0 12px 25px rgba(15,23,42,0.35)";
        box.style.resize = "both";
        box.style.overflow = "auto";
        box.style.zIndex = "20";

        container.appendChild(box);
        markEditable(box);

        select(box);
        saveHistory();
        notify();
        showHint("Text box added. Click to edit, drag corner to resize.", box);
    }

    const mo = new MutationObserver(() => notify());
    mo.observe(doc.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
    });

    doc.addEventListener(
        "input",
        (e) => {
            const target = e.target as HTMLElement | null;
            ensureButtonHasContent(target || null);
            notify();
        },
        true
    );

    doc.addEventListener("keydown", (e) => {
        const key = e.key.toLowerCase();
        const mod = e.metaKey || e.ctrlKey;
        if (mod && key === "z") {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
        }
        if (e.key === "Escape")
            (doc.defaultView as any).__klonerApi?.clear();
        if ((key === "backspace" || key === "delete") && selected) {
            const active = doc.activeElement as HTMLElement | null;
            if (
                !active?.isContentEditable &&
                active?.tagName !== "INPUT" &&
                active?.tagName !== "TEXTAREA"
            ) {
                e.preventDefault();
                const parent = selected.parentElement;
                selected.remove();
                (doc.defaultView as any).__klonerApi?.clear();
                parent?.focus?.();
                saveHistory();
                notify();
            }
        }
    });

    updateUndoRedoState();
    publishSelection();
}

// legacy alias if any call sites still use the old name
export const injectEditableOverlay = installKlonerIframeApi;
