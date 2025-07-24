import type { CursorPosition } from './utils';

export const Keywords = {
  Func: 'fn',
  If: 'if',
  Ret: 'return',
  Var: 'let',
} as const;
type KeywordsMap = typeof Keywords;
type Keyword = KeywordsMap[keyof KeywordsMap];
const is_keyword = (s: string): s is Keyword => Object.values(Keywords).includes(s as Keyword);

export const TokenKind = Object.freeze({
  EOF: 'EoF',
  Symbol: 'Symbol',
  Ident: 'Identifier',
  Keyword: 'Keyword',
  Integer: 'Integer',
  String: 'String',
} as const);

export type TokenKindsMap = (typeof TokenKind);

export type TokenKind = (typeof TokenKind)[keyof (typeof TokenKind)];

// interface TokenKindMap {
//   EOF: {
//     kind: 'EoF';
//     pos: CursorPosition;
//   };
//   Symbol: {
//   };
// }

export type EOFToken = {
  kind: TokenKindsMap['EOF'];
  pos: CursorPosition;
}
export type SymToken = {
  kind: TokenKindsMap['Symbol'];
  pos: CursorPosition;
  sym: string;
}
export type IdentToken = {
  kind: TokenKindsMap['Ident'];
  pos: CursorPosition;
  ident: string;
}
export type IntToken = {
  kind: TokenKindsMap['Integer'];
  pos: CursorPosition;
  int: number;
}

export type StrToken = {
  kind: TokenKindsMap['String'];
  pos: CursorPosition;
  string: string;
}

export type KeywordToken = {
  kind: TokenKindsMap['Keyword'];
  pos: CursorPosition;
  kword: Keyword;
}

export type Token =
  | EOFToken
  | SymToken
  | IdentToken
  | KeywordToken
  | IntToken
  | StrToken
  ;

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
  #tok: Token;

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

  next(): Token {
    const buf = this.buf;
    if (this.cursor >= buf.length || buf.length == 0) {
      this.#tok = {
        kind: TokenKind.EOF,
        pos: { line: this.line, column: this.column },
      };
      return this.#tok;
    }

    while (this.cursor < buf.length) {
      const ch = buf[++this.cursor];
      if (!ch) {
        this.cursor = buf.length;
        this.#tok = {
          kind: TokenKind.EOF,
          pos: { line: this.line, column: this.column },
        };
        return this.#tok;
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
          kind: TokenKind.EOF,
          pos: { line: this.line, column: this.column },
        };
        return this.#tok;
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
        kind: TokenKind.String,
        pos: { line, column },
        string: str,
      };

      return this.#tok;
    }

    if (ch == '&' && buf[this.cursor + 1] == '&') {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: TokenKind.Symbol,
        pos: { line, column },
        sym: '&&',
      };
      return this.#tok;
    }

    if (ch == '|' && buf[this.cursor + 1] == '|') {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: TokenKind.Symbol,
        pos: { line, column },
        sym: '||',
      };
      return this.#tok;
    }

    if (ch == '=') {
      const next = buf[this.cursor + 1]!;
      if (next == '>' || next == '=') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: TokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return this.#tok;
      }
    }

    if (ch == '!' && buf[this.cursor + 1] == '=') {
      this.cursor++;
      this.column++;
      this.#tok = {
        kind: TokenKind.Symbol,
        pos: { line, column },
        sym: '!=',
      };
      return this.#tok;
    }

    if (ch == '>') {
      const next = buf[this.cursor + 1]!;
      if (next == '>' || next == '=') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: TokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return this.#tok;
      }
    }

    if (ch == '<') {
      const next = buf[this.cursor + 1]!;
      if (next == '<' || next == '=') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: TokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return this.#tok;
      }
    }

    if (ch == '|') {
      const next = buf[this.cursor + 1]!;
      if (next == '>' || next == '|') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: TokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return this.#tok;
      }
    }

    let negative = false;
    if (ch === '-') {
      const next = buf[this.cursor + 1]!;
      if (next == '>') {
        this.cursor++;
        this.column++;
        this.#tok = {
          kind: TokenKind.Symbol,
          pos: { line, column },
          sym: `${ch}${next}`,
        };
        return this.#tok;
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
        kind: TokenKind.Integer,
        pos: { line, column },
        int,
      };

      return this.#tok;
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
          kind: TokenKind.Keyword,
          pos: { line, column },
          kword: str,
        };
        return this.#tok;
      }

      this.#tok = {
        kind: TokenKind.Ident,
        pos: { line, column },
        ident: str,
      };
      return this.#tok;
    }


    this.#tok = {
      kind: TokenKind.Symbol,
      pos: { line, column },
      sym: ch!,
    };
    return this.#tok;
  }

  peek() {
    return this.clone().next();
  }

  get_token(): Token {
    return this.#tok;
  }

  get_symbol(): string {
    if (this.#tok.kind !== TokenKind.Symbol) return '';
    return this.#tok.sym;
  }

  get_ident(): string {
    if (this.#tok.kind !== TokenKind.Ident) return '';
    return this.#tok.ident;
  }

  get_pos() {
    return this.#tok.pos;
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

