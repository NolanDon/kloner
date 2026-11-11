export type EditorPalette = {
    id: string;
    name: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    primary: string;
    primaryText: string;
    accent: string;
    border: string;
};

export const EDITOR_COLOR_PRESETS: EditorPalette[] = [
    {
        id: "paper",
        name: "Paper & cobalt",
        background: "#E8EAF1",
        surface: "#F4F5F8",
        text: "#191C27",
        muted: "#4E5667",
        primary: "#244FD1",
        primaryText: "#FFFFFF",
        accent: "#6333C7",
        border: "#C7CAD5",
    },
    {
        id: "midnight",
        name: "Midnight",
        background: "#0B1220",
        surface: "#18253A",
        text: "#F2F6FC",
        muted: "#B4C6DD",
        primary: "#39BDEB",
        primaryText: "#062A3E",
        accent: "#B49AFF",
        border: "#344963",
    },
    {
        id: "charcoal",
        name: "Charcoal & ember",
        background: "#171513",
        surface: "#2B2521",
        text: "#F3E9DE",
        muted: "#C7B7A8",
        primary: "#EA774D",
        primaryText: "#351A10",
        accent: "#F0C46F",
        border: "#51433B",
    },
    {
        id: "forest",
        name: "Forest & marigold",
        background: "#10231B",
        surface: "#1E392D",
        text: "#F0F5E9",
        muted: "#BACDBA",
        primary: "#70B67D",
        primaryText: "#11291A",
        accent: "#F1C66F",
        border: "#385645",
    },
    {
        id: "ocean",
        name: "Ocean & coral",
        background: "#D6EAF0",
        surface: "#E9F4F5",
        text: "#103542",
        muted: "#45636D",
        primary: "#08758A",
        primaryText: "#FFFFFF",
        accent: "#A93730",
        border: "#B8D3DA",
    },
    {
        id: "plum",
        name: "Plum & apricot",
        background: "#231629",
        surface: "#38233F",
        text: "#F8F0F8",
        muted: "#D1BFD3",
        primary: "#C684DF",
        primaryText: "#2E1738",
        accent: "#FFAA83",
        border: "#5C4262",
    },
    {
        id: "terracotta",
        name: "Terracotta & teal",
        background: "#E9D6C5",
        surface: "#F4E7DB",
        text: "#39261E",
        muted: "#655046",
        primary: "#AC472D",
        primaryText: "#FFFFFF",
        accent: "#17685F",
        border: "#CCB29E",
    },
    {
        id: "rose",
        name: "Rosewood & brass",
        background: "#2B151F",
        surface: "#422331",
        text: "#FFF0F3",
        muted: "#D6B5C1",
        primary: "#E87593",
        primaryText: "#3B1524",
        accent: "#F5C168",
        border: "#67404F",
    },
    {
        id: "mono",
        name: "Graphite",
        background: "#1B1D20",
        surface: "#2B2E32",
        text: "#F2F3F2",
        muted: "#C5C8C9",
        primary: "#E5E6E3",
        primaryText: "#202124",
        accent: "#AEB7C2",
        border: "#4A4C51",
    },
    {
        id: "electric",
        name: "Citrus & plum",
        background: "#E8E6B7",
        surface: "#F3F0CE",
        text: "#292719",
        muted: "#57543A",
        primary: "#586B1F",
        primaryText: "#FFFFFF",
        accent: "#713A78",
        border: "#C6C391",
    },
];

export type PalettePreviewChange = { selector: string; property: string; value: string };

export const paletteTokens = (palette: EditorPalette) => ({
    background: palette.background,
    surface: palette.surface,
    text: palette.text,
    muted: palette.muted,
    primary: palette.primary,
    primaryText: palette.primaryText,
    accent: palette.accent,
    border: palette.border,
});
