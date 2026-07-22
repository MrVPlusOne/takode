function mergeUniqueStrings(existing: string[], additions: string[]): string[] {
  const merged = [...existing];
  for (const value of additions) {
    if (!merged.includes(value)) merged.push(value);
  }
  return merged;
}

function extractQuotedStrings(input: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    out.push(match[1].replace(/\\"/g, '"'));
  }
  return out;
}

function renderIncludeOnlyArray(vars: string[]): string[] {
  return ["include_only = [", ...vars.map((v) => `    "${v}",`), "]"];
}

export function removeTopLevelTomlSettings(configToml: string, keys: Set<string>): string {
  if (keys.size === 0 || !configToml.trim()) return configToml;

  const endsWithNewline = configToml.endsWith("\n");
  const lines = configToml.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const out: string[] = [];
  let inRoot = true;
  let skipUntilMultilineDelimiter: '\"\"\"' | "'''" | null = null;

  for (const line of lines) {
    if (skipUntilMultilineDelimiter) {
      if (line.includes(skipUntilMultilineDelimiter)) {
        skipUntilMultilineDelimiter = null;
      }
      continue;
    }

    const trimmed = line.trim();
    if (/^\[\[?.+\]\]?\s*(?:#.*)?$/.test(trimmed)) {
      inRoot = false;
      out.push(line);
      continue;
    }

    const assignment = inRoot ? line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=/) : null;
    const key = assignment?.[1];
    if (!key || !keys.has(key)) {
      out.push(line);
      continue;
    }

    const valueStart = line.slice(line.indexOf("=") + 1).trimStart();
    const delimiter = valueStart.startsWith('\"\"\"') ? '\"\"\"' : valueStart.startsWith("'''") ? "'''" : null;
    if (delimiter && !valueStart.slice(delimiter.length).includes(delimiter)) {
      skipUntilMultilineDelimiter = delimiter;
    }
  }

  return out.join("\n") + (endsWithNewline ? "\n" : "");
}

export function upsertShellEnvironmentIncludeOnly(configToml: string, requiredVars: string[]): string {
  if (requiredVars.length === 0) return configToml;
  const shellEnvPolicyHeader = "[shell_environment_policy]";
  const normalizedRequired = Array.from(new Set(requiredVars)).sort();
  const endsWithNewline = configToml.endsWith("\n");
  const lines = configToml.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const sectionStart = lines.findIndex((line) => line.trim().toLowerCase() === shellEnvPolicyHeader.toLowerCase());
  if (sectionStart === -1) {
    const out = [...lines];
    if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
    out.push(shellEnvPolicyHeader);
    out.push(...renderIncludeOnlyArray(normalizedRequired));
    return out.join("\n") + (endsWithNewline || configToml.length === 0 ? "\n" : "");
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  let includeStart = -1;
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    if (/^\s*include_only\s*=\s*\[/.test(lines[i])) {
      includeStart = i;
      break;
    }
  }

  if (includeStart === -1) {
    const out = [...lines];
    out.splice(sectionStart + 1, 0, ...renderIncludeOnlyArray(normalizedRequired));
    return out.join("\n") + (endsWithNewline ? "\n" : "");
  }

  let includeEnd = includeStart;
  while (includeEnd < sectionEnd) {
    if (lines[includeEnd].includes("]")) break;
    includeEnd++;
  }
  if (includeEnd >= sectionEnd) includeEnd = includeStart;

  const includeBlock = lines.slice(includeStart, includeEnd + 1).join("\n");
  const existingVars = extractQuotedStrings(includeBlock);
  const mergedVars = mergeUniqueStrings(existingVars, normalizedRequired);
  const replacement = renderIncludeOnlyArray(mergedVars);
  const out = [...lines];
  out.splice(includeStart, includeEnd - includeStart + 1, ...replacement);
  return out.join("\n") + (endsWithNewline ? "\n" : "");
}
