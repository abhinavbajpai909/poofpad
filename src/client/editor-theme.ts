import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Extension } from "@codemirror/state";
import { EditorView } from "codemirror";
import { tags } from "@lezer/highlight";

/** Every colour is a CSS variable (styles.css), so switching themes is just a change on <html>. */
const theme = {
  "&": { color: "var(--text)", backgroundColor: "var(--bg)", height: "100%" },
  ".cm-content": { caretColor: "var(--text)", fontFamily: "var(--mono)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--active-line)", color: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--panel)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-text)",
  },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--text)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--active-line)",
    color: "var(--muted)",
    border: "none",
  },
};

export const darkTheme: Extension = EditorView.theme(theme, { dark: true });
export const lightTheme: Extension = EditorView.theme(theme, { dark: false });

export const highlighting: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--syn-keyword)" },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syn-string)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syn-number)" },
    { tag: [tags.comment, tags.docComment], color: "var(--syn-comment)", fontStyle: "italic" },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: "var(--syn-function)",
    },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syn-type)" },
    {
      tag: [tags.variableName, tags.propertyName, tags.attributeName],
      color: "var(--syn-variable)",
    },
    { tag: [tags.tagName, tags.angleBracket], color: "var(--syn-keyword)" },
    { tag: [tags.heading], color: "var(--syn-keyword)", fontWeight: "bold" },
    { tag: [tags.link, tags.url], color: "var(--syn-string)", textDecoration: "underline" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.invalid, color: "var(--danger)" },
  ]),
);
