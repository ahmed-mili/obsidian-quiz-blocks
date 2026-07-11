# Éditeur d'équations (math-field) — design

Date : 2026-07-11. Validé par Ahmed en conversation (design en 6 sections, « ok vas-y implémente ça »).
Références d'Ahmed : capture panneau symboles Overleaf (122028.png) ; exigences verbatim : frappe→LaTeX auto, « si j'ai écrit une fraction, j'ai juste à cliquer sur un des chiffres… je peux le modifier », « il ne faut [pas] que je voie tout le code latex », catégorie par défaut = celle utile à la réponse.

## Bibliothèque

**MathLive 0.110.0** (npm `mathlive`, MIT, web component `<math-field>`) — vérifié 2026-07-11 : frappe naturelle → math rendue (inline shortcuts `/`, `^`, `sqrt`, `pi`), caret posé au clic sur n'importe quel atome, clavier virtuel personnalisable par catégories, sortie `getValue('latex')`. Écartés : MathQuill (jQuery, vieillissant), fait-maison MathJax (semaines, fragile).

## 1. Où le champ apparaît

- Question texte « math » = `hasMath(prompt)` OU une `acceptedAnswers`/`answer` contient un segment `$...$`/commande LaTeX OU `mathInput: true` (nouveau champ, ajouté au prompt système IA et aux knownKeys).
- Quiz (moteur, terminal.js variante `text` uniquement) : `<math-field>` remplace la textarea. cmd/powershell/bash : JAMAIS.
- Éditeur : champ « Réponses acceptées » (editor-form) et aperçu (preview.js, vide/readonly) utilisent le même composant quand la question est math.
- Question non-math : textarea actuelle inchangée.

## 2. Saisie

Comportements natifs MathLive conservés ; `mathVirtualKeyboardPolicy` configuré pour NE PAS afficher le clavier plein écran desktop (notre panneau custom à la place). Aucun mode « code LaTeX » exposé (menu contextuel MathLive élagué si besoin).

## 3. Panneau de symboles (référence Overleaf)

Clavier virtuel MathLive custom (`mathVirtualKeyboard.layouts`) — catégories : Bases (× ÷ ± = ≠ < > ≤ ≥), Fractions & exposants (a/b, x², x_n, |x|), Racines (√, ∛), Calcul (∫, ∫_a^b, ∑, lim, d/dx, ∞), Grec (α…ω usuels), Flèches & relations (→, ⇒, ∈, ⊂). Catégorie par défaut : analyse des commandes LaTeX de la première acceptedAnswer — mapping `\frac|\^` → Fractions, `\sqrt` → Racines, `\int|\sum|\lim` → Calcul, `\alpha…` → Grec, défaut Bases. Panneau visible au focus du champ, masqué au blur.

## 4. Correction

`normalizeMathAnswer(latex)` : trim, espaces multiples→rien, `\left`/`\right` retirés, `\dfrac`/`\tfrac`→`\frac`, accolades singleton `{x}`→`x` (1 char), `\cdot` conservé (PAS d'équivalence symbolique — décision d'Ahmed : `x·4` ≠ `4x` ; chaque forme acceptable est listée dans acceptedAnswers). Comparaison normalisée contre CHAQUE acceptedAnswer, insensible à la casse si `caseSensitive` false (défaut). Les acceptedAnswers écrites avec `$...$` sont comparées après strip des dollars.

## 5. Distribution

`npm install mathlive` + bundle esbuild (release GitHub inchangé : main.js/styles.css/manifest.json). Fonts : SPIKE en Task 1 — voie A : `fonts.css` importé avec loader esbuild `dataurl` (fonts inline dans styles.css) ; voie B : `MathfieldElement.fontsDirectory` vers le dossier du plugin via `adapter.getResourcePath`. Retenir la voie qui rend correctement DANS Obsidian (vérif visuelle). Sons désactivés (`soundsDirectory = null`).

## 6. Hors périmètre v1

Équivalence symbolique (Compute Engine), recherche dans le panneau, math-field dans le composer/énoncés, mobile virtual keyboard custom (le clavier MathLive standard fait l'affaire sur tactile).

## Modules

- `src/engine/math-input.js` — factory partagée : `isMathQuestion(q)`, `createMathField(host, opts)` (champ configuré, panneau, catégorie déduite), `normalizeMathAnswer(latex)`. Requis par terminal.js (moteur) et editor (form + preview).
- `terminal.js` : branche math → math-field, lecture de la valeur via `getValue('latex')` au lieu de `.value`, correction via normalizeMathAnswer.
- `editor-form.js` : Réponses acceptées en math-field si question math.
- `ai-client.js` : prompt système documente `mathInput: true`.

## Vérification

Spike rendu fonts dans Obsidian · question math générée → math-field présent, textarea absente · frappe `1/2` → fraction, clic numérateur → édition ciblée · panneau ouvert sur la bonne catégorie ($\int$ attendu → Calcul) · correction : bonne réponse acceptée sous forme normalisée, `x\cdot4` refusé pour `4x` · question non-math → textarea inchangée · cmd/bash → jamais de math-field · thème clair/sombre · zéro régression `npm run build`.
