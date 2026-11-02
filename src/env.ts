/**
 * Load .env from the project root, and let it win over the machine's environment.
 *
 * Node's --env-file does the opposite (a variable already set on the machine beats the file), which
 * bit this project once: a machine-wide ANTHROPIC_API_KEY with no credit shadowed the project's own.
 * Imported first by every entry point, so values are in place before any module reads them.
 */
import { readFileSync } from "node:fs";

try {
  const text = readFileSync(".env", "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value !== "") process.env[key] = value;
  }
} catch {
  // no .env: the environment as it is
}
