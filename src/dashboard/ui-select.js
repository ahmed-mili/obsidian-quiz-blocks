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
		const body = btn.createDiv({ cls: "qbd-action-menu-body" });
		body.createSpan({ cls: "qbd-select-option-label", text: item.label });
		if (item.sub) body.createSpan({ cls: "qbd-action-menu-sub", text: item.sub });
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

const obsidian = require("obsidian");
module.exports = { createSelect, closeAllSelects, openActionMenu };
