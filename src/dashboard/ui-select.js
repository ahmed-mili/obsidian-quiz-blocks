'use strict';

/* ══════════════════════════════════════════════════════════
   UI SELECT — Dropdown custom réutilisable
   Remplace les <select> natifs (popup OS non thémable).
   Trigger bouton au look champ + menu portalé à document.body
   (position fixed), fermeture clic-dehors / Escape / scroll.
══════════════════════════════════════════════════════════ */

const openMenus = new Set();

/* Ferme tous les menus ouverts (appelé à chaque re-render). */
function closeAllSelects() {
	for (const close of Array.from(openMenus)) close();
}

/*
 * createSelect(parent, {
 *   value, options: [{ value, label, hint? }],
 *   onChange(value), disabled?, placeholder?
 * }) → { el, setValue, setOptions, setDisabled }
 */
function createSelect(parent, opts) {
	let options = opts.options || [];
	let value = opts.value;
	let disabled = !!opts.disabled;
	const placeholder = opts.placeholder || "Sélectionner…";

	const trigger = parent.createEl("button", { cls: "qbd-select" });
	trigger.type = "button";
	const labelEl = trigger.createSpan({ cls: "qbd-select-label" });
	const chevron = trigger.createSpan({ cls: "qbd-select-chevron" });
	obsidian.setIcon(chevron, "chevron-down");

	let menuEl = null;

	function currentOption() {
		return options.find(o => o.value === value);
	}

	function refreshLabel() {
		const cur = currentOption();
		if (opts.renderTrigger) {
			labelEl.empty();
			opts.renderTrigger(labelEl, cur || null);
		} else {
			labelEl.textContent = cur ? cur.label : (value || placeholder);
		}
		labelEl.classList.toggle("qbd-select-label--empty", !cur && !value);
		trigger.disabled = disabled;
		trigger.classList.toggle("qbd-select--disabled", disabled);
	}

	function closeMenu() {
		if (!menuEl) return;
		menuEl.remove();
		menuEl = null;
		trigger.setAttribute("aria-expanded", "false");
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e) {
		if (trigger.contains(e.target) || (menuEl && menuEl.contains(e.target))) return;
		closeMenu();
	}

	function onKeyDown(e) {
		if (e.key === "Escape") closeMenu();
	}

	function onScroll(e) {
		if (menuEl && menuEl.contains(e.target)) return;
		closeMenu();
	}

	function openMenu() {
		if (disabled || options.length === 0 || !trigger.isConnected) return;
		closeAllSelects();

		const rect = trigger.getBoundingClientRect();
		menuEl = document.body.createDiv({ cls: "qbd-select-menu" });
		menuEl.setAttribute("role", "listbox");
		// Hauteur max bornée par la place du meilleur côté. Un select bas
		// sur écran mobile a peu de place en dessous → on ouvrira vers le
		// haut (openUp) plutôt que de déborder sous le pli (le menu est
		// position:fixed, la partie hors écran serait inatteignable).
		const spaceBelow = window.innerHeight - rect.bottom - 8;
		const spaceAbove = rect.top - 8;
		const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
		const maxH = Math.max(Math.min(openUp ? spaceAbove : spaceBelow, 320), 120);
		menuEl.style.top = rect.bottom + 4 + "px";
		menuEl.style.left = rect.left + "px";
		menuEl.style.minWidth = rect.width + "px";
		menuEl.style.maxHeight = maxH + "px";

		for (const o of options) {
			const optBtn = menuEl.createEl("button", {
				cls: "qbd-select-option" + (o.value === value ? " is-active" : "")
			});
			optBtn.type = "button";
			optBtn.setAttribute("role", "option");
			optBtn.setAttribute("aria-selected", o.value === value ? "true" : "false");
			const check = optBtn.createSpan({ cls: "qbd-select-check" });
			if (o.value === value) obsidian.setIcon(check, "check");
			if (opts.renderOption) {
				opts.renderOption(optBtn, o);
			} else {
				optBtn.createSpan({ cls: "qbd-select-option-label", text: o.label });
				if (o.hint) optBtn.createSpan({ cls: "qbd-select-option-hint", text: o.hint });
			}
			optBtn.addEventListener("click", () => {
				const changed = o.value !== value;
				value = o.value;
				refreshLabel();
				closeMenu();
				if (changed && opts.onChange) opts.onChange(o.value);
			});
		}

		// Positionnement vertical définitif : au-dessus si le bas manque
		// de place (openUp), sinon en dessous (défaut déjà posé).
		const menuRect = menuEl.getBoundingClientRect();
		if (openUp) {
			menuEl.style.top = Math.max(8, rect.top - 4 - menuRect.height) + "px";
		}
		// Si le menu déborde à droite du viewport, le rabattre
		if (menuRect.right > window.innerWidth - 8) {
			menuEl.style.left = Math.max(8, window.innerWidth - 8 - menuRect.width) + "px";
		}

		trigger.setAttribute("aria-expanded", "true");
		openMenus.add(closeMenu);
		document.addEventListener("mousedown", onDocDown, true);
		document.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", closeMenu);
	}

	trigger.addEventListener("click", () => {
		if (menuEl) closeMenu();
		else openMenu();
	});

	refreshLabel();

	return {
		el: trigger,
		setValue(v) { value = v; refreshLabel(); },
		setOptions(next, nextValue) {
			options = next || [];
			if (nextValue !== undefined) value = nextValue;
			refreshLabel();
		},
		setDisabled(d) { disabled = !!d; refreshLabel(); }
	};
}

