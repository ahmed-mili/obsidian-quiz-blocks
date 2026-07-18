/* ══════════════════════════════════════════════════════════
   ICON SUGGEST — icônes proposées d'après le NOM du module + son UE
   (demande Ahmed 2026-07-19). Table de mots-clés → icônes Lucide :
   on concatène nom + UE (minuscule, sans accents) et chaque règle
   dont un mot-clé apparaît verse ses icônes, dédupliquées, dans
   l'ordre des règles. Zéro correspondance = pas de suggestion (le
   picker affiche juste sa grille). Domaines orientés informatique
   (les modules d'Ahmed : réseau, cyber, système…) + académique large.
══════════════════════════════════════════════════════════ */

interface Rule {
	keys: string[];
	icons: string[];
}

const RULES: Rule[] = [
	{ keys: ["reseau", "network", "ccna", "cisco", "routage", "routeur", "commutation", "lan", "wan"], icons: ["router", "network", "wifi", "share-2"] },
	{ keys: ["cloud", "infrastructure", "virtualis", "conteneur", "docker", "kubernetes"], icons: ["cloud", "server", "boxes"] },
	{ keys: ["cyber", "securit", "protection", "chiffrement", "cryptographie", "pentest", "vulnerab"], icons: ["shield-check", "shield", "lock", "key-round"] },
	{ keys: ["systeme", "exploitation", "administration", "admin sys", "serveur", "server", "os", "unix", "linux", "windows"], icons: ["server-cog", "server", "monitor-cog", "hard-drive"] },
	{ keys: ["programmation", "developpement", "logiciel", "code", "algorithm", "poo", "objet", "compilation"], icons: ["code", "braces", "terminal", "file-code"] },
	{ keys: ["web", "internet", "html", "frontend", "javascript", "site"], icons: ["globe", "code-xml", "layout-panel-top"] },
	{ keys: ["base de donnee", "donnee", "data", "sql", "bdd", "nosql"], icons: ["database", "table-2"] },
	{ keys: ["math", "mathematique", "calcul", "statistique", "algebre", "analyse", "probabilit"], icons: ["sigma", "calculator", "function-square"] },
	{ keys: ["electronique", "circuit", "materiel", "hardware", "microcontroleur", "processeur"], icons: ["cpu", "circuit-board", "memory-stick"] },
	{ keys: ["intelligence", " ia ", "machine learning", "apprentissage", "neuron", "donnees massives", "big data"], icons: ["brain", "bot", "sparkles"] },
	{ keys: ["projet", "gestion", "management", "agile", "scrum"], icons: ["briefcase", "list-checks", "kanban"] },
	{ keys: ["communication", "anglais", "langue", "expression", "redaction"], icons: ["languages", "message-square", "mic"] },
	{ keys: ["design", "graphique", "ergonomie", "ux", "ui", "interface"], icons: ["palette", "pen-tool", "layout-dashboard"] },
	{ keys: ["droit", "juridique", "rgpd", "conformite", "legal"], icons: ["scale", "gavel", "file-badge"] },
	{ keys: ["gestion entreprise", "economie", "comptabilit", "finance", "marketing"], icons: ["trending-up", "line-chart", "coins"] },
];

/** Normalise (minuscule + retrait des diacritiques) pour un match robuste. */
function norm(s: string): string {
	return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Icônes suggérées pour un module d'après son nom et son UE (max `limit`).
 * Renvoie une liste dédupliquée, dans l'ordre des règles.
 */
export function suggestIcons(name: string, ue: string | null | undefined, limit = 6): string[] {
	const hay = " " + norm(`${name} ${ue ?? ""}`) + " ";
	const out: string[] = [];
	for (const rule of RULES) {
		if (rule.keys.some(k => hay.includes(norm(k)))) {
			for (const ic of rule.icons) if (!out.includes(ic)) out.push(ic);
		}
	}
	return out.slice(0, limit);
}
