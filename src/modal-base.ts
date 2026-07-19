import { App, Modal } from "obsidian";

/* ══════════════════════════════════════════════════════════
   MODAL DE BASE — apparition + disparition animées
   Obsidian détache le DOM d'une modale DÈS close() : aucune transition de
   sortie ne peut jouer, et ce build n'anime pas non plus l'entrée →
   ouverture/fermeture instantanées et sèches. QbdModal ajoute les deux :
   — entrée : classe `qbd-anim-modal` sur le panneau, animée en CSS ;
   — sortie : close() joue l'animation PUIS laisse Obsidian détacher.
   Toutes les modales du plugin héritent d'ici (au lieu de Modal directement).
   Le CSS (components/modal-anim.css) ne cible que `.modal.qbd-anim-modal`,
   jamais les modales natives d'Obsidian. Cf. obsidian:plugin-dev §6 bis.
══════════════════════════════════════════════════════════ */
export class QbdModal extends Modal {
	private qbdClosing = false;

	constructor(app: App) {
		super(app);
		// modalEl existe dès le constructeur de Modal ; marqueur commun sur le
		// panneau (l'entrée est animée en CSS via cette classe).
		this.modalEl.addClass("qbd-anim-modal");
	}

	/** Joue l'animation de sortie AVANT de laisser Obsidian détacher le DOM.
	    Idempotent (Escape ET clic sur le fond peuvent tomber quasi ensemble)
	    et respectueux de prefers-reduced-motion. */
	close(): void {
		if (this.qbdClosing) return;
		this.qbdClosing = true;

		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			super.close();
			return;
		}

		this.modalEl.addClass("qbd-closing");
		this.containerEl.addClass("qbd-closing"); // le fond .modal-bg suit
		let detached = false;
		const detach = (): void => {
			if (detached) return;
			detached = true;
			super.close(); // détache le DOM + appelle onClose()
		};
		// Fin de l'animation de sortie du panneau, avec un filet de sécurité si
		// animationend ne se déclenche pas (animation coupée, onglet masqué).
		this.modalEl.addEventListener("animationend", (e: AnimationEvent) => {
			if (e.target === this.modalEl) detach();
		});
		window.setTimeout(detach, 240);
	}
}