/*
 * openActionMenu(anchorEl, items) — menu flottant d'actions
 * (même surface visuelle que le dropdown). items :
 * [{ icon, label, sub?, disabled?, onClick }]
 */
function openActionMenu(anchorEl, items) {
	closeAllSelects();

	const rect = anchorEl.getBoundingClientRect();
	const menuEl = document.body.createDiv({ cls: "qbd-select-menu qbd-action-menu" });
	menuEl.setAttribute("role", "menu");

	for (const item of items) {
		const btn = menuEl.createEl("button", {
			cls: "qbd-select-option" + (item.disabled ? " qbd-select-option--disabled" : "")
		});
		btn.type = "button";
		btn.setAttribute("role", "menuitem");
		if (item.disabled) btn.disabled = true;
		const iconEl = btn.createSpan({ cls: "qbd-select-check qbd-action-menu-icon" });
		if (item.icon) obsidian.setIcon(iconEl, item.icon);
		// Ligne simple façon claude.ai (icône + label + accessoire à droite).
		// `sub` reste supporté (2 lignes) pour compat, mais n'est plus utilisé ici.
		if (item.sub) {
			const body = btn.createDiv({ cls: "qbd-action-menu-body" });
			body.createSpan({ cls: "qbd-select-option-label", text: item.label });
			body.createSpan({ cls: "qbd-action-menu-sub", text: item.sub });
		} else {
			btn.createSpan({ cls: "qbd-select-option-label", text: item.label });
		}
		if (item.hint) btn.createSpan({ cls: "qbd-action-menu-hint", text: item.hint });
		btn.addEventListener("click", () => {
			closeMenu();
			if (!item.disabled && item.onClick) item.onClick();
		});
	}

	// Position : au-dessus ou en dessous de l'ancre selon la place
	menuEl.style.left = rect.left + "px";
	menuEl.style.visibility = "hidden";
	menuEl.style.top = "0px";
	const menuRect = menuEl.getBoundingClientRect();
	const below = rect.bottom + 4;
	const above = rect.top - 4 - menuRect.height;
	menuEl.style.top = (below + menuRect.height <= window.innerHeight - 8 || above < 8 ? below : above) + "px";
	if (menuRect.width + rect.left > window.innerWidth - 8) {
		menuEl.style.left = Math.max(8, window.innerWidth - 8 - menuRect.width) + "px";
	}
	menuEl.style.visibility = "";

	function closeMenu() {
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e) {
		if (anchorEl.contains(e.target) || menuEl.contains(e.target)) return;
		closeMenu();
	}

	function onKeyDown(e) {
		if (e.key === "Escape") closeMenu();
	}

	function onScroll(e) {
		if (menuEl.contains(e.target)) return;
		closeMenu();
	}

	openMenus.add(closeMenu);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);

	return { close: closeMenu };
}

/*
 * openModelMenu(anchorEl, {
 *   models: [{ value, label, desc?, badge? }],
 *   currentModel,
 *   efforts: [{ value, label }],
 *   currentEffort,
 *   onPickModel(value), onPickEffort(value), onMore?()
 * }) — dropdown modèle + effort façon claude.ai : liste des modèles
 * (label + description + badge), séparateur, ligne « Effort » qui
 * ouvre un drill-in dans le même menu, puis « Plus de modèles ».
 */
