# « Mes quiz » — cartes par module et par UE

**Statut :** validé par Ahmed le 2026-07-17.
**Origine :** « chaque carte correspond à un dossier qui contient des quiz ; un
dossier doit avoir le nom du module auquel appartiennent les quiz, et son UE
doit être celle à laquelle il appartient — tu as toutes ces infos dans mon
`Dashboard.md` ». Puis : « je ne veux plus jamais voir un truc qui ressemble à
ça » (capture de l'arbre à chemins bruts avec le dossier `syncthing`), « et on
doit aussi pouvoir trier par UE ».

## Ce que ça remplace, et pourquoi

La vue « Par dossier » actuelle rend un **arbre des chemins bruts du vault** :
`Bachelor Cybersécurité & Ethical Hacking/B1 (2025-2026)`, avec `syncthing/…`
qui remonte comme un groupe. Ahmed rejette explicitement cet affichage. Il est
**supprimé** et remplacé par des cartes au **nom de module** propre, tiré de
`Dashboard.md`, avec l'UE.

## Constat de terrain (vault Efrei, 2026-07-17)

- `Dashboard.md` (racine du vault) décrit la hiérarchie **UE → module** dans des
  encadrés `> [!portals] <UE> …` suivis de liens wiki vers les dossiers de
  module. ~24 modules, 8 UE.
- Les quiz réels ne sont que dans **2 dossiers de module** (`XTI201 - CCNA 1`
  19 quiz, `XTI207 - Gestion du parc informatique 1` 4 quiz), plus **12 quiz
  hors module** (11 dans `B1`, 1 à la racine) et un doublon `syncthing/`.
- **Décision d'Ahmed** : il rangera lui-même les 12 orphelins dans leurs
  dossiers de module ; le plugin suit. Les orphelins et `syncthing` sont **hors
  périmètre** — le plugin ne les déplace pas.

## Décision 1 — la source de vérité est `Dashboard.md`

Le plugin lit une **note de correspondance** (défaut : `Dashboard`) et en extrait
une table `dossier de module → { nom affiché, UE }` :

- Chaque encadré `> [!portals] <TITRE UE>` définit une **UE** (son titre, ex.
  `UE22CS - Infrastructure réseau et Solutions cloud`).
- Chaque ligne `> - [[<chemin>|<alias>]]` sous l'encadré est un **module** :
  - **dossier de module** = le segment de `<chemin>` situé **immédiatement sous
    le dossier d'année** (`B1 (2025-2026)`), ex. `XTI201 - CCNA 1`. Ce segment
    est identique que le lien pointe vers le dossier ou vers une note à
    l'intérieur (vérifié sur les deux formes présentes dans `Dashboard.md`).
  - **nom affiché** = l'`alias` du lien (ex. `XTI204-CS - Administration
    système`), ou le dossier si le lien n'a pas d'alias.
  - **UE** = le titre de l'encadré parent.

## Décision 2 — rattachement d'un quiz à un module

Un quiz appartient au module correspondant au **plus proche dossier ancêtre**
de son chemin qui figure dans la table (on remonte le chemin depuis le fichier).

Conséquence voulue : un quiz sous `B1/syncthing/XTI201 - CCNA 1/quiz.md` remonte
jusqu'à `XTI201 - CCNA 1`, reconnu → il rejoint le module `XTI201`. **Le mot
« syncthing » n'apparaît nulle part** — c'est précisément l'affichage rejeté.

Fallbacks (dégradation propre, jamais de disparition) :
- **Dossier de quiz absent de la table** → carte au **nom du dossier**, **sans
  badge UE**.
- **Note de correspondance absente / sans encadré `[!portals]`** (autre vault,
  B2 plus tard) → toutes les cartes au nom de dossier, sans UE. Le plugin reste
  pleinement utilisable, **mobile compris** (lecture via l'API `vault`, aucun
  accès Node).

## Décision 3 — le sélecteur passe à quatre axes

`quizzesGrouping: "module" | "ue" | "recent" | "type"`, **défaut `"module"`**.
(L'ancienne valeur `"folder"` est retirée ; migration : `"folder"` lu →
`"module"`.)

| Axe | Rendu |
|---|---|
| **Par module** (défaut) | Grille plate de **cartes de module**, une par dossier de module contenant des quiz. UE en petite étiquette sur la carte. |
| **Par UE** | Les mêmes cartes de module, **regroupées sous un en-tête par UE** (repliable, avec compte + avancement agrégés). C'est le « trier par UE ». |
| **Par activité** | Quiz à plat, par récence — **inchangé**. |
| **Par type** | Quiz à plat, par type — **inchangé**. |

Les libellés du sélecteur restent explicites (pas de jargon ambigu). Le
déclencheur affiche toujours l'axe courant en toutes lettres.

## La carte de module

- **Nom du module** (de `Dashboard.md`), en titre.
- **UE** en petite étiquette (ex. `UE22CS`). Absente si non résolue.
- **Nombre de quiz** du module (ceux réellement affichés : filtre + recherche
  appliqués).
- **Avancement** : nombre de quiz maîtrisés (`bestScore >= MASTERY_THRESHOLD`) +
  barre — la même sémantique que les nœuds actuels, **pas un inventaire**.
- Réutilise le style de carte existant (liseré, filet, coins) autant que
  possible. **Pas** de ligne « Par toi / cadenas / … » (mono-utilisateur).

## Le clic — on entre dans le module (drill-down)

Cliquer une carte de module remplace la grille par les **quiz de ce module**
(cartes de quiz avec bouton lecture), précédés d'un **fil d'Ariane**
`Mes quiz › <nom du module>` qui ramène à la grille. Les **filtres**
(Tous / En cours / Maîtrisés / Non commencés) et la **recherche** s'appliquent à
l'intérieur, sur les quiz du module. Un seul niveau de profondeur (module →
quiz) : pas de sous-modules.

L'état « dans quel module suis-je » est de l'état d'interface (pas persisté au
disque) : revenir à « Mes quiz » via le rail ou le fil d'Ariane rouvre la grille.

## Interaction avec l'existant

- Le **repli** (`quizzesExpandedFolders`) ne concerne plus que l'axe **Par UE**
  (les en-têtes d'UE se replient) ; en grille « Par module » il n'y a pas de
  section à replier. Les clés d'état deviennent `ue:<titre UE>` (le `:` est
  interdit dans un chemin Obsidian → aucune collision, argument déjà utilisé
  pour `recent:` / `type:`).
- Le **bouton lecture** sur les cartes de quiz, le **sélecteur**, les modes
  activité/type, les 4 pastilles de filtre : conservés tels quels.
- La carte de module **n'a pas** de bouton lecture (elle contient N quiz, pas
  un seul) : son clic entre dans le module.

## Fichiers touchés (indicatif)

- `src/dashboard/quiz-modules.ts` *(créé)* — **pur** : parse la note de
  correspondance → table module, et regroupe les quiz par module / par UE.
  Testable seul sous Node (comme `quiz-tree.ts`).
- `src/dashboard/quizzes.ts` — nouveaux axes « module »/« ue », grille de cartes
  de module, drill-down + fil d'Ariane. **Déjà à ~359 lignes, au-dessus du
  plafond ~350** : l'extraction du parsing/regroupement dans `quiz-modules.ts`
  et le retrait de l'arbre `quiz-tree` doivent laisser le fichier **sous 350**.
- `src/dashboard/quiz-card.ts` ou un nouveau `module-card.ts` — la carte de
  module (distincte de la carte de quiz).
- `src/plugin.ts` + `src/types/dashboard-ctx.ts` — réglages : `quizzesGrouping`
  (valeurs mises à jour, migration `folder`→`module`) et le chemin de la note de
  correspondance (`quizzesModuleMapNote`, défaut `"Dashboard"`), **déclarés des
  deux côtés** (piège vérifié : `ctx.plugin.settings` est typé `AiSettings`).
- `src/assets/css/dashboard/dashboard-quizzes.css` — style carte de module,
  en-têtes d'UE, fil d'Ariane.
- `src/i18n/{en,fr}/dashboard.ts` — libellés (axes, fil d'Ariane, « sans UE »…).

Le module `quiz-tree.ts` (arbre à chemins bruts) n'est **plus utilisé** par la
vue par défaut ; il reste consommé par rien après cette refonte → à retirer si
plus aucun appelant (vérifier au `grep`).

## Hors périmètre (décisions d'Ahmed)

- Ranger les 12 quiz orphelins et supprimer le doublon `syncthing` : côté vault,
  par Ahmed.
- Modules de `Dashboard.md` **sans** quiz : non affichés (une carte par dossier
  qui contient des quiz, pas une carte par module déclaré).
- Édition de `Dashboard.md` depuis le plugin.

## Contraintes (rappel, liantes)

- **Aucun framework de test** ne doit être ajouté. Vérification = `npm run check`
  + test manuel mesuré dans **Efrei**, prouvé à l'écran (croiser capture ET DOM).
- **`isDesktopOnly` reste `false`** : DOM pur + lecture `vault`, aucun `require`,
  `fs`, `process`.
- **Aucune chaîne visible en dur** : `t()`, anglais de référence, français typé
  derrière. **Un seul seuil de maîtrise** (`MASTERY_THRESHOLD`).
- CSS thémable (variables Obsidian, clair ET sombre). Commentaires en français.
- **Ordre stable** : modules triés alphabétiquement par nom, UE dans l'ordre
  d'apparition dans `Dashboard.md` (pas par nombre — sinon ça saute au filtre).

## Vérification (à prouver dans Efrei, capture + DOM)

1. « Par module » : une carte par dossier de module à quiz (aujourd'hui `XTI201`,
   `XTI207`), nom propre + UE + compte + avancement ; **aucun chemin brut, aucun
   « syncthing »** à l'écran.
2. Un quiz sous `syncthing/XTI201 - CCNA 1/` est compté dans la carte `XTI201`
   (rattachement au plus proche ancêtre reconnu).
3. « Par UE » : cartes regroupées sous en-têtes d'UE repliables ; un module non
   résolu tombe dans un groupe « Sans UE » en dernier.
4. Clic sur une carte de module → quiz du module + fil d'Ariane ; retour OK ;
   filtres et recherche actifs à l'intérieur.
5. `Dashboard.md` renommée/absente → dégradation : cartes au nom de dossier,
   sans UE, sans plantage.
6. Modes activité/type inchangés ; bouton lecture des quiz intact.
7. Rendu correct thème clair ET sombre ; 360 px utilisable.
8. `quizzes.ts` repasse **sous 350 lignes**.
