# Quizzes Collapse Clipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empêcher toute bordure de carte de rester visible sous une section de quiz repliée tout en conservant l'animation de 240 ms et l'élévation au survol à l'état ouvert.

**Architecture:** `.qbd-quizzes-node-body` reste le contrôleur de hauteur animé. Un nouvel enfant `.qbd-quizzes-node-clip` devient l'unique frontière de peinture autour de la grille et n'active `overflow: clip` que pendant l'animation ou à l'état replié.

**Tech Stack:** TypeScript strict, DOM Obsidian, CSS Grid, Node.js sans dépendance pour le test de contrat, CLI Obsidian pour la vérification réelle.

## Global Constraints

- Conserver l'animation actuelle de 240 ms dans les deux sens.
- Conserver l'élévation `translateY(-3px)` des cartes au survol lorsque la section est ouverte et stable.
- Ne laisser aucun pixel des cartes visible lorsque la section est repliée.
- Appliquer le même comportement à toutes les sections repliables des vues Recent et UE.
- Ne pas dépendre d'un délai JavaScript supplémentaire ni d'une hauteur codée en dur.
- Préfixer chaque commande CLI Obsidian par `vault="Efrei"`.

---

### Task 1: Isoler la peinture de la grille repliable

**Files:**
- Create: `scripts/check-collapse-clipping.mjs`
- Modify: `src/dashboard/quizzes-render.ts:95-104`
- Modify: `src/assets/css/dashboard/dashboard-quizzes.css:199-220`

**Interfaces:**
- Consumes: `renderCollapsibleSection(deps, parent, key, label, total, defaultOpen)` et les classes d'état `.is-collapsed` / `.is-animating`.
- Produces: un élément `.qbd-quizzes-node-clip` retourné par `renderCollapsibleSection`, dans lequel les appelants rendent leur `.qbd-module-grid`.

- [ ] **Step 1: Écrire le test de contrat en échec**

Créer `scripts/check-collapse-clipping.mjs` :

```js
import { readFileSync } from "node:fs";

const render = readFileSync("src/dashboard/quizzes-render.ts", "utf8");
const css = readFileSync("src/assets/css/dashboard/dashboard-quizzes.css", "utf8");

const checks = [
	[
		"renderCollapsibleSection crée et retourne le wrapper de clipping",
		/const body = nodeEl\.createDiv\(\{ cls: "qbd-quizzes-node-body" \}\);\s*return body\.createDiv\(\{ cls: "qbd-quizzes-node-clip" \}\);/s,
		render,
	],
	[
		"le wrapper peut se comprimer sous sa hauteur intrinsèque",
		/\.qbd-quizzes-node-clip\s*\{[^}]*min-height:\s*0;/s,
		css,
	],
	[
		"le wrapper clippe la peinture pendant l'animation et le repli",
		/\.qbd-quizzes-node\.is-collapsed \.qbd-quizzes-node-clip,\s*\.qbd-quizzes-node\.is-animating \.qbd-quizzes-node-clip\s*\{[^}]*overflow:\s*clip;/s,
		css,
	],
];

const failed = checks.filter(([, pattern, source]) => !pattern.test(source));
if (failed.length) {
	for (const [label] of failed) console.error(`FAIL: ${label}`);
	process.exit(1);
}
console.log("PASS: contrat de clipping du repli");
```

- [ ] **Step 2: Exécuter le test et constater l'échec initial**

Run: `node scripts/check-collapse-clipping.mjs`

Expected: exit code `1` avec les trois lignes `FAIL`, car le wrapper et ses règles n'existent pas encore.

- [ ] **Step 3: Ajouter le wrapper DOM minimal**

Dans `renderCollapsibleSection`, remplacer le retour direct du corps par :

```ts
	const body = nodeEl.createDiv({ cls: "qbd-quizzes-node-body" });
	return body.createDiv({ cls: "qbd-quizzes-node-clip" });
```

