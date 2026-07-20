# Halo du titre d’un dossier ouvert

**Statut :** validé par Ahmed le 2026-07-20.

## Problème

Le halo actuel est un calque de 560 × 230 px décalé de 80 px à gauche et de
90 px vers le haut, puis agrandi visuellement par `filter: blur(10px)`. Il
atteint donc les limites du port de défilement `.qbd-content`, dont les axes
sont clippés par `overflow-x: hidden` et `overflow-y: auto`. La lumière reste
colorée au point de coupe, ce qui produit des arêtes nettes contre le ruban
latéral et sous la limite supérieure du contenu.

## Contraintes

- La lumière reste derrière le breadcrumb, l’icône et le titre du dossier.
- Elle doit devenir entièrement transparente avant chaque bord de sa boîte.
- Elle ne doit dépendre d’aucun débordement hors de `.qbd-content`.
- Le ruban latéral, le scroll et les règles d’overflow existantes ne changent
  pas.
- La forme doit se réduire avec la largeur disponible sans provoquer de
  débordement horizontal.

## Approches examinées

1. Déplacer le halo derrière le ruban au niveau de `.qbd-root`. Écarté : la
   lumière contaminerait la navigation et pourrait encore être coupée par les
   limites de la racine.
2. Autoriser les débordements de `.qbd-content`. Écarté : ce conteneur est le
   port de défilement principal et ce changement risquerait de créer du scroll
   horizontal ou des peintures parasites.
3. Borner la propagation dans le hero. Retenu : deux gradients elliptiques,
   l’un focal et l’autre ambiant, s’éteignent à 100 % avant leurs quatre bords.

## Conception retenue

`.qbd-quizzes-folder-halo` reste un enfant absolu du hero, mais commence à
`left: 0` et `top: 0`. Sa largeur est plafonnée et ne dépasse jamais 100 % du
hero. Les centres et rayons des deux ellipses sont exprimés en pourcentages :
la couche large diffuse la couleur autour de l’ensemble du titre, tandis que
la couche plus courte renforce doucement l’icône et le début du libellé.

Le filtre `blur()` et les offsets négatifs sont supprimés. La douceur provient
uniquement des arrêts alpha des gradients. À chaque bord de la boîte, les deux
couches valent déjà `transparent`, donc un ancêtre peut clipper la boîte sans
produire de ligne visible.

## Vérification

- Le contrat statique échoue tant que le halo conserve un offset négatif, un
  filtre débordant ou un dégradé encore coloré à son bord.
- Le build TypeScript et le build de production réussissent.
- Après rechargement du plugin dans le vault `Efrei`, une capture zoomée du
  hero ne montre aucune coupure à gauche ni en haut.
- Le halo reste naturel aux largeurs desktop, étroite et mobile.
- `scrollWidth <= clientWidth` sur le contenu et la racine.
