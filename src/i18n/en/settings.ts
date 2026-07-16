/* Réglages du plugin (SettingTab) — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/settings.ts, sinon le
   typecheck échoue (Record<TransKey, string>). */
export const EN_SETTINGS = {
	"settings.language.name": "Language",
	"settings.language.desc": "Interface language. Automatic follows your Obsidian language. This does not affect the language of generated quizzes, which always follows the language of your prompt.",
	"settings.language.auto": "Automatic (follow Obsidian)",
	"settings.language.en": "English",
	"settings.language.fr": "Français",
	"settings.ai.mentionFolders.name": "Folders outside the vault",
	"settings.ai.mentionFolders.desc": "Folders the “@” picker also searches, on top of your vault. Press Enter to add. Desktop only.",
	"settings.ai.mentionFolders.remove": "Remove this folder",
	"settings.ai.mentionFolders.invalid": "Not a folder: {dir}",
} as const;
