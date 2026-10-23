// Downloads and explicit escape links do not leave the editor through its guard.
export function shouldBypassEditorNavigationGuard(anchor: HTMLAnchorElement): boolean {
    return anchor.hasAttribute("download")
        || anchor.dataset.klonerNavigationBypass === "true"
        || Boolean(anchor.target && anchor.target !== "_self");
}
