import type { CursorPosition } from './utils';



interface LexerTokensMap {
  EOF: {
    kind: 'eof';
    pos: CursorPosition;
  };

  Symbol: {
    kind: 'symbol';
    pos: CursorPosition;
    sym: string;
  };

  Ident: {
    kind: 'identifier';
    pos: CursorPosition;
    ident: string;
  };

  Keyword: {
    kind: 'keyword';
    pos: CursorPosition;
    word: string;
  };

  Number: {
    kind: 'number';
    pos: CursorPosition;
    is_float: boolean;
    num: number;
  };

  String: {
    kind: 'string';
    pos: CursorPosition;
    string: string;
  };
}

export const LexerTokenKind = Object.freeze({
  EOF: 'eof',
  Symbol: 'symbol',
  Ident: 'identifier',
  Keyword: 'keyword',
  Number: 'number',
  String: 'string',
} as const satisfies { [K in keyof LexerTokensMap]: LexerTokensMap[K]['kind']; });

export type LexerTokenKindsMap = typeof LexerTokenKind;
export type LexerTokenKind = LexerTokenKindsMap[keyof LexerTokenKindsMap];
export type LexerToken = LexerTokensMap[keyof LexerTokensMap];


