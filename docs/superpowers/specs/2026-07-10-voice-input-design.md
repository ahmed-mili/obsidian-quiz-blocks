# Saisie vocale Whisper local — design

Date : 2026-07-10. Validé par Ahmed en conversation (design présenté puis « ok vas-y c'est bon pour moi »).

## Objectif

Dictée vocale dans le composer IA du dashboard (textarea `.qbd-ai-composer-input`, créé dans `ai.js`), transcrite **localement** par whisper.cpp. Zéro impact sur le release GitHub (main.js + styles.css + manifest.json inchangés), zéro consommation d'abonnement, opt-in complet : un utilisateur qui n'active rien ne voit aucune différence.

## Déclenchement — push-to-talk sur Espace (comme Claude Code)

Aucun bouton. Maintenir **Espace** dans le composer démarre la dictée, relâcher transcrit.

Mécanique précise (sur le textarea du composer uniquement) :

- `keydown` Espace non-repeat → « armé » : timestamp + position du curseur mémorisés, l'espace s'insère normalement (la frappe rapide n'est jamais perturbée).
- Toute autre touche pendant la phase armée → désarme (c'est de la frappe normale).
- `keydown` Espace avec `e.repeat` pendant la phase armée/enregistrement → `preventDefault()` (pas de spam d'espaces).
- Timer **400 ms** : si Espace toujours enfoncé → retirer l'espace inséré au moment de l'armement, démarrer l'enregistrement, afficher la pill.
- `keyup` Espace : si enregistrement en cours → stop + transcription ; sinon rien.
- **Échap** pendant l'enregistrement → annule sans transcrire. `blur` du textarea → annule aussi.
- Dictée **activée mais non installée** (binaire ou modèle manquant) → l'appui long affiche une `Notice` qui pointe vers les réglages du plugin. Si `voiceEnabled` est false, le listener n'est pas attaché du tout (aucun effet, pas même la notice) — l'opt-in est réel.
- Nouvel appui long pendant qu'une transcription est en cours → ignoré (une à la fois).

## Capture audio

- `getUserMedia({ audio: { channelCount: 1 } })` + `AudioContext({ sampleRate: 16000 })` + `ScriptProcessorNode` qui accumule les échantillons Float32.
- À l'arrêt : encodage WAV PCM16 mono 16 kHz (~40 lignes, aucune dépendance, pas de conversion en aval — c'est le format d'entrée natif de whisper.cpp).
- Fichier écrit dans `os.tmpdir()/qbd-voice-<ts>.wav`, supprimé en `finally` après transcription.
- Durée max de sécurité : **120 s** (auto-stop + transcription).
- Permission micro refusée / pas de micro → `Notice` explicite, état nettoyé.

## Transcription

- `child_process.execFile` (pattern déjà établi dans `ai-client.js`) :
  `whisper-cli.exe -m <model.bin> -f <wav> -l <lang> -nt -np` — stdout = texte seul.
  Flags vérifiés sur le binaire réel v1.9.1 le 2026-07-10.
- `windowsHide: true`, timeout 60 s, kill du process si la vue/le plugin se ferme pendant la transcription.
- Résultat : trim ; si vide → notice discrète « aucun texte reconnu » ; sinon insertion **à la position du curseur** avec espaces intelligents (espace ajouté avant/après si les caractères adjacents l'exigent) + dispatch d'un event `input` (resize/état du composer).

## Indicateur visuel

Pill flottante au-dessus du composer (même verre que `.qbd-hover-tip`) :

- **Enregistrement** : point rouge pulsant + durée `m:ss`.
- **Transcription** : libellé « Transcription… » (spinner discret).
- Disparaît à l'insertion, à l'annulation ou sur erreur. `prefers-reduced-motion` : pas de pulsation.

## Installation & réglages (opt-in)

Nouvelle section « Saisie vocale (dictée) » dans les réglages du plugin :

- **Toggle « Activer la dictée »** (`voiceEnabled`, défaut `false`).
- **Accélération** (`voiceBackend`) : `cpu` (défaut, léger, universel) | `cuda` (GPU NVIDIA, téléchargement lourd). *Écart déclaré vs le design conversé : pas de build Vulkan dans les releases officielles whisper.cpp — les GPU AMD/Intel restent sur CPU en v1.*
- **Modèle** (`voiceModel`) : `small-q5_1` (« Rapide », 190 Mo, défaut) | `large-v3-turbo-q5_0` (« Max », 574 Mo).
- **Langue** (`voiceLang`) : `fr` (défaut) | `auto` | `en`.
- **État + bouton « Télécharger »** par composant manquant (binaire, modèle), avec barre de progression. Rien n'est téléchargé sans clic explicite.

Sources vérifiées (2026-07-10, version épinglée — bump volontaire uniquement) :

| Composant | Asset | Taille |
|---|---|---|
| Binaire CPU | `github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip` | 8,0 Mo |
| Binaire CUDA | `.../v1.9.1/whisper-cublas-12.4.0-bin-x64.zip` | 677,9 Mo |
| Modèle Rapide | `huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin` | 190,1 Mo |
| Modèle Max | `.../ggml-large-v3-turbo-q5_0.bin` | 574,0 Mo |

Le zip CPU contient `Release/whisper-cli.exe` + DLLs `ggml-*` (vérifié par extraction réelle) ; l'arborescence du zip CUDA sera inspectée à l'implémentation.

- **Stockage** : `%LOCALAPPDATA%\quiz-blocks\whisper\bin-<backend>\` et `...\models\` — **hors vault** (jamais synchronisé, jamais dans le release) et **partagé entre les vaults** (un seul téléchargement pour les 5 vaults d'Ahmed).
- **Téléchargement** : `fetch()` (suit les redirects GitHub/HF) streamé chunk par chunk vers `fs.createWriteStream` — jamais 678 Mo en mémoire — progression via `content-length` ; téléchargement vers `<fichier>.part` puis rename (pas d'install à moitié). Dézippage : `Expand-Archive` via PowerShell (spawn).
- **Périmètre v1 : Windows uniquement** (`process.platform === "win32"`) ; sur les autres OS la section réglages affiche « non disponible ». macOS/Linux extensibles plus tard (assets tar.gz existants).

## Settings ajoutés (DEFAULT_SETTINGS)

```js
voiceEnabled: false,
voiceBackend: "cpu",       // "cpu" | "cuda"
voiceModel: "small-q5_1",  // | "large-v3-turbo-q5_0"
voiceLang: "fr",           // | "auto" | "en"
```

## Modules (factory ctx, comme le reste du dashboard)

- `src/dashboard/voice-install.js` — chemins, détection installé/manquant, téléchargement + progression, unzip. Aucune UI.
- `src/dashboard/voice-input.js` — `attachVoiceInput(ctx, textarea)` : hold Espace, capture, WAV, spawn whisper, insertion, pill. Retourne un `detach()` (cleanup à la fermeture de la vue).
- `src/dashboard/ai.js` — un appel `attachVoiceInput(...)` après la création du textarea, un appel `detach()` au cleanup.
- `src/plugin.js` — settings + section réglages (utilise voice-install pour état/téléchargement).
- `src/assets/css/components/voice-input.css` — pill (+ `@import` dans le point d'entrée CSS existant).

## Cas d'erreur couverts

Micro refusé/absent · binaire ou modèle manquant · échec/exit≠0 de whisper (Notice + log console, wav nettoyé) · stdout vide · timeout process · téléchargement interrompu (`.part` repris à zéro au prochain clic) · double déclenchement pendant transcription (ignoré).

## Vérification (états à couvrir avant « terminé »)

Appui bref = espace normal · appui long → dictée insérée au curseur (composer vide, milieu de texte, fin) · Échap annule · non installé → notice · `voiceEnabled` false → aucun effet · micro refusé · dictée silencieuse · modèle Rapide et Max · backend cpu et cuda · reduced-motion · fermeture de la vue pendant enregistrement et pendant transcription.
