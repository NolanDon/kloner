export function getResponsiveUiScale(viewportWidth: number): number {
    const width = Number(viewportWidth);
    if (!Number.isFinite(width) || width <= 0) return 0.6;

    const minWidth = 1280;
    const maxWidth = 1920;
    const minScale = 0.6;
    const maxScale = 0.8;

    if (width <= minWidth) return minScale;
    if (width >= maxWidth) return maxScale;

    const t = (width - minWidth) / (maxWidth - minWidth);
    return Math.round((minScale + t * (maxScale - minScale)) * 100) / 100;
}
