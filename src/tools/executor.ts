import { App, TFile, getFrontMatterInfo, normalizePath } from "obsidian";
import type { SelectionScope, ToolResult } from "../types";

/** Images the read tools refuse (SVG is text, so they read it). */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif", "ico"];

/**
 * Files the read tools refuse because their text would be useless to the
 * model. Best effort by extension: an unlisted binary file is still read.
 */
const BINARY_EXTENSIONS = [
  "pdf", "epub", "zip", "gz", "tar", "7z", "rar", "jar", "iso", "dmg", "exe", "dll", "so", "dylib", "bin",
  "mp3", "wav", "m4a", "ogg", "flac", "aac", "opus",
  "webm", "mp4", "m4v", "mov", "mkv", "avi", "ogv", "3gp", "mpeg", "mpg",
  "woff", "woff2", "ttf", "otf", "eot", "psd", "raw",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "sqlite", "db",
];

type AskUserCallback = (question: string) => Promise<string>;

/**
 * Executes a tool call against the Obsidian Vault API.
 * Uses docs-recommended patterns:
 * - getFileByPath() for direct file lookups
 * - cachedRead() for display-only reads
 * - vault.process() for atomic edits
 * - fileManager.renameFile() for link-aware renames
 * - fileManager.trashFile() for safe deletes
 */
export async function executeTool(
  app: App,
  toolName: string,
  input: Record<string, unknown>,
  onAskUser: AskUserCallback,
  scope?: SelectionScope
): Promise<ToolResult> {
  if (Object.prototype.hasOwnProperty.call(input, "_raw")) {
    return { result: "Invalid tool arguments: provide a valid JSON object and retry.", isError: true };
  }
  try {
    const outOfScope = scope && scopeGuard(app, toolName, input, scope);
    if (outOfScope) return outOfScope;
    switch (toolName) {
      case "read_document":
        return await readDocument(app, input);
      case "edit_document":
        return await editDocument(app, input, scope);
      case "search_vault":
        return await searchVault(app, input);
      case "read_file":
        return await readFile(app, input);
      case "create_file":
        return await createFile(app, input);
      case "list_files":
        return await listFiles(app, input);
      case "rename_file":
        return await renameFile(app, input);
      case "delete_file":
        return await deleteFile(app, input);
      case "get_properties":
        return await getProperties(app, input);
      case "set_properties":
        return await setProperties(app, input);
      case "get_backlinks":
        return await getBacklinks(app, input);
      case "get_current_datetime":
        return getCurrentDatetime();
      case "open_document":
        return await openDocument(app, input);
      case "ask_user":
        return await askUser(input, onAskUser);
      default:
        return { result: `Unknown tool: ${toolName}`, isError: true };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: `Tool error: ${msg}`, isError: true };
  }
}

// ─── Selection scope ────────────────────────────────────────────────────────
// A turn sent with a selection may change only the selected text of that
// note (the instruction in the user message alone isn't always followed).
// edit_document's find_replace works inside the selection; the other ways
// to change that note are refused. Other notes stay editable.

const scopeRefusal = (path: string): ToolResult => ({
  result: `Not changed: the user selected text in ${path}, and only that selection may change. Use edit_document with operation find_replace and text from within the selection.`,
  isError: true,
});

/** Refuses tools other than edit_document that would change the scoped note. */
function scopeGuard(
  app: App,
  toolName: string,
  input: Record<string, unknown>,
  scope: SelectionScope
): ToolResult | null {
  if (toolName === "rename_file" || toolName === "delete_file") {
    // The note itself, or a folder it is in (the vault root included).
    const given = optionalString(input.path);
    const path = given === undefined ? undefined : normalizePath(given).replace(/\/+$/, "");
    const touches = path !== undefined && (path === scope.filePath || path === "" || scope.filePath.startsWith(`${path}/`));
    return touches ? scopeRefusal(scope.filePath) : null;
  }
  if (toolName === "set_properties" && resolveFile(app, optionalString(input.path))?.path === scope.filePath) {
    return scopeRefusal(scope.filePath);
  }
  return null;
}

