import type { LexerToken } from './tags';
import { LexerTokenKind, is_keyword } from './tags';
import type { CursorPosition } from './utils';
import { Result } from './utils';


const is_whitespace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

const ALPHABET_CHARS = Object.freeze([
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
]);
const NUMERIC_CHARS = Object.freeze([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
] as const);

const is_alpha_ch = (ch: string) => ALPHABET_CHARS.includes(ch.toLowerCase() as any);
const is_num_ch = (ch: string) => NUMERIC_CHARS.includes(ch as any);
const is_alphanum_ch = (ch: string) => is_alpha_ch(ch) || is_num_ch(ch);

const is_valid_ident_ch = (ch: string) => is_alphanum_ch(ch) || ch === '_';

class SimpLexer {
  private cursor: number;
  private line: number;
  private column: number;
  private buf: string;
  #tok: LexerToken;

  constructor(buf: string) {
    this.buf = buf;
    this.cursor = -1;
    this.column = 0;
    this.line = 1;
    this.next = this.next.bind(this);
    this.#tok = null as any;
  }

  eof() {
    return this.cursor >= this.buf.length;
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
      if (!ch) {
        this.cursor = buf.length;
        this.#tok = {
          kind: LexerTokenKind.EOF,
          pos: { line: this.line, column: this.column },
        };
        return Result.Ok(this.#tok);
      }
      this.column++;

      if (is_whitespace(ch)) {
        if (ch === '\n') {
          this.line++;
          this.column = 0;
        }
        continue;
      }

      break;
    }

    let ch = buf[this.cursor];
    if (ch == '/' && buf[this.cursor + 1] == '/') {
      this.cursor++;
      this.column++;
      while (ch && ch != '\n') {
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

    if (ch === '`') {
      let str = ''; // TODO: Possibly should handle unterminated strings properly but it doesn't really matter right now
      ch = buf[++this.cursor];
      while (ch != `'`) {
        let escpaing = false;
        if (ch == '\\') {
          ch = buf[++this.cursor];
          if (ch == null) break;
          escpaing = true;
        }

        if (escpaing) {
          switch (ch) {
            case 'n': ch = '\n'; break;
            case 'r': ch = '\r'; break;
            case 't': ch = '\t'; break;
          }
        }

        str += ch;
        ch = buf[++this.cursor];
      }

      this.#tok = {
        kind: LexerTokenKind.String,
        pos: { line, column },
        string: str,
      };

      return Result.Ok(this.#tok);
    }

    if (ch == '&' && buf[this.cursor + 1] == '&') {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: LexerTokenKind.Symbol,
        pos: { line, column },
        sym: '&&',
      };
      return Result.Ok(this.#tok);
    }

    if (ch == '|' && buf[this.cursor + 1] == '|') {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: LexerTokenKind.Symbol,
        pos: { line, column },
        sym: '||',
      };
      return Result.Ok(this.#tok);
    }

    if (ch == '=') {
      const next = buf[this.cursor + 1]!;
      if (next == '>' || next == '=') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: LexerTokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return Result.Ok(this.#tok);
      }
    }

    if (ch == '!' && buf[this.cursor + 1] == '=') {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: LexerTokenKind.Symbol,
        pos: { line, column },
        sym: '!=',
      };
      return Result.Ok(this.#tok);
    }

    if (ch == '>') {
      const next = buf[this.cursor + 1]!;
      if (next == '>' || next == '=') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: LexerTokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return Result.Ok(this.#tok);
      }
    }

    if (ch == '<') {
      const next = buf[this.cursor + 1]!;
      if (next == '<' || next == '=') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: LexerTokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return Result.Ok(this.#tok);
      }
    }

    if (ch == '|') {
      const next = buf[this.cursor + 1]!;
      if (next == '>' || next == '|') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: LexerTokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return Result.Ok(this.#tok);
      }
    }

    let negative = false;
    if (ch === '-') {
      const next = buf[this.cursor + 1]!;
      if (next == '>') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: LexerTokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return Result.Ok(this.#tok);
      }

      if (is_num_ch(next)) {
        negative = true;
        ch = next;
      }
    }

    if (is_num_ch(ch!)) {
      let str = '';

      while (ch && is_num_ch(ch)) {
        str += ch;
        ch = buf[++this.cursor];
        this.column++;
      }
      this.cursor--;

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

    if (is_valid_ident_ch(ch!)) {
      let str = '';

      while (ch && is_valid_ident_ch(ch)) {
        str += ch;
        ch = buf[++this.cursor];
        this.column++;
      }
      this.cursor--;

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
      sym: ch!,
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

  get_pos(): CursorPosition {
    return { line: this.line, column: this.column };
  }

  clone() {
    const copy = new SimpLexer(this.buf);
    copy.cursor = this.cursor;
    copy.line = this.line;
    copy.column = this.column;
    return copy;
  }
}

export const Lex = (contents: string) => new SimpLexer(contents);
export type Lexer = ReturnType<typeof Lex>;

