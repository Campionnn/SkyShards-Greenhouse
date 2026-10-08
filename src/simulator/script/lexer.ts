// Tokenizer for the script language. Produces the whole token list up front
// (scripts are small), so the parser can look ahead freely (arrow functions).

export type TokenType = "num" | "str" | "tpl" | "name" | "punct" | "eof";

export interface Token {
  type: TokenType;
  /** Name / punctuator text, or the cooked string value. */
  value: string;
  num?: number;
  /** Template pieces: starts with a backtick (else `}`), ends with a backtick (else `${`). */
  tplHead?: boolean;
  tplTail?: boolean;
  line: number;
  col: number;
  /** A line break comes before this token (automatic semicolons). */
  nl: boolean;
}

/** A syntax or runtime error at a source position (1-based). */
export class ScriptSyntaxError extends Error {
  readonly line: number;
  readonly col: number;
  constructor(message: string, line: number, col: number) {
    super(message);
    this.name = "ScriptSyntaxError";
    this.line = line;
    this.col = col;
  }
}

const PUNCTS = [
  "...", "===", "!==", "**=", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "**",
  "{", "}", "(", ")", "[", "]", ";", ",", ".", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", "=",
];

const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdPart = (c: string) => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let nl = false;
  /** Open template expressions: brace depth inside each `${ ... }`. */
  const tplDepth: number[] = [];

  const err = (msg: string, l = line, c = col): never => {
    throw new ScriptSyntaxError(msg, l, c);
  };
  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") {
        line++;
        col = 1;
      } else col++;
      i++;
    }
  };
  const push = (t: Omit<Token, "nl">) => {
    out.push({ ...t, nl });
    nl = false;
  };

  const escape = (): string => {
    // At the backslash.
    advance();
    const c = src[i];
    if (c === undefined) err("Unfinished escape sequence");
    advance();
    switch (c) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "0": return "\0";
      case "b": return "\b";
      case "\n": return "";
      case "u": {
        if (src[i] === "{") {
          const end = src.indexOf("}", i);
          if (end < 0) err("Bad unicode escape");
          const cp = parseInt(src.slice(i + 1, end), 16);
          advance(end - i + 1);
          return String.fromCodePoint(cp);
        }
        const hex = src.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) err("Bad unicode escape");
        advance(4);
        return String.fromCharCode(parseInt(hex, 16));
      }
      case "x": {
        const hex = src.slice(i, i + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) err("Bad hex escape");
        advance(2);
        return String.fromCharCode(parseInt(hex, 16));
      }
      default:
        return c;
    }
  };

  /** Scan template characters up to a backtick or `${`. At the first character. */
  const templatePart = (head: boolean, l: number, c: number) => {
    let s = "";
    for (;;) {
      const ch = src[i];
      if (ch === undefined) err("Unterminated template string", l, c);
      if (ch === "`") {
        advance();
        push({ type: "tpl", value: s, tplHead: head, tplTail: true, line: l, col: c });
        return;
      }
      if (ch === "$" && src[i + 1] === "{") {
        advance(2);
        push({ type: "tpl", value: s, tplHead: head, tplTail: false, line: l, col: c });
        tplDepth.push(0);
        return;
      }
      if (ch === "\\") s += escape();
      else {
        s += ch;
        advance();
      }
    }
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      nl = true;
      advance();
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\uFEFF" || c === "\u00A0") {
      advance();
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") advance();
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const l = line;
      const cc = col;
      advance(2);
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") nl = true;
        advance();
      }
      if (i >= src.length) err("Unterminated comment", l, cc);
      advance(2);
      continue;
    }
    const l = line;
    const cc = col;
    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      let j = i;
      let value: number;
      if (c === "0" && /[xXbBoO]/.test(src[i + 1] ?? "")) {
        const base = { x: 16, b: 2, o: 8 }[src[i + 1].toLowerCase() as "x" | "b" | "o"];
        j = i + 2;
        while (j < src.length && /[0-9a-fA-F_]/.test(src[j])) j++;
        const digits = src.slice(i + 2, j).replace(/_/g, "");
        value = parseInt(digits, base);
        if (!digits || Number.isNaN(value)) err("Bad number", l, cc);
      } else {
        while (j < src.length && (isDigit(src[j]) || src[j] === "_")) j++;
        if (src[j] === "." && isDigit(src[j + 1] ?? "")) {
          j++;
          while (j < src.length && (isDigit(src[j]) || src[j] === "_")) j++;
        } else if (src[j] === "." && !isIdStart(src[j + 1] ?? "") && src[j + 1] !== ".") {
          j++; // "1." is a number
        }
        if (/[eE]/.test(src[j] ?? "") && /[0-9+-]/.test(src[j + 1] ?? "")) {
          j += 2;
          while (j < src.length && isDigit(src[j])) j++;
        }
        value = Number(src.slice(i, j).replace(/_/g, ""));
      }
      if (isIdStart(src[j] ?? "")) err("A number can't be followed directly by a name", l, cc);
      advance(j - i);
      push({ type: "num", value: String(value), num: value, line: l, col: cc });
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdPart(src[j])) j++;
      const name = src.slice(i, j);
      advance(j - i);
      push({ type: "name", value: name, line: l, col: cc });
      continue;
    }
    if (c === '"' || c === "'") {
      advance();
      let s = "";
      for (;;) {
        const ch = src[i];
        if (ch === undefined || ch === "\n") err("Unterminated string", l, cc);
        if (ch === c) {
          advance();
          break;
        }
        if (ch === "\\") s += escape();
        else {
          s += ch;
          advance();
        }
      }
      push({ type: "str", value: s, line: l, col: cc });
      continue;
    }
    if (c === "`") {
      advance();
      templatePart(true, l, cc);
      continue;
    }
    if (c === "}" && tplDepth.length && tplDepth[tplDepth.length - 1] === 0) {
      tplDepth.pop();
      advance();
      templatePart(false, l, cc);
      continue;
    }
    const p = PUNCTS.find((q) => src.startsWith(q, i));
    if (!p) err(`Unexpected character "${c}"`, l, cc);
    // `a?.5:b` is a conditional, not optional chaining.
    const punct = p === "?." && isDigit(src[i + 2] ?? "") ? "?" : p!;
    if (tplDepth.length) {
      if (punct === "{") tplDepth[tplDepth.length - 1]++;
      else if (punct === "}") tplDepth[tplDepth.length - 1]--;
    }
    advance(punct.length);
    push({ type: "punct", value: punct, line: l, col: cc });
  }
  if (tplDepth.length) err("Unterminated template string");
  out.push({ type: "eof", value: "", line, col, nl: true });
  return out;
}
