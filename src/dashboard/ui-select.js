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
		labelEl.textContent = cur ? cur.label : (value || placeholder);
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
		const spaceBelow = window.innerHeight - rect.bottom - 16;
		const maxH = Math.max(Math.min(spaceBelow, 320), 140);
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
			optBtn.createSpan({ cls: "qbd-select-option-label", text: o.label });
			if (o.hint) optBtn.createSpan({ cls: "qbd-select-option-hint", text: o.hint });
			optBtn.addEventListener("click", () => {
				const changed = o.value !== value;
				value = o.value;
				refreshLabel();
				closeMenu();
				if (changed && opts.onChange) opts.onChange(o.value);
			});
		}

		// Si le menu déborde à droite du viewport, le rabattre
		const menuRect = menuEl.getBoundingClientRect();
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

const obsidian = require("obsidian");
module.exports = { createSelect, closeAllSelects };
