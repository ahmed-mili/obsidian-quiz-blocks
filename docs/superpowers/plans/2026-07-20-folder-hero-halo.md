# Folder Hero Halo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le halo débordant du titre de dossier par une lumière bornée qui devient transparente avant toute limite de clipping.

**Architecture:** Le DOM ne change pas. Le contrat statique existant verrouille d’abord la géométrie attendue, puis une seule règle CSS remplace les offsets négatifs et le filtre par deux gradients elliptiques contenus dans le hero.

**Tech Stack:** TypeScript strict, CSS natif, script de contrat Node.js, build esbuild du plugin Obsidian.

## Global Constraints

- La lumière reste derrière le breadcrumb, l’icône et le titre du dossier.
- Elle est entièrement transparente avant chacun des quatre bords de sa boîte.
- Aucun changement de `.qbd-content`, du ruban latéral ou des règles d’overflow.
- Aucun offset négatif, `filter: blur()`, largeur fixe débordante ou `!important` ajouté.
- La boîte du halo ne dépasse jamais 100 % de la largeur du hero.

---

### Task 1: Borner la propagation du halo

**Files:**
- Modify: `scripts/check-folder-drill-design.mjs`
- Modify: `src/assets/css/dashboard/dashboard-quizzes.css`

**Interfaces:**
- Consumes: `--accent` posé sur `.qbd-quizzes-folder-hero` par `src/dashboard/quizzes.ts`.
- Produces: le contrat visuel de `.qbd-quizzes-folder-halo`, borné à `min(620px, 100%) × 160px`.

- [ ] **Step 1: Écrire le contrat en échec**

Ajouter aux `checks` de `scripts/check-folder-drill-design.mjs` :

```js
["le halo reste entièrement dans la bannière", /\.qbd-quizzes-folder-halo\s*\{(?=[^}]*left:\s*0;)(?=[^}]*top:\s*0;)(?=[^}]*width:\s*min\(620px,\s*100%\);)(?=[^}]*height:\s*160px;)(?![^}]*filter:)[^}]*\}/s, css],
["les deux couches du halo s'éteignent avant leurs bords", /\.qbd-quizzes-folder-halo\s*\{[^}]*background:\s*radial-gradient\([^;]*transparent 100%\),\s*radial-gradient\([^;]*transparent 100%\);/s, css],
```

- [ ] **Step 2: Vérifier l’échec attendu**

Run: `node scripts/check-folder-drill-design.mjs`

Expected: sortie `FAIL` pour les deux nouveaux contrats, car la règle actuelle contient `left: -80px`, `top: -90px`, `width: 560px`, `height: 230px` et `filter: blur(10px)`.

- [ ] **Step 3: Remplacer uniquement la géométrie du halo**

Dans `src/assets/css/dashboard/dashboard-quizzes.css`, remplacer le bloc `.qbd-quizzes-folder-halo` par :

```css
.qbd-quizzes-folder-halo {
	position: absolute;
	left: 0;
	top: 0;
	width: min(620px, 100%);
	height: 160px;
	background:
		radial-gradient(ellipse 30% 42% at 34% 52%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 100%),
		radial-gradient(ellipse 44% 50% at 44% 50%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 100%);
	pointer-events: none;
}
```

La première ellipse concentre la lumière sur l’icône et le début du titre. La seconde diffuse une ambiance plus large. Leurs rayons restent inférieurs ou égaux à la distance entre leur centre et chaque bord, donc leur couleur atteint zéro avant le clipping.

- [ ] **Step 4: Vérifier le contrat et les builds**

Run:

```powershell
node scripts/check-folder-drill-design.mjs
npm run check
npm run build
```

Expected: `PASS: contrat visuel du dossier ouvert`, typecheck avec code de sortie 0, puis build de production avec code de sortie 0 et déploiement automatique dans le vault `Efrei`.

- [ ] **Step 5: Recharger et inspecter le rendu réel**

Run:

```powershell
obsidian vault="Efrei" plugin:reload id=quiz-blocks
```

Puis mesurer dans le DOM que le halo commence dans le hero, ne dépasse pas sa largeur, et que `.qbd-root` comme `.qbd-content` n’ont aucun débordement horizontal. Capturer le hero seul, avec une marge autour, pour vérifier l’absence de ligne à gauche et en haut.

- [ ] **Step 6: Vérifier les conflits CSS**

Confirmer qu’il n’existe qu’une règle `.qbd-quizzes-folder-halo`, qu’elle est référencée par `src/dashboard/quizzes.ts`, et qu’aucun sélecteur mort ou doublon conflictuel n’a été introduit.
