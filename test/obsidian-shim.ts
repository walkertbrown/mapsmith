// A tiny stand-in for the `obsidian` module so main.ts can run under jsdom.
// Only what Mapsmith touches is here.

type Opts = { cls?: string; text?: string; type?: string; placeholder?: string; href?: string; value?: string };

function make(this: HTMLElement | void, tag: string, o?: Opts): HTMLElement {
	const el = document.createElement(tag);
	if (o?.cls) el.className = o.cls;
	if (o?.text) el.textContent = o.text;
	if (o?.type) el.setAttribute('type', o.type);
	if (o?.placeholder) el.setAttribute('placeholder', o.placeholder);
	if (o?.href) el.setAttribute('href', o.href);
	if (o?.value !== undefined) (el as HTMLInputElement).value = o.value;
	if (this && this !== (globalThis as unknown)) (this as HTMLElement).appendChild(el);
	return el;
}

export function installDomHelpers() {
	const P = HTMLElement.prototype as unknown as Record<string, unknown>;
	P.createSpan = function (this: HTMLElement, o?: Opts) { return make.call(this, 'span', o); };
	P.createDiv = function (this: HTMLElement, o?: Opts) { return make.call(this, 'div', o); };
	P.createEl = function (this: HTMLElement, tag: string, o?: Opts) { return make.call(this, tag, o); };
	(Node.prototype as unknown as Record<string, unknown>).appendText = function (this: Element, t: string) { this.append(t); };
	P.setText = function (this: HTMLElement, t: string) { this.textContent = t; };
	P.empty = function (this: HTMLElement) { this.replaceChildren(); };
	const E = Element.prototype as unknown as Record<string, unknown>;
	E.addClass = function (this: Element, ...c: string[]) { this.classList.add(...c); };
	E.removeClass = function (this: Element, ...c: string[]) { this.classList.remove(...c); };
	E.hasClass = function (this: Element, c: string) { return this.classList.contains(c); };
	P.hide = function (this: HTMLElement) { this.style.display = 'none'; };
	P.show = function (this: HTMLElement) { this.style.display = ''; };
	E.toggleClass = function (this: Element, c: string, on: boolean) { this.classList.toggle(c, on); };
	P.setAttr = function (this: HTMLElement, k: string, v: string) { this.setAttribute(k, v); };
	P.setCssProps = function (this: HTMLElement, props: Record<string, string>) { for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v); };
	(Element.prototype as unknown as Record<string, unknown>).createSvg = function (
		this: Element,
		tag: string,
		o?: { cls?: string; attr?: Record<string, string | number | boolean | null> },
	) {
		const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
		if (o?.cls) el.setAttribute('class', o.cls);
		for (const [k, v] of Object.entries(o?.attr ?? {})) if (v !== null && v !== false) el.setAttribute(k, String(v));
		this.appendChild(el);
		return el;
	};
	(globalThis as unknown as Record<string, unknown>).createSpan = (o?: Opts) => make.call(undefined, 'span', o);
	(globalThis as unknown as Record<string, unknown>).createDiv = (o?: Opts) => make.call(undefined, 'div', o);
	(globalThis as unknown as Record<string, unknown>).createEl = (tag: string, o?: Opts) => make.call(undefined, tag, o);
}

export class TFile {
	extension: string;
	constructor(public path: string, public basename = path.split('/').pop()!.replace(/\.md$/, '')) {
		this.extension = path.split('.').pop()!;
	}
}
export type TAbstractFile = { path: string };

export interface FakeNote { path: string; content: string; frontmatter?: Record<string, unknown> }

export class App {
	notes = new Map<string, FakeNote>();
	events: { name: string; data: unknown }[] = [];
	opened: string[] = [];
	private find(key: string) {
		return this.notes.get(key) ?? this.notes.get(key + '.md') ?? [...this.notes.values()].find((n) => n.path === key);
	}
	metadataCache = {
		getFirstLinkpathDest: (link: string): TFile | null => {
			const n = this.find(link);
			return n ? new TFile(n.path) : null;
		},
		getFileCache: (f: TFile) => {
			const n = this.find(f.path);
			return n ? { frontmatter: n.frontmatter } : null;
		},
	};
	folders = new Set<string>();
	active: string | null = null;
	private handlers = new Map<string, ((data: never) => void)[]>();
	vaultHandlers = new Map<string, ((f: TAbstractFile, old?: string) => void)[]>();
	leaves: WorkspaceLeaf[] = [];
	views: Record<string, (leaf: WorkspaceLeaf) => ItemView> = {};
	vault = {
		on: (name: string, fn: (f: TAbstractFile, old?: string) => void) => {
			this.vaultHandlers.set(name, [...(this.vaultHandlers.get(name) ?? []), fn]);
			return { name, fn };
		},
		getAbstractFileByPath: (path: string) => (this.find(path) ? new TFile(this.find(path)!.path) : this.folders.has(path) ? { path } : null),
		cachedRead: async (f: TFile) => this.find(f.path)!.content,
		getMarkdownFiles: () => [...this.notes.values()].map((n) => new TFile(n.path)),
		create: async (path: string, content: string) => {
			this.notes.set(path, { path, content });
			return new TFile(path);
		},
		createFolder: async (path: string) => { this.folders.add(path); },
		process: async (f: TFile, fn: (data: string) => string) => {
			const n = this.find(f.path)!;
			n.content = fn(n.content);
			for (const h of this.vaultHandlers.get('modify') ?? []) h(new TFile(n.path));
			return n.content;
		},
	};
	workspace = {
		trigger: (name: string, data: unknown) => {
			this.events.push({ name, data });
			for (const h of this.handlers.get(name) ?? []) h(data as never);
		},
		on: (name: string, fn: (data: never) => void) => {
			this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
			return { name, fn };
		},
		getActiveFile: () => (this.active ? new TFile(this.active) : null),
		getLeaf: () => ({ openFile: async (f: TFile) => { this.active = f.path; this.opened.push(f.path); } }),
		openLinkText: async (link: string) => { this.opened.push(link); },
		getLeavesOfType: (type: string) => this.leaves.filter((l) => l.view?.getViewType() === type),
		getRightLeaf: () => {
			const leaf = new WorkspaceLeaf(this);
			this.leaves.push(leaf);
			return leaf;
		},
		revealLeaf: async (_leaf: WorkspaceLeaf) => {},
	};
}

