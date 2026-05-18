export interface ParsedFileReadCommand {
  commandName: "cat" | "sed";
  filePath: string;
}

export function parseFileReadCommand(command: string): ParsedFileReadCommand | null {
  const words = tokenizeShellWords(command);
  if (!words || words.length === 0) return null;

  const commandWords = stripLeadingEnvAssignments(words);
  if (commandWords.length === 0) return null;

  const commandName = getCommandName(commandWords[0]);
  if (commandName === "cat") return parseCatFileRead(commandWords);
  if (commandName === "sed") return parseSedFileRead(commandWords);
  return null;
}

const CAT_FLAGS_WITHOUT_VALUES = new Set([
  "--number",
  "--number-nonblank",
  "--show-all",
  "--show-ends",
  "--show-nonprinting",
  "--show-tabs",
  "--squeeze-blank",
]);

function tokenizeShellWords(command: string): string[] | null {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let hasCurrent = false;

  for (const ch of command) {
    if (escaped) {
      current += ch;
      hasCurrent = true;
      escaped = false;
      continue;
    }

    if (ch === "\\" && quote !== "'") {
      escaped = true;
      hasCurrent = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
        hasCurrent = true;
        continue;
      }
      current += ch;
      hasCurrent = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      hasCurrent = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (hasCurrent) {
        words.push(current);
        current = "";
        hasCurrent = false;
      }
      continue;
    }

    if (/[;&|<>()`]/.test(ch)) return null;

    current += ch;
    hasCurrent = true;
  }

  if (escaped || quote) return null;
  if (hasCurrent) words.push(current);
  return words;
}

function stripLeadingEnvAssignments(words: string[]): string[] {
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=.+$/.test(words[index])) {
    index++;
  }
  return words.slice(index);
}

function getCommandName(commandWord: string): string {
  return commandWord.replace(/\\/g, "/").split("/").pop() ?? commandWord;
}

function parseCatFileRead(words: string[]): ParsedFileReadCommand | null {
  const operands: string[] = [];
  let parsingOptions = true;

  for (const word of words.slice(1)) {
    if (parsingOptions && word === "--") {
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && word.startsWith("--")) {
      if (!CAT_FLAGS_WITHOUT_VALUES.has(word)) return null;
      continue;
    }

    if (parsingOptions && /^-[AbenstuvTE]+$/.test(word)) {
      continue;
    }

    operands.push(word);
  }

  const filePath = operands.length === 1 ? operands[0] : "";
  if (!isConcreteFileOperand(filePath)) return null;
  return { commandName: "cat", filePath };
}

function parseSedFileRead(words: string[]): ParsedFileReadCommand | null {
  let sawNoPrint = false;
  let sawScript = false;
  let index = 1;

  for (; index < words.length; index++) {
    const word = words[index];
    if (word === "--") {
      index++;
      break;
    }
    if (!word.startsWith("-") || word === "-") break;

    if (word === "-e") {
      index++;
      if (index >= words.length) return null;
      sawScript = true;
      continue;
    }

    if (word.startsWith("-e") && word.length > 2) {
      sawScript = true;
      continue;
    }

    if (word.includes("i") || word.includes("f")) return null;
    if (!/^-[nEr]+$/.test(word)) return null;
    if (word.includes("n")) sawNoPrint = true;
  }

  if (!sawNoPrint) return null;
  if (!sawScript) {
    if (index >= words.length) return null;
    sawScript = true;
    index++;
  }

  const operands = words.slice(index);
  const filePath = sawScript && operands.length === 1 ? operands[0] : "";
  if (!isConcreteFileOperand(filePath)) return null;
  return { commandName: "sed", filePath };
}

function isConcreteFileOperand(filePath: string): boolean {
  if (!filePath || filePath === "-") return false;
  if (filePath.startsWith("~")) return false;
  return !/[$*?[\]{}]/.test(filePath);
}