/** How many copies of `text` start before `end` in `data` (not overlapping). */
export function copiesBefore(data: string, text: string, end: number): number {
  let count = 0;
  for (let at = data.indexOf(text); at !== -1 && at < end; at = data.indexOf(text, at + text.length)) count++;
  return count;
}

/**
 * Where the selected text is in the note now: at its offset; else, if text
 * typed elsewhere moved it, the same copy counted from the top; else the
 * copy nearest to the offset; -1 if gone.
 */
function selectionStart(data: string, text: string, from?: number, occurrence?: number): number {
  if (from !== undefined && data.startsWith(text, from)) return from;
  // Text typed above the selection moves it: the same copy, counted from the top.
  if (occurrence !== undefined) {
    let at = data.indexOf(text);
    for (let i = 0; i < occurrence && at !== -1; i++) at = data.indexOf(text, at + text.length);
    if (at !== -1) return at;
  }
  if (from === undefined) return data.indexOf(text);
  const after = data.indexOf(text, from);
  const before = data.lastIndexOf(text, from);
  if (before === -1 || after === -1) return Math.max(before, after);
  return from - before <= after - from ? before : after;
}

/** The position in `data` of an editor offset (the editor counts \r\n as one character). */
function crlfOffset(data: string, offset: number): number {
  let at = 0;
  for (let i = 0; i < offset && at < data.length; i++) at += data.startsWith("\r\n", at) ? 2 : 1;
  return at;
}

/**
 * find_replace inside the selection: `find` is looked up in the selected
 * text (not the first match in the note), and the scope then holds the
 * changed text, so later edits in the turn stay inside it too.
 */
