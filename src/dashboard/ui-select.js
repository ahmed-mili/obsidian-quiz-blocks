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
 *   onChange(value), onOpen?, disabled?, placeholder?
 * }) → { el, setValue, setOptions, setDisabled, refreshMenu }
 * onOpen : appelé à chaque ouverture du menu (rafraîchissements async) ;
 * refreshMenu : redessine les options du menu s'il est ouvert (les données
 * lues par renderOption ont pu changer entre-temps).
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

	/* (Re)construit les options du menu ouvert. Séparé d'openMenu pour que
	   refreshMenu puisse redessiner en place quand un statut async arrive
	   pendant que le menu est ouvert (ex. version d'un CLI re-détectée). */
	function renderMenuOptions() {
		if (!menuEl) return;
		menuEl.empty();
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
	}

	function openMenu() {
		if (disabled || options.length === 0 || !trigger.isConnected) return;
		closeAllSelects();
		if (opts.onOpen) opts.onOpen();

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

		renderMenuOptions();

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
		setDisabled(d) { disabled = !!d; refreshLabel(); },
		refreshMenu: renderMenuOptions
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

/*
 * openEffortSlider(anchorEl, {
 *   variant: "claude" | "codex",
 *   efforts: [{ value, label, accent? }], currentEffort,
 *   onPickEffort(value)
 * })
 * Popover slider d'effort — réplique du contrôle natif de chaque outil :
 * — claude : carte « Effort <Niveau> » + aide (?) au survol, libellés
 *   « Plus rapide / Plus intelligent », piste à points, remplissage violet
 *   étoilé au niveau accent (ultracode) ;
 * — codex : carte « Advanced › » + éclair (tooltip « 1.5x speed / More
 *   usage » au survol, non cliquable), piste à remplissage dégradé bleu
 *   étoilé, violette au niveau accent (ultra), tooltip « Consumes usage
 *   limits faster » au survol de la piste au niveau max/ultra.
 * Le popover reste ouvert pendant l'ajustement (comme les originaux) ;
 * onPickEffort est notifié à chaque niveau retenu (relâchement/clavier).
 */
function openEffortSlider(anchorEl, opts) {
	closeAllSelects();

	const efforts = opts.efforts || [];
	if (!efforts.length) return null;
	const variant = opts.variant === "codex" ? "codex" : "claude";
	const n = efforts.length;
	let idx = Math.max(0, efforts.findIndex(e => e.value === opts.currentEffort));
	let committed = efforts[idx].value;

	const menuEl = document.body.createDiv({
		cls: "qbd-select-menu qbd-effort-pop qbd-effort-pop--" + variant
	});
	menuEl.setAttribute("role", "menu");

	// ── Tooltips au survol (aide, éclair, piste) ──
	// Portalés au <body> ; suivis dans `tips` pour être retirés à la fermeture
	// du popover (l'ancre disparaît sans mouseleave). pointer-events: none →
	// jamais cliquables, conformes à la référence (« juste on le survole »).
	const tips = new Set();
	function attachTip(anchor, build, shouldShow) {
		let tip = null;
		const hide = () => { if (tip) { tip.remove(); tips.delete(tip); tip = null; } };
		anchor.addEventListener("mouseenter", () => {
			if (tip || (shouldShow && !shouldShow())) return;
			tip = document.body.createDiv({ cls: "qbd-hover-tip" });
			tips.add(tip);
			build(tip);
			const r = anchor.getBoundingClientRect();
			tip.style.visibility = "hidden";
			const tr = tip.getBoundingClientRect();
			let left = r.left + r.width / 2 - tr.width / 2;
			left = Math.min(Math.max(8, left), window.innerWidth - tr.width - 8);
			let top = r.top - tr.height - 8;
			if (top < 8) top = r.bottom + 8;
			tip.style.left = left + "px";
			tip.style.top = top + "px";
			tip.style.visibility = "";
		});
		anchor.addEventListener("mouseleave", hide);
		return hide;
	}

	// ── En-tête + échelle (claude uniquement — codex a sa propre rangée
	// d'en-tête réduite à l'éclair Fast, sans titre « Advanced ») ──
	let valueEl = null;
	if (variant === "claude") {
		const head = menuEl.createDiv({ cls: "qbd-effort-pop-head" });
		const title = head.createSpan({ cls: "qbd-effort-pop-title" });
		title.createSpan({ text: "Effort" }); // gap 5px via CSS (handoff)
		valueEl = title.createSpan({ cls: "qbd-effort-pop-value" });
		// Aide « ? » : cercle custom du handoff (15×15, bordure #56565c),
		// PAS une icône Lucide — imposé par la référence validée.
		const help = head.createSpan({ cls: "qbd-effort-pop-icon qbd-effort-pop-help" });
		help.setAttribute("aria-hidden", "true");
		help.setText("?");
		attachTip(help, (tip) => {
			tip.addClass("qbd-hover-tip--card");
			tip.createDiv({ cls: "qbd-hover-tip-title", text: "Effort" });
			tip.createDiv({
				cls: "qbd-hover-tip-body",
				text: "Un effort plus élevé génère des réponses plus complètes, mais prend plus de temps et utilise vos limites plus rapidement."
			});
		});
		const scale = menuEl.createDiv({ cls: "qbd-effort-pop-scale" });
		scale.createSpan({ text: "Plus rapide" });
		scale.createSpan({ text: "Plus intelligent" });
	}

	// ── Slider discret (codex : l'éclair Fast vit dans une rangée
	// d'en-tête AU-DESSUS, aligné à droite — référence 2026-07-10 —,
	// le slider occupe seul sa ligne, pleine largeur) ──
	const zapRow = (variant === "codex" && opts.fast)
		? menuEl.createDiv({ cls: "qbd-effort-pop-zaprow" })
		: null;
	const slider = menuEl.createDiv({ cls: "qbd-effort-slider" });
	slider.tabIndex = 0;
	slider.setAttribute("role", "slider");
	slider.setAttribute("aria-label", "Effort");
	slider.setAttribute("aria-valuemin", "0");
	slider.setAttribute("aria-valuemax", String(n - 1));
	const track = slider.createDiv({ cls: "qbd-effort-track" });
	const fill = track.createDiv({ cls: "qbd-effort-fill" });
	// Overlay violet (codex) : opacité pilotée par --qbd-p → le fill vire
	// progressivement du bleu au violet, comme la source ChatGPT.
	if (variant === "codex") fill.createDiv({ cls: "qbd-effort-fill-ultra" });
	const rail = track.createDiv({ cls: "qbd-effort-rail" });
	const dots = [];
	for (let i = 0; i < n; i++) {
		// Le point du niveau accent (ultracode) est TOUJOURS violet dans la
		// carte Claude Code (notchUltracode), même au repos.
		const dot = rail.createDiv({
			cls: "qbd-effort-dot" + (efforts[i].accent ? " qbd-effort-dot--ultra" : "")
		});
		dot.style.left = (n > 1 ? (i / (n - 1)) * 100 : 0) + "%";
		dots.push(dot);
	}
	// Pouce claude : dans la PISTE (pas le rail) — piloté en transform par
	// effort-canvas.js (formule du handoff : 1 + v·(W−thumbW−2)) ; codex :
	// rail + left % (inchangé).
	const thumb = (variant === "claude" ? track : rail).createDiv({ cls: "qbd-effort-thumb" });
	// Piste claude : mosaïque de pixels animés en canvas (handoff validé
	// « design_handoff_effort_slider ») — visible au niveau ultracode.
	const trackFx = variant === "claude"
		? createEffortTrackFx(track, thumb, {
			accent: "#a78bfa", // accent validé du handoff
			speed: 0.3,        // vitesse validée
			value: n > 1 ? idx / (n - 1) : 1
		})
		: null;

	// ── Éclair Fast (codex) : VRAI toggle du service tier « priority »
	// (1.5x speed, more usage), persisté via opts.fast.onToggle. Le tooltip
	// reste au survol ; absent si le modèle n'expose pas le tier Fast. ──
	let stopDrift = null;
	if (zapRow) {
		const zap = zapRow.createEl("button", { cls: "qbd-effort-fast qbd-effort-pop-zap" });
		zap.type = "button";
		zap.setAttribute("aria-label", "Fast (1.5x speed)");
		obsidian.setIcon(zap, "zap");
		// Drift des étoiles Fast piloté en rAF via --qbd-drift : des keyframes
		// CSS ne savent ni décélérer ni accélérer. Ici la VITESSE tend vers sa
		// cible par lissage exponentiel (~0.45s) pendant que l'opacité fond en
		// CSS (.3s) → les points ralentissent et s'effacent ENSEMBLE, et
		// repartent en fondu déjà en mouvement. La couche ::after suit à
		// 0.65x via calc() (parallaxe préservée).
		const DRIFT_SPEED = 86;  // px/s — 2x la version keyframes (56px/1.3s)
		const DRIFT_TAU = 0.15;  // s — ~95 % de l'arrêt/du départ en 0.45s
		const DRIFT_WRAP = 1120; // 20 tuiles de 56px ; 0.65x retombe sur 728
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let driftX = 0;
		let driftV = opts.fast.on ? DRIFT_SPEED : 0; // ouverture : déjà en croisière
		let driftRaf = 0;
		let driftLast = 0;
		const driftStep = (ts) => {
			const dt = Math.min(0.05, Math.max(0, (ts - driftLast) / 1000));
			driftLast = ts;
			const target = opts.fast.on ? DRIFT_SPEED : 0;
			driftV += (target - driftV) * (1 - Math.exp(-dt / DRIFT_TAU));
			driftX = (driftX - driftV * dt) % DRIFT_WRAP;
			fill.style.setProperty("--qbd-drift", driftX.toFixed(2) + "px");
			if (!target && driftV < 0.5) { driftRaf = 0; return; } // arrêté → veille
			driftRaf = requestAnimationFrame(driftStep);
		};
		const driftWake = () => {
			// Boucle déjà active : elle lit la nouvelle cible toute seule.
			if (reduceMotion || driftRaf) return;
			driftLast = performance.now();
			driftRaf = requestAnimationFrame(driftStep);
		};
		stopDrift = () => cancelAnimationFrame(driftRaf);
		const refreshZap = () => {
			zap.classList.toggle("is-on", !!opts.fast.on);
			zap.setAttribute("aria-pressed", opts.fast.on ? "true" : "false");
			// Fast ON → étoiles animées sur le fill bleu (référence ChatGPT).
			menuEl.classList.toggle("is-fast", !!opts.fast.on);
		};
		refreshZap();
		if (opts.fast.on) driftWake();
		zap.addEventListener("click", () => {
			opts.fast.on = !opts.fast.on;
			refreshZap();
			driftWake();
			if (opts.fast.onToggle) opts.fast.onToggle(opts.fast.on);
		});
		attachTip(zap, (tip) => {
			tip.createDiv({ cls: "qbd-hover-tip-title", text: "1.5x speed" });
			tip.createDiv({ cls: "qbd-hover-tip-body", text: "More usage" });
		});
	}

	// Aux niveaux qui consomment le plus (max/ultra), Codex prévient au survol
	// de la piste (référence : tooltip au-dessus du slider en état ultra).
	if (variant === "codex") {
		attachTip(slider, (tip) => {
			tip.createDiv({ cls: "qbd-hover-tip-title", text: "Consumes usage limits faster" });
		}, () => idx >= n - 1 || ["max", "ultra"].includes(efforts[idx].value));
	}

	const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

	// En-tête de la carte Claude Code : niveaux en ANGLAIS (demande
	// explicite). Un niveau inconnu retombe sur son label capitalisé.
	const CLAUDE_EFFORT_EN = {
		low: "Low", medium: "Medium", high: "High",
		xhigh: "Extra", max: "Max", ultracode: "Ultracode"
	};

	// Transition « ticker » du niveau : l'ancien texte glisse vers le HAUT
	// en fondant, le nouveau monte depuis le BAS. Le sortant passe en
	// absolute pour ne pas fausser la largeur ; nettoyage par animationend
	// + minuterie de secours (reduced-motion ne déclenche pas animationend).
	function rollValue(label) {
		const cur = valueEl.querySelector(".qbd-effort-pop-value-text:not(.is-out)");
		if (cur && cur.textContent === label) return;
		if (cur) {
			// Changements rapides : un seul sortant à la fois (les précédents
			// sont purgés) → une tache floue douce, pas un empilement lisible.
			valueEl.querySelectorAll(".qbd-effort-pop-value-text.is-out").forEach(e => e.remove());
			cur.classList.remove("is-in");
			cur.classList.add("is-out");
			const drop = () => cur.remove();
			cur.addEventListener("animationend", drop, { once: true });
			setTimeout(drop, 350);
			const next = valueEl.createSpan({ cls: "qbd-effort-pop-value-text is-in", text: label });
			next.addEventListener("animationend", () => next.classList.remove("is-in"), { once: true });
		} else {
			valueEl.createSpan({ cls: "qbd-effort-pop-value-text", text: label });
		}
	}

	// Squish du pouce à chaque changement de niveau (source ChatGPT :
	// scale [1,.93,1,1], times [0,.1309,.6354,1], .3s linear) — la classe
	// est retirée puis reposée pour rejouer l'animation CSS.
	let lastIdx = null;
	function squishThumb() {
		thumb.classList.remove("is-squish");
		void thumb.offsetWidth; // reflow → l'animation peut se rejouer
		thumb.classList.add("is-squish");
	}

	function update() {
		const ef = efforts[idx];
		// Squish : signature ChatGPT (codex) uniquement — le handoff claude
		// n'en a pas, et son pouce est piloté en transform (conflit).
		if (variant === "codex" && lastIdx !== null && idx !== lastIdx) squishThumb();
		const animate = lastIdx !== null; // 1er rendu : pouce posé sans tween
		lastIdx = idx;
		slider.style.setProperty("--qbd-p", String(n > 1 ? idx / (n - 1) : 1));
		slider.setAttribute("aria-valuenow", String(idx));
		slider.setAttribute("aria-valuetext", ef.label);
		// Rungs de la zone remplie (source ChatGPT : blancs/30 si i <= idx,
		// les « étoiles » de la référence).
		dots.forEach((d, i) => d.classList.toggle("is-filled", i <= idx));
		// Niveau accent (ultracode / ultra) → état violet.
		menuEl.classList.toggle("is-ultra", !!ef.accent);
		if (trackFx) {
			trackFx.setValue(n > 1 ? idx / (n - 1) : 1, animate);
			// (Ré)entrer en ultracode rejoue le chargement droite→gauche.
			trackFx.setUltra(!!ef.accent);
		}
		if (valueEl) {
			rollValue(CLAUDE_EFFORT_EN[ef.value] || capitalize(ef.label));
			valueEl.classList.toggle("is-ultra", !!ef.accent);
		}
	}

	function commit() {
		const v = efforts[idx].value;
		if (v === committed) return;
		committed = v;
		opts.currentEffort = v;
		if (opts.onPickEffort) opts.onPickEffort(v);
	}

	function idxFromPointer(e) {
		const r = rail.getBoundingClientRect();
		const p = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
		return Math.round(p * (n - 1));
	}

	let dragging = false;
	slider.addEventListener("pointerdown", (e) => {
		e.preventDefault();
		slider.focus();
		// capture best-effort : un pointerId déjà relâché (stylet, synthèse)
		// jette InvalidPointerId — le drag suit alors les pointermove simples.
		try { slider.setPointerCapture(e.pointerId); } catch (err) { /* best effort */ }
		dragging = true;
		slider.classList.add("is-dragging"); // press : scale(.94) du pouce (codex)
		idx = idxFromPointer(e);
		update();
	});
	slider.addEventListener("pointermove", (e) => {
		if (!dragging) return;
		const next = idxFromPointer(e);
		if (next !== idx) { idx = next; update(); }
	});
	slider.addEventListener("pointerup", (e) => {
		if (!dragging) return;
		dragging = false;
		slider.classList.remove("is-dragging");
		try { slider.releasePointerCapture(e.pointerId); } catch (err) { /* best effort */ }
		commit();
	});
	slider.addEventListener("pointercancel", () => { dragging = false; slider.classList.remove("is-dragging"); });
	slider.addEventListener("keydown", (e) => {
		let next = idx;
		if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(n - 1, idx + 1);
		else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, idx - 1);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = n - 1;
		else return;
		e.preventDefault();
		if (next !== idx) { idx = next; update(); commit(); }
	});

	update();

	// ── Position (au-dessus de l'ancre si le bas manque de place) ──
	const rect = anchorEl.getBoundingClientRect();
	menuEl.style.visibility = "hidden";
	menuEl.style.top = "0px";
	menuEl.style.left = "0px";
	const mr = menuEl.getBoundingClientRect();
	let left = Math.min(Math.max(8, rect.left), window.innerWidth - mr.width - 8);
	const below = rect.bottom + 4;
	const top = (below + mr.height <= window.innerHeight - 8 || rect.top - 4 - mr.height < 8)
		? below : rect.top - 4 - mr.height;
	menuEl.style.left = left + "px";
	menuEl.style.top = top + "px";
	menuEl.style.visibility = "";

	function closeMenu() {
		if (trackFx) trackFx.destroy(); // stoppe la boucle rAF du canvas
		if (stopDrift) stopDrift();     // stoppe la boucle rAF du drift Fast
		for (const t of tips) t.remove();
		tips.clear();
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
	setTimeout(() => slider.focus(), 0);

	return { close: closeMenu };
}

/*
 * openOptionsMenu(anchorEl, {
 *   count, minCount, maxCount,   // slider Questions
 *   type, types: string[],       // choix du Type
 *   onCount(n), onType(t)
 * })
 * Popover des options de génération (remplace la carte « Options » du
 * formulaire). Reste ouvert pendant les réglages — fermeture clic-dehors,
 * Esc, scroll. Le Type est une liste à coche directe, PAS un dropdown
 * imbriqué : l'ouverture d'un createSelect appelle closeAllSelects(),
 * qui fermerait ce popover.
 */
function openOptionsMenu(anchorEl, opts) {
	closeAllSelects();

	const menuEl = document.body.createDiv({ cls: "qbd-select-menu qbd-options-pop" });
	menuEl.setAttribute("role", "menu");

	// ── Questions : DROPDOWN à presets + « Personnalisé » (référence
	// sélecteur de durée d'Ahmed, 2026-07-11) — Personnalisé révèle un
	// champ nombre à côté (« Custom | 5 m : 00 s »). Dropdown LOCAL au
	// popover : createSelect appellerait closeAllSelects() et fermerait
	// le popover parent. ──
	const PRESETS = [5, 10, 15, 20, 30];
	let count = Math.min(100, Math.max(1, Math.round(Number(opts.count) || 5)));
	let isCustom = !PRESETS.includes(count);

	menuEl.createDiv({ cls: "qbd-options-pop-title", text: "Questions" });
	const countRow = menuEl.createDiv({ cls: "qbd-options-pop-row" });
	const ddWrap = countRow.createDiv({ cls: "qbd-opts-dd-wrap" });
	const trigger = ddWrap.createEl("button", { cls: "qbd-opts-dd" });
	trigger.type = "button";
	const trigLabel = trigger.createSpan({ cls: "qbd-opts-dd-label" });
	const trigChev = trigger.createSpan({ cls: "qbd-select-chevron" });
	obsidian.setIcon(trigChev, "chevron-down");
	const ddMenu = ddWrap.createDiv({ cls: "qbd-opts-dd-menu is-hidden" });
	const field = countRow.createEl("input", {
		type: "number", cls: "qbd-opts-count",
		attr: { min: "1", max: "100", inputmode: "numeric" }
	});

	const commitCount = (n) => {
		count = Math.min(100, Math.max(1, Math.round(Number(n) || count)));
		field.value = String(count);
		if (opts.onCount) opts.onCount(count);
	};

	const refreshCountUI = () => {
		trigLabel.setText(isCustom ? "Personnalisé" : count + " questions");
		field.classList.toggle("is-hidden", !isCustom);
		trigger.setAttribute("aria-expanded", ddMenu.classList.contains("is-hidden") ? "false" : "true");
		for (const b of ddMenu.querySelectorAll(".qbd-opts-dd-item")) {
			const active = b.dataset.preset === "custom"
				? isCustom
				: (!isCustom && Number(b.dataset.preset) === count);
			b.classList.toggle("is-active", active);
			const check = b.querySelector(".qbd-select-check");
			check.empty();
			if (active) obsidian.setIcon(check, "check");
		}
	};

	const closeDd = () => { ddMenu.classList.add("is-hidden"); refreshCountUI(); };

	for (const p of [...PRESETS.map(String), "custom"]) {
		const item = ddMenu.createEl("button", { cls: "qbd-opts-dd-item" });
		item.type = "button";
		item.dataset.preset = p;
		item.createSpan({ cls: "qbd-select-check" });
		item.createSpan({ text: p === "custom" ? "Personnalisé" : p + " questions" });
		item.addEventListener("click", () => {
			if (p === "custom") {
				isCustom = true;
				closeDd();
				field.focus();
			} else {
				isCustom = false;
				commitCount(Number(p));
				closeDd();
			}
		});
	}

	trigger.addEventListener("click", () => {
		ddMenu.classList.toggle("is-hidden");
		refreshCountUI();
	});

	// Champ nombre : sélection au focus, commit Enter/blur, Échap annule.
	field.addEventListener("focus", () => field.select());
	field.addEventListener("change", () => commitCount(field.value));
	field.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			commitCount(field.value);
			field.blur();
		} else if (e.key === "Escape") {
			e.stopPropagation();
			field.value = String(count);
			field.blur();
		}
	});

	commitCount(count);
	refreshCountUI();

	// ── Type : items à coche (même anatomie que les options de select) ──
	menuEl.createDiv({ cls: "qbd-options-pop-title", text: "Type" });
	const items = [];
	let current = opts.type;
	function refreshItems() {
		for (const it of items) {
			const active = it.t === current;
			it.btn.classList.toggle("is-active", active);
			it.btn.setAttribute("aria-checked", active ? "true" : "false");
			it.check.empty();
			if (active) obsidian.setIcon(it.check, "check");
		}
	}
	for (const t of opts.types) {
		const btn = menuEl.createEl("button", { cls: "qbd-select-option" });
		btn.type = "button";
		btn.setAttribute("role", "menuitemradio");
		const check = btn.createSpan({ cls: "qbd-select-check" });
		btn.createSpan({ cls: "qbd-select-option-label", text: t });
		btn.addEventListener("click", () => {
			current = t;
			refreshItems();
			if (opts.onType) opts.onType(t);
		});
		items.push({ t, btn, check });
	}
	refreshItems();

	// ── Position (pattern openEffortSlider : sous l'ancre, sinon dessus) ──
	const rect = anchorEl.getBoundingClientRect();
	menuEl.style.visibility = "hidden";
	menuEl.style.top = "0px";
	menuEl.style.left = "0px";
	const mr = menuEl.getBoundingClientRect();
	const left = Math.min(Math.max(8, rect.left), window.innerWidth - mr.width - 8);
	const below = rect.bottom + 4;
	const top = (below + mr.height <= window.innerHeight - 8 || rect.top - 4 - mr.height < 8)
		? below : rect.top - 4 - mr.height;
	menuEl.style.left = left + "px";
	menuEl.style.top = top + "px";
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
 * openNotePicker(anchorEl, {
 *   openFiles: TFile[],   // notes actuellement ouvertes (ordre des onglets)
 *   allFiles: TFile[],    // toutes les notes du vault (pour la recherche)
 *   onPick(file)
 * })
 * Sélecteur de note (« Insérer dans une note ») : les notes OUVERTES en
 * tête, et une recherche qui fouille tout le vault en dessous.
 */
