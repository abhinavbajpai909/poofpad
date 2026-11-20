import type { Extension } from "@codemirror/state";

interface LanguageDefinition {
  label: string;
  load: () => Promise<Extension>;
}

/** Each language package is a dynamic import, so it is only downloaded once a pad uses it. */
export const LANGUAGES = {
  plain: { label: "Plain text", load: () => Promise.resolve([]) },
  javascript: {
    label: "JavaScript",
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  },
  typescript: {
    label: "TypeScript",
    load: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  },
  python: {
    label: "Python",
    load: () => import("@codemirror/lang-python").then((m) => m.python()),
  },
  java: { label: "Java", load: () => import("@codemirror/lang-java").then((m) => m.java()) },
  sql: { label: "SQL", load: () => import("@codemirror/lang-sql").then((m) => m.sql()) },
  json: { label: "JSON", load: () => import("@codemirror/lang-json").then((m) => m.json()) },
  html: { label: "HTML", load: () => import("@codemirror/lang-html").then((m) => m.html()) },
  css: { label: "CSS", load: () => import("@codemirror/lang-css").then((m) => m.css()) },
  markdown: {
    label: "Markdown",
    load: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  },
  xml: { label: "XML", load: () => import("@codemirror/lang-xml").then((m) => m.xml()) },
  yaml: { label: "YAML", load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()) },
} as const satisfies Record<string, LanguageDefinition>;

export type LanguageId = keyof typeof LANGUAGES;

export const DEFAULT_LANGUAGE: LanguageId = "plain";

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

/** The shared value comes from other clients, so it is checked before use. */
export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === "string" && Object.hasOwn(LANGUAGES, value);
}

export function loadLanguage(id: LanguageId): Promise<Extension> {
  return LANGUAGES[id].load();
}
