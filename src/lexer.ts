import type { LexerToken } from './token-node-defintions';
import { LexerTokenKind, is_keyword } from './token-node-defintions';
import type { SourcePosition } from './utils';
import { Result, Utf8 } from './utils';

const BytesMap = {
  TABULATION: 9, // '\t'
  NEWLINE: 10, // '\n'
  CARRIAGE_RETURN: 13, // '\r'
  SPACE: 32, // ' '
  EXCLAMATION: 33, // '!'

  DOUBLE_QUOTE: 34, // '"'
  AMPERSAND: 38, // '&'
  SINGLE_QUOTE: 39, // '\''

  DASH: 45, // '-'
  FORWARDSLASH: 47, // '/'

  NUMBER_0: 48, // '0'
  NUMBER_9: 57, // '9'

  LESS_THAN_SIGN: 60, // '<'
  EQUAL_SIGN: 61, // '='
  GREATER_THAN_SIGN: 62, // '>'

  CHAR_A_UPPER: 65, // 'A'
  CHAR_Z_UPPER: 90, // 'Z'

  BACKSLASH: 92, // '\\'
  BACKTICK: 96, // '`'

  UNDERSCORE: 95, // '_'

  CHAR_A_LOWER: 97, // 'a'
  CHAR_N_LOWER: 110, // 'n'
  CHAR_R_LOWER: 114, // 'r'
  CHAR_T_LOWER: 116, // 't'
  CHAR_Z_LOWER: 122, // 'z'

  BAR: 124, // '|'
};

function is_char_whitespace(char: number) {
  return char == BytesMap.TABULATION || char == BytesMap.NEWLINE || char == BytesMap.CARRIAGE_RETURN || char == BytesMap.SPACE;
}

function is_char_alphabetic(char: number) {
  if (BytesMap.CHAR_A_UPPER <= char && char <= BytesMap.CHAR_Z_UPPER) return true;
  if (BytesMap.CHAR_A_LOWER <= char && char <= BytesMap.CHAR_Z_LOWER) return true;
  return false;
}

function is_char_numeric(char: number) {
  return BytesMap.NUMBER_0 <= char && char <= BytesMap.NUMBER_9;
}

function is_char_alphanumeric(char: number) {
  return is_char_alphabetic(char) || is_char_numeric(char);
}

function is_char_usable_for_an_identifier(char: number) {
  return char == BytesMap.UNDERSCORE || is_char_alphanumeric(char);
}

class SimpLexer {
  private cursor: number;
  private line: number;
  private column: number;
  private buf: Uint8Array;
  private src: string;
  #tok: LexerToken;

  constructor(source_name: string, buffer: Uint8Array) {
    this.src = source_name;
    this.buf = buffer;
    this.cursor = -1;
    this.column = 0;
    this.line = 1;
    this.next = this.next.bind(this);
    this.#tok = null as any;
  }

  eof() {
    return this.cursor >= this.buf.length;
  }

  extend_buffer(extended: Uint8Array) {
    const base = this.buf.slice(this.cursor < 0 ? 0 : this.cursor);
    const total_length = base.length + extended.length;
    const nbuf = new Uint8Array(total_length);
    let i = 0;
    for (let j = 0; j < base.length; ++j) {
      nbuf[i++] = base[j]!;
    }
    for (let j = 0; j < extended.length; ++j) {
      nbuf[i++] = extended[j]!;
    }
    this.buf = nbuf;
    this.cursor = -1;
  }

