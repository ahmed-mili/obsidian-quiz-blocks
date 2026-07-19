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
