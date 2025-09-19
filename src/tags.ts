import type { CursorPosition } from './utils';

export const Keyword = Object.freeze({
  Fn: 'fn',
  Function: 'function',
  If: 'if',
  Else: 'else',
  Return: 'return',
  Let: 'let',
} as const);
export type KeywordsMap = typeof Keyword;
export type Keyword = KeywordsMap[keyof KeywordsMap];
const keywords_array = Object.values(Keyword) as Array<Keyword>;
export function is_keyword(word: string): word is Keyword {
  if (word.length <= 1) return false;
  return keywords_array.includes(word as any);
}

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
    word: Keyword,
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


export const BinopOperators = Object.freeze({
  Math: ['+', '-', '/', '*', '%'],
  Comparison: ['>', '<', '==', '<=', '>=', '!='],
  Logical: ['&&', '||'],
} as const);
export type BinopOperatorsMap = { [K in keyof typeof BinopOperators]: typeof BinopOperators[K][number]; }
export type MathBinopOperator = (typeof BinopOperators)['Math'][number];
export type ComparisonBinopOperator = (typeof BinopOperators)['Comparison'][number];
export type LogicalBinopOperator = (typeof BinopOperators)['Logical'][number];
export type BinopOperator = BinopOperatorsMap[keyof BinopOperatorsMap];

export const binop_checker = Object.freeze({
  is_math_operator: (v: any): v is BinopOperatorsMap['Math'] => BinopOperators.Math.includes(v),
  is_comparison_operator: (v: any): v is BinopOperatorsMap['Comparison'] => BinopOperators.Comparison.includes(v),
  is_logical_operator: (v: any): v is BinopOperatorsMap['Logical'] => BinopOperators.Logical.includes(v),
  is_binop: (v: any): v is BinopOperator => BinopOperators.Math.includes(v) || BinopOperators.Comparison.includes(v) || BinopOperators.Logical.includes(v),
} as const);

export function is_binop(val: string): val is BinopOperator {
  if (BinopOperators.Math.includes(val as any)) return true;
  if (BinopOperators.Comparison.includes(val as any)) return true;
  if (BinopOperators.Logical.includes(val as any)) return true;
  return false;
}

// export interface BinopOperatorsMap {
//   Math: '+' | '-' | '/' | '*' | '%';
//   Comparison: '>' | '<' | '==' | '<=' | '>=' | '!=';
//   Logical: '&&' | '||';
// }

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
    op: BinopOperator;
    lhs: BinopItemParserNode;
    rhs: BinopItemParserNode;
  };

  PipeOperatorHead: {
    kind: 'pipe_operator_head';
    pos: CursorPosition;
    val: ExprParserNode;
    next: ParserNodesMap['PipeOperatorTail'];
  };

  PipeOperatorTail: {
    kind: 'pipe_operator_tail';
    pos: CursorPosition;
    val: ParserNodesMap['Identifier'] | ParserNodesMap['FuncCall'];
    next: ParserNodesMap['PipeOperatorTail'] | null;
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
  | ParserNodesMap['PipeOperatorHead']
  ;

export const ParserNodeKind = Object.freeze({
  EOF: 'eof',
  FuncDecl: 'fn_decl',
  FuncArgDecl: 'fn_arg_decl',
  FuncCall: 'call_fn',
  VarDecl: 'var_decl',
  Binop: 'binary_operator',
  PipeOperatorHead: 'pipe_operator_head',
  PipeOperatorTail: 'pipe_operator_tail',
  Grouped: 'grouped_expression',
  Keyword: 'keyword',
  IfElse: 'if-else',
  Identifier: 'identifier',
  Literal: 'literal',
} as const satisfies { [K in keyof ParserNodesMap]: ParserNodesMap[K]['kind']; });

export type ParserNodeKindsMap = typeof ParserNodeKind;
export type ParserNodeKind = ParserNodeKindsMap[keyof ParserNodeKindsMap];