  next(): Result<LexerToken, string> {
    const buf = this.buf;
    if (this.cursor >= buf.length || buf.length == 0) {
      this.#tok = {
        kind: LexerTokenKind.EOF,
        pos: { line: this.line, column: this.column },
      };
      return Result.Ok(this.#tok);
    }

    while (this.cursor < buf.length) {
      const ch = buf[++this.cursor];
      if (ch === undefined) {
        this.cursor = buf.length;
        this.#tok = {
          kind: LexerTokenKind.EOF,
          pos: { line: this.line, column: this.column },
        };
        return Result.Ok(this.#tok);
      }
      this.column++;

      if (is_char_whitespace(ch)) {
        if (ch === BytesMap.NEWLINE) {
          this.line++;
          this.column = 0;
        }
        continue;
      }

      break;
    }

    let ch = buf[this.cursor];
    if (!ch) {
      if (this.#tok && this.#tok.kind != LexerTokenKind.EOF) {
        this.cursor = buf.length;
        this.#tok = {
          kind: LexerTokenKind.EOF,
          pos: { line: this.line, column: this.column },
        };
      }
      return Result.Ok(this.#tok);
    }
    if (ch == BytesMap.FORWARDSLASH && buf[this.cursor + 1] == BytesMap.FORWARDSLASH) {
      this.cursor++;
      this.column++;
      while (ch !== undefined && ch != BytesMap.NEWLINE) {
        this.column++;
        ch = buf[++this.cursor];
      }
      if (!ch) {
        this.#tok = {
          kind: LexerTokenKind.EOF,
          pos: { line: this.line, column: this.column },
        };
        return Result.Ok(this.#tok);
      }
      this.cursor--;
      return this.next();
    }
    const { line, column } = this;

    if (ch === BytesMap.BACKTICK) {
      // TODO: Possibly should handle unterminated strings properly but it doesn't really matter right now
      const str_buf: number[] = [];
      ch = buf[++this.cursor];
      while (ch != undefined && ch != BytesMap.SINGLE_QUOTE) {
        let escpaing = false;
        if (ch == BytesMap.BACKSLASH) {
          ch = buf[++this.cursor];
          if (ch == null) break;
          escpaing = true;
        }

        if (escpaing) {
          switch (ch) {
            case BytesMap.CHAR_N_LOWER: ch = BytesMap.NEWLINE; break;
            case BytesMap.CHAR_R_LOWER: ch = BytesMap.CARRIAGE_RETURN; break;
            case BytesMap.CHAR_T_LOWER: ch = BytesMap.TABULATION; break;
          }
        }

        str_buf.push(ch);
        ch = buf[++this.cursor];
      }
      const str = Utf8.decode(str_buf);

      this.#tok = {
        kind: LexerTokenKind.String,
        pos: { line, column },
        string: str,
      };

      return Result.Ok(this.#tok);
    }

    if (ch == BytesMap.AMPERSAND && buf[this.cursor + 1] == BytesMap.AMPERSAND) {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: LexerTokenKind.Symbol,
        pos: { line, column },
        sym: '&&',
      };
      return Result.Ok(this.#tok);
    }

    if (ch == BytesMap.BAR && buf[this.cursor + 1] == BytesMap.BAR) {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: LexerTokenKind.Symbol,
        pos: { line, column },
        sym: '||',
      };
      return Result.Ok(this.#tok);
    }

    if (ch == BytesMap.EQUAL_SIGN && buf[this.cursor + 1] === BytesMap.EQUAL_SIGN) {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: LexerTokenKind.Symbol,
        pos: { line, column },
        sym: '==',
      };
      return Result.Ok(this.#tok);
    }

    if (ch == BytesMap.EXCLAMATION && buf[this.cursor + 1] == BytesMap.EQUAL_SIGN) {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: LexerTokenKind.Symbol,
        pos: { line, column },
        sym: '!=',
      };
      return Result.Ok(this.#tok);
    }

    if (ch == BytesMap.GREATER_THAN_SIGN) {
      const next = buf[this.cursor + 1]!;
      if (next == BytesMap.GREATER_THAN_SIGN || next == BytesMap.EQUAL_SIGN) {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: LexerTokenKind.Symbol,
          pos: { line, column },
          sym: Utf8.decode([ch, next]),
        };
        return Result.Ok(this.#tok);
      }
    }

    if (ch == BytesMap.LESS_THAN_SIGN) {
      const next = buf[this.cursor + 1]!;
      if (next == BytesMap.LESS_THAN_SIGN || next == BytesMap.EQUAL_SIGN) {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: LexerTokenKind.Symbol,
          pos: { line, column },
          sym: Utf8.decode([ch, next]),
        };
        return Result.Ok(this.#tok);
      }
    }

    if (ch == BytesMap.BAR) {
      const next = buf[this.cursor + 1]!;
      if (next == BytesMap.GREATER_THAN_SIGN || next == BytesMap.BAR) {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: LexerTokenKind.Symbol,
          pos: { line, column },
          sym: Utf8.decode([ch, next]),
        };
        return Result.Ok(this.#tok);
      }
    }

    let negative = false;
    if (ch === BytesMap.DASH) {
      const next = buf[this.cursor + 1]!;
      if (next == BytesMap.GREATER_THAN_SIGN) {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: LexerTokenKind.Symbol,
          pos: { line, column },
          sym: '->',
        };
        return Result.Ok(this.#tok);
      }

      if (is_char_numeric(next)) {
        negative = true;
        ch = next;
      }
    }

    if (is_char_numeric(ch)) {
      const str_buf: number[] = [];
      while (ch !== undefined && is_char_numeric(ch)) {
        str_buf.push(ch);
        ch = buf[++this.cursor];
        this.column++;
      }
      this.cursor--;
      const str = Utf8.decode(str_buf);
      let int = Number.parseInt(str);
      if (negative) int = -int;

      this.#tok = {
        kind: LexerTokenKind.Number,
        pos: { line, column },
        is_float: false,
        num: int,
      };

      return Result.Ok(this.#tok);
    }

    if (is_char_usable_for_an_identifier(ch)) {
      const str_buf: number[] = [];

      while (ch !== undefined && is_char_usable_for_an_identifier(ch)) {
        str_buf.push(ch);
        ch = buf[++this.cursor];
        this.column++;
      }
      this.cursor--;
      const str = Utf8.decode(str_buf);

      if (is_keyword(str)) {
        this.#tok = {
          kind: LexerTokenKind.Keyword,
          pos: { line, column },
          word: str,
        };
        return Result.Ok(this.#tok);
      }

      this.#tok = {
        kind: LexerTokenKind.Ident,
        pos: { line, column },
        ident: str,
      };
      return Result.Ok(this.#tok);
    }


    this.#tok = {
      kind: LexerTokenKind.Symbol,
      pos: { line, column },
      sym: Utf8.decode([ch]),
    };
    return Result.Ok(this.#tok);
  }

  peek() {
    const result = this.clone().next();
    if (!result.ok) return null;
    return result.value;
  }

  get_token(): LexerToken {
    return this.#tok;
  }

  get_symbol(): string {
    if (this.#tok.kind !== LexerTokenKind.Symbol) return '';
    return this.#tok.sym;
  }

  get_ident(): string {
    if (this.#tok.kind !== LexerTokenKind.Ident) return '';
    return this.#tok.ident;
  }

  get_pos(): SourcePosition {
    return { file: this.src, line: this.line, column: this.column };
  }

  clone() {
    const copy = new SimpLexer(this.src, this.buf);
    copy.cursor = this.cursor;
    copy.line = this.line;
    copy.column = this.column;
    return copy;
  }
}

export const Lex = (source_name: string, contents: string) => new SimpLexer(source_name, Utf8.encode(contents));
export type Lexer = ReturnType<typeof Lex>;

