/**
 * Wait until a srcdoc preview has applied its external stylesheets and fonts.
 * The iframe load event is not always enough to prevent an unstyled first paint.
 */
export async function waitForPreviewResources(doc: Document, timeoutMs = 2500): Promise<void> {
    const view = doc.defaultView;
    const stylesheetLinks = Array.from(
        doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
    );

    await Promise.all(
        stylesheetLinks.map(
            (link) =>
                link.sheet
                    ? Promise.resolve()
                    : new Promise<void>((resolve) => {
                          let settled = false;
                          const finish = () => {
                              if (settled) return;
                              settled = true;
                              resolve();
                          };
                          link.addEventListener("load", finish, { once: true });
                          link.addEventListener("error", finish, { once: true });
                          view?.setTimeout(finish, timeoutMs);
                      }),
        ),
    );

    await doc.fonts?.ready;
    await new Promise<void>((resolve) => {
        if (view) view.requestAnimationFrame(() => resolve());
        else resolve();
    });
}