async function editInScope(
  app: App,
  file: TFile,
  scope: SelectionScope,
  find: string,
  content: string
): Promise<ToolResult> {
  // Set in the callback; the cast keeps TypeScript from narrowing it to "done".
  let outcome = "done" as "done" | "outside" | "lost";
  let multiple = false;
  await app.vault.process(file, (data) => {
    // The editor's selection and offset use \n line breaks; a note saved
    // with \r\n is matched and written with \r\n.
    const crlf = data.includes("\r\n");
    const inNote = (text: string) => (crlf ? text.replace(/\r?\n/g, "\r\n") : text);
    const selected = inNote(scope.text);
    const from = crlf && scope.from !== undefined ? crlfOffset(data, scope.from) : scope.from;
    const start = selectionStart(data, selected, from, scope.occurrence);
    const at = scope.text.indexOf(find);
    if (start === -1 || at === -1) {
      outcome = start === -1 ? "lost" : "outside";
      return data;
    }
    multiple = scope.text.indexOf(find, at + 1) !== -1;
    scope.text = scope.text.slice(0, at) + content + scope.text.slice(at + find.length);
    scope.from = crlf ? data.slice(0, start).replace(/\r\n/g, "\n").length : start;
    const changed = data.slice(0, start) + inNote(scope.text) + data.slice(start + selected.length);
    scope.occurrence = copiesBefore(changed, inNote(scope.text), start);
    return changed;
  });
  if (outcome === "lost") {
    return {
      result: `Not changed: the selected text is no longer in ${file.path} as it was selected. Tell the user; they can select it again and resend.`,
      isError: true,
    };
  }
  if (outcome === "outside") {
    return {
      result: `Not changed: 'find' must be text from within the user's selection in ${file.path}; nothing outside it may change.`,
      isError: true,
    };
  }
  const note = multiple ? "[Note: Multiple matches found in the selection, replacing first occurrence.]\n" : "";
  return { result: `${note}Successfully replaced text in the selection in ${file.path}.`, isError: false };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve a file from path or active file */
function resolveFile(app: App, path?: string): TFile | null {
  if (path) {
    return app.vault.getFileByPath(normalizePath(path));
  }
  return app.workspace.getActiveFile();
}

/** Ensure parent folders exist for a path */
async function ensureParentFolder(app: App, filePath: string): Promise<void> {
  const parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
  if (parentPath && !app.vault.getFolderByPath(parentPath)) {
    await app.vault.createFolder(parentPath);
  }
}

/** An error for an image or binary file, whose text would be garbage; null for text. */
function refuseNonText(file: TFile, tool: string): ToolResult | null {
  const extension = file.extension.toLowerCase();
  if (IMAGE_EXTENSIONS.includes(extension)) {
    return { result: `${file.path} is an image; ${tool} reads text only. To show it, the user can attach it to a chat message.`, isError: true };
  }
  if (BINARY_EXTENSIONS.includes(extension)) {
    return { result: `${file.path} is a binary file; ${tool} reads text only.`, isError: true };
  }
  return null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requiredRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** A JSON object; arrays and null are not. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Tool Implementations ───────────────────────────────────────────────────

async function readDocument(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = optionalString(input.path);
  const file = resolveFile(app, path);
  if (!file) {
    return { result: path ? `File not found: ${path}` : "No active document open.", isError: true };
  }
  const refusal = refuseNonText(file, "read_document");
  if (refusal) return refusal;

  // cachedRead() is faster for display-only reads
  const content = await app.vault.cachedRead(file);
  return { result: `# ${file.path}\n\n${content}`, isError: false };
}

async function editDocument(
  app: App,
  input: Record<string, unknown>,
  scope?: SelectionScope
): Promise<ToolResult> {
  const operation = requiredString(input.operation);
  // A missing `content` must not become "": replace_all would blank the
  // note and find_replace would delete the found text, both reported as
  // success. An explicit "" (delete on purpose) is fine.
  if (typeof input.content !== "string") {
    return { result: "'content' is required for edit_document (use \"\" to delete text).", isError: true };
  }
  const content = input.content;
  const find = optionalString(input.find);
  const position = optionalString(input.position);

  const path = optionalString(input.path);
  const file = resolveFile(app, path);
  if (!file) {
    return { result: path ? `File not found: ${path}` : "No active document open.", isError: true };
  }

  if (scope && file.path === scope.filePath) {
    if (operation !== "find_replace") return scopeRefusal(file.path);
    if (!find) return { result: "'find' parameter is required for find_replace.", isError: true };
    return await editInScope(app, file, scope, find, content);
  }

  switch (operation) {
    case "replace_all":
      await app.vault.process(file, () => content);
      return { result: `Replaced all content in ${file.path}.`, isError: false };

    case "find_replace": {
      if (!find) {
        return { result: "'find' parameter is required for find_replace.", isError: true };
      }

      // Use vault.process() for atomic read-modify-write
      let resultMsg = "";
      let found = false;

      await app.vault.process(file, (data) => {
        const idx = data.indexOf(find);
        if (idx === -1) {
          found = false;
          return data; // Return unchanged
        }
        found = true;
        const secondIdx = data.indexOf(find, idx + 1);
        if (secondIdx !== -1) {
          resultMsg = "[Note: Multiple matches found, replacing first occurrence.]\n";
        }
        return data.substring(0, idx) + content + data.substring(idx + find.length);
      });

      if (!found) {
        return {
          result: "Could not find the specified text. Make sure it matches exactly (including whitespace and line breaks).",
          isError: true,
        };
      }

      return { result: `${resultMsg}Successfully replaced text in ${file.path}.`, isError: false };
    }

    case "insert": {
      if (!position) {
        return { result: "'position' parameter is required for insert.", isError: true };
      }
      if (position !== "beginning" && position !== "end" && position !== "after_frontmatter") {
        return { result: `Unknown position: ${position}. Use beginning, end or after_frontmatter.`, isError: true };
      }

      await app.vault.process(file, (data) => {
        if (position === "end") return data + "\n" + content;
        // After the frontmatter as Obsidian reads it (0 without one), so a
        // "---" inside a value doesn't count.
        const start = position === "after_frontmatter" ? getFrontMatterInfo(data).contentStart : 0;
        const head = data.substring(0, start);
        // A note that ends right at the closing --- has no line break after it.
        const separator = head && !head.endsWith("\n") ? "\n" : "";
        return head + separator + content + "\n" + data.substring(start);
      });

      return { result: `Inserted content at ${position} of ${file.path}.`, isError: false };
    }

    default:
      return { result: `Unknown operation: ${operation}`, isError: true };
  }
}

async function searchVault(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const query = requiredString(input.query).toLowerCase();
  const searchContent = input.searchContent as boolean | undefined;
  const limit = Math.min((input.limit as number) || 10, 50);

  const files = app.vault.getMarkdownFiles();
  const results: string[] = [];

  for (const file of files) {
    if (results.length >= limit) break;

    if (file.path.toLowerCase().includes(query)) {
      results.push(`- ${file.path}`);
      continue;
    }

    if (searchContent) {
      // cachedRead() avoids redundant disk reads
      const content = await app.vault.cachedRead(file);
      const lowerContent = content.toLowerCase();
      const idx = lowerContent.indexOf(query);
      if (idx !== -1) {
        const start = Math.max(0, idx - 50);
        const end = Math.min(content.length, idx + query.length + 50);
        const snippet = content.substring(start, end).replace(/\n/g, " ");
        results.push(`- ${file.path}: ...${snippet}...`);
      }
    }
  }

  if (results.length === 0) {
    return { result: `No results found for "${query}".`, isError: false };
  }

  return {
    result: `Found ${results.length} result(s):\n${results.join("\n")}`,
    isError: false,
  };
}

async function readFile(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = requiredString(input.path);
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }

  const file = app.vault.getFileByPath(normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }

  const refusal = refuseNonText(file, "read_file");
  if (refusal) return refusal;

  const content = await app.vault.cachedRead(file);
  return { result: content, isError: false };
}

async function createFile(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = normalizePath(requiredString(input.path));
  const content = requiredString(input.content);

  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }

  if (app.vault.getFileByPath(path)) {
    return { result: `File already exists: ${path}. Use edit_document to modify it.`, isError: true };
  }

  await ensureParentFolder(app, path);
  await app.vault.create(path, content || "");
  return { result: `Created ${path}.`, isError: false };
}

