import { ButtonComponent, Setting } from 'obsidian';
import { getCurrentColorScheme } from 'obsidian-extra';

import { Callout } from '&callout';
import {
	CalloutSetting,
	CalloutSettings,
	CalloutSettingsChanges,
	CalloutSettingsColorSchemeCondition,
} from '&callout-settings';
import CalloutManagerPlugin from '&plugin';

import { UIPaneNavigation } from '&ui/pane';
import { CalloutColorSetting } from '&ui/setting/callout-color';
import { CalloutIconSetting } from '&ui/setting/callout-icon';

import { typeofCondition } from '../callout-settings';

/**
 * The appearance section of the edit callout pane.
 */
export class EditCalloutPaneAppearance {
	private readonly plugin: CalloutManagerPlugin;
	private readonly onChangeNotify: (settings: CalloutSettings) => void;
	private readonly getNav: () => UIPaneNavigation;

	private callout: Callout;
	private categorized: CategorizedCalloutSettings;
	private containerEl: HTMLElement;

	private readonly sectionEl: HTMLElement;

	public constructor(
		plugin: CalloutManagerPlugin,
		callout: Callout,
		initial: CalloutSettings,
		getNav: () => UIPaneNavigation,
		onChange: (settings: CalloutSettings) => void,
	) {
		this.plugin = plugin;
		this.getNav = getNav;
		this.callout = callout;
		this.categorized = categorizeSettings(initial);
		this.onChangeNotify = onChange;

		// Create the section container.
		const frag = document.createDocumentFragment();
		const sectionEl = (this.sectionEl = frag.createDiv({
			cls: ['callout-manager-edit-callout-section'],
		}));

		sectionEl.createEl('h2', { text: 'Appearance' });

		// Create the appearance panel.
		this.containerEl = sectionEl.createDiv({ cls: 'callout-manager-edit-callout-section--appearance' });
		this.refresh();
	}

	/**
	 * Attaches the section to a container.
	 * @param containerEl The container element.
	 */
	public attach(containerEl: HTMLElement) {
		containerEl.appendChild(this.sectionEl);
	}

