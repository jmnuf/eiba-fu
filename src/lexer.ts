import type { LexerToken } from './tags';
import { LexerTokenKind, is_keyword } from './tags';
import type { SourcePosition } from './utils';
import { Result } from './utils';


function is_char_whitespace(char: number) {
  return char == 9 || char == 10 || char == 13 || char == 32;
}

function is_char_alphabetic(char: number) {
  //      65 = 'A'          90 = 'Z'    97 = 'a'         122 = 'z'
  return (65 <= char && char <= 90) || (97 <= char && char <= 122);
}

function is_char_numeric(char: number) {
  //     48 = '0'             57 = '9'
  return 48 <= char && char <= 57;
}

function is_char_alphanumeric(char: number) {
  return is_char_alphabetic(char) || is_char_numeric(char);
}

function is_char_usable_for_an_identifier(char: number) {
  return char == 95 || is_char_alphanumeric(char);
}

class SimpLexer {
  private cursor: number;
  private line: number;
  private column: number;
  private buf: string;
  private src: string;
  #tok: LexerToken;

  constructor(source_name: string, buffer: string) {
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

      if (is_char_whitespace(ch.codePointAt(0)!)) {
        if (ch === '\n') {
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
    let code = ch.codePointAt(0)!;

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

      if (is_char_numeric(next.codePointAt(0)!)) {
        negative = true;
        ch = next;
        code = next.codePointAt(0)!;
      }
    }

    if (is_char_numeric(code)) {
      let str = '';

      while (ch && is_char_numeric(code)) {
        str += ch;
        ch = buf[++this.cursor];
        code = ch?.codePointAt(0) ?? 0;
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

    if (is_char_usable_for_an_identifier(code)) {
      let str = '';

      while (ch && is_char_usable_for_an_identifier(code)) {
        str += ch;
        ch = buf[++this.cursor];
        code = ch?.codePointAt(0) ?? 0;
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

export const Lex = (source_name: string, contents: string) => new SimpLexer(source_name, contents);
export type Lexer = ReturnType<typeof Lex>;