function openModelMenu(anchorEl, opts) {
	closeAllSelects();

	const menuEl = document.body.createDiv({ cls: "qbd-select-menu qbd-model-menu" });
	menuEl.setAttribute("role", "menu");
	let effortFlyout = null;
	let effortCloseTimer = null;
	let moreFlyout = null;
	let moreCloseTimer = null;

	function effortLabelOf(v) {
		const efs = opts.efforts || [];
		const e = efs.find(x => x.value === v);
		return e ? e.label : (efs[0] ? efs[0].label : "");
	}

	function reposition() {
		const rect = anchorEl.getBoundingClientRect();
		menuEl.style.left = rect.left + "px";
		menuEl.style.visibility = "hidden";
		menuEl.style.top = "0px";
		const menuRect = menuEl.getBoundingClientRect();
		const below = rect.bottom + 4;
		const above = rect.top - 4 - menuRect.height;
		menuEl.style.top = (below + menuRect.height <= window.innerHeight - 8 || above < 8 ? below : above) + "px";
		let left = rect.left;
		if (menuRect.width + left > window.innerWidth - 8) {
			left = Math.max(8, window.innerWidth - 8 - menuRect.width);
		}
		menuEl.style.left = left + "px";
		menuEl.style.visibility = "";
	}

	// Construit un bouton d'option modèle (liste principale ET flyout « Plus de
	// modèles »). Ferme le menu et notifie onPickModel au clic.
	function appendModelOption(parent, m) {
		const active = m.value === opts.currentModel;
		const btn = parent.createEl("button", { cls: "qbd-select-option" + (active ? " is-active" : "") });
		btn.type = "button";
		btn.setAttribute("role", "menuitemradio");
		btn.setAttribute("aria-checked", active ? "true" : "false");
		const check = btn.createSpan({ cls: "qbd-select-check" });
		if (active) obsidian.setIcon(check, "check");
		const body = btn.createDiv({ cls: "qbd-model-option-body" });
		const top = body.createDiv({ cls: "qbd-model-option-top" });
		top.createSpan({ cls: "qbd-select-option-label", text: m.label });
		if (m.badge) top.createSpan({ cls: "qbd-model-option-badge", text: m.badge });
		if (m.desc) body.createSpan({ cls: "qbd-model-option-desc", text: m.desc });
		// Icône à droite (Ollama : nuage = cloud, téléchargement = local non
		// installé, rien = local installé), calée à droite comme l'app Ollama.
		if (m.icon) {
			const ic = btn.createSpan({ cls: "qbd-model-option-icon" });
			obsidian.setIcon(ic, m.icon);
		}
		btn.addEventListener("click", () => {
			const changed = m.value !== opts.currentModel;
			opts.currentModel = m.value;
			closeMenu();
			if (changed && opts.onPickModel) opts.onPickModel(m.value);
		});
		return btn;
	}

	function renderMain() {
		menuEl.empty();

		// Recherche « Find model… » + liste scrollable (façon app Ollama) quand
		// opts.searchable : la liste défile en interne (hauteur ~7 lignes),
		// l'effort reste fixe en dessous. Sinon, liste plate directe.
		if (opts.searchable) {
			menuEl.addClass("qbd-model-menu--searchable");
			const searchWrap = menuEl.createDiv({ cls: "qbd-model-menu-search" });
			const searchInput = searchWrap.createEl("input", {
				cls: "qbd-model-menu-search-input",
				attr: { type: "text", placeholder: "Find model…", spellcheck: "false" }
			});
			const listEl = menuEl.createDiv({ cls: "qbd-model-menu-list" });
			const paint = (filter) => {
				listEl.empty();
				const f = (filter || "").trim().toLowerCase();
				const shown = opts.models.filter(m => !f
					|| (m.label || "").toLowerCase().includes(f)
					|| (m.value || "").toLowerCase().includes(f));
				if (!shown.length) listEl.createDiv({ cls: "qbd-model-menu-empty", text: "Aucun modèle" });
				else for (const m of shown) appendModelOption(listEl, m);
			};
			paint("");
			searchInput.addEventListener("input", () => paint(searchInput.value));
			searchInput.addEventListener("keydown", (e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					if (searchInput.value) { searchInput.value = ""; paint(""); }
					else closeMenu();
				}
			});
			setTimeout(() => searchInput.focus(), 0);
		} else {
			for (const m of opts.models) appendModelOption(menuEl, m);
		}

		// Ligne « Effort » : seulement si le modèle expose des niveaux (Ollama
		// masque la ligne pour un modèle sans capability « thinking »). Au
		// survol, ouvre un flyout latéral à droite (façon claude.ai), sans clic.
		if (opts.efforts && opts.efforts.length) {
			menuEl.createDiv({ cls: "qbd-model-menu-sep" });

			const effortRow = menuEl.createEl("button", { cls: "qbd-select-option qbd-model-menu-row qbd-effort-row" });
			effortRow.type = "button";
			effortRow.setAttribute("role", "menuitem");
			effortRow.createSpan({ cls: "qbd-select-check" });
			effortRow.createSpan({ cls: "qbd-select-option-label", text: "Effort" });
			effortRow.createSpan({ cls: "qbd-model-menu-row-value", text: effortLabelOf(opts.currentEffort) });
			const effortChev = effortRow.createSpan({ cls: "qbd-model-menu-row-chevron" });
			obsidian.setIcon(effortChev, "chevron-right");

			effortRow.addEventListener("mouseenter", () => { cancelMoreClose(); closeMoreFlyout(); cancelEffortClose(); openEffortFlyout(effortRow); });
			effortRow.addEventListener("mouseleave", scheduleEffortClose);
		}

		// Ligne « Plus de modèles » : flyout latéral avec le reste des modèles
		// (façon claude.ai). Rendue seulement si opts.moreModels est non vide.
		if (opts.moreModels && opts.moreModels.length) {
			const moreRow = menuEl.createEl("button", { cls: "qbd-select-option qbd-model-menu-row qbd-more-row" });
			moreRow.type = "button";
			moreRow.setAttribute("role", "menuitem");
			moreRow.createSpan({ cls: "qbd-select-check" });
			moreRow.createSpan({ cls: "qbd-select-option-label", text: "Plus de modèles" });
			const moreChev = moreRow.createSpan({ cls: "qbd-model-menu-row-chevron" });
			obsidian.setIcon(moreChev, "chevron-right");

			moreRow.addEventListener("mouseenter", () => { cancelEffortClose(); closeEffortFlyout(); cancelMoreClose(); openMoreFlyout(moreRow); });
			moreRow.addEventListener("mouseleave", scheduleMoreClose);
		}
	}

	// ── Flyout latéral d'effort (façon claude.ai) ──
	// Ouvert au survol de la ligne « Effort », portalé au <body> (le menu a
	// overflow → un enfant absolu serait rogné). Délai de fermeture court =
	// hover-intent (le temps d'atteindre le flyout à travers le petit espace),
	// pas un contournement de bug : annulé dès qu'on entre dans le flyout.
	function cancelEffortClose() {
		if (effortCloseTimer) { clearTimeout(effortCloseTimer); effortCloseTimer = null; }
	}

	function scheduleEffortClose() {
		cancelEffortClose();
		effortCloseTimer = setTimeout(closeEffortFlyout, 140);
	}

	function closeEffortFlyout() {
		cancelEffortClose();
		if (effortFlyout) { effortFlyout.remove(); effortFlyout = null; }
		const row = menuEl.querySelector(".qbd-effort-row");
		if (row) row.classList.remove("is-open");
	}

	function openEffortFlyout(row) {
		if (effortFlyout) return;
		row.classList.add("is-open");
		const fly = document.body.createDiv({ cls: "qbd-select-menu qbd-effort-flyout" });
		effortFlyout = fly;
		fly.setAttribute("role", "menu");
		fly.createDiv({
			cls: "qbd-effort-flyout-head",
			text: "Un effort plus élevé signifie des réponses plus approfondies, mais prend plus de temps et consomme vos limites plus rapidement."
		});
		for (const ef of (opts.efforts || [])) {
			const active = ef.value === opts.currentEffort;
			// Classe par niveau (--low/--medium/…/--ultracode) : porte la couleur
			// du picker /effort de Claude Code, révélée seulement à l'actif/survol.
			const b = fly.createEl("button", {
				cls: "qbd-select-option qbd-effort-option qbd-effort-option--" + ef.value
					+ (active ? " is-active" : "")
			});
			b.type = "button";
			b.setAttribute("role", "menuitemradio");
			b.setAttribute("aria-checked", active ? "true" : "false");
			const check = b.createSpan({ cls: "qbd-select-check" });
			if (active) obsidian.setIcon(check, "check");
			const body = b.createDiv({ cls: "qbd-effort-option-body" });
			const top = body.createDiv({ cls: "qbd-effort-option-top" });
			top.createSpan({ cls: "qbd-select-option-label", text: ef.label });
			if (ef.isDefault) top.createSpan({ cls: "qbd-effort-badge", text: "Par défaut" });
			if (ef.sub) body.createSpan({ cls: "qbd-effort-option-sub", text: ef.sub });
			b.addEventListener("click", () => {
				const changed = ef.value !== opts.currentEffort;
				opts.currentEffort = ef.value;
				closeMenu();
				if (changed && opts.onPickEffort) opts.onPickEffort(ef.value);
			});
		}

		// Position : à droite du menu (flip à gauche si pas de place). Le bas
		// du flyout s'aligne sur le bas de la ligne « Effort » → les niveaux
		// montent depuis la ligne, le plus élevé (ultracode) en bas.
		const rowR = row.getBoundingClientRect();
		const menuR = menuEl.getBoundingClientRect();
		fly.style.visibility = "hidden";
		fly.style.top = "0px";
		fly.style.left = "0px";
		const fr = fly.getBoundingClientRect();
		let left = menuR.right + 4;
		if (left + fr.width > window.innerWidth - 8) left = menuR.left - 4 - fr.width;
		left = Math.max(8, left);
		let top = rowR.bottom - fr.height;
		top = Math.min(Math.max(8, top), window.innerHeight - fr.height - 8);
		fly.style.left = left + "px";
		fly.style.top = top + "px";
		fly.style.visibility = "";

		fly.addEventListener("mouseenter", cancelEffortClose);
		fly.addEventListener("mouseleave", scheduleEffortClose);
	}

	// ── Flyout « Plus de modèles » (façon claude.ai) ──
	// Ouvert au survol de la ligne, portalé au <body>. Contient le reste des
	// modèles (opts.moreModels), chacun sélectionnable comme dans la liste.
	function cancelMoreClose() {
		if (moreCloseTimer) { clearTimeout(moreCloseTimer); moreCloseTimer = null; }
	}

	function scheduleMoreClose() {
		cancelMoreClose();
		moreCloseTimer = setTimeout(closeMoreFlyout, 140);
	}

	function closeMoreFlyout() {
		cancelMoreClose();
		if (moreFlyout) { moreFlyout.remove(); moreFlyout = null; }
		const row = menuEl.querySelector(".qbd-more-row");
		if (row) row.classList.remove("is-open");
	}

	function openMoreFlyout(row) {
		if (moreFlyout) return;
		row.classList.add("is-open");
		const fly = document.body.createDiv({ cls: "qbd-select-menu qbd-more-flyout" });
		moreFlyout = fly;
		fly.setAttribute("role", "menu");
		for (const m of opts.moreModels) appendModelOption(fly, m);

		// Position : à droite du menu (flip à gauche si pas de place). Haut du
		// flyout aligné sur le haut de la ligne (la liste descend depuis la ligne).
		const rowR = row.getBoundingClientRect();
		const menuR = menuEl.getBoundingClientRect();
		fly.style.visibility = "hidden";
		fly.style.top = "0px";
		fly.style.left = "0px";
		const fr = fly.getBoundingClientRect();
		let left = menuR.right + 4;
		if (left + fr.width > window.innerWidth - 8) left = menuR.left - 4 - fr.width;
		left = Math.max(8, left);
		let top = Math.min(Math.max(8, rowR.top), window.innerHeight - fr.height - 8);
		fly.style.left = left + "px";
		fly.style.top = top + "px";
		fly.style.visibility = "";

		fly.addEventListener("mouseenter", cancelMoreClose);
		fly.addEventListener("mouseleave", scheduleMoreClose);
	}

	function closeMenu() {
		closeEffortFlyout();
		closeMoreFlyout();
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e) {
		if (anchorEl.contains(e.target) || menuEl.contains(e.target)
			|| (effortFlyout && effortFlyout.contains(e.target))
			|| (moreFlyout && moreFlyout.contains(e.target))) return;
		closeMenu();
	}

	function onKeyDown(e) {
		if (e.key !== "Escape") return;
		if (effortFlyout) closeEffortFlyout();
		else if (moreFlyout) closeMoreFlyout();
		else closeMenu();
	}

	function onScroll(e) {
		if (menuEl.contains(e.target) || (effortFlyout && effortFlyout.contains(e.target))
			|| (moreFlyout && moreFlyout.contains(e.target))) return;
		closeMenu();
	}

	renderMain();
	reposition();

	openMenus.add(closeMenu);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);

	return { close: closeMenu };
}

const obsidian = require("obsidian");
module.exports = { createSelect, closeAllSelects, openActionMenu, openModelMenu };