	protected refresh() {
		const { plugin, categorized, callout, containerEl, getNav } = this;
		containerEl.empty();

		CATEGORIES[categorized.type].render(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			{ plugin, containerEl, callout, getNav, cat: categorized as CategorizedCalloutSettings } as any,
			(newCat) => {
				this.categorized = newCat;

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				this.onChangeNotify(CATEGORIES[newCat.type].serialize(newCat as any));
				this.refresh();
			},
		);
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Categorizatiom:
// Try to categorize the settings so we know how to display the UI for changing the appearance.
// ---------------------------------------------------------------------------------------------------------------------

type CategorizedCalloutSettings =
	| { type: 'complex'; settings: CalloutSettings }
	| { type: 'unified'; color: string | undefined; otherChanges: CalloutSettingsChanges }
	| {
			type: 'split';
			colorDark: string | undefined;
			colorLight: string | undefined;
			otherChanges: CalloutSettingsChanges;
	  };

/**
 * Classifies the provided callout settings.
 *
 * Three types of settings are determined:
 *  - `complex`: The settings are using combinators and/or are too complex to represent with a simple UI.
 *  - `unified`: The settings change the color across both dark and light theme.
 *  - `split`: The settings change the color differently for dark and light theme.
 *
 * @param settings The settings to classify.
 * @returns The type of settings that were classified.
 */
function categorizeSettings(settings: CalloutSettings): CategorizedCalloutSettings {
	const COMPLEX: { type: 'complex'; settings: CalloutSettings } = { type: 'complex', settings };

	// Ensure all the conditions are only "appearance".
	const settingsWithColorSchemeCondition: CalloutSettings<CalloutSettingsColorSchemeCondition> = [];
	const settingsWithNoCondition: CalloutSettings<undefined> = [];
	for (const setting of settings) {
		const type = typeofCondition(setting.condition);
		switch (type) {
			case 'and':
			case 'or':
			case 'theme':
				return COMPLEX;

			case 'colorScheme':
				settingsWithColorSchemeCondition.push(setting as CalloutSetting<CalloutSettingsColorSchemeCondition>);
				break;

			case undefined:
				settingsWithNoCondition.push(setting as CalloutSetting<undefined>);
				break;
		}
	}

	// Check to see that the appearance conditions only change the color.
	const appearanceColor = { dark: undefined as undefined | string, light: undefined as undefined | string };
	for (const setting of settingsWithColorSchemeCondition) {
		const changed = Object.keys(setting.changes);
		if (changed.length === 0) {
			continue;
		}

		if (changed.find((key) => key !== 'color') !== undefined) {
			return COMPLEX;
		}

		// Keep track of the changed color.
		const appearanceCond = (setting.condition as CalloutSettingsColorSchemeCondition).colorScheme;
		if (appearanceColor[appearanceCond] === undefined) {
			appearanceColor[appearanceCond] = setting.changes.color;
		} else {
			return COMPLEX;
		}
	}

	// Collect the remaining changes.
	const otherChanges: CalloutSettingsChanges = {};
	for (const [change, value] of settingsWithNoCondition.flatMap((s) => Object.entries(s.changes))) {
		if (value === undefined) continue;
		if (change in otherChanges) {
			return COMPLEX;
		}

		(otherChanges as Record<string, unknown>)[change] = value;
	}

	// If there aren't any dark or light appearance colors, it's a unified color.
	if (appearanceColor.dark === undefined && appearanceColor.light === undefined) {
		if (otherChanges.color === undefined) {
			return { type: 'unified', color: undefined, otherChanges };
		}

		return { type: 'unified', color: otherChanges.color, otherChanges };
	}

	// Split color.
	const colorDark = appearanceColor.dark ?? (appearanceColor.light as string);
	const colorLight = appearanceColor.light ?? (appearanceColor.dark as string);
	return { type: 'split', colorDark, colorLight, otherChanges };
}

// ---------------------------------------------------------------------------------------------------------------------
// Panels:
// These render different settings depending how the callout settings were categorized.
// ---------------------------------------------------------------------------------------------------------------------

type CategorizedCalloutSettingsHandlers = {
	[key in CategorizedCalloutSettings['type']]: {
		render(
			vars: {
				plugin: CalloutManagerPlugin;
				containerEl: HTMLElement;
				callout: Callout;
				cat: Extract<CategorizedCalloutSettings, { type: key }>;
				getNav: () => UIPaneNavigation;
			},
			update: (cat: CategorizedCalloutSettings) => void,
		): void;
		serialize(cat: Extract<CategorizedCalloutSettings, { type: key }>): CalloutSettings;
	};
};

/** */
const CATEGORIES: CategorizedCalloutSettingsHandlers = {
	unified: {
		serialize(cat): CalloutSettings {
			return [
				{
					condition: undefined,
					changes: {
						...cat.otherChanges,
						color: cat.color,
					},
				},
			];
		},
		render({ plugin, containerEl, callout, cat, getNav }, update) {
			const colorScheme = getCurrentColorScheme(plugin.app);
			const otherColorScheme = colorScheme === 'dark' ? 'light' : 'dark';

			new CalloutColorSetting(containerEl, callout)
				.setName('Color')
				.setDesc('Change the color of the callout.')
				.setColorString(cat.color)
				.onChange((color) => update({ ...cat, otherChanges: cat.otherChanges, color }));

			new Setting(containerEl)
				.setName(`Color Scheme`)
				.setDesc(`Change the color of the callout for the ${otherColorScheme} color scheme.`)
				.addButton((btn) =>
					btn
						.setClass('clickable-icon')
						.setIcon('lucide-sun-moon')
						.onClick(() => {
							const color = cat.color ?? callout.color;
							update({
								type: 'split',
								colorDark: color,
								colorLight: color,
								otherChanges: cat.otherChanges,
							});
						}),
				);

			new CalloutIconSetting(containerEl, callout, plugin, getNav)
				.setName('Icon')
				.setDesc('Change the callout icon.')
				.setIcon(cat.otherChanges.icon)
				.onChange((icon) => update({ ...cat, otherChanges: { ...cat.otherChanges, icon } }));
		},
	},

	split: {
		serialize(cat): CalloutSettings {
			return [
				{
					condition: undefined,
					changes: {
						...cat.otherChanges,
					},
				},
				{
					condition: { colorScheme: 'light' },
					changes: {
						color: cat.colorLight,
					},
				},
				{
					condition: { colorScheme: 'dark' },
					changes: {
						color: cat.colorDark,
					},
				},
			];
		},
		render({ containerEl, getNav, callout, cat, plugin }, update) {
			const { colorDark, colorLight } = cat;

			function doUpdate(cat: Extract<CategorizedCalloutSettings, { type: 'split' }>) {
				if (cat.colorDark === undefined && cat.colorLight === undefined) {
					update({ type: 'unified', color: undefined, otherChanges: cat.otherChanges });
					return;
				}

				update(cat);
			}

			new CalloutColorSetting(containerEl, callout)
				.setName('Dark Color')
				.setDesc('Change the color of the callout for the dark color scheme.')
				.setColorString(colorDark)
				.onChange((color) => doUpdate({ ...cat, colorDark: color }));

			new CalloutColorSetting(containerEl, callout)
				.setName(`Light Color`)
				.setDesc(`Change the color of the callout for the light color scheme.`)
				.setColorString(colorLight)
				.onChange((color) => doUpdate({ ...cat, colorLight: color }));

			new CalloutIconSetting(containerEl, callout, plugin, getNav)
				.setName('Icon')
				.setDesc('Change the callout icon.')
				.setIcon(cat.otherChanges.icon)
				.onChange((icon) => doUpdate({ ...cat, otherChanges: { ...cat.otherChanges, icon } }));
		},
	},

	complex: {
		render({ containerEl, cat }, update) {
			const complexJson = JSON.stringify(cat.settings, undefined, '  ');
			containerEl.createEl('p', {
				text:
					"This callout has been configured using the plugin's data.json file. " +
					'To prevent unintentional changes to the configuration, you need to edit it manually.',
			});

			containerEl.createEl('code', { cls: 'callout-manager-edit-callout--complex-json' }, (el) => {
				el.createEl('pre', { text: complexJson });
			});

			containerEl.createEl('p', {
				text: 'Alternatively, you can reset the callout by clicking the button below twice.',
			});

			let resetButtonClicked = false;
			const resetButton = new ButtonComponent(containerEl)
				.setButtonText('Reset Callout')
				.setClass('callout-manager-edit-callout--complex-reset')
				.setWarning()
				.onClick(() => {
					if (!resetButtonClicked) {
						resetButtonClicked = true;
						resetButton.setButtonText('Are you sure?');
						return;
					}

					update({ type: 'unified', color: undefined, otherChanges: {} });
				});
		},

		serialize(cat): void {
			throw new Error('Attempted to serialize complex callout settings. Refusing.');
		},
	},
} as CategorizedCalloutSettingsHandlers;

declare const STYLES: `
	.callout-manager-edit-callout-section--appearance {
		.setting-item {
			border-top: none;
			padding-top: 0.375em;
		}

		.setting-item:has(+ .setting-item) {
			padding-bottom: 0.375em;

			body.is-phone & {
				margin-bottom: 0.7em;
			}
		}

		.setting-item + .setting-item {
		}
	}

	.callout-manager-edit-callout--setting-cleared {
	}

	// The preview showing the complex callout setting JSON.
	.callout-manager-edit-callout--complex-json pre {
		border: rgba(var(--background-modifier-border)) 1px solid;
		border-radius: var(--callout-radius);
		padding: var(--size-4-2);
		background: var(--background-primary-alt);
		overflow-x: auto;

		margin: 0;
	}

	// The reset button.
	.callout-manager-edit-callout--complex-reset {
		width: 100%;
	}
`;
