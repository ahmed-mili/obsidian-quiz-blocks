import { setIcon } from "obsidian";
import type { DashboardCtx, DashboardViewName } from "../types/dashboard-ctx";

/* ══════════════════════════════════════════════════════════
   NAVIGATION SIDEBAR — Dashboard
   Sidebar avec brand et nav items stylisés.
══════════════════════════════════════════════════════════ */

interface NavItem {
	key: Exclude<DashboardViewName, "detail">;
	label: string;
	icon: string;
}

export interface NavHandlers {
	render(container: HTMLElement): void;
	setActive(key: DashboardViewName): void;
}

export function createNavHandlers(ctx: DashboardCtx): NavHandlers {
	let activeNav: DashboardViewName = "home";

	const NAV_ITEMS: NavItem[] = [
		{ key: "home", label: "Accueil", icon: "home" },
		{ key: "quizzes", label: "Mes quiz", icon: "layers" },
		{ key: "ai", label: "Générer", icon: "sparkles" }
	];

	function render(container: HTMLElement): void {
		container.empty();

		// Brand header
		const brand = container.createDiv({ cls: "qbd-nav-brand" });
		const brandRow = brand.createDiv({ cls: "qbd-nav-brand-row" });
		const brandIcon = brandRow.createSpan({ cls: "qbd-nav-brand-icon" });
		setIcon(brandIcon, "graduation-cap");
		brandRow.createEl("span", { cls: "qbd-nav-brand-title", text: "Quiz Blocks" });

		// Separator
		container.createDiv({ cls: "qbd-nav-sep" });

		// Nav items
		const navList = container.createDiv({ cls: "qbd-nav-items" });
		const quizzes = ctx.scanner ? ctx.scanner.getQuizzes() : [];

		for (const item of NAV_ITEMS) {
			const btn = navList.createEl("button", {
				cls: `qbd-nav-item ${activeNav === item.key ? "qbd-nav-item--active" : ""}`
			});

			const iconWrap = btn.createSpan({ cls: "qbd-nav-icon" });
			setIcon(iconWrap, item.icon);

			btn.createSpan({ cls: "qbd-nav-label", text: item.label });

			if (item.key === "quizzes" && quizzes.length > 0) {
				btn.createSpan({ cls: "qbd-nav-badge", text: String(quizzes.length) });
			}

			btn.addEventListener("click", () => {
				activeNav = item.key;
				ctx.navigate(item.key);
			});
		}

	}

	function setActive(key: DashboardViewName): void {
		activeNav = key;
	}

	return { render, setActive };
}
