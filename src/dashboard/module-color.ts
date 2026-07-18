/* ══════════════════════════════════════════════════════════
   MODULE COLOR — source unique de l'identité colorée d'un module
   (design handoff « folder cards 6a », Ahmed 2026-07-18). Chaque
   dossier a un accent : la couleur CHOISIE dans « Modifier dossier »
   (override) si elle existe, sinon une couleur DÉRIVÉE STABLE du nom
   (hash → palette) — « choisies par l'utilisateur ou dérivées » du
   handoff : chaque matière garde une identité même sans choix. Tout
   le reste (tile-bg, icon-bg, bordures, lueur) se dérive en CSS de
   --accent via color-mix ; ce module ne fournit QUE l'accent.
══════════════════════════════════════════════════════════ */

/** Palette partagée : les 8 pastilles du color picker (« Modifier dossier »).
    Couleur choisie ET couleur dérivée puisent dans le même jeu → un ensemble
    cohérent, qu'elle soit imposée ou automatique. */
export const MODULE_PALETTE = [
	"#4573ff", "#14b8a6", "#10b981", "#84cc16",
	"#f59e0b", "#ef4466", "#d946ef", "#8b5cf6",
];

/** Hash déterministe d'une chaîne → index de palette (djb2-like). Stable :
    le même dossier retombe toujours sur la même couleur d'un rendu à l'autre. */
export function hashAccent(key: string): string {
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
	return MODULE_PALETTE[h % MODULE_PALETTE.length];
}

/** Accent effectif d'un module : la couleur choisie (override) prime, sinon
    la couleur dérivée du dossier. */
export function moduleAccent(m: { folder: string; color?: string }): string {
	return m.color || hashAccent(m.folder);
}
