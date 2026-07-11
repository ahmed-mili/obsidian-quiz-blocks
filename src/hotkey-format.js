'use strict';

/* ══════════════════════════════════════════════════════════
   HOTKEYS DU COMPOSER — format & capture partagés
   Réglages { modifiers: ["Mod"|"Ctrl"|"Alt"|"Shift"|"Meta"…],
   key: e.key minuscule } consommés par le Scope de la vue
   dashboard, affichés dans le menu « + » et édités dans les
   réglages du plugin. « Mod » suit la convention Obsidian :
   Ctrl sur Windows/Linux, ⌘ sur macOS.
══════════════════════════════════════════════════════════ */

const obsidian = require("obsidian");

const MAC_GLYPHS = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
const WIN_LABELS = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };

/* { modifiers, key } → « Ctrl+F » (Windows/Linux) ou « ⌘F » (macOS). */
function formatHotkey(hk) {
	if (!hk || !hk.key) return "";
	const mac = obsidian.Platform.isMacOS;
	const mods = (hk.modifiers || []).map(m => (mac ? MAC_GLYPHS[m] : WIN_LABELS[m]) || m);
	const key = hk.key.length === 1 ? hk.key.toUpperCase()
		: hk.key.charAt(0).toUpperCase() + hk.key.slice(1);
	return mac ? mods.join("") + key : [...mods, key].join("+");
}

/* KeyboardEvent → { modifiers, key }, ou null si la touche pressée est
   un modificateur seul (capture en attente de la touche finale). */
function eventToHotkey(e) {
	if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(e.key)) return null;
	const mac = obsidian.Platform.isMacOS;
	const modifiers = [];
	// « Mod » = la touche de commande usuelle de la plateforme ; l'autre
	// touche contrôle garde son nom propre (portabilité du réglage).
	if (e.ctrlKey) modifiers.push(mac ? "Ctrl" : "Mod");
	if (e.metaKey) modifiers.push(mac ? "Mod" : "Meta");
	if (e.altKey) modifiers.push("Alt");
	if (e.shiftKey) modifiers.push("Shift");
	return { modifiers, key: e.key.toLowerCase() };
}

module.exports = { formatHotkey, eventToHotkey };
