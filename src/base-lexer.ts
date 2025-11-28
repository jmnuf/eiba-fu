import * as stdio from '#stdio';
import type { ui8 } from './ctype';
import { isspace, isalpha, isdigit, char, isalnum } from './ctype';

type ptr = number & {};

class String_View {
  private buf: Uint8Array;
  data: ptr;
  len: number;

  constructor(buffer: Uint8Array, data: ptr = 0, len: number = 0) {
    this.buf = buffer;
    this.data = data;
    this.len = len;

    const is_index = (input: unknown): input is `${number}` => typeof input == 'string' && !!input.match(/^\d+$/);
    return new Proxy(this, {
      get(target, property, receiver) {
        if (is_index(property)) {
          const index = parseInt(property);
          return target.at(index);
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  switch_buf(buf: Uint8Array) {
    this.buf = buf;
    this.data = 0;
    this.len = 0;
  }

  bytes() {
    return this.buf.subarray(this.data, this.data + this.len);
  }

  at(index: number) {
    const offset = this.data + index;
    if (offset < this.data) return undefined;
    if (offset >= this.data + this.len) return undefined;
    return this.buf[this.data + index];
  }

  as_str(): string {
    const decoder = new TextDecoder();
    return decoder.decode(this.bytes());
  }

  as_int(): number {
    const subbuf = this.bytes();
    let n = 0;
    let cursor = 0;
    while (cursor < this.len) {
      const c = subbuf[cursor++] as ui8;
      if (!isdigit(c) && c !== char('_')) break;
      if (c == char('_')) continue;
      n = (n * 10) + (c - char('0'));
    }
    console.log('Int Number:', n);
    return n;
  }

  as_flt(): number {
    const str = this.as_str();
    console.log('Float Number:', str);
    return parseFloat(str);
  }
}

const ExtraTokenKinds = {
  EOF: 256,
  Ident: 257,
  Int: 258,
  Flt: 259,
  Str: 260,
  Char: 261,
} as const;
type ExtraTokenKindsMap = typeof ExtraTokenKinds;

export type TokenKind = ui8 | ExtraTokenKindsMap[keyof ExtraTokenKindsMap];

export const TOKEN_OPAREN = 40;
export const TOKEN_CPAREN = 41;
export const TOKEN_ASTERISK = 42;
export const TOKEN_PLUS = 43;
export const TOKEN_MINUS = 45;  // '-'
export const TOKEN_FSLASH = 47; // '/'
export const TOKEN_BSLASH = 92; // '\\'
export const TOKEN_EOF = ExtraTokenKinds.EOF;
export const TOKEN_IDENT = ExtraTokenKinds.Ident;
export const TOKEN_INTEGER = ExtraTokenKinds.Int;
export const TOKEN_FLOAT = ExtraTokenKinds.Flt;
export const TOKEN_STRING = ExtraTokenKinds.Str;
export const TOKEN_CHAR = ExtraTokenKinds.Char;

export interface Lexer {
  buf: Uint8Array;
  buf_len: number;
  file_path: string;
  fd: stdio.FILE | null;

  cursor: number;
  row: number;
  col: number;

  token_kind: TokenKind;
  string: String_View;
  number: number;

  error: string;
}

export function lexer_init(file_path: string, buf: Uint8Array | null = null): Lexer | null {
  let fd: Lexer['fd'];
  let buf_len: number;
  if (buf == null) {
    const result = stdio.fopen(file_path, 'r');
    if (!result.ok) {
      console.error('[ERROR] Failed to open file ' + file_path + ':', result.error.message);
      return null;
    }
    fd = result.value;
    buf = new Uint8Array(1024);
    buf_len = stdio.fread(buf, fd);
  } else {
    fd = null;
    buf_len = buf.byteLength;
  }

  return {
    buf, buf_len,
    file_path,
    fd, cursor: 0,
    col: 0, row: 0,
    number: 0,
    token_kind: 0,
    string: new String_View(buf),
    error: '',
  };
}

export function lexer_reinit(l: Lexer, file_path: string, buf: Uint8Array | null = null): boolean {
  let fd: Lexer['fd'];
  let buf_len: number;
  if (buf == null) {
    const result = stdio.fopen(file_path, 'r');
    if (!result.ok) {
      console.error('[ERROR] Failed to open file ' + file_path + ':', result.error.message);
      return false;
    }
    fd = result.value;
    buf = new Uint8Array(1024);
    buf_len = stdio.fread(buf, fd);
  } else {
    fd = null;
    buf_len = buf.byteLength;
  }

  l.fd = fd;
  l.buf = buf;
  l.buf_len = buf_len;
  l.file_path = file_path;
  l.cursor = 0;
  l.row = 0;
  l.col = 0;
  l.number = 0;
  l.token_kind = 0;
  l.string.switch_buf(buf);
  l.error = '';

  return true;
}

const UNDERSCORE_CHAR = char('_');
const STRING_LIT_START_DELIM_CHAR = char('"');
const STRING_LIT_END_DELIM_CHAR = char('`');
const CHAR_LIT_DELIM_CHAR = char("'");

export function lexer_next(l: Lexer): boolean {
  l.string.data = 0;
  l.string.len = 0;
  l.number = 0;
  l.error = '';

  if (l.cursor >= l.buf_len) {
    l.token_kind = ExtraTokenKinds.EOF;
    return true;
  }

  while (l.cursor < l.buf_len) {
    let c = l.buf[l.cursor++] as ui8;
    l.col++;
    l.token_kind = c;
    while (isspace(c)) {
      if (l.cursor >= l.buf_len) {
        l.token_kind = ExtraTokenKinds.EOF;
        return true;
      }

      if (c == char('\n')) {
        l.row++;
        l.col = 0;
      } else {
        l.col++;
      }

      c = l.buf[l.cursor++] as ui8;
      l.token_kind = c;
    }
    l.string.data = l.cursor - 1;
    l.string.len = 1;

    if (isalpha(c) || c == UNDERSCORE_CHAR) {
      l.token_kind = TOKEN_IDENT;
      l.string.len = 0;
      while (isalnum(c) || c == UNDERSCORE_CHAR) {
        l.string.len++;
        l.col++;
        if (l.cursor >= l.buf_len) break;
        c = l.buf[l.cursor++] as ui8;
      }

      return true;
    }

    if (isdigit(c)) {
      l.string.len = 0;
      let is_decimal = false;
      while (isdigit(c) || c == UNDERSCORE_CHAR) {
        l.string.len++;
        l.col++;
        if (l.cursor >= l.buf_len) break;
        c = l.buf[l.cursor++] as ui8;
        if (!is_decimal && c == char('.')) {
          is_decimal = true;
          l.string.len++;
          if (l.cursor >= l.buf_len) break;
          c = l.buf[l.cursor++] as ui8;
          continue;
        }
      }

      if (is_decimal) {
        l.token_kind = TOKEN_FLOAT;
        l.number = l.string.as_flt();
      } else {
        l.token_kind = TOKEN_INTEGER;
        l.number = l.string.as_int();
      }
      return true;
    }

    if (c == STRING_LIT_START_DELIM_CHAR) {
      l.token_kind = TOKEN_STRING;
      l.string.data++;
      l.string.len = 0;
      if (l.cursor >= l.buf_len) {
        console.error(`${l.file_path}:${l.row}:${l.col}: [ERROR] Unterminated string literal`);
        return false;
      }
      c = l.buf[l.cursor++] as ui8;
      const start_col = l.col++;
      const start_row = l.row;
      while (c != STRING_LIT_END_DELIM_CHAR) {
        l.string.len++;
        if (c == char('\n')) {
          l.row++;
          l.col = 0;
        } else {
          l.col++;
        }
        if (c == TOKEN_BSLASH) {
          if (l.cursor >= l.buf_len) {
            l.error = `${l.file_path}:${start_row}:${start_col}: [ERROR] Unterminated escape sequence in string literal`;
            return false;
          }
          l.string.len++;
          c = l.buf[l.cursor++] as ui8;
          if (c == char('n') || c == char('r') || c == char('t') || c == char('\\')) {
            l.col++;
          } else {
            const ch = String.fromCharCode(c);
            l.error = `${l.file_path}:${l.row}:${l.col}: [ERROR] Unknown character literal escape sequence: '\\${ch}'`;
            return false;
          }
        }
        if (l.cursor >= l.buf_len) {
          l.error = `${l.file_path}:${start_row}:${start_col}: [ERROR] Unterminated string literal`;
          return false;
        }
        c = l.buf[l.cursor++] as ui8;
      }
      return true;
    }

    if (c == CHAR_LIT_DELIM_CHAR) {
      l.string.data++;
      l.string.len = 1;
      l.token_kind = TOKEN_CHAR;
      if (l.cursor >= l.buf_len) {
        l.error = `${l.file_path}:${l.row}:${l.col}: [ERROR] Unterminated character literal`;
        return false;
      }
      l.col++;
      c = l.buf[l.cursor++] as ui8;
      l.number = c;
      if (l.cursor >= l.buf_len) {
        l.error = `${l.file_path}:${l.row}:${l.col}: [ERROR] Unterminated character literal`;
        return false;
      }
      if (c == TOKEN_BSLASH) {
        l.col++;
        c = l.buf[l.cursor++] as ui8;
        if (l.cursor >= l.buf_len) {
          l.error = `${l.file_path}:${l.row}:${l.col}: [ERROR] Unterminated escape sequence in character literal`;
          return false;
        }
        if (c == char('n')) {
          c = 10;
        } else if (c == char('t')) {
          c = 9;
        } else if (c == char('r')) {
          c = 13;
        } else if (c == char('\\')) {
          c = char('\\');
        } else if (c == char('\'')) {
          c = char('\'');
        } else {
          const ch = String.fromCharCode(c);
          l.error = `${l.file_path}:${l.row}:${l.col}: [ERROR] Unknown character literal escape sequence: \\${ch}`;
          return false;
        }
        l.col++;
        l.string.len++;
        l.number = c;
      }
      l.col++;
      c = l.buf[l.cursor++] as ui8;
      if (c != CHAR_LIT_DELIM_CHAR) {
        l.error = `${l.file_path}:${l.row}:${l.col}: [ERROR] Character literal expected to be closed`;
        return false;
      }
      return true;
    }

    return true;
  }

  return true;
}

