export type EditorPalette = { id: string; name: string; background: string; surface: string; text: string; muted: string; primary: string; primaryText: string; accent: string; border: string };
export const EDITOR_COLOR_PRESETS: EditorPalette[] = [
 {id:'paper',name:'Paper & cobalt',background:'#FAFAFA',surface:'#FFFFFF',text:'#171717',muted:'#525252',primary:'#1D4ED8',primaryText:'#FFFFFF',accent:'#7C3AED',border:'#E5E7EB'},
 {id:'midnight',name:'Midnight',background:'#0B1220',surface:'#151F32',text:'#F1F5F9',muted:'#A8B6CC',primary:'#38BDF8',primaryText:'#082F49',accent:'#A78BFA',border:'#334155'},
 {id:'charcoal',name:'Charcoal & linen',background:'#141210',surface:'#24211D',text:'#E8DDC8',muted:'#BFB39F',primary:'#E7BA73',primaryText:'#241A0C',accent:'#E98A36',border:'#514B41'},
 {id:'forest',name:'Forest',background:'#F3F7F2',surface:'#FFFFFF',text:'#19352B',muted:'#4B665B',primary:'#25734A',primaryText:'#FFFFFF',accent:'#946018',border:'#D4E2D8'},
 {id:'ocean',name:'Ocean',background:'#F0F7FC',surface:'#FFFFFF',text:'#142D4E',muted:'#4B6580',primary:'#075985',primaryText:'#FFFFFF',accent:'#0F766E',border:'#CBDDEB'},
 {id:'plum',name:'Plum',background:'#F8F4FA',surface:'#FFFFFF',text:'#30213D',muted:'#6C5878',primary:'#7E22CE',primaryText:'#FFFFFF',accent:'#A21CAF',border:'#E4D6EC'},
 {id:'terracotta',name:'Terracotta',background:'#FCF7F2',surface:'#FFFFFF',text:'#3B2923',muted:'#735C52',primary:'#A6422B',primaryText:'#FFFFFF',accent:'#8D6319',border:'#E9DCD1'},
 {id:'rose',name:'Rose',background:'#FFF5F7',surface:'#FFFFFF',text:'#451C2C',muted:'#80576A',primary:'#BE185D',primaryText:'#FFFFFF',accent:'#7E22CE',border:'#F0D5DF'},
 {id:'mono',name:'Monochrome',background:'#F7F7F7',surface:'#FFFFFF',text:'#171717',muted:'#5C5C5C',primary:'#262626',primaryText:'#FFFFFF',accent:'#525252',border:'#D9D9D9'},
 {id:'electric',name:'Electric',background:'#131126',surface:'#211C3A',text:'#F5F3FF',muted:'#B9B0D1',primary:'#C4B5FD',primaryText:'#2E1065',accent:'#67E8F9',border:'#463C61'},
];
export type PalettePreviewChange = { selector: string; property: string; value: string };
export const paletteTokens = (palette: EditorPalette) => ({ background: palette.background, surface: palette.surface, text: palette.text, muted: palette.muted, primary: palette.primary, primaryText: palette.primaryText, accent: palette.accent, border: palette.border });