async function listFiles(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const folder = optionalString(input.folder);
  const extension = optionalString(input.extension);

  let files = app.vault.getFiles();

  if (folder) {
    const normalizedFolder = normalizePath(folder);
    files = files.filter((f) =>
      f.path.startsWith(normalizedFolder + "/") || f.path === normalizedFolder
    );
  }

  if (extension) {
    const ext = extension.startsWith(".") ? extension : `.${extension}`;
    files = files.filter((f) => f.path.endsWith(ext));
  }

  const paths = files.map((f) => f.path).sort();
  const capped = paths.slice(0, 100);
  const suffix = paths.length > 100 ? `\n\n(Showing 100 of ${paths.length} files)` : "";

  if (capped.length === 0) {
    return { result: "No files found matching the criteria.", isError: false };
  }

  return {
    result: capped.map((p) => `- ${p}`).join("\n") + suffix,
    isError: false,
  };
}

async function renameFile(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = requiredString(input.path);
  const newPath = requiredString(input.new_path);

  if (!path || !newPath) {
    return { result: "Both 'path' and 'new_path' parameters are required.", isError: true };
  }

  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }

  const normalizedNew = normalizePath(newPath);

  if (app.vault.getAbstractFileByPath(normalizedNew)) {
    return { result: `A file already exists at: ${normalizedNew}`, isError: true };
  }

  await ensureParentFolder(app, normalizedNew);

  // fileManager.renameFile() updates all internal links automatically
  await app.fileManager.renameFile(file, normalizedNew);
  return { result: `Renamed ${path} to ${normalizedNew}.`, isError: false };
}

