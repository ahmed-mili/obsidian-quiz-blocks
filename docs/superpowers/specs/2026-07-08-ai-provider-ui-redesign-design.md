# Design — Refonte UI génération IA + provider Claude par abonnement

Date : 2026-07-08
Contexte : demande d'Ahmed (captures 172340 + 172436) — boutons sidebar collés/moches,
provider IA non cliquable dans la page Générer, ajout de Claude par abonnement
(Pro/Max/Team/Enterprise) sans clé API, vrais logos Ollama/Claude, polish général.

## Décisions

### 1. Sidebar — fix des boutons collés
Root cause : `.theme-dark button` (spécificité 0,1,1) peint le chrome natif Obsidian
(box-shadow + fond pilule) par-dessus `.qbd-nav-item` (0,1,0). Fix : neutraliser
`box-shadow: none !important; background: transparent !important` (background redéfini
par les modificateurs hover/active plus spécifiques), espacement `gap: 4px`.

### 2. Page Générer — sélecteur de provider cliquable
La carte « Modèle IA » devient un vrai sélecteur : 3 provider cards en grille
(Claude / Ollama Cloud / Ollama local), chacune avec logo de marque, nom, et ligne de
statut (dot couleur + texte). Clic = changement de provider (settings.aiProvider +
reset du modèle par défaut) + re-render. Card active : bordure + teinte accent.

Sous la grille : rangée « Modèle » avec un dropdown custom + zone de hint
contextuelle (clé manquante, serveur offline, CLI non installé) avec action directe
(bouton vers les réglages du plugin, commande à copier).

Statuts détectés en async (render non bloquant, update à l'arrivée) :
- claude-code : `claude --version` via child_process (cache 60 s) → vert « Prêt » /
  rouge « Non installé » + lien d'installation.
- ollama-cloud : clé présente → vert ; absente → orange « Clé API requise » +
  bouton réglages.
- ollama : GET /api/tags → vert « N modèles installés » (alimente le dropdown) /
  rouge « Serveur non détecté » + hint `ollama serve`.

### 3. Provider Claude par abonnement — via Claude Code CLI
Remplace le provider `anthropic` (clé API). Friction minimale : réutilise la session
Claude Code déjà connectée au compte (validé sur cette machine, CLI 2.1.204 :
`claude -p --output-format json` → JSON `.result` en ~3 s).

- `ai-client.js` : `callClaudeCode()` → `spawn` du CLI, prompt complet (system+user)
  passé par **stdin** (aucun échappement d'argument), args fixes :
  `-p --output-format json --model <alias> --tools "" --no-session-persistence
  --setting-sources ""`, cwd = homedir, windowsHide, timeout 180 s.
- Modèles = alias stables `sonnet` (recommandé) / `opus` / `haiku` — suivent
  automatiquement les derniers modèles du compte.
- Images : fichiers écrits en temp dir, `--tools "Read"`, chemins dans le prompt
  (Read est read-only, autorisé en mode print).
- Erreurs mappées en français : non installé → lien install ; non connecté →
  « lancez `claude` puis `/login` » ; timeout.
- Migration au load : `aiProvider === "anthropic"` → `"claude-code"`, modèle → `sonnet`.
  Champ UI clé API supprimé ; tutoriel settings remplacé (installer CLI, /login).

### 4. Logos de marque
Simple Icons (CC0) inline : `ollama` (monochrome theme-aware, currentColor) et
`claude` (couleur de marque #D97757). Ollama Cloud = même logo, libellé « Cloud ».
Constantes SVG dans `ai-providers.js`. Unicode ✕/↺ existants remplacés par Lucide
(x / rotate-ccw) via setIcon.

### 5. Dropdown custom — plus aucun `<select>` natif
Règle cardinale obsidian:plugin-design : le popup d'un `<select>` natif est un
overlay OS non thémable. Nouveau module `ui-select.js` (vanilla, pas de React dans
ce plugin) : trigger `<button>` au look champ + menu portalé à `document.body`
(position fixed depuis getBoundingClientRect, fermeture mousedown-dehors + Escape,
checkmark accent sur l'option active, couleurs 100 % variables natives Obsidian).
API : `createSelect(parent, { value, options, onChange })` → `{ setOptions, setValue }`.
Remplace les 4 `<select>` de ai.js (modèle ×3 chemins + type de questions).
Les réglages du plugin (plugin.js) gardent les composants natifs Obsidian Setting
(cohérence avec l'app, hors périmètre de la règle).

## Fichiers touchés
- `src/dashboard/ai-providers.js` (nouveau) — registry providers, logos, modèles,
  checks de statut (source unique, dédoublonne ai.js/plugin.js)
- `src/dashboard/ui-select.js` (nouveau) — dropdown custom portalé
- `src/dashboard/ai.js` — provider cards, dropdowns, hints
- `src/dashboard/ai-client.js` — callClaudeCode, suppression du chemin clé API
- `src/plugin.js` — migration settings, nouveau tutoriel, dropdown provider
- `src/assets/css/dashboard/dashboard-nav.css` — fix chrome boutons
- `src/assets/css/dashboard/dashboard-ai.css` — provider cards + polish
- `src/assets/css/components/ui-select.css` (nouveau) + import dans `index.css`

## Hors périmètre
Autres providers (OpenAI, Gemini…) : l'architecture registry les rend ajoutables,
mais focus actuel = Ollama local/cloud + Claude abonnement (demande explicite).
