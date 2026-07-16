# Picker de mentions « @ » dans le composer IA — design

Date : 2026-07-16. Statut : en attente de validation par Ahmed.
Référence fournie : capture du picker `@` de Claude Code (terminal, liste racine du cwd)
et capture du composer « Generate a quiz » du dashboard.

## Objectif

Taper `@` dans le composer de la page « Générer » ouvre un picker de fichiers qui se
comporte comme celui de Claude Code : liste de la racine, navigation dans les dossiers,
recherche récursive à la frappe, sélection au clavier. La sélection d'un fichier
**l'attache au quiz** (chip existante), elle n'insère pas de chemin dans le texte.

Le périmètre par défaut est le vault. Des dossiers externes (typiquement `Downloads`)
peuvent être ajoutés par réglage, sur desktop uniquement.

## Ce qui existe déjà et n'est PAS réécrit

Le composer sait déjà attacher des sources. Le picker s'y branche, il ne double rien :

- `NoteAttachment { name, content, path? }` et l'état `noteAttachments` dans `ai.ts`.
- Les chips (rangée `.qbd-ai-composer-attachments`, bouton de retrait).
- `attachNoteVaultFile(file: TFile)` : dédoublonne par `path`, `vault.read`, `render()`.
- `addComposerFiles(files: File[])` : route images (vision), PDF (texte via le `loadPdfJs`
  embarqué d'Obsidian), texte (`.md`, `.txt`, `text/*`), refuse le reste avec Notice.
- L'injection dans le prompt : `notesBlock` (délimiteurs `--- nom ---`) et bascule
  automatique en `source: "text"` dans `startGeneration`.

Conséquence : **aucune modification d'`ai-client.ts`**. Les trois fournisseurs (Claude
Code CLI, Codex, Ollama) reçoivent le contenu déjà injecté et fonctionnent sans le savoir.
C'est aussi ce qui rend la feature indépendante du fournisseur, contrairement au `@` de
Claude Code où c'est le modèle qui lit le fichier via son outil Read (Ollama, servi en
HTTP, n'a aucun accès disque et ne pourrait pas suivre un chemin).

## Comportement

### Déclenchement

- `@` tapé **en début de mot** : début du textarea, ou précédé d'un espace ou d'un saut
  de ligne. `ahmed@gmail.com` n'ouvre donc rien.
- Ouverture immédiate, sans délai, sur la liste racine.

### Liste initiale (racine du vault)

