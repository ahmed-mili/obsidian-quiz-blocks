import type { EN_SETTINGS } from "../en/settings";

/* Réglages du plugin — français. Le type force l'exhaustivité : une clé
   ajoutée à l'anglais et oubliée ici casse `npm run check`. */
export const FR_SETTINGS: Record<keyof typeof EN_SETTINGS, string> = {
	"settings.language.name": "Langue",
	"settings.language.desc": "Langue de l'interface. « Automatique » suit la langue d'Obsidian. Sans effet sur la langue des quiz générés, qui suit toujours celle de votre demande.",
	"settings.language.auto": "Automatique (suivre Obsidian)",
	"settings.language.en": "English",
	"settings.language.fr": "Français",
	"settings.ai.mentionFolders.name": "Dossiers hors du coffre",
	"settings.ai.mentionFolders.desc": "Dossiers que le picker « @ » cherche en plus de votre coffre. Entrée pour ajouter. Ordinateur uniquement.",
	"settings.ai.mentionFolders.remove": "Retirer ce dossier",
	"settings.ai.mentionFolders.invalid": "Ce n'est pas un dossier : {dir}",
	"settings.ai.mentionFolders.placeholder": "Chemin du dossier",
};