Les appelants existants continuent de recevoir un `HTMLElement`, mais rendent désormais leur grille dans le wrapper.

- [ ] **Step 4: Déplacer le clipping sur le wrapper dédié**

Dans `dashboard-quizzes.css`, remplacer les règles visant l'enfant générique par :

```css
.qbd-quizzes-node-clip {
	min-height: 0;
}
.qbd-quizzes-node.is-collapsed .qbd-quizzes-node-clip,
.qbd-quizzes-node.is-animating .qbd-quizzes-node-clip {
	overflow: clip;
}
```

Conserver sans changement la transition de `.qbd-quizzes-node-body`, sa règle `grid-template-rows: 0fr` et la logique TypeScript de `is-animating`.

- [ ] **Step 5: Exécuter le test de contrat et les vérifications statiques**

Run: `node scripts/check-collapse-clipping.mjs`

Expected: `PASS: contrat de clipping du repli`.

Run: `npm run check`

Expected: TypeScript termine avec l'exit code `0`.

Run: `npm run build`

Expected: esbuild termine avec l'exit code `0` et déploie le plugin dans les vaults configurés.

- [ ] **Step 6: Contrôler les conflits CSS et l'overflow horizontal**

Run: `rg -n "qbd-quizzes-node-(body|clip)|overflow" src/assets/css/dashboard/dashboard-quizzes.css`

Expected: une seule frontière de clipping pour le contenu repliable, sur `.qbd-quizzes-node-clip`; aucune nouvelle largeur fixe, marge négative ou règle d'overflow horizontal.

- [ ] **Step 7: Recharger le plugin dans le bon vault**

Run: `obsidian vault="Efrei" plugin:reload id=quiz-blocks`

Expected: confirmation du rechargement de `quiz-blocks`. Si le raccourci `obsidian` n'est pas résolu, utiliser `%LOCALAPPDATA%\Programs\Obsidian\Obsidian.com` avec les mêmes arguments.

- [ ] **Step 8: Mesurer les états dans le DOM réel**

Évaluer dans le vault Efrei un script court chargé depuis le scratchpad :

```js
JSON.stringify([...document.querySelectorAll(".qbd-quizzes-node")].map((node) => {
	const body = node.querySelector(".qbd-quizzes-node-body");
	const clip = node.querySelector(".qbd-quizzes-node-clip");
	const cards = [...node.querySelectorAll(".qbd-module-card")];
	return {
		label: node.querySelector(".qbd-quizzes-node-label")?.textContent,
		collapsed: node.classList.contains("is-collapsed"),
		bodyHeight: body?.getBoundingClientRect().height,
		clipHeight: clip?.getBoundingClientRect().height,
		overflow: clip ? getComputedStyle(clip).overflow : null,
		cardCount: cards.length,
	};
}))
```

Expected à l'état replié: `bodyHeight: 0`, `clipHeight: 0`, `overflow: "clip"`, avec `cardCount` supérieur à zéro pour « Older than one month ». Expected à l'état ouvert stable: hauteurs positives et `overflow: "visible"`.

- [ ] **Step 9: Vérifier visuellement les cinq états**

Capturer dans Obsidian l'état ouvert, la fermeture, l'état replié, l'ouverture et le survol ouvert. Tester un viewport court proche de `1357 x 475` puis un viewport plus haut proche de `1291 x 632`.

Expected: aucun trait coloré sous l'en-tête replié; animation fluide dans les deux sens; bordure et ombre de la carte survolée non rognées à l'état ouvert; aucune barre de défilement horizontale.

- [ ] **Step 10: Commit du correctif vérifié**

```bash
git add scripts/check-collapse-clipping.mjs src/dashboard/quizzes-render.ts src/assets/css/dashboard/dashboard-quizzes.css
git commit -m "fix(quizzes): clipper entièrement les sections repliées"
```