export class Component {
	load() { (this as { onload?: () => void }).onload?.(); }
	unload() {}
	registerEvent(_ref: unknown) {}
	register(_fn: () => void) {}
}

export class WorkspaceLeaf {
	view: ItemView | null = null;
	constructor(public app: App) {}
	async setViewState(s: { type: string }) {
		this.view = this.app.views[s.type]!(this);
		await this.view.onOpen();
	}
}

export class ItemView extends Component {
	app: App;
	containerEl = document.createElement('div');
	contentEl = document.createElement('div');
	constructor(public leaf: WorkspaceLeaf) {
		super();
		this.app = leaf.app;
		this.containerEl.append(document.createElement('div'), this.contentEl);
	}
	getViewType() { return ''; }
	async onOpen() {}
	async onClose() {}
}
export class MarkdownRenderChild extends Component {
	constructor(public containerEl: HTMLElement) { super(); }
}

export class Plugin extends Component {
	postProcessors: ((el: HTMLElement, ctx: Ctx) => void)[] = [];
	codeBlocks: Record<string, (src: string, el: HTMLElement, ctx: Ctx) => void> = {};
	commands: { id: string; name: string; callback: () => void }[] = [];
	settingTab: unknown;
	data: unknown = null;
	constructor(public app: App, public manifest: unknown) { super(); }
	registerMarkdownPostProcessor(fn: (el: HTMLElement, ctx: Ctx) => void) { this.postProcessors.push(fn); }
	registerMarkdownCodeBlockProcessor(lang: string, fn: (src: string, el: HTMLElement, ctx: Ctx) => void) { this.codeBlocks[lang] = fn; }
	addCommand(c: { id: string; name: string; callback?: () => void }) { this.commands.push(c as never); }
	registerView(type: string, fn: (leaf: WorkspaceLeaf) => ItemView) { this.app.views[type] = fn; }
	intervals: number[] = [];
	registerInterval(id: number) { this.intervals.push(id); return id; }
	onunload() { for (const id of this.intervals) window.clearInterval(id); }
	addSettingTab(t: unknown) { this.settingTab = t; }
	async loadData() { return this.data; }
	async saveData(d: unknown) { this.data = d; }
}

export interface SectionInfo { text: string; lineStart: number; lineEnd: number }
export interface Ctx { sourcePath: string; addChild: (c: Component) => void; getSectionInfo: (el: HTMLElement) => SectionInfo | null }
export function ctx(sourcePath = 'Game.md', info: SectionInfo | null = null): Ctx {
	return { sourcePath, addChild: (c) => c.load(), getSectionInfo: () => info };
}

export class Modal {
	contentEl = document.createElement('div');
	titleEl = document.createElement('div');
	constructor(public app: App) {}
	static last: Modal | null = null;
	open() { Modal.last = this; this.onOpen(); }
	close() { this.onClose(); }
	onOpen() {}
	onClose() {}
	setTitle(t: string) { this.titleEl.textContent = t; }
}

export class PluginSettingTab {
	containerEl = document.createElement('div');
	constructor(public app: App, public plugin: Plugin) {}
}

export class Notice {
	static last = '';
	constructor(msg: string) { Notice.last = msg; }
}

export const MarkdownRenderer = {
	render: async (_app: App, md: string, el: HTMLElement) => {
		el.textContent = md;
	},
};

export function setIcon(el: HTMLElement, name: string) {
	el.setAttribute('data-icon', name);
	// the browser demo draws real icons through this hook
	const hook = (globalThis as unknown as { __iconHook?: (el: HTMLElement, name: string) => void }).__iconHook;
	if (hook) hook(el, name);
}

/** Requests the plugin makes, answered by whatever a test puts in `requestUrl.reply`. */
export interface Req { url: string; method?: string; headers?: Record<string, string>; body?: string; contentType?: string; throw?: boolean }
type Reply = (r: Req) => { status: number; json?: unknown } | Promise<{ status: number; json?: unknown }>;
export const requestUrl = Object.assign(
	async (r: Req) => {
		requestUrl.sent.push(r);
		return requestUrl.reply(r);
	},
	{ sent: [] as Req[], reply: ((_r: Req) => ({ status: 200, json: { ok: true, sold: true } })) as Reply },
);

export type SettingDefinitionItem = unknown;

export const normalizePath = (p: string) => p.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
