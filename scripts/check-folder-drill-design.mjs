import { readFileSync } from "node:fs";

const quizzes = readFileSync("src/dashboard/quizzes.ts", "utf8");
const render = readFileSync("src/dashboard/quizzes-render.ts", "utf8");
const card = readFileSync("src/dashboard/quiz-card.ts", "utf8");
const css = readFileSync("src/assets/css/dashboard/dashboard-quizzes.css", "utf8");
const components = readFileSync("src/assets/css/dashboard/dashboard-components.css", "utf8");
const dashboard = readFileSync("src/dashboard.ts", "utf8");

const checks = [
	["le dossier ouvert possède une bannière et son halo dédiés", /qbd-quizzes-folder-hero[\s\S]*qbd-quizzes-folder-halo/, quizzes],
	["la bannière utilise l'accent du dossier", /qbd-quizzes-folder-hero[\s\S]*setProperty\("--accent"/, quizzes],
	["le halo reste entièrement dans la bannière", /\.qbd-quizzes-folder-halo\s*\{(?=[^}]*left:\s*0;)(?=[^}]*top:\s*0;)(?=[^}]*width:\s*min\(620px,\s*100%\);)(?=[^}]*height:\s*160px;)(?![^}]*filter:)[^}]*\}/s, css],
	["les deux couches du halo s'éteignent avant leurs bords", /\.qbd-quizzes-folder-halo\s*\{[^}]*background:\s*radial-gradient\([^;]*transparent 100%\),\s*radial-gradient\([^;]*transparent 100%\);/s, css],
	["l'icône libre du dossier mesure 46 px", /\.qbd-quizzes-folder-hero \.qbd-quizzes-title-icon svg\s*\{[^}]*width:\s*46px;[^}]*height:\s*46px;/s, css],
	["le titre et son trait reprennent exactement le traitement 7a", /\.qbd-quizzes-folder-hero \.qbd-quizzes-title\s*\{[^}]*color:\s*var\(--accent\);[^}]*text-shadow:\s*0 2px 22px rgba\(0,\s*0,\s*0,\s*0\.65\),\s*0 0 30px color-mix\(in srgb, var\(--accent\) 30%, transparent\);/s, css],
	["le titre du dossier utilise Constantia dans sa graisse d'origine", /\.qbd-quizzes-folder-hero \.qbd-quizzes-title\s*\{[^}]*font-family:\s*Constantia, "Iowan Old Style", "Palatino Linotype", Georgia, serif;[^}]*font-weight:\s*700;/s, css],
	["les chiffres de Constantia restent alignés sur la ligne de base", /\.qbd-quizzes-folder-hero \.qbd-quizzes-title\s*\{[^}]*font-variant-numeric:\s*lining-nums;/s, css],
	["le trait 7a fait 200 px et démarre sous le titre", /\.qbd-quizzes-title-underline\s*\{[^}]*margin-top:\s*13px;[^}]*margin-left:\s*61px;[^}]*width:\s*200px;[^}]*height:\s*3px;/s, css],
	["la variante dossier ne crée pas la barre d'accent historique", /if \(!isFolderDrill\)\s*\{\s*card\.createDiv\(\{ cls: `qbd-quiz-card-accent/, card],
	["les cartes dossier utilisent la surface de verre 7a", /\.qbd-quiz-card\.qbd-quiz-card--folder\s*\{[^}]*background:\s*rgba\(16,\s*22,\s*40,\s*0\.48\);[^}]*backdrop-filter:\s*blur\(16px\) saturate\(130%\);[^}]*border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.13\);[^}]*border-radius:\s*15px;/s, components],
	["le bouton dossier emploie circle-play", /setIcon\(playBtn, isFolderDrill \? "circle-play" : "play"\)/, card],
	["le bouton play dossier est un carré arrondi de 32 px", /\.qbd-root \.qbd-quiz-card\.qbd-quiz-card--folder \.qbd-quiz-card-play\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*border-radius:\s*9px;/s, components],
	["le triangle Lucide du bouton play est plein", /\.qbd-quiz-card--folder \.qbd-quiz-card-play svg > path:first-child,[^\{]*\{[^}]*fill:\s*currentColor;[^}]*stroke:\s*none;/s, components],
	["le donut est une structure CSS avec centre opaque", /qbd-progress-donut[\s\S]*qbd-progress-donut-center[\s\S]*createEl\("b"/, render],
	["le donut 7a fait 150 px avec un centre de 112 px", /\.qbd-progress-donut\s*\{[^}]*width:\s*150px;[^}]*height:\s*150px;[^}]*background:\s*conic-gradient/s, css],
	["le centre du donut est opaque et centré", /\.qbd-progress-donut-center\s*\{[^}]*width:\s*112px;[^}]*height:\s*112px;[^}]*background:\s*#0d1222;[^}]*display:\s*flex;/s, css],
	["les animations heroIn et cardIn sont définies", /@keyframes qbd-folder-hero-in[\s\S]*@keyframes qbd-folder-card-in/, css],
	["les cartes reçoivent le délai 100 ms + index × 45 ms", /entryIndex:\s*index[\s\S]*100 \+ \(opts\.entryIndex \?\? 0\) \* 45/, `${render}\n${card}`],
	["le panneau Progrès entre après 170 ms", /\.qbd-progress-panel\s*\{[^}]*animation-delay:\s*170ms;/s, css],
	["la grille passe de deux à trois colonnes à 1200 px", /\.qbd-quizzes-drill-grid\s*\{[^}]*repeat\(2,[^}]*\}[\s\S]*@media \(min-width:\s*1200px\)[\s\S]*\.qbd-quizzes-drill-grid\s*\{[^}]*repeat\(3,/s, css],
	["le contrôleur distingue l'entrée du re-render interne", /const viewKey = openModuleFolder \?\? "root";[\s\S]*?const entering = viewKey !== lastPaintedView;[\s\S]*?classList\.toggle\("qbd-quizzes-enter", entering\)/, quizzes],
	["nav entrante, bascule d'axe et note de correspondance ré-arment l'entrée", /(?:[\s\S]*?lastPaintedView = null\b){3}/, quizzes],
	["une autre page ne garde jamais la classe d'entrée", /removeClass\("qbd-quizzes-enter"\)/, dashboard],
	["la cascade racine traverse toutes les sections avec la formule du drill", /let entryIndex = 0;\s*\n\s*const entryDelay = \(\): string => `\$\{100 \+ entryIndex\+\+ \* 45\}ms`;/, render],
	["chaque en-tête de section et chaque carte de dossier prend son cran", /nodeEl\.style\.setProperty\("--qbd-card-delay", entryDelay\(\)\)[\s\S]*card\.style\.setProperty\("--qbd-card-delay", entryDelay\(\)\)/, render],
	["hero, header racine et sélecteur d'axe entrent ensemble", /\.qbd-quizzes-enter \.qbd-quizzes-folder-hero,\s*\.qbd-quizzes-enter > \.qbd-quizzes-header,\s*\.qbd-quizzes-enter > \.qbd-quizzes-group\s*\{[^}]*animation:\s*qbd-folder-hero-in 0\.35s ease both;/s, css],
	["hors entrée le hero n'a plus d'animation propre", /\.qbd-quizzes-folder-hero\s*\{(?=[^}]*position:\s*relative)(?![^}]*animation)[^}]*\}/s, css],
	["en-têtes de section et cartes de dossier entrent en cascade", /\.qbd-quizzes-enter \.qbd-quizzes-node-head,\s*\.qbd-quizzes-enter \.qbd-module-card\s*\{[^}]*animation:\s*qbd-folder-card-in 0\.4s cubic-bezier\(0\.2, 0\.7, 0\.3, 1\) both;[^}]*animation-delay:\s*var\(--qbd-card-delay, 100ms\);/s, css],
	["le panneau Progrès n'entre que sous la classe d'entrée", /\.qbd-quizzes-enter \.qbd-progress-panel\s*\{[^}]*animation:\s*qbd-folder-card-in[^}]*animation-delay:\s*170ms;/s, css],
	["les cartes quiz du drill n'animent qu'à l'entrée", /\.qbd-quizzes-enter \.qbd-quiz-card\.qbd-quiz-card--folder\s*\{[^}]*animation:\s*qbd-folder-card-in[^}]*animation-delay:\s*var\(--qbd-card-delay, 100ms\);/s, components],
	["hors entrée la carte dossier n'a plus d'animation propre", /\.qbd-quiz-card\.qbd-quiz-card--folder\s*\{(?=[^}]*backdrop-filter)(?![^}]*animation)[^}]*\}/s, components],
	["reduced-motion neutralise toute la transition d'entrée", /prefers-reduced-motion[\s\S]*\.qbd-quizzes-enter \.qbd-module-card,[\s\S]*animation:\s*none/, css],
];

const failed = checks.filter(([, pattern, source]) => !pattern.test(source));
if (failed.length) {
	for (const [label] of failed) console.error(`FAIL: ${label}`);
	process.exit(1);
}

console.log("PASS: contrat visuel du dossier ouvert");
