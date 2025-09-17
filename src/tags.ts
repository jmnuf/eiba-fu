import type { CursorPosition } from './utils';

export interface LexerTokensMap {
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


export interface BinopOperatorsMap {
  Math: '+' | '-' | '/' | '*' | '%';
  Comparison: '>' | '<' | '==' | '<=' | '>=' | '!=';
  Logical: '&&' | '||';
}

export interface ParserNodesMap {
  EOF: { kind: 'eof'; };

  FuncDecl: {
    kind: 'fn_decl';
    name: string;
    returns: string;
    args: Array<ParserNodesMap['FuncArgDecl']>;
    body: SimpParserNode[];
    pos: CursorPosition;
  };

  FuncArgDecl: {
    kind: 'fn_arg_decl';
    name: string;
    type: string;
    pos: CursorPosition;
  };

  FuncCall: {
    kind: 'call_fn';
    pos: CursorPosition;
    name: string;
    args: Array<SimpParserNode>;
  };

  Binop: {
    kind: 'binary_operator';
    pos: CursorPosition;
    op: BinopOperatorsMap[keyof BinopOperatorsMap];
    lhs: SimpParserNode;
    rhs: SimpParserNode;
  };

  // type PipeChainables = IdentNode | FnCallNode;
  PipeOperator: {
    kind: 'pipe_operator';
    pos: CursorPosition;
    val: Exclude<ExprParserNode, ParserNodesMap['PipeOperator']>;
    next: ParserNodesMap['PipeOperator'] | null;
  };

  Literal: {
    kind: 'literal';
    pos: CursorPosition;
    type: 'str';
    value: string;
  } | {
    kind: 'literal';
    pos: CursorPosition;
    type: 'int';
    value: number;
  };

  Grouped: {
    kind: 'grouped_expression';
    pos: CursorPosition;
    item: ExprParserNode | null;
  };

  Keyword: {
    kind: 'keyword';
    pos: CursorPosition;
    word: string;
    expr: ExprParserNode | null;
  };

  VarDecl: {
    kind: 'var_decl';
    pos: CursorPosition;
    name: string;
    type: {
      name: string;
      general: 'number' | null;
      infer_pos: (CursorPosition & { file: string; }) | null;
    };
    init: ExprParserNode | null;
  };

  Identifier: {
    kind: 'identifier';
    pos: CursorPosition;
    ident: string;
  };

  IfElse: {
    kind: 'if-else';
    pos: CursorPosition;
    cond: SimpParserNode;
    if_body: SimpParserNode[];
    else_body: null | SimpParserNode[];
  };
}

export type ParserNode = ParserNodesMap[keyof ParserNodesMap];
export type SimpParserNode = Exclude<ParserNode, ParserNodesMap['EOF'] | ParserNodesMap['FuncArgDecl']>;
export type StatementParserNode = Exclude<ParserNode, ParserNodesMap['EOF'] | ParserNodesMap['FuncArgDecl']>;

export type BinopItemParserNode =
  | ParserNodesMap['Literal']
  | ParserNodesMap['Identifier']
  | ParserNodesMap['FuncCall']
  | ParserNodesMap['Binop']
  | ParserNodesMap['Grouped']
  ;

export type ExprParserNode =
  | ParserNodesMap['FuncDecl']
  | ParserNodesMap['FuncCall']
  | ParserNodesMap['Binop']
  | ParserNodesMap['Grouped']
  | ParserNodesMap['Literal']
  | ParserNodesMap['Identifier']
  | ParserNodesMap['PipeOperator']
  ;

export const ParserNodeKind = Object.freeze({
  EOF: 'eof',
  FuncDecl: 'fn_decl',
  FuncArgDecl: 'fn_arg_decl',
  FuncCall: 'call_fn',
  VarDecl: 'var_decl',
  Binop: 'binary_operator',
  PipeOperator: 'pipe_operator',
  Grouped: 'grouped_expression',
  Keyword: 'keyword',
  IfElse: 'if-else',
  Identifier: 'identifier',
  Literal: 'literal',
} as const satisfies { [K in keyof ParserNodesMap]: ParserNodesMap[K]['kind']; });

export type ParserNodeKindsMap = typeof ParserNodeKind;
export type ParserNodeKind = ParserNodeKindsMap[keyof ParserNodeKindsMap];

