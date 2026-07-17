# « Mes quiz » — organisation par dossiers

**Statut :** validé par Ahmed le 2026-07-17.
**Problème :** « si par exemple j'ai 100 quiz je vais pas pouvoir m'y retrouver ».
**Échelle cible :** « actuellement j'ai que 35 quiz mais plus tard j'en aurait
200 ». La conception est jugée à **200**, pas à 35 — c'est la contrainte qui a
tranché entre liste plate et arborescence.

## Ce que la page fait aujourd'hui

`src/dashboard/quizzes.ts` (128 lignes) rend un en-tête, une recherche, quatre
pastilles de filtre (`all` / `progress` / `mastered` / `fresh`) puis une grille
**plate** de `renderQuizCard`. Aucun regroupement : toutes les cartes à la suite.

## Constats de terrain (vault Efrei, 2026-07-17)

Ces mesures ont changé la conception ; elles sont ici pour qu'on ne refasse pas
le raisonnement à l'envers.

- **Les 54 quiz n'ont AUCUN tag.** Ni frontmatter, ni tag en ligne. Les notes de
  quiz n'ont même pas de bloc frontmatter.
- **Ils sont déjà rangés par matière dans le vault**, en 5 dossiers :

  | Dossier | Quiz |
  |---|---|
  | `Bachelor…/B1 (2025-2026)/XTI201 - CCNA 1` | 19 |
  | `Bachelor…/B1 (2025-2026)/syncthing/XTI201 - CCNA 1` | 19 |
  | `Bachelor…/B1 (2025-2026)` | 11 |
  | `Bachelor…/B1 (2025-2026)/XTI207 - Gestion du parc informatique 1` | 4 |
  | (racine du vault) | 1 |

- **~19 de ces quiz sont des doublons.** 18 des 19 fichiers sous `syncthing/`
  ont un contenu **strictement identique** à ceux de `XTI201 - CCNA 1`, et sont
  plus anciens (mtime 2026-03-14 contre 2026-03-24). Le vrai total est ~35.
  **Hors périmètre** : c'est le vault d'Ahmed, aucune suppression sans son
  accord. L'arborescence les rendra visibles, ce qui suffit.
- **Deux dossiers portent le même nom de base** (`XTI201 - CCNA 1`) : un libellé
  réduit au dernier segment produirait deux lignes identiques.
- **Tous les dossiers partagent un préfixe commun** (`Bachelor Cybersécurité &
  Ethical Hacking/B1 (2025-2026)`). Ce fait commande la compaction ci-dessous.

## Décision 1 — le dossier du vault, pas un tag

La demande initiale était « chaque nom de dossier sera le tag présent dans les
métadonnées du fichier ». Les mesures l'ont invalidée : sans aucun tag, la
fonctionnalité aurait produit un seul groupe « Sans tag » contenant tous les
quiz — précisément le problème à résoudre. Le dossier du vault porte déjà la
structure voulue, marche à la première seconde, et suit quand une note bouge.

Écartés : **tags écrits par le générateur** (n'améliore rien tant que l'existant
n'est pas taggé à la main) ; **tag sinon dossier** (« pourquoi ce quiz est-il
là ? » aurait eu deux réponses possibles).

## Décision 2 — arborescence à chaînes compactées, pas liste plate

C'est l'échelle de 200 qui tranche.

- **Liste plate de sections** (un groupe par dossier) : correcte à 35 (5
  sections), mais à 200 quiz Ahmed aura B1/B2/B3 × une dizaine de modules, soit
  20 à 30 sections. Le défilement revient par la fenêtre — le problème d'origine.
- **Arborescence complète** : ferait déplier `Bachelor Cybersécurité & Ethical
  Hacking` puis `B1 (2025-2026)` pour atteindre quoi que ce soit, alors que ce
  préfixe est commun à tout. Deux clics qui n'apprennent rien.
