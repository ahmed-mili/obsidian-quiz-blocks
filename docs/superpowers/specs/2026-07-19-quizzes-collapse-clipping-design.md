# Repli des sections de quiz sans fuite de bordure

## Problème

Les cartes d'une section repliée restent montées afin d'animer la hauteur avec
`grid-template-rows`. Dans certaines géométries, le bord supérieur coloré des
cartes reste peint sur un pixel sous l'en-tête de section. Les trois traits
visibles correspondent aux trois cartes de la première rangée.

## Contraintes

- Conserver l'animation actuelle de 240 ms dans les deux sens.
- Conserver l'élévation `translateY(-3px)` des cartes au survol lorsque la
  section est ouverte et stable.
- Ne laisser aucun pixel des cartes visible lorsque la section est repliée.
- Appliquer le même comportement à toutes les sections repliables des vues
  Recent et UE.
- Ne pas dépendre d'un délai JavaScript supplémentaire ni d'une hauteur codée
  en dur.

## Solution retenue

Ajouter un wrapper de clipping dédié entre `.qbd-quizzes-node-body` et la
grille de cartes :

```text
.qbd-quizzes-node-body
└── .qbd-quizzes-node-clip
    └── .qbd-module-grid ou .qbd-home-grid
```

Le corps conserve exclusivement la responsabilité d'animer sa rangée de
`1fr` vers `0fr`. Le nouveau wrapper porte `min-height: 0` et devient la
frontière de peinture avec `overflow: clip` pendant l'animation et à l'état
replié. À l'état ouvert stable, son overflow redevient visible afin que le
survol des cartes ne soit pas rogné.

Cette séparation rend la fuite impossible par construction : la grille qui
peint les bordures n'est plus elle-même l'élément compressé à zéro.

## Changements prévus

- Centraliser la création du corps et de son wrapper dans
  `src/dashboard/quizzes-render.ts`.
- Faire rendre chaque grille dans le wrapper retourné par ce helper.
- Déplacer les règles `min-height` et de clipping vers
  `.qbd-quizzes-node-clip` dans
  `src/assets/css/dashboard/dashboard-quizzes.css`.
- Ne modifier ni la persistance de l'état, ni `aria-expanded`, ni la durée ou
  l'easing de la transition.

## Vérification

1. Établir un test de contrat qui échoue tant que chaque corps repliable ne
   possède pas le wrapper et sa règle de clipping.
2. Exécuter `npm run check` puis `npm run build`.
3. Recharger le plugin dans le vault Efrei.
4. Vérifier dans Obsidian les états ouvert, animation de fermeture, replié,
   animation d'ouverture et survol ouvert.
5. Comparer des captures avec un viewport court proche de 1357 x 475 et un
   viewport plus haut proche de 1291 x 632.
6. Vérifier l'absence d'overflow horizontal et de conflit CSS sur les
   sélecteurs touchés.
