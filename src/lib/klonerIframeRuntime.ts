// src/lib/installKlonerIframeApi.ts

import { Device } from "@/components/editor/PreviewEditor";

export function installKlonerIframeApi(
    doc: Document,
    onChange: (updatedHtml: string) => void,
    initialDevice: Device = "desktop"
) {
    function applyCoepSafeImageAttrs() {
        // Dashboard routes run with COEP=require-corp for WebContainer.
        // Cross-origin <img> requests (e.g. Firebase Storage) must be CORS-enabled,
        // otherwise the browser blocks them with:
        // ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
        const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>("img[src]"));
        for (const img of imgs) {
            const src = img.getAttribute("src") || "";
            const isFirebaseStorage =
                /^https?:\/\/firebasestorage\.googleapis\.com\//i.test(src) ||
                /^https?:\/\/storage\.googleapis\.com\//i.test(src);
            if (!isFirebaseStorage) continue;

            const prev = img.getAttribute("crossorigin");
            if (prev !== "anonymous") {
                img.setAttribute("crossorigin", "anonymous");
                img.setAttribute("referrerpolicy", "no-referrer");

                // Force a refetch using CORS mode.
                try {
                    const cur = img.src;
                    img.src = cur;
                } catch {
                    // ignore
                }
            }
        }
    }

    // Remove old editor artifacts
    doc.querySelectorAll("[data-kloner-style]").forEach((n) => n.remove());
    doc.querySelectorAll("[data-kloner-sel]").forEach((n) =>
        (n as HTMLElement).removeAttribute("data-kloner-sel")
    );
    doc.querySelectorAll("[contenteditable]").forEach((n) =>
        (n as HTMLElement).removeAttribute("contenteditable")
    );

    applyCoepSafeImageAttrs();

    const style = doc.createElement("style");
    style.setAttribute("data-kloner-style", "1");
    style.textContent = `

     html, body {
        margin: 0;
        padding: 0;
        overflow: auto;
        scrollbar-width: none;        
    }

    html::-webkit-scrollbar,
    body::-webkit-scrollbar {
        width: 0;
        height: 0;
    }

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


       /* =========================================
    Per-device text alignment, driven by editor device
    ========================================= */
    [data-kl-align]{
      text-align: inherit;
    }

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

    /* =========================================
       Per-device border radius
       ========================================= */
    :root[data-kl-device="desktop"] [data-kl-radius]{
      border-radius: var(--kl-radius-desktop, 0px);
    }

    :root[data-kl-device="tablet"] [data-kl-radius]{
      border-radius: var(
        --kl-radius-tablet,
        var(--kl-radius-desktop, 0px)
      );
    }

    :root[data-kl-device="mobile"] [data-kl-radius]{
      border-radius: var(
        --kl-radius-mobile,
        var(--kl-radius-tablet, var(--kl-radius-desktop, 0px))
      );
    }

    /* make inner images follow the block radius */
    [data-kl-radius] img{
      border-radius: inherit;
    }


        /* =========================================
       Per-device margin driven by editor device toggle
       Supports per-side vars with sensible fallbacks
       ========================================= */
    :root[data-kl-device="desktop"] [data-kl-mar]{
      margin-top: var(--kl-mar-top-desktop, var(--kl-mar-desktop, 0px)) !important;
      margin-bottom: var(--kl-mar-bottom-desktop, var(--kl-mar-desktop, 0px)) !important;
      margin-left: var(--kl-mar-left-desktop, var(--kl-mar-desktop, 0px)) !important;
      margin-right: var(--kl-mar-right-desktop, var(--kl-mar-desktop, 0px)) !important;
    }

    :root[data-kl-device="tablet"] [data-kl-mar]{
      margin-top: var(
        --kl-mar-top-tablet,
        var(--kl-mar-top-desktop, var(--kl-mar-desktop, 0px))
      ) !important;
      margin-bottom: var(
        --kl-mar-bottom-tablet,
        var(--kl-mar-bottom-desktop, var(--kl-mar-desktop, 0px))
      ) !important;
      margin-left: var(
        --kl-mar-left-tablet,
        var(--kl-mar-left-desktop, var(--kl-mar-desktop, 0px))
      ) !important;
      margin-right: var(
        --kl-mar-right-tablet,
        var(--kl-mar-right-desktop, var(--kl-mar-desktop, 0px))
      ) !important;
    }

    :root[data-kl-device="mobile"] [data-kl-mar]{
      margin-top: var(
        --kl-mar-top-mobile,
        var(--kl-mar-top-tablet,
          var(--kl-mar-top-desktop, var(--kl-mar-desktop, 0px))
        )
      ) !important;
      margin-bottom: var(
        --kl-mar-bottom-mobile,
        var(--kl-mar-bottom-tablet,
          var(--kl-mar-bottom-desktop, var(--kl-mar-desktop, 0px))
        )
      ) !important;
      margin-left: var(
        --kl-mar-left-mobile,
        var(--kl-mar-left-tablet,
          var(--kl-mar-left-desktop, var(--kl-mar-desktop, 0px))
        )
      ) !important;
      margin-right: var(
        --kl-mar-right-mobile,
        var(--kl-mar-right-tablet,
          var(--kl-mar-right-desktop, var(--kl-mar-desktop, 0px))
        )
      ) !important;
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
       Per-device margin driven by editor device toggle
       Supports per-side vars with sensible fallbacks
       ========================================= */
    :root[data-kl-device="desktop"] [data-kl-mar]{
      margin-top: var(--kl-mar-top-desktop, var(--kl-mar-desktop, 0px));
      margin-bottom: var(--kl-mar-bottom-desktop, var(--kl-mar-desktop, 0px));
      margin-left: var(--kl-mar-left-desktop, var(--kl-mar-desktop, 0px));
      margin-right: var(--kl-mar-right-desktop, var(--kl-mar-desktop, 0px));
    }

    :root[data-kl-device="tablet"] [data-kl-mar]{
      margin-top: var(
        --kl-mar-top-tablet,
        var(--kl-mar-top-desktop, var(--kl-mar-desktop, 0px))
      );
      margin-bottom: var(
        --kl-mar-bottom-tablet,
        var(--kl-mar-bottom-desktop, var(--kl-mar-desktop, 0px))
      );
      margin-left: var(
        --kl-mar-left-tablet,
        var(--kl-mar-left-desktop, var(--kl-mar-desktop, 0px))
      );
      margin-right: var(
        --kl-mar-right-tablet,
        var(--kl-mar-right-desktop, var(--kl-mar-desktop, 0px))
      );
    }

    :root[data-kl-device="mobile"] [data-kl-mar]{
      margin-top: var(
        --kl-mar-top-mobile,
        var(--kl-mar-top-tablet,
          var(--kl-mar-top-desktop, var(--kl-mar-desktop, 0px))
        )
      );
      margin-bottom: var(
        --kl-mar-bottom-mobile,
        var(--kl-mar-bottom-tablet,
          var(--kl-mar-bottom-desktop, var(--kl-mar-desktop, 0px))
        )
      );
      margin-left: var(
        --kl-mar-left-mobile,
        var(--kl-mar-left-tablet,
          var(--kl-mar-left-desktop, var(--kl-mar-desktop, 0px))
        )
      );
      margin-right: var(
        --kl-mar-right-mobile,
        var(--kl-mar-right-tablet,
          var(--kl-mar-right-desktop, var(--kl-mar-desktop, 0px))
        )
      );
    }


      /* =========================================
       Per-device padding driven by editor device toggle
       Supports per-side vars with sensible fallbacks
       ========================================= */
    :root[data-kl-device="desktop"] [data-kl-pad]{
      padding-top: var(--kl-pad-top-desktop, var(--kl-pad-desktop, 24px));
      padding-bottom: var(--kl-pad-bottom-desktop, var(--kl-pad-desktop, 24px));
      padding-left: var(--kl-pad-left-desktop, var(--kl-pad-desktop, 24px));
      padding-right: var(--kl-pad-right-desktop, var(--kl-pad-desktop, 24px));
    }

    :root[data-kl-device="tablet"] [data-kl-pad]{
      padding-top: var(
        --kl-pad-top-tablet,
        var(--kl-pad-top-desktop, var(--kl-pad-desktop, 24px))
      );
      padding-bottom: var(
        --kl-pad-bottom-tablet,
        var(--kl-pad-bottom-desktop, var(--kl-pad-desktop, 24px))
      );
      padding-left: var(
        --kl-pad-left-tablet,
        var(--kl-pad-left-desktop, var(--kl-pad-desktop, 24px))
      );
      padding-right: var(
        --kl-pad-right-tablet,
        var(--kl-pad-right-desktop, var(--kl-pad-desktop, 24px))
      );
    }

    :root[data-kl-device="mobile"] [data-kl-pad]{
      padding-top: var(
        --kl-pad-top-mobile,
        var(--kl-pad-top-tablet,
          var(--kl-pad-top-desktop, var(--kl-pad-desktop, 24px))
        )
      );
      padding-bottom: var(
        --kl-pad-bottom-mobile,
        var(--kl-pad-bottom-tablet,
          var(--kl-pad-bottom-desktop, var(--kl-pad-desktop, 24px))
        )
      );
      padding-left: var(
        --kl-pad-left-mobile,
        var(--kl-pad-left-tablet,
          var(--kl-pad-left-desktop, var(--kl-pad-desktop, 24px))
        )
      );
      padding-right: var(
        --kl-pad-right-mobile,
        var(--kl-pad-right-tablet,
          var(--kl-pad-right-desktop, var(--kl-pad-desktop, 24px))
        )
      );
    }


       /* =========================================
       Per-device width
       ========================================= */
    :root[data-kl-device="desktop"] [data-kl-width]{
      width: var(--kl-width-desktop, auto);
    }

    :root[data-kl-device="tablet"] [data-kl-width]{
      width: var(
        --kl-width-tablet,
        var(--kl-width-desktop, auto)
      );
    }

    :root[data-kl-device="mobile"] [data-kl-width]{
      width: var(
        --kl-width-mobile,
        var(--kl-width-tablet, var(--kl-width-desktop, auto))
      );
    }


       /* =========================================
       Per-device text alignment + font size
       ========================================= */
    [data-kl-align]{
      text-align: var(--kl-align-desktop, inherit);
    }

    [data-kl-font]{
      font-size: var(--kl-font-size-desktop, inherit);
    }

    :root[data-kl-device="desktop"] [data-kl-align]{
      text-align: var(--kl-align-desktop, inherit);
    }
    :root[data-kl-device="desktop"] [data-kl-font]{
      font-size: var(--kl-font-size-desktop, inherit);
    }

    :root[data-kl-device="tablet"] [data-kl-align]{
      text-align: var(
        --kl-align-tablet,
        var(--kl-align-desktop, inherit)
      );
    }
    :root[data-kl-device="tablet"] [data-kl-font]{
      font-size: var(
        --kl-font-size-tablet,
        var(--kl-font-size-desktop, inherit)
      );
    }

    :root[data-kl-device="mobile"] [data-kl-align]{
      text-align: var(
        --kl-align-mobile,
        var(--kl-align-tablet, var(--kl-align-desktop, inherit))
      );
    }
    :root[data-kl-device="mobile"] [data-kl-font]{
      font-size: var(
        --kl-font-size-mobile,
        var(--kl-font-size-tablet, var(--kl-font-size-desktop, inherit))
      );
    }

    /* =========================================
       Per-device block positioning (margin-based align)
       Uses the current device's var only
       ========================================= */

    /* Desktop block align */
    :root[data-kl-device="desktop"] [data-kl-align][style*="--kl-align-desktop: center"]{
      display:block;
      margin-left:auto !important;
      margin-right:auto !important;
    }
    :root[data-kl-device="desktop"] [data-kl-align][style*="--kl-align-desktop: right"]{
      display:block;
      margin-left:auto !important;
      margin-right:0 !important;
    }
    :root[data-kl-device="desktop"] [data-kl-align][style*="--kl-align-desktop: left"]{
      display:block;
      margin-left:0 !important;
      margin-right:0 !important;
    }

    /* Tablet block align */
    :root[data-kl-device="tablet"] [data-kl-align][style*="--kl-align-tablet: center"]{
      display:block;
      margin-left:auto !important;
      margin-right:auto !important;
    }
    :root[data-kl-device="tablet"] [data-kl-align][style*="--kl-align-tablet: right"]{
      display:block;
      margin-left:auto !important;
      margin-right:0 !important;
    }
    :root[data-kl-device="tablet"] [data-kl-align][style*="--kl-align-tablet: left"]{
      display:block;
      margin-left:0 !important;
      margin-right:0 !important;
    }

    /* Mobile block align */
    :root[data-kl-device="mobile"] [data-kl-align][style*="--kl-align-mobile: center"]{
      display:block;
      margin-left:auto !important;
      margin-right:auto !important;
    }
    :root[data-kl-device="mobile"] [data-kl-align][style*="--kl-align-mobile: right"]{
      display:block;
      margin-left:auto !important;
      margin-right:0 !important;
    }
    :root[data-kl-device="mobile"] [data-kl-align][style*="--kl-align-mobile: left"]{
      display:block;
      margin-left:0 !important;
      margin-right:0 !important;
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

        // 1a) Bake per-device width into the clone so export has real width
        try {
            const liveWidthNodes = doc.body.querySelectorAll<HTMLElement>("[data-kl-width]");
            const cloneWidthNodes = bodyClone.querySelectorAll<HTMLElement>("[data-kl-width]");

            liveWidthNodes.forEach((liveEl, idx) => {
                const cloneEl = cloneWidthNodes[idx];
                if (!cloneEl) return;

                const cs = doc.defaultView!.getComputedStyle(liveEl);
                const w = cs.width;

                if (w && w !== "auto") {
                    cloneEl.style.width = w;
                }

                // Drop editor-specific vars / flags from export
                cloneEl.style.removeProperty("--kl-width-desktop");
                cloneEl.style.removeProperty("--kl-width-tablet");
                cloneEl.style.removeProperty("--kl-width-mobile");
                cloneEl.removeAttribute("data-kl-width");
            });
        } catch {
            // best-effort only; ignore failures
        }


        // 1b) Bake per-device margin into the clone so export has real margins
        try {
            const liveMarNodes = doc.body.querySelectorAll<HTMLElement>("[data-kl-mar]");
            const cloneMarNodes = bodyClone.querySelectorAll<HTMLElement>("[data-kl-mar]");

            liveMarNodes.forEach((liveEl, idx) => {
                const cloneEl = cloneMarNodes[idx];
                if (!cloneEl) return;

                const cs = doc.defaultView!.getComputedStyle(liveEl);
                const mt = cs.marginTop;
                const mb = cs.marginBottom;
                const ml = cs.marginLeft;
                const mr = cs.marginRight;

                if (mt && mt !== "0px") cloneEl.style.marginTop = mt;
                if (mb && mb !== "0px") cloneEl.style.marginBottom = mb;
                if (ml && ml !== "0px") cloneEl.style.marginLeft = ml;
                if (mr && mr !== "0px") cloneEl.style.marginRight = mr;

                // Drop editor-specific vars / flags from export
                cloneEl.style.removeProperty("--kl-mar-desktop");
                cloneEl.style.removeProperty("--kl-mar-tablet");
                cloneEl.style.removeProperty("--kl-mar-mobile");

                cloneEl.style.removeProperty("--kl-mar-top-desktop");
                cloneEl.style.removeProperty("--kl-mar-bottom-desktop");
                cloneEl.style.removeProperty("--kl-mar-left-desktop");
                cloneEl.style.removeProperty("--kl-mar-right-desktop");

                cloneEl.style.removeProperty("--kl-mar-top-tablet");
                cloneEl.style.removeProperty("--kl-mar-bottom-tablet");
                cloneEl.style.removeProperty("--kl-mar-left-tablet");
                cloneEl.style.removeProperty("--kl-mar-right-tablet");

                cloneEl.style.removeProperty("--kl-mar-top-mobile");
                cloneEl.style.removeProperty("--kl-mar-bottom-mobile");
                cloneEl.style.removeProperty("--kl-mar-left-mobile");
                cloneEl.style.removeProperty("--kl-mar-right-mobile");

                cloneEl.removeAttribute("data-kl-mar");
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


    function adjustBlockLayer(block: HTMLElement, direction: "forward" | "backward") {
        const cs = doc.defaultView!.getComputedStyle(block);

        // make sure it participates in stacking
        if (cs.position === "static") {
            block.style.position = "relative";
        }

        const ds = block.dataset as any;

        let current = 0;

        if (ds.klZIndex) {
            const n = parseInt(ds.klZIndex, 10);
            if (Number.isFinite(n)) current = n;
        } else if (block.style.zIndex) {
            const n = parseInt(block.style.zIndex, 10);
            if (Number.isFinite(n)) current = n;
        } else {
            const cz = cs.zIndex;
            const n = parseInt(cz || "0", 10);
            if (Number.isFinite(n)) current = n;
        }

        let next = direction === "forward" ? current + 10 : current - 10;
        if (next < 0) next = 0;

        ds.klZIndex = String(next);
        block.style.zIndex = String(next);

        saveHistory();
        notify();
        showHint(
            direction === "forward" ? "Block brought forward." : "Block sent backward.",
            block,
        );
    }


    async function insertImageFromLibraryIntoBlock(
        block: HTMLElement,
        src: string,
        storagePath?: string,
    ) {
        if (!src) return;

        const img = doc.createElement("img");
        img.src = src;
        img.alt = "";

        // CORS-enable Firebase Storage images for COEP contexts.
        if (
            /^https?:\/\/firebasestorage\.googleapis\.com\//i.test(src) ||
            /^https?:\/\/storage\.googleapis\.com\//i.test(src)
        ) {
            img.crossOrigin = "anonymous";
            img.referrerPolicy = "no-referrer";
        }

        // Tag it with the storage path so delete-assets works
        if (storagePath) {
            img.setAttribute("data-kloner-path", storagePath);
        }

        img.style.display = "block";
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.removeAttribute("height");

        const box = cssBox(block);
        if (box.w > 4) {
            const w = Math.round(box.w);
            img.style.width = `${w}px`;
            img.setAttribute("width", String(w));
        }

        if (block.firstChild) block.insertBefore(img, block.firstChild);
        else block.appendChild(img);

        saveHistory();
        notify();
        showHint("Image inserted from your library.", block);
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

        // important: do NOT clear selection here, so the React toolbar
        // does not receive a "has: false" event and unmount.
        // select(null);

        updateUndoRedoState();
        notify();
    }


    function undo() {
        restoreHistory(idx - 1);
    }

    function redo() {
        restoreHistory(idx + 1);
    }

    let suppressNotify = 0;

    const notify = (() => {
        let t = 0 as unknown as number;
        let raf = 0 as unknown as number;
        return () => {
            if (suppressNotify > 0) return;

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

    type PadSide = "all" | "top" | "bottom" | "left" | "right";

    let activeDevice: Device = initialDevice;

    type MarginSide = "all" | "top" | "bottom" | "left" | "right";

    function getMarginVarName(device: Device, side: MarginSide = "all") {
        const suffix =
            device === "tablet"
                ? "tablet"
                : device === "mobile"
                    ? "mobile"
                    : "desktop";

        if (side === "all") {
            return `--kl-mar-${suffix}`;
        }
        return `--kl-mar-${side}-${suffix}`;
    }

    function getCurrentDeviceMargin(
        block: HTMLElement,
        device: Device,
        side: MarginSide,
    ): number {
        const varName = getMarginVarName(device, side);
        const raw = block.style.getPropertyValue(varName)?.trim();

        if (raw && raw.endsWith("px")) {
            const n = parseFloat(raw.slice(0, -2));
            if (!Number.isNaN(n)) return n;
        }

        const cs = doc.defaultView!.getComputedStyle(block);

        let fromComputed = 0;
        if (side === "top" || side === "all") {
            fromComputed = parseFloat(cs.marginTop || "0") || 0;
        } else if (side === "bottom") {
            fromComputed = parseFloat(cs.marginBottom || "0") || 0;
        } else if (side === "left") {
            fromComputed = parseFloat(cs.marginLeft || "0") || 0;
        } else if (side === "right") {
            fromComputed = parseFloat(cs.marginRight || "0") || 0;
        }

        return fromComputed;
    }

    function normalizeAllDeviceMargin(block: HTMLElement) {
        const cs = doc.defaultView!.getComputedStyle(block);

        const desktopTop = parseFloat(cs.marginTop || "0") || 0;
        const desktopBottom =
            parseFloat(cs.marginBottom || "0") || desktopTop;
        const desktopLeft =
            parseFloat(cs.marginLeft || "0") || desktopTop;
        const desktopRight =
            parseFloat(cs.marginRight || "0") || desktopTop;

        const scale = (n: number, f: number) => Math.round(n * f);

        const tabletTop = scale(desktopTop, 0.85);
        const tabletBottom = scale(desktopBottom, 0.85);
        const tabletLeft = scale(desktopLeft, 0.85);
        const tabletRight = scale(desktopRight, 0.85);

        const mobileTop = scale(desktopTop, 0.7);
        const mobileBottom = scale(desktopBottom, 0.7);
        const mobileLeft = scale(desktopLeft, 0.7);
        const mobileRight = scale(desktopRight, 0.7);

        block.setAttribute("data-kl-mar", "1");

        block.style.removeProperty("margin");
        block.style.removeProperty("margin-top");
        block.style.removeProperty("margin-bottom");
        block.style.removeProperty("margin-left");
        block.style.removeProperty("margin-right");

        // device-level fallbacks (kept for compatibility)
        block.style.setProperty("--kl-mar-desktop", `${desktopTop}px`);
        block.style.setProperty("--kl-mar-tablet", `${tabletTop}px`);
        block.style.setProperty("--kl-mar-mobile", `${mobileTop}px`);

        // desktop per-side
        block.style.setProperty("--kl-mar-top-desktop", `${desktopTop}px`);
        block.style.setProperty("--kl-mar-bottom-desktop", `${desktopBottom}px`);
        block.style.setProperty("--kl-mar-left-desktop", `${desktopLeft}px`);
        block.style.setProperty("--kl-mar-right-desktop", `${desktopRight}px`);

        // tablet per-side
        block.style.setProperty("--kl-mar-top-tablet", `${tabletTop}px`);
        block.style.setProperty("--kl-mar-bottom-tablet", `${tabletBottom}px`);
        block.style.setProperty("--kl-mar-left-tablet", `${tabletLeft}px`);
        block.style.setProperty("--kl-mar-right-tablet", `${tabletRight}px`);

        // mobile per-side
        block.style.setProperty("--kl-mar-top-mobile", `${mobileTop}px`);
        block.style.setProperty("--kl-mar-bottom-mobile", `${mobileBottom}px`);
        block.style.setProperty("--kl-mar-left-mobile", `${mobileLeft}px`);
        block.style.setProperty("--kl-mar-right-mobile", `${mobileRight}px`);
    }

    function adjustBlockMargin(
        block: HTMLElement,
        side: MarginSide,
        deltaPx: number,
    ) {
        if (!block.hasAttribute("data-kl-mar")) {
            normalizeAllDeviceMargin(block);
        }

        const current = getCurrentDeviceMargin(block, activeDevice, side);

        // allow negative to pull blocks together, but clamp
        const MIN_MAR = -240;
        const MAX_MAR = 480;

        let next = current + deltaPx;

        if (next < MIN_MAR) next = MIN_MAR;
        if (next > MAX_MAR) next = MAX_MAR;

        const rounded = Math.round(next);

        if (side === "all") {
            const topVar = getMarginVarName(activeDevice, "top");
            const bottomVar = getMarginVarName(activeDevice, "bottom");
            const leftVar = getMarginVarName(activeDevice, "left");
            const rightVar = getMarginVarName(activeDevice, "right");
            const allVar = getMarginVarName(activeDevice, "all");

            block.style.setProperty(topVar, `${rounded}px`);
            block.style.setProperty(bottomVar, `${rounded}px`);
            block.style.setProperty(leftVar, `${rounded}px`);
            block.style.setProperty(rightVar, `${rounded}px`);
            block.style.setProperty(allVar, `${rounded}px`);
        } else {
            const varName = getMarginVarName(activeDevice, side);
            block.style.setProperty(varName, `${rounded}px`);
        }

        block.setAttribute("data-kl-mar", "1");

        saveHistory();
        notify();

        const label =
            side === "all"
                ? "all sides"
                : side === "top"
                    ? "top"
                    : side === "bottom"
                        ? "bottom"
                        : side === "left"
                            ? "left"
                            : "right";

        showHint(
            `Margin (${activeDevice}, ${label}) set to ${rounded}px.`,
            block,
        );
    }

    function resetBlockMarginForDevice(
        block: HTMLElement,
        device: Device,
    ) {
        const base = 0;

        const allVar = getMarginVarName(device, "all");
        block.style.setProperty(allVar, `${base}px`);

        const sides: MarginSide[] = ["top", "bottom", "left", "right"];
        for (const side of sides) {
            const varName = getMarginVarName(device, side);
            block.style.setProperty(varName, `${base}px`);
        }

        block.setAttribute("data-kl-mar", "1");

        saveHistory();
        notify();

        showHint(
            `Margin (${device}, all sides) reset.`,
            block,
        );
    }


    function getPaddingVarName(device: Device, side: PadSide = "all") {
        const suffix =
            device === "tablet"
                ? "tablet"
                : device === "mobile"
                    ? "mobile"
                    : "desktop";

        if (side === "all") {
            return `--kl-pad-${suffix}`;
        }
        return `--kl-pad-${side}-${suffix}`;
    }

    function getWidthVarName(device: Device) {
        if (device === "tablet") return "--kl-width-tablet";
        if (device === "mobile") return "--kl-width-mobile";
        return "--kl-width-desktop";
    }


    function getAlignVarName(device: Device) {
        if (device === "tablet") return "--kl-align-tablet";
        if (device === "mobile") return "--kl-align-mobile";
        return "--kl-align-desktop";
    }

    function getFontSizeVarName(device: Device) {
        if (device === "tablet") return "--kl-font-size-tablet";
        if (device === "mobile") return "--kl-font-size-mobile";
        return "--kl-font-size-desktop";
    }

    function getRadiusVarName(device: Device) {
        if (device === "tablet") return "--kl-radius-tablet";
        if (device === "mobile") return "--kl-radius-mobile";
        return "--kl-radius-desktop";
    }

    function getCurrentDeviceRadius(block: HTMLElement, device: Device): number {
        const varName = getRadiusVarName(device);
        const rawVar = block.style.getPropertyValue(varName)?.trim();

        if (rawVar && rawVar.endsWith("px")) {
            const n = parseFloat(rawVar.slice(0, -2));
            if (!Number.isNaN(n)) return n;
        }

        const cs = doc.defaultView!.getComputedStyle(block);
        const br = (cs as any).borderRadius as string | undefined;

        if (br && br !== "0px") {
            // border-radius can be "12px" or "10px 12px"; take the first numeric token
            const match = br.match(/([0-9.]+)px/);
            if (match) {
                const n = parseFloat(match[1]);
                if (!Number.isNaN(n)) return n;
            }
        }

        return 0;
    }

    function adjustBlockRadius(block: HTMLElement, deltaPx: number) {
        if (!deltaPx) return;

        const current = getCurrentDeviceRadius(block, activeDevice);

        const MIN_RAD = 0;
        const MAX_RAD = 96;

        let next = current + deltaPx;
        if (next < MIN_RAD) next = MIN_RAD;
        if (next > MAX_RAD) next = MAX_RAD;

        const rounded = Math.round(next);
        const varName = getRadiusVarName(activeDevice);

        // mark this element as radius-managed by the editor
        block.setAttribute("data-kl-radius", "1");
        block.style.setProperty(varName, `${rounded}px`);

        saveHistory();
        notify();

        showHint(
            `Border radius (${activeDevice}) set to ${rounded}px.`,
            block,
        );
    }

    function resetBlockRadiusForDevice(block: HTMLElement, device: Device) {
        const varName = getRadiusVarName(device);

        block.setAttribute("data-kl-radius", "1");
        block.style.setProperty(varName, "0px");

        saveHistory();
        notify();

        showHint(
            `Border radius (${device}) reset.`,
            block,
        );
    }


    // per-device image width helpers
    function getImageWidthKey(device: Device) {
        if (device === "tablet") return "klImgTabletWidth";
        if (device === "mobile") return "klImgMobileWidth";
        return "klImgDesktopWidth";
    }

    function ensureImageWidthBaselines(img: HTMLImageElement) {
        const ds = img.dataset as any;

        const rendered =
            Math.round(img.getBoundingClientRect().width) ||
            img.naturalWidth ||
            parseInt(img.getAttribute("width") || "0", 10) ||
            0;

        if (!rendered) return;

        const hasAny =
            !!ds.klImgDesktopWidth ||
            !!ds.klImgTabletWidth ||
            !!ds.klImgMobileWidth;

        // If we already have baselines but they are wildly larger than the
        // actual rendered width (old behaviour), reset them to rendered-based
        if (hasAny) {
            const existing =
                parseFloat(ds.klImgDesktopWidth || ds.klImgTabletWidth || ds.klImgMobileWidth || "0") ||
                0;

            if (existing && existing > rendered * 1.25) {
                // fall through and recompute
            } else {
                return;
            }
        }

        const desktop = rendered;
        const tablet = Math.round(rendered * 0.85);
        const mobile = Math.round(rendered * 0.7);

        ds.klImgDesktopWidth = String(desktop);
        ds.klImgTabletWidth = String(tablet);
        ds.klImgMobileWidth = String(mobile);
    }

    function getImageWidthForDevice(img: HTMLImageElement, device: Device): number {
        ensureImageWidthBaselines(img);
        const key = getImageWidthKey(device);
        const raw = (img.dataset as any)[key] as string | undefined;
        if (!raw) return 0;
        const n = parseFloat(raw);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function setImageWidthForDevice(
        img: HTMLImageElement,
        device: Device,
        width: number,
    ) {
        const key = getImageWidthKey(device);
        (img.dataset as any)[key] = String(Math.round(width));
    }

    function applyImageWidthForDevice(img: HTMLImageElement, device: Device) {
        const w = getImageWidthForDevice(img, device);
        if (!w) return;

        const rounded = Math.round(w);

        img.style.width = `${rounded}px`;
        img.setAttribute("width", String(rounded));
        // allow growing beyond parent; device-specific widths control behaviour
        img.style.maxWidth = "none";
        img.style.height = "auto";
        img.removeAttribute("height");
    }

    function applyImageWidthsForAll(device: Device) {
        doc.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
            applyImageWidthForDevice(img, device);
        });
    }

    function getCurrentDevicePadding(
        block: HTMLElement,
        device: Device,
        side: PadSide,
    ): number {
        const varName = getPaddingVarName(device, side);
        const raw = block.style.getPropertyValue(varName)?.trim();

        if (raw && raw.endsWith("px")) {
            const n = parseFloat(raw.slice(0, -2));
            if (!Number.isNaN(n)) return n;
        }

        const cs = doc.defaultView!.getComputedStyle(block);

        let fromComputed = 0;
        if (side === "top" || side === "all") {
            fromComputed = parseFloat(cs.paddingTop || "0") || 0;
        } else if (side === "bottom") {
            fromComputed = parseFloat(cs.paddingBottom || "0") || 0;
        } else if (side === "left") {
            fromComputed = parseFloat(cs.paddingLeft || "0") || 0;
        } else if (side === "right") {
            fromComputed = parseFloat(cs.paddingRight || "0") || 0;
        }

        if (fromComputed > 0) return fromComputed;

        return 24;
    }

    function getCurrentDeviceWidth(block: HTMLElement, device: Device): number {
        const varName = getWidthVarName(device);
        const raw = block.style.getPropertyValue(varName)?.trim();

        if (raw && raw.endsWith("px")) {
            const n = parseFloat(raw.slice(0, -2));
            if (!Number.isNaN(n)) return n;
        }

        const cs = doc.defaultView!.getComputedStyle(block);
        const fromComputed = parseFloat(cs.width || "0") || 0;

        return fromComputed > 0 ? fromComputed : 300; // default width
    }


    function normalizeAllDevicePadding(block: HTMLElement) {
        const cs = doc.defaultView!.getComputedStyle(block);

        const desktopTop = parseFloat(cs.paddingTop || "0") || 24;
        const desktopBottom =
            parseFloat(cs.paddingBottom || "0") || desktopTop;
        const desktopLeft =
            parseFloat(cs.paddingLeft || "0") || desktopTop;
        const desktopRight =
            parseFloat(cs.paddingRight || "0") || desktopTop;

        const scale = (n: number, f: number) => Math.round(n * f);

        const tabletTop = scale(desktopTop, 0.85);
        const tabletBottom = scale(desktopBottom, 0.85);
        const tabletLeft = scale(desktopLeft, 0.85);
        const tabletRight = scale(desktopRight, 0.85);

        const mobileTop = scale(desktopTop, 0.7);
        const mobileBottom = scale(desktopBottom, 0.7);
        const mobileLeft = scale(desktopLeft, 0.7);
        const mobileRight = scale(desktopRight, 0.7);

        block.setAttribute("data-kl-pad", "1");

        block.style.removeProperty("padding");
        block.style.removeProperty("padding-top");
        block.style.removeProperty("padding-bottom");
        block.style.removeProperty("padding-left");
        block.style.removeProperty("padding-right");

        // device-level fallbacks (kept for compatibility, using top as base)
        block.style.setProperty("--kl-pad-desktop", `${desktopTop}px`);
        block.style.setProperty("--kl-pad-tablet", `${tabletTop}px`);
        block.style.setProperty("--kl-pad-mobile", `${mobileTop}px`);

        // desktop per-side
        block.style.setProperty("--kl-pad-top-desktop", `${desktopTop}px`);
        block.style.setProperty("--kl-pad-bottom-desktop", `${desktopBottom}px`);
        block.style.setProperty("--kl-pad-left-desktop", `${desktopLeft}px`);
        block.style.setProperty("--kl-pad-right-desktop", `${desktopRight}px`);

        // tablet per-side
        block.style.setProperty("--kl-pad-top-tablet", `${tabletTop}px`);
        block.style.setProperty("--kl-pad-bottom-tablet", `${tabletBottom}px`);
        block.style.setProperty("--kl-pad-left-tablet", `${tabletLeft}px`);
        block.style.setProperty("--kl-pad-right-tablet", `${tabletRight}px`);

        // mobile per-side
        block.style.setProperty("--kl-pad-top-mobile", `${mobileTop}px`);
        block.style.setProperty("--kl-pad-bottom-mobile", `${mobileBottom}px`);
        block.style.setProperty("--kl-pad-left-mobile", `${mobileLeft}px`);
        block.style.setProperty("--kl-pad-right-mobile", `${mobileRight}px`);
    }

    function normalizeAllDeviceWidth(block: HTMLElement) {
        const cs = doc.defaultView!.getComputedStyle(block);
        const desktopWidth = parseFloat(cs.width || "0") || 300;

        const scale = (n: number, f: number) => Math.round(n * f);

        const tabletWidth = scale(desktopWidth, 0.9);
        const mobileWidth = scale(desktopWidth, 0.8);

        block.setAttribute("data-kl-width", "1");

        block.style.removeProperty("width");

        block.style.setProperty("--kl-width-desktop", `${desktopWidth}px`);
        block.style.setProperty("--kl-width-tablet", `${tabletWidth}px`);
        block.style.setProperty("--kl-width-mobile", `${mobileWidth}px`);
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
            const px = cmd.value;
            const varName = getFontSizeVarName(activeDevice);

            // mark this element as using per-device font sizing
            selected.setAttribute("data-kl-font", "1");

            // wipe any inner inline font-size so the device var is authoritative
            selected.querySelectorAll<HTMLElement>("*").forEach((child) => {
                child.style.removeProperty("font-size");
            });

            // also wipe inline font-size on the selected root
            selected.style.removeProperty("font-size");

            // set the device-specific var
            selected.style.setProperty(varName, `${px}px`);

            didChange = true;

        } else if (cmd.kind === "align") {
            const v = cmd.value;
            if (v === "left" || v === "center" || v === "right") {
                const block = selected;
                const varName = getAlignVarName(activeDevice);

                // mark this element as alignment-managed by the editor
                block.setAttribute("data-kl-align", "1");

                // per-device alignment via CSS var (text-align + block-align handled in CSS)
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
                        if (h.style.width) h.style.removeProperty("width");
                        h.style.display = h.style.display || "block";
                        h.style.marginLeft = "auto";
                        h.style.marginRight = "auto";
                    });
                } else if (v === "left") {
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

    // inside installKlonerIframeApi, after `const api: any = ...`

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

    api.bringBlockForward = () => {
        if (!selected) return;
        adjustBlockLayer(selected, "forward");
    };

    api.sendBlockBackward = () => {
        if (!selected) return;
        adjustBlockLayer(selected, "backward");
    };

    // aliases if you prefer block*-style names
    api.blockBringForward = api.bringBlockForward;
    api.blockSendBackward = api.sendBlockBackward;


    // aliases for React toolbar
    api.blockDelete = api.deleteBlock;

    // core
    api.clear = () => {
        select(null);
        (doc.activeElement as HTMLElement | null)?.blur?.();
    };
    api.style = (cmd: any) => applyStyleCommand(cmd);
    api.select = (el: HTMLElement | null) => {
        select(el);
    };

    // image ops (library)
    api.insertImageFromLibrary = (src: string, storagePath?: string) => {
        if (!selected) {
            const body = doc.body as HTMLElement;
            showHint("Select a block, then choose an image from your library.", body);
            return;
        }
        insertImageFromLibraryIntoBlock(selected, src, storagePath);
    };

    // device (for per-device padding and image widths)
    api.setDevice = (next: Device) => {
        if (!next || next === activeDevice) return;
        activeDevice = next;
        doc.documentElement.setAttribute("data-kl-device", next);
        applyImageWidthsForAll(activeDevice);
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


    // padding
    api.blockPad = (side: PadSide = "all", deltaPx: number = 8) => {
        if (!selected) return;

        const s: PadSide =
            side === "top" ||
                side === "bottom" ||
                side === "left" ||
                side === "right"
                ? side
                : "all";

        const d = typeof deltaPx === "number" ? deltaPx : 0;
        if (!d) return;

        adjustBlockPadding(selected, s, d);
    };

    api.padMore = () => {
        if (!selected) return;
        adjustBlockPadding(selected, "all", 8);
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
        adjustBlockPadding(selected, "all", -8);
    };

    api.blockPadReset = () => {
        if (!selected) return;
        resetBlockPaddingForDevice(selected, activeDevice);
    };

    api.blockWidthReset = () => {
        if (!selected) return;
        resetBlockWidthForDevice(selected, activeDevice);
    };

    // margin (per-device)
    api.blockMargin = (side: MarginSide = "all", deltaPx: number = 8) => {
        if (!selected) return;

        const s: MarginSide =
            side === "top" ||
                side === "bottom" ||
                side === "left" ||
                side === "right"
                ? side
                : "all";

        const d = typeof deltaPx === "number" ? deltaPx : 0;
        if (!d) return;

        adjustBlockMargin(selected, s, d);
    };

    api.marginMore = () => {
        if (!selected) return;
        adjustBlockMargin(selected, "all", 8);
    };

    api.marginLess = () => {
        if (!selected) return;
        adjustBlockMargin(selected, "all", -8);
    };

    api.blockMarginReset = () => {
        if (!selected) return;
        resetBlockMarginForDevice(selected, activeDevice);
    };


    // border radius (per-device)
    api.blockRadius = (deltaPx: number = 4) => {
        if (!selected) return;
        adjustBlockRadius(selected, deltaPx);
    };

    api.blockRadiusReset = () => {
        if (!selected) return;
        resetBlockRadiusForDevice(selected, activeDevice);
    };

    // image ops (local file / bg / sizing)
    api.insertImage = () => {
        if (!selected) return;
        insertImageIntoBlock(selected).catch(() => { });
    };

    api.setBackgroundImage = () => {
        if (!selected) return;
        setBlockBackgroundImage(selected).catch(() => { });
    };

    // background from library (no file picker; uses stored URL + path)
    api.setBackgroundImageFromLibrary = (src: string, storagePath?: string) => {
        if (!selected) {
            const body = doc.body as HTMLElement;
            showHint("Select a block, then choose a background image.", body);
            return;
        }
        setBlockBackgroundImageFromLibrary(selected, src, storagePath);
    };

    api.replaceImage = () => {
        if (!selected) return;
        const img = getImageFromSelection(selected);
        if (!img) return;
        replaceImage(img);
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

    // expose to React toolbar
    api.blockGetFontFamily = () => {
        return { fontFamily: getSelectedFontFamily() };
    };

    api.fontFamilyPreview = (payload?: { fontFamily?: string } | string) => {
        const family =
            typeof payload === "string" ? payload : (payload?.fontFamily || "");
        previewFontFamily(family);
    };

    api.fontFamilySet = (payload?: { fontFamily?: string } | string) => {
        const family =
            typeof payload === "string" ? payload : (payload?.fontFamily || "");
        setFontFamily(family);
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
    api.imgInsertFromLibrary = api.insertImageFromLibrary;

    // background-from-library aliases for panels
    api.blockSetBackgroundFromLibrary = api.setBackgroundImageFromLibrary;
    api.blockSetBackgroundImageFromLibrary = api.setBackgroundImageFromLibrary;
    api.blockSetBackgroundImage = api.setBackgroundImageFromLibrary;
    api.blockSetBackground = api.setBackgroundImageFromLibrary;

    api.textboxAdd = api.addTextBox;
    api.linkEdit = api.editLink;

    api.getSelectionMeta = () => {
        return selected
            ? { has: true, tagName: selected.tagName }
            : { has: false };
    };

    // new nav helpers for toolbar
    api.blockGetHref = () => {
        return getHrefForSelection();
    };

    api.blockSetHref = (href: string) => {
        return setHrefForSelection(href);
    };


    api.historyUndo = api.undo;
    api.historyRedo = api.redo;

    (doc.defaultView as any).__klonerApi = api;

    doc.addEventListener(
        "click",
        (e) => {
            const t = e.target as HTMLElement;
            const block = t.closest(
                "section, article, header, footer, main, button, a, div, li, p, span, h1, h2, h3, h4, h5, h6"
            ) as HTMLElement | null;

            if (block) select(block);
            else select(null);
        },
        true
    );

    // ---- Font family (preview + apply) ----

    function getSelectedFontFamily(): string {
        if (!selected) return "";
        try {
            return doc.defaultView!.getComputedStyle(selected).fontFamily || "";
        } catch {
            return selected.style.fontFamily || "";
        }
    }

    function previewFontFamily(nextFamily: string) {
        if (!selected) return;
        const family = (nextFamily || "").trim();
        if (!family) return;

        suppressNotify++;
        try {
            selected.style.fontFamily = family;
            publishSelection();
        } finally {
            suppressNotify--;
        }
    }


    function setFontFamily(nextFamily: string) {
        if (!selected) return;
        const family = (nextFamily || "").trim();
        if (!family) return;

        selected.style.fontFamily = family;

        saveHistory();
        notify();
        publishSelection();
    }


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

    function findLinkFor(target: HTMLElement | null): HTMLAnchorElement | null {
        if (!target) return null;
        if (target.tagName === "A") return target as HTMLAnchorElement;
        return target.closest("a") as HTMLAnchorElement | null;
    }

    function getHrefForSelection() {
        const linkEl = findLinkFor(selected);
        if (!linkEl) {
            return { hasLink: false, href: "" };
        }
        return {
            hasLink: true,
            href: linkEl.getAttribute("href") || "",
        };
    }

    function setHrefForSelection(nextHrefRaw: string) {
        const linkEl = findLinkFor(selected);
        if (!linkEl) {
            if (selected) {
                showHint("No link found on this block.", selected);
            }
            return;
        }

        const nextHref = (nextHrefRaw || "").trim();

        // Basic safety: disallow javascript: URLs
        if (/^\s*javascript:/i.test(nextHref)) {
            showHint("This type of link is not allowed here.", linkEl);
            return;
        }

        if (!nextHref) {
            linkEl.removeAttribute("href");
            saveHistory();
            notify();
            showHint("Link cleared.", linkEl);
            return;
        }

        linkEl.setAttribute("href", nextHref);
        saveHistory();
        notify();
        showHint("Link updated.", linkEl);
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

    function applyBlockBackgroundTheme(block: HTMLElement, url: string) {
        const cs = doc.defaultView!.getComputedStyle(block);
        if (cs.position === "static") {
            block.style.position = "relative";
        }

        block.style.backgroundImage = `url("${url}")`;
        block.style.backgroundSize = "cover";
        block.style.backgroundPosition = "center center";
        block.style.backgroundRepeat = "no-repeat";

        // slight theme harmonisation: keep existing background-color as overlay
        // but ensure text stays readable if it was transparent
        if (!block.style.backgroundColor || block.style.backgroundColor === "transparent") {
            block.style.backgroundColor = "rgba(15,23,42,0.82)";
        }
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

        applyBlockBackgroundTheme(block, tempUrl);

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

    function setBlockBackgroundImageFromLibrary(
        block: HTMLElement,
        src: string,
        storagePath?: string,
    ) {
        if (!src) return;

        const oldPath = block.getAttribute("data-kloner-bg-path") || undefined;
        if (oldPath && oldPath !== storagePath) {
            block.setAttribute("data-kloner-bg-old-path", oldPath);
        }

        if (storagePath) {
            block.setAttribute("data-kloner-bg-path", storagePath);
        }

        if ((block.dataset as any).localImageId) {
            delete (block.dataset as any).localImageId;
        }
        if ((block.dataset as any).localFilename) {
            delete (block.dataset as any).localFilename;
        }

        applyBlockBackgroundTheme(block, src);

        saveHistory();
        notify();
        showHint("Background image applied from your library.", block);
    }


    function adjustBlockPadding(
        block: HTMLElement,
        side: PadSide,
        deltaPx: number,
    ) {
        // Only normalize once per block; otherwise each edit on tablet/mobile
        // overwrites all device paddings from that device's computed style.
        if (!block.hasAttribute("data-kl-pad")) {
            normalizeAllDevicePadding(block);
        }

        const current = getCurrentDevicePadding(block, activeDevice, side);

        const MIN_PAD = 0;
        const MAX_PAD = 480; // or whatever upper bound you want

        let next = current + deltaPx;

        if (next < MIN_PAD) next = MIN_PAD;
        if (next > MAX_PAD) next = MAX_PAD;

        const rounded = Math.round(next);

        if (side === "all") {
            const topVar = getPaddingVarName(activeDevice, "top");
            const bottomVar = getPaddingVarName(activeDevice, "bottom");
            const leftVar = getPaddingVarName(activeDevice, "left");
            const rightVar = getPaddingVarName(activeDevice, "right");
            const allVar = getPaddingVarName(activeDevice, "all");

            block.style.setProperty(topVar, `${rounded}px`);
            block.style.setProperty(bottomVar, `${rounded}px`);
            block.style.setProperty(leftVar, `${rounded}px`);
            block.style.setProperty(rightVar, `${rounded}px`);
            block.style.setProperty(allVar, `${rounded}px`);
        } else {
            const varName = getPaddingVarName(activeDevice, side);
            block.style.setProperty(varName, `${rounded}px`);
        }

        block.setAttribute("data-kl-pad", "1");

        saveHistory();
        notify();

        const label =
            side === "all"
                ? "all sides"
                : side === "top"
                    ? "top"
                    : side === "bottom"
                        ? "bottom"
                        : side === "left"
                            ? "left"
                            : "right";

        showHint(
            `Padding (${activeDevice}, ${label}) set to ${rounded}px.`,
            block,
        );
    }

    function resetBlockPaddingForDevice(
        block: HTMLElement,
        device: Device,
    ) {
        // Keep other devices untouched. Only overwrite this device's vars.
        const base = 24; // neutral reset value

        const allVar = getPaddingVarName(device, "all");
        block.style.setProperty(allVar, `${base}px`);

        const sides: PadSide[] = ["top", "bottom", "left", "right"];
        for (const side of sides) {
            const varName = getPaddingVarName(device, side);
            block.style.setProperty(varName, `${base}px`);
        }

        block.setAttribute("data-kl-pad", "1");

        saveHistory();
        notify();

        showHint(
            `Padding (${device}, all sides) reset.`,
            block,
        );
    }

    function resetBlockWidthForDevice(block: HTMLElement, device: Device) {
        const base = 300; // neutral reset value

        const varName = getWidthVarName(device);
        block.style.setProperty(varName, `${base}px`);

        block.setAttribute("data-kl-width", "1");

        saveHistory();
        notify();

        showHint(
            `Width (${device}) reset.`,
            block,
        );
    }


    function growBlock(block: HTMLElement, factor: number = 1.1) {
        // Only normalize once per block; otherwise each edit on tablet/mobile
        // overwrites all device widths from that device's computed style.
        if (!block.hasAttribute("data-kl-width")) {
            normalizeAllDeviceWidth(block);
        }

        const currentWidth = getCurrentDeviceWidth(block, activeDevice);

        const parent = block.parentElement;
        const parentRect = parent?.getBoundingClientRect();

        let nextWidth = currentWidth * factor;

        if (parentRect) {
            const maxWidth = parentRect.width;
            if (nextWidth > maxWidth) nextWidth = maxWidth;
        }

        const minWidth = 120;
        if (nextWidth < minWidth) nextWidth = minWidth;

        const rounded = Math.round(nextWidth);

        const varName = getWidthVarName(activeDevice);
        block.style.setProperty(varName, `${rounded}px`);

        block.setAttribute("data-kl-width", "1");

        saveHistory();
        notify();
        showHint(`Block width (${activeDevice}) set to ${rounded}px.`, block);
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
        the:
        {
            const next = prompt("Link URL (href):", current);
            if (next === null) break the;
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

    // per-device, small-increment image resize
    function resizeImage(target: HTMLElement, factor: number) {
        const img =
            (target.tagName === "IMG"
                ? (target as HTMLImageElement)
                : (target.querySelector("img") as HTMLImageElement | null)) ?? null;

        if (!img) {
            showHint("Select a block with an <img> to resize.", target);
            return;
        }

        ensureImageWidthBaselines(img);

        const baseline =
            Number(img.dataset.klImgDesktopWidth) ||
            img.naturalWidth ||
            parseInt(img.getAttribute("width") || "0", 10) ||
            Math.round(img.getBoundingClientRect().width) ||
            0;

        if (!baseline) {
            showHint("Can't determine image size.", img);
            return;
        }

        const currentW =
            getImageWidthForDevice(img, activeDevice) ||
            Math.round(img.getBoundingClientRect().width) ||
            baseline;

        if (!currentW) {
            showHint("Can't determine image size.", img);
            return;
        }

        const direction = factor >= 1 ? 1 : -1;

        // constant, small step so first click doesn't jump
        let step = 12;
        if (baseline < 320) step = 8;
        if (baseline > 1200) step = 16;

        let nextW = currentW + direction * step;

        const minW = Math.max(80, Math.round(baseline * 0.25));
        const maxW = Math.round(baseline * 2.5);

        if (nextW < minW) nextW = minW;
        if (nextW > maxW) nextW = maxW;

        setImageWidthForDevice(img, activeDevice, nextW);
        applyImageWidthForDevice(img, activeDevice);

        const parent = img.parentElement as HTMLElement | null;
        if (parent && (!parent.style.overflow || parent.style.overflow === "hidden")) {
            parent.style.overflow = "visible";
        }

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
                (doc.defaultView as any).__klonerApi?.deleteBlock();
            }
        }
    });


    updateUndoRedoState();
    publishSelection();
}

// legacy alias if any call sites still use the old name
export const injectEditableOverlay = installKlonerIframeApi;