- **Retenu — arborescence + compaction des chaînes à enfant unique** (le patron
  de VS Code et de GitHub) : un dossier dont le seul contenu est un unique
  sous-dossier fusionne avec lui sur une même ligne, `Bachelor…/B1 (2025-2026)`.
  Aucun niveau creux, et la hiérarchie réapparaît d'elle-même quand B2 puis B3
  arrivent.

À 35 quiz :

```
▾ Bachelor…/B1 (2025-2026)              35 · 12 maîtrisés  ███░░
     ▾ XTI201 - CCNA 1                  19 · 12 maîtrisés  ██████░
     ▸ syncthing/XTI201 - CCNA 1        19 · 0 maîtrisé    ░░░░░░
     ▸ XTI207 - Gestion du parc…         4 · 0 maîtrisé    ░░░░░░
       [les 11 quiz posés directement ici]
▸ Sans dossier                           1
```

À 200 :

```
▸ B1 (2025-2026)                        54 · 54 maîtrisés  ██████████
▾ B2 (2026-2027)                        88 · 31 maîtrisés  ███░░░░░░░
     ▸ XTI301 - …                       22
     ▾ XTI305 - …                       18
▸ B3 (2027-2028)                        58 · 0 maîtrisé    ░░░░░░░░░░
```

Trois lignes au repos pour trois années.

## Ce que fait StudySmarter (référence analysée le 2026-07-17)

Maquettes produit `SS_UI_2.svg` / `SS_UI_3.svg`, page
`studysmarter.fr/features/dossiers`.

- **Sous-dossiers imbriqués** (« Untersets »), sur plusieurs niveaux, reliés par
  un rail vertical. → **Valide l'arborescence.** Ils ne compactent pas les
  chaînes ; nous si, parce que le vault d'Ahmed a un préfixe commun.
- **Titres de groupe discrets** (« Mathe », « Englisch » : gris, petits, texte
  nu) ; ce sont **les cartes** qui portent le poids visuel — liseré coloré,
  icône, menu `⋮`, pied à compteurs typés (« 3450 Karteikarten · 12 Dokumente ·
  3 Sets »). → Repris : nœuds discrets, cartes riches.
- **Pastille de tag DANS la carte** (`Chemie`). → Chez la référence elle-même,
  le tag n'est qu'une étiquette posée sur un objet **déjà rangé dans un
  dossier** ; il ne remplace pas le dossier. Confirme la décision 1.
- **Leurs compteurs sont un inventaire**, pas un avancement.

### Où l'on fait mieux, et pourquoi

1. **L'avancement dans le nœud.** Leurs titres sont muets parce que leurs
   groupes ne se replient jamais. Ici le repli est mémorisé : un nœud replié
   doit rester informatif, sinon replier revient à cacher.
2. **Compaction des chaînes** : ils imposent un niveau par dossier réel.
3. **Retrait du chemin sur les cartes** : redondant sous un nœud de dossier.
   Ils n'affichent aucun chemin.
4. **Nos cartes gardent leur avantage** : liseré d'état, pastille de statut,
   barre de progression, meilleur score — pas un inventaire.

## Conception

### Construction de l'arbre

Dans `renderQuizGrid` (`quizzes.ts`), **après** le filtrage existant (recherche
+ pastille) : l'arbre est construit sur les quiz **retenus**, jamais sur le
total. Un dossier vide après filtrage n'existe pas.

1. Pour chaque quiz retenu, découper `quiz.path` en segments ; le dernier (le
   fichier) est écarté. Chaîne vide = racine du vault.
2. Insérer dans un arbre de nœuds `{ segment, children: Map, quizzes: [] }`.
3. **Compacter** : tant qu'un nœud a exactement **un** enfant et **aucun** quiz
   direct, le fusionner avec cet enfant ; le libellé devient
   `parent/enfant`. La compaction ne s'applique jamais à la racine virtuelle.

Le scanner n'est **pas** touché : `QuizIndexEntry.path` suffit. Aucun nouveau
module tant que `quizzes.ts` reste sous ~350 lignes ; s'il déborde, extraire la
construction de l'arbre dans `src/dashboard/quiz-tree.ts` (fonction pure,
`(quizzes, stats) => TreeNode[]`) — c'est la coupure naturelle.