- Fichiers et dossiers **mélangés**, tri alphabétique insensible à la casse (fidèle à la
  référence : `.git\`, `.gitattributes`, `.github\`, `.gitignore`, `CLAUDE.md`).
- Dossiers suffixés `/`.
- Première entrée présélectionnée.
- Racines externes configurées ajoutées **en fin de liste**, après un séparateur, avec une
  icône distincte.

### Recherche

- Dès la première lettre après `@`, la recherche est **toujours globale** : tout le vault
  (récursivement) **plus l'intégralité de chaque racine externe configurée**
  (récursivement). Jamais de périmètre réduit. Décision d'Ahmed, 2026-07-16.
- Le filtre est un fuzzy sur le **chemin complet**, ce qui rend toute notion de périmètre
  inutile : `@Cours/ja` matche `Cours/Java/TD3.md` parce que le préfixe tapé fait
  simplement partie du motif. Descendre dans un dossier n'enferme donc pas la recherche,
  ça ne fait que pré-remplir le début du motif.
- **Les espaces sont autorisés dans le token** tant que la recherche a au moins un
  résultat. Non négociable : 410 des 443 notes du vault Personal ont un espace dans leur
  chemin. Le token se termine et le menu se ferme quand un espace donne zéro résultat.
- Résultats plafonnés à 30 à l'affichage (comme `openNotePicker` aujourd'hui), le fuzzy
  restant calculé sur l'ensemble.

### Navigation et sélection

- Flèches haut/bas : déplacent la sélection. Entrée ou Tab : valident. Échap : ferme.
  Clic : valide. Backspace qui efface le `@` : ferme.
- **Dossier sélectionné → on descend dedans** : le token devient `@Cours/` et la liste
  affiche son contenu. Un dossier ne s'attache jamais. La descente est un confort
  d'exploration, elle ne restreint pas la recherche (cf. « Recherche »).
- **Fichier sélectionné → attachement** : le token `@…` est retiré du texte, le fichier
  passe par la plomberie existante (`attachNoteVaultFile` pour le vault, `addComposerFiles`
  pour les racines externes), une chip apparaît. Le texte tapé reste propre.

### Types listés

Seuls les formats que le composer sait attacher sont affichés : `.md`, `.txt`, PDF,
images, texte brut (`.csv`, `.json`…). Les autres (`.zip`, `.docx`, `.pptx`, `.exe`) sont
**masqués**. Tout ce qui est proposé s'attache réellement, et le bruit de `Downloads`
(installeurs, archives) disparaît.

## Fidélité à la référence : écarts assumés

| Référence (terminal) | Ici | Motif |
|---|---|---|
| Suffixe `\` | Suffixe `/` | Les chemins Obsidian utilisent `/` sur toutes les plateformes |
| Préfixe `+`, sélection par couleur de texte | Icônes Lucide, sélection par fond | Le composer clone claude.ai, pas un terminal. Règle projet `lucide-icons` et style d'`openNotePicker` existant |
| Liste tous les fichiers | Masque les formats non attachables | Décision d'Ahmed (2026-07-16) |
| Insère un chemin, le modèle lit | Attache le contenu (chip) | Ollama n'a pas d'accès disque ; la plomberie de chips existe déjà. Décision d'Ahmed |
| Dossier référencé = listing pour le modèle | Dossier = navigation seule | Un listing de dossier n'a aucun sens comme source de quiz |

## Sources de fichiers

### Vault (toutes plateformes)

API Obsidian, arbre déjà en mémoire. Aucun accès disque, aucune indexation à écrire.
Tout est natif, rien à réimplémenter (vérifié dans `obsidian.d.ts` le 2026-07-16) :

- Listing : `vault.getRoot()` puis `TFolder.children` (`TAbstractFile[]`, discriminé par
  `instanceof TFolder`).
- Recherche : `getAllLoadedFiles()` pour l'ensemble, filtré par **`prepareFuzzySearch(query)`**
  (`obsidian.d.ts:5252`), qui renvoie un `SearchResult` scoré. Le tri des résultats suit ce
  score. Aucun algorithme de fuzzy maison.

### Racines externes (desktop uniquement)

`require("fs")` **paresseux, à l'intérieur des fonctions**, gardé par
`Platform.isDesktopApp`, conformément au pattern établi (`ai-client.ts`, `ai-providers.ts`).

- **Navigation** : `readdir` du seul dossier affiché, jamais de ses enfants. Le coût est
  indépendant de la taille du disque.
- **Recherche récursive** : la racine est parcourue **intégralement**, en arrière-plan, dès
  la première ouverture du picker, puis mise en cache pour la session et invalidée sur le
  `mtime` de la racine. Les résultats du vault s'affichent immédiatement, ceux du disque se
  greffent à l'arrivée.
- **Gardes anti-explosion** (un utilisateur peut configurer `C:\` ou un dossier de projets) :
  profondeur 8, 20000 entrées, dossiers cachés et `node_modules` ignorés. Ces bornes sont
  très au-dessus d'un usage réel (`Downloads` chez Ahmed : 15 fichiers, 2 dossiers, donc
  parcouru en entier).
- **Jamais de troncature silencieuse** : si une garde est atteinte, le picker le dit
  explicitement (indication en pied de menu nommant la racine concernée) plutôt que de
  laisser croire que la recherche a tout couvert.

### Mobile

`isDesktopOnly` **reste `false`** (règle projet absolue). Sur mobile, le picker `@`
fonctionne normalement sur le vault, qui ne demande aucune API Node. Seules les racines
externes sont indisponibles : la section de réglage est masquée et aucune racine externe
n'est listée. Dégradation, jamais blocage.

## Coût et performance

Mesuré le 2026-07-16 sur la machine d'Ahmed :

| Source | Volume réel | Coût |
|---|---|---|
| Vault Efrei (le plus gros) | 3311 fichiers, 655 dossiers | Parcours de tableau en mémoire, sous la milliseconde, zéro I/O |
| Vault Personal | 1511 fichiers, 443 `.md` | Idem |
| `Downloads` | 15 fichiers, 2 dossiers | Parcours complet de quelques ms, une fois par session |

Aucun accès disque pendant la frappe : la navigation lit un seul dossier, la recherche
externe lit un cache. Le seul scénario dégradé serait une racine énorme et récursive
(`C:\dev` et ses `node_modules`), que les plafonds ci-dessus neutralisent.

## Modules

Deux modules neufs, deux greffes ciblées. Cible < 350 lignes par module (règle projet).

- **`src/dashboard/file-sources.ts`** (~150 lignes, nouveau). Seul responsable de « où sont
  les fichiers ». Expose `FileEntry { name, path, isFolder, source: "vault" | "external" }`
  et trois opérations : lister un dossier, chercher récursivement, résoudre une entrée en
  source attachable. Aucune dépendance à l'UI. L'abstraction par `source` permettra
  d'ajouter `"remote"` (relais mobile vers le PC) sans refonte.
- **`src/dashboard/mention-picker.ts`** (~200 lignes, nouveau). Glue textarea : détection du
  token `@` avant le caret, cycle de vie du menu, clavier, appel de l'attachement.
- **`src/dashboard/ui-select.ts`** (greffe). Ajout d'`openMentionMenu`, et extension de
  `MenuHandle` avec `setItems` / `moveSelection` / `confirm`. Motif : la règle projet
  impose `ui-select.ts` comme seul dropdown, et le positionnement portalé (flip, clamp,
  fermeture sur scroll/resize/Échap) y est déjà résolu. Le fichier est déjà gros (57 Ko),
  mais réimplémenter un menu autonome dupliquerait ce socle.
- **Ancrage : le composer, pas le caret.** La référence le montre (capture du 2026-07-16) :
  la liste s'affiche au-dessus du prompt, alignée à gauche, et ne suit pas le curseur. Le
  paramètre `anchorEl: HTMLElement` d'`openNotePicker` convient donc tel quel, avec son flip
  et son clamp. Aucun miroir de textarea, aucun calcul de rectangle de caret.
- **Différence avec `openNotePicker`** : ce dernier possède son propre champ de recherche et
  vole le focus (`setTimeout(() => input.focus(), 0)`). Pour les mentions, la frappe doit
  rester dans le textarea. `openMentionMenu` est donc sans champ interne, piloté de
  l'extérieur par `setItems`, et ne prend jamais le focus.
- **`src/dashboard/ai.ts`** (greffe minimale). Attache le picker au textarea, garde le
  handler d'envoi, restaure le caret. Surface volontairement réduite : Fable 5 travaille
  dans ce fichier en parallèle.

## Pièges identifiés dans le code existant

1. **`render()` détruit le textarea et le caret.** Chaque attachement reconstruit tout le
   DOM du composer et le re-focus ne restaure pas `selectionStart`. Le bug existe déjà
   (menu `+`, drag & drop) ; `@` le rendrait criant (attacher au milieu d'une phrase
   renverrait le caret à la fin). Correctif structurel : sauvegarder et restaurer la
   position du caret autour du `render`, ce qui répare aussi les chemins existants.
2. **Entrée est déjà l'envoi.** Le handler d'envoi doit interroger explicitement l'état du
   picker (`if (picker.isOpen()) return`) plutôt que de dépendre de l'ordre d'attachement
   des listeners, qui est fragile (voice-input est attaché avant le handler d'envoi).
3. **La dictée s'arme sur `keydown` Espace** (push-to-talk, armement puis enregistrement à
   400 ms). Or le picker doit accepter les espaces. Quand le menu est ouvert, la dictée ne
   s'arme pas : l'espace est de la frappe normale.
4. **Nouveau réglage à déclarer à deux endroits** : `plugin.ts` et `AiSettings` dans
   `types/dashboard-ctx.ts`, sinon `ai.ts` ne peut pas le lire.

## Réglages

- Nouvelle clé `aiMentionExtraFolders: string[]`, défaut `[]`. Aucun changement de
  comportement pour l'existant et **aucune migration impérative** : l'`Object.assign` sur
  `DEFAULT_SETTINGS` de `loadSettings()` suffit.
- SettingTab, section IA : liste de chemins avec ajout et suppression. Chaque chemin est
  validé à la saisie (existe, et est bien un dossier), Notice explicite sinon.
- Section masquée quand `Platform.isDesktopApp` est faux.

## i18n

Nouvelles clés dans `i18n/en/ai.ts` et `i18n/en/settings.ts` (référence), puis `fr/`. Le
typage `Record<keyof typeof EN_X, string>` transforme un oubli en erreur de compilation.
Aucune clé du format quiz n'est touchée. `t()` appelé au rendu, jamais en constante
top-level.

## Non-objectifs (YAGNI)

- Pas d'attachement de dossier entier (un dossier se navigue).
- Pas de relais mobile vers les CLI du PC : sujet distinct, spec séparée. Constat du
  2026-07-16 : SSH est impossible depuis Obsidian mobile (WebView Capacitor, pas de socket
  TCP brute) ; la voie viable serait un relais HTTP sur le tailnet existant. Hors périmètre.
- Pas de limite de taille sur le contenu attaché (aucune n'existe aujourd'hui hors
  `KIMI_ARG_MAX`).
- Pas de respect de `.gitignore` (notion absente du vault).

## Vérification

`npm run check` (seule vérification automatisée du projet, aucun framework de test), puis
test manuel dans Obsidian. Points à couvrir au test : `ahmed@gmail.com` n'ouvre pas le
menu, `@Cours Java` (avec espace) trouve la note sans déclencher la dictée, Entrée valide
sans envoyer le prompt, attachement au milieu d'une phrase conserve le caret, racine
externe navigable, et sur mobile le `@` vault fonctionne sans racine externe.