async function deleteFile(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = requiredString(input.path);
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }

  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }

  // fileManager.trashFile() respects the user's file deletion preference.
  await app.fileManager.trashFile(file);
  return { result: `Moved ${path} to trash.`, isError: false };
}

async function getProperties(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = optionalString(input.path);
  const file = resolveFile(app, path);
  if (!file) {
    return { result: path ? `File not found: ${path}` : "No active document open.", isError: true };
  }

  const cache = app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter;

  if (!frontmatter) {
    return { result: `No frontmatter properties found in ${file.path}.`, isError: false };
  }

  // Remove the position metadata that Obsidian adds internally
  const clean = { ...frontmatter };
  delete clean.position;

  return { result: JSON.stringify(clean, null, 2), isError: false };
}

async function setProperties(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const props = requiredRecord(input.properties);
  if (!props) {
    return { result: "'properties' parameter must be an object.", isError: true };
  }

  const path = optionalString(input.path);
  const file = resolveFile(app, path);
  if (!file) {
    return { result: path ? `File not found: ${path}` : "No active document open.", isError: true };
  }

  // Use Obsidian's built-in processFrontMatter for safe YAML handling
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(props)) {
      if (value === null) {
        delete frontmatter[key];
      } else {
        frontmatter[key] = value;
      }
    }
  });

  const setKeys = Object.entries(props).filter(([, v]) => v !== null).map(([k]) => k);
  const removedKeys = Object.entries(props).filter(([, v]) => v === null).map(([k]) => k);
  const parts: string[] = [];
  if (setKeys.length > 0) parts.push(`Set: ${setKeys.join(", ")}`);
  if (removedKeys.length > 0) parts.push(`Removed: ${removedKeys.join(", ")}`);

  return { result: `Updated properties in ${file.path}. ${parts.join(". ")}.`, isError: false };
}

async function getBacklinks(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = optionalString(input.path);
  const file = resolveFile(app, path);
  if (!file) {
    return { result: path ? `File not found: ${path}` : "No active document open.", isError: true };
  }

  // resolvedLinks maps: source path -> { target path -> link count }
  const allLinks = app.metadataCache.resolvedLinks;
  const backlinks: string[] = [];

  for (const [sourcePath, targets] of Object.entries(allLinks)) {
    if (targets[file.path]) {
      backlinks.push(sourcePath);
    }
  }

  if (backlinks.length === 0) {
    return { result: `No backlinks found for ${file.path}.`, isError: false };
  }

  backlinks.sort();
  return {
    result: `${backlinks.length} note(s) link to ${file.path}:\n${backlinks.map((p) => `- ${p}`).join("\n")}`,
    isError: false,
  };
}

function getCurrentDatetime(): ToolResult {
  const now = new Date();
  const iso = now.toISOString();
  const local = now.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  // YYYY-MM-DD in the user's time zone, as daily notes are named.
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateOnly = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  return {
    result: `Local: ${local}\nISO: ${iso}\nDate: ${dateOnly}`,
    isError: false,
  };
}

async function openDocument(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = requiredString(input.path);
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }

  const file = app.vault.getFileByPath(normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }

  // Open in the most recent non-chat leaf so it doesn't replace the sidebar
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  return { result: `Opened ${file.path}.`, isError: false };
}

async function askUser(
  input: Record<string, unknown>,
  onAskUser: AskUserCallback
): Promise<ToolResult> {
  const question = requiredString(input.question);
  if (!question) {
    return { result: "'question' parameter is required.", isError: true };
  }

  const answer = await onAskUser(question);
  return { result: answer, isError: false };
}