### Rendu d'un nœud

```
▾ XTI201 - CCNA 1        19 quiz · 12 maîtrisés  ████████░░
```

- **Libellé** = segment(s) du nœud, chaînes compactées jointes par `/`.
  Racine du vault → `t("dashboard.quizzes.noFolder")`.
- **Compte** = quiz du nœud **et de tous ses descendants**, tels qu'affichés
  (filtre et recherche appliqués). Jamais le total du dossier : « 19 » au-dessus
  de 3 cartes serait un mensonge.
- **Agrégat de maîtrise** = quiz du sous-arbre dont `bestScore >= 80`, sur le
  compte affiché, plus une barre fine. Le seuil 80 est celui du filtre
  `mastered` existant (`quizzes.ts:110`) — **ne pas en introduire un second**.
- **Chevron** de repli à gauche.
- **Indentation** par niveau, **plafonnée** : la compaction supprime déjà les
  niveaux creux, mais une profondeur réelle importante ne doit pas écraser les
  cartes à 360 px de large (cf. mémoire `dashboard-android-pass`). Retenu :
  16 px par niveau, plafond à 4 niveaux d'indentation visuelle.

### Ordre

Dans un nœud : **les sous-dossiers d'abord** (alphabétique sur le libellé),
**puis les cartes** des quiz posés directement dans ce dossier. C'est la
convention de tout explorateur de fichiers, y compris celui d'Obsidian.

À la racine : alphabétique, `noFolder` **toujours en dernier**.

Trier par nombre ferait sauter les nœuds de place à chaque changement de filtre
(les comptes dépendent du filtre) : l'alphabétique reste stable quoi qu'il
arrive.

### Repli et persistance

- Nouveau réglage `quizzesCollapsedFolders: string[]` dans
  `QuizBlocksSettings` / `DEFAULT_SETTINGS` (`src/plugin.ts`), **défaut `[]`**
  → premier usage : tout déplié.
- Contenu : le **chemin de dossier complet** de chaque nœud replié (pas le
  libellé, ambigu ; pas les dépliés, qui sont le défaut).
- Écriture via `plugin.saveSettings()`, le canal déjà utilisé par `quizStats`
  (`stats-store.ts:58`). Aucune section dans l'onglet de réglages : c'est de
  l'état d'interface, pas une préférence à éditer.
- Un nœud compacté est identifié par le **chemin complet du dossier le plus
  profond de sa chaîne** — pour `Bachelor…/B1 (2025-2026)`, c'est
  `Bachelor Cybersécurité & Ethical Hacking/B1 (2025-2026)`. Ainsi l'état
  survit à l'apparition d'un `B2` qui romprait la compaction : `B1` garde son
  identité et reste replié, au lieu d'être traité comme un nœud inconnu.

### Recherche et filtres

- Un nœud sans aucun résultat dans son sous-arbre est **masqué**.
- Un nœud replié **contenant** des résultats est déplié **temporairement**,
  ainsi que ses ancêtres, sans modifier `quizzesCollapsedFolders` : une
  recherche ne doit pas reconfigurer la page dans le dos de l'utilisateur.
- Recherche vidée → l'état mémorisé reprend la main.
- Aucun résultat nulle part → état vide existant (`dashboard.quizzes.empty`).

### Carte de quiz

`renderQuizCard` (`quiz-card.ts`) a **deux appelants** : `quizzes.ts:123` et
`home.ts:265` (via un wrapper local, `home.ts:264`). Sur l'accueil les cartes ne
sont **pas** regroupées : le chemin y reste la seule indication d'où sort un
quiz. Un retrait sec dégraderait l'accueil.