function openNotePicker(anchorEl, opts) {
	closeAllSelects();

	const menuEl = document.body.createDiv({
		cls: "qbd-select-menu qbd-model-menu qbd-model-menu--searchable qbd-note-picker"
	});
	menuEl.setAttribute("role", "listbox");

	const searchWrap = menuEl.createDiv({ cls: "qbd-model-menu-search" });
	const input = searchWrap.createEl("input", {
		cls: "qbd-model-menu-search-input",
		attr: { type: "text", placeholder: "Rechercher une note…", spellcheck: "false" }
	});
	const listEl = menuEl.createDiv({ cls: "qbd-model-menu-list" });

	function addFile(file) {
		const b = listEl.createEl("button", { cls: "qbd-select-option qbd-note-picker-item" });
		b.type = "button";
		b.setAttribute("role", "option");
		const ic = b.createSpan({ cls: "qbd-action-menu-icon" });
		obsidian.setIcon(ic, "file-text");
		const body = b.createDiv({ cls: "qbd-action-menu-body" });
		body.createSpan({ cls: "qbd-select-option-label", text: file.basename });
		const folder = file.parent && file.parent.path && file.parent.path !== "/" ? file.parent.path : "";
		if (folder) body.createSpan({ cls: "qbd-action-menu-sub", text: folder });
		b.addEventListener("click", () => {
			closeMenu();
			if (opts.onPick) opts.onPick(file);
		});
	}

	function paint(query) {
		listEl.empty();
		const f = (query || "").trim().toLowerCase();
		const match = (file) => !f
			|| file.basename.toLowerCase().includes(f)
			|| file.path.toLowerCase().includes(f);
		const open = (opts.openFiles || []).filter(match);
		// La recherche fouille TOUT le vault ; sans requête, seules les
		// notes ouvertes sont proposées (référence : « uniquement celles
		// ouvertes, et on peut surtout chercher »).
		let rest = [];
		if (f) {
			const openPaths = new Set(open.map(x => x.path));
			rest = (opts.allFiles || []).filter(x => !openPaths.has(x.path) && match(x)).slice(0, 30);
		}
		if (open.length) {
			listEl.createDiv({ cls: "qbd-note-picker-section", text: "Notes ouvertes" });
			open.forEach(addFile);
		}
		if (rest.length) {
			listEl.createDiv({ cls: "qbd-note-picker-section", text: "Toutes les notes" });
			rest.forEach(addFile);
		}
		if (!open.length && !rest.length) {
			listEl.createDiv({
				cls: "qbd-model-menu-empty",
				text: f ? "Aucune note trouvée" : "Aucune note ouverte — tapez pour chercher"
			});
		}
	}

	paint("");
	input.addEventListener("input", () => paint(input.value));
	input.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			if (input.value) { input.value = ""; paint(""); }
			else closeMenu();
		}
	});
	setTimeout(() => input.focus(), 0);

	// ── Position (au-dessus de l'ancre si le bas manque de place) ──
	const rect = anchorEl.getBoundingClientRect();
	menuEl.style.visibility = "hidden";
	menuEl.style.top = "0px";
	menuEl.style.left = "0px";
	const mr = menuEl.getBoundingClientRect();
	const left = Math.min(Math.max(8, rect.left), window.innerWidth - mr.width - 8);
	const below = rect.bottom + 4;
	const top = (below + mr.height <= window.innerHeight - 8 || rect.top - 4 - mr.height < 8)
		? below : rect.top - 4 - mr.height;
	menuEl.style.left = left + "px";
	menuEl.style.top = top + "px";
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

const obsidian = require("obsidian");
const { createEffortTrackFx } = require("./effort-canvas");
module.exports = { createSelect, closeAllSelects, openActionMenu, openModelMenu, openEffortSlider, openOptionsMenu, openNotePicker };
