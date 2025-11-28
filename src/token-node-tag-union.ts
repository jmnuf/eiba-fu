import type { CursorPosition } from './utils';

export const TOKEN_TAG = {
  EOF: 'EOF',
  SYMBOL: 'Symbol',
  IDENT: 'Ident',
  NUMBER: 'Number',
  STRING: 'String',
} as const;

export type TokenTag = (typeof TOKEN_TAG)[keyof (typeof TOKEN_TAG)];

export interface Token {
  kind: TokenTag;
  pos: CursorPosition;

  string: string;
  number: number;
}

export const SYNTAX_NODE_TAG = {
  FUNC_DECL: 'Fndcl',
  FUNC_ARG_DECL: 'FnArgDcl',
  FUNC_CALL: 'FnCall',
  VAR_DECL: 'var_dcl',
  BIN_OP: 'BinOp',
  PIPE_OP: 'PipeOp',
  EXPR: 'Expr',
  IF_ELSE: 'IfElse',
  IDENT: 'Ident',
  INT_LITERAL: 'IntLit',
  FLT_LITERAL: 'FltLit',
  STR_LITERAL: 'StrLit',
} as const;

export type SyntaxNodeTagsMap = typeof SYNTAX_NODE_TAG;
export type SyntaxNodeTag = SyntaxNodeTagsMap[keyof SyntaxNodeTagsMap];

interface FnArgDeclNode {
  name: string;
  type: string;
}

interface FnDeclNode {
  name: string;
  returns: string;
  args: FnArgDeclNode[];
  body: SimpSyntaxNode[];
}

interface FnCallNode {
  name: string;
  args: SimpSyntaxNode;
}


export const BinopOperators = {
  Math: ['+', '-', '/', '*', '%'],
  Comparison: ['>', '<', '==', '<=', '>=', '!='],
  Logical: ['&&', '||'],
} as const;
export type BinopOperatorsMap = { [K in keyof typeof BinopOperators]: typeof BinopOperators[K][number]; }
export type MathBinopOperator = (typeof BinopOperators)['Math'][number];
export type ComparisonBinopOperator = (typeof BinopOperators)['Comparison'][number];
export type LogicalBinopOperator = (typeof BinopOperators)['Logical'][number];
export type BinopOperator = BinopOperatorsMap[keyof BinopOperatorsMap];

export const binop_checker = {
  is_math_operator: (v: any): v is BinopOperatorsMap['Math'] => BinopOperators.Math.includes(v),
  is_comparison_operator: (v: any): v is BinopOperatorsMap['Comparison'] => BinopOperators.Comparison.includes(v),
  is_logical_operator: (v: any): v is BinopOperatorsMap['Logical'] => BinopOperators.Logical.includes(v),
  is_binop: (v: any): v is BinopOperator => BinopOperators.Math.includes(v) || BinopOperators.Comparison.includes(v) || BinopOperators.Logical.includes(v),
} as const;

export function is_binop(val: string): val is BinopOperator {
  if (BinopOperators.Math.includes(val as any)) return true;
  if (BinopOperators.Comparison.includes(val as any)) return true;
  if (BinopOperators.Logical.includes(val as any)) return true;
  return false;
}


interface BinOpNode {
  op: BinopOperator;
  lhs: SimpSyntaxNode;
  rhs: SimpSyntaxNode;
}

interface PipeOpNode {
  val: SyntaxNodeWithoutTag<SyntaxNodeTagsMap['PIPE_OP'], ExprSyntaxNode>;
  next: PipeOpNode | null;
}

type int = number & {};

export const is_int = (n: unknown): n is int => Number.isInteger(n);
export const flt_as_int = (n: number): int => Math.floor(n);

interface IntLitNode {
  value: int;
}

interface FltLitNode {
  value: number;
}

interface StrLitNode {
  value: string;
}

interface ExprNode {
  expr: SyntaxNode | null;
}

interface ReturnNode { }

interface VarDeclNode {
  name: string;
  type_name: string | null;
  init: SyntaxNode | null;
}

interface IdentNode {
  ident: string;
}

interface IfElseNode {
  cond: SyntaxNode;
  if_body: SyntaxNode[];
  else_body: SyntaxNode[] | null;
}

export interface SyntaxNode {
  tag: SyntaxNodeTag;
  pos: CursorPosition;

  fn_decl: FnDeclNode;
  fn_arg_decl: FnDeclNode;
  fn_call: FnCallNode;

  binop: BinOpNode;
  pipe: PipeOpNode;

  int_lit: IntLitNode;
  flt_lit: FltLitNode;
  str_lit: StrLitNode;

  expr: ExprNode;
  returns: ReturnNode;

  var_decl: VarDeclNode;
  ident: IdentNode;

  if_else: IfElseNode;
}

type SyntaxNodeWithoutTag<T extends SyntaxNodeTag, BaseNode extends SyntaxNode = SyntaxNode> = {
  [K in keyof BaseNode]: K extends 'tag'
  ? Exclude<SyntaxNodeTag, T>
  : BaseNode[K];
};
type SyntaxNodeWithTag<T extends SyntaxNodeTag, BaseNode extends SyntaxNode = SyntaxNode> = {
  [K in keyof BaseNode]: K extends 'tag'
  ? Extract<SyntaxNodeTag, T>
  : BaseNode[K];
};

export type SimpSyntaxNode = SyntaxNodeWithoutTag<SyntaxNodeTagsMap['FUNC_ARG_DECL']>;
export type ExprSyntaxNode = SyntaxNodeWithTag<
  SyntaxNodeTagsMap['FUNC_DECL'] | SyntaxNodeTagsMap['FUNC_CALL'] | SyntaxNodeTagsMap['BIN_OP'] | SyntaxNodeTagsMap['EXPR'] | SyntaxNodeTagsMap['INT_LITERAL'] | SyntaxNodeTagsMap['FLT_LITERAL'] | SyntaxNodeTagsMap['STR_LITERAL'] | SyntaxNodeTagsMap['IDENT'] | SyntaxNodeTagsMap['PIPE_OP']
>;