→ La ligne de chemin devient **conditionnelle**, via un paramètre d'options en
fin de signature (l'existant est positionnel, `onOpen?` en dernier) :

```ts
export function renderQuizCard(
	container: HTMLElement,
	quiz: QuizIndexEntry,
	stats: QuizStatRecord | null | undefined,
	onOpen?: (quiz: QuizIndexEntry) => void,
	opts?: { showPath?: boolean }   // défaut : true
): HTMLDivElement
```

`quizzes.ts` passe `{ showPath: false }` ; `home.ts` n'est pas touché. La ligne
est **omise** du DOM, jamais masquée en CSS.

## i18n

Anglais de référence (`src/i18n/en/dashboard.ts`), français typé derrière.

| Clé | EN | FR |
|---|---|---|
| `dashboard.quizzes.noFolder` | `No folder` | `Sans dossier` |
| `dashboard.quizzes.folderCount` | `{count} quizzes` | `{count} quiz` |
| `dashboard.quizzes.folderMastered` | `{count} mastered` | `{count} maîtrisés` |
| `dashboard.quizzes.folderToggle` | `Collapse or expand this folder` | `Replier ou déplier ce dossier` |

Formes singulier/pluriel : suivre le patron `dashboard.common.questionsOne` /
`questionsOther` déjà en place.

## Fichiers touchés

- `src/dashboard/quizzes.ts` — arbre, compaction, nœuds, repli (le gros)
- `src/dashboard/quiz-card.ts` — `opts.showPath`
- `src/plugin.ts` — `quizzesCollapsedFolders` (type + défaut)
- `src/assets/css/dashboard/*.css` — style des nœuds, indentation, barre
- `src/i18n/{en,fr}/dashboard.ts` — 4 clés
- *(éventuel)* `src/dashboard/quiz-tree.ts` si `quizzes.ts` dépasse ~350 lignes

## Hors périmètre

- Suppression des 19 doublons `syncthing/` (décision d'Ahmed, son vault).
- Tags, drill-down, menu `⋮` par carte, glisser-déposer entre dossiers.
- Toute modification du scanner ou du frontmatter des notes.

## Vérification

Ce projet **n'a aucun framework de test** et ne doit pas en gagner un.
Vérification = `npm run check` (`tsc --noEmit`) **plus** un test manuel dans le
vault **Efrei**, prouvé par des mesures.

À prouver **à l'écran**, pas seulement dans le DOM (leçon de
`feat/mention-picker` : un test qui pilote des listeners ne prouve jamais le
rendu ; et une capture seule ne prouve rien non plus — Chromium resert un frame
périmé en arrière-plan, croiser capture ET DOM) :

1. L'arbre affiche `Bachelor…/B1 (2025-2026)` **compacté sur une seule ligne**,
   et non deux niveaux à déplier.
2. Ses 3 sous-dossiers apparaissent, avec les comptes du tableau ci-dessus, et
   les 11 quiz directs sont rendus **après** les sous-dossiers.
3. Les deux `XTI201 - CCNA 1` sont **distinguables** (`syncthing/` compacté dans
   le libellé de l'un).
4. Replier un nœud, recharger le plugin → il est **toujours** replié.
5. Une recherche déplie temporairement un nœud replié qui a des résultats **et
   ses ancêtres** ; vider la recherche restaure l'état mémorisé.
6. Changer de filtre ne **réordonne pas** les nœuds.
7. Un nœud replié affiche son agrégat de maîtrise.
8. Aucun chemin ne subsiste sur les cartes de « Mes quiz » ; l'accueil garde
   les siens.
9. Rendu correct en thème clair **et** sombre (variables Obsidian, aucune
   couleur en dur).
10. À 360 px de large, l'indentation n'écrase pas les cartes.

`isDesktopOnly` reste `false` : DOM pur, aucun accès Node, donc aucun risque de
chargement mobile.

### Cas limites à couvrir

- Un dossier contenant **à la fois** des sous-dossiers et des quiz directs
  (c'est le cas de `B1 (2025-2026)` : 11 quiz + 3 sous-dossiers) — la compaction
  ne doit **pas** s'y appliquer.
- Un quiz à la racine du vault → `noFolder`, en dernier.
- Filtre ne laissant qu'un seul quiz → un seul nœud, compacté jusqu'à lui.
- Aucun quiz nulle part → état vide, aucun nœud.
