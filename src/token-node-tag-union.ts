import type { CursorPosition, Prettify } from './utils';
import type { int } from './ctype';

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
  RETURN: 'return',
  DEFER: 'defer',
} as const;

export type SyntaxNodeTagsMap = typeof SYNTAX_NODE_TAG;
export type SyntaxNodeTag = SyntaxNodeTagsMap[keyof SyntaxNodeTagsMap];

export interface SyntaxNode {
  tag: SyntaxNodeTag;
  pos: CursorPosition;
}

export interface FnArgDeclNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['FUNC_ARG_DECL'];
  name: string;
  type: string;
}

export interface FnDeclNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['FUNC_DECL'];
  name: string;
  returns: string;
  args: FnArgDeclNode[];
  body: SimpSyntaxNode[];
}

export interface FnCallNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['FUNC_CALL'];
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


export interface BinOpNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['BIN_OP'];
  op: BinopOperator;
  lhs: SimpSyntaxNode;
  rhs: SimpSyntaxNode;
}

export interface PipeOpNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['PIPE_OP'];
  val: SyntaxNodeWithoutTag<SyntaxNodeTagsMap['PIPE_OP'], ExprSyntaxNode>;
  next: PipeOpNode | null;
}

export interface IntLitNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['INT_LITERAL'];
  value: int;
}

export interface FltLitNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['FLT_LITERAL'];
  value: number;
}

export interface StrLitNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['STR_LITERAL'];
  value: string;
}

export interface ExprNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['EXPR'];
  expr: SyntaxNode | null;
}

export interface ReturnNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['RETURN'];
}

export interface VarDeclNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['VAR_DECL'];
  name: string;
  type_name: string | null;
  init: SyntaxNode | null;
}

export interface IdentNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['IDENT'];
  ident: string;
}

export interface IfElseNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['IF_ELSE'];
  cond: SyntaxNode;
  if_body: SyntaxNode[];
  else_body: SyntaxNode[] | null;
}

export interface DeferNode extends SyntaxNode {
  tag: SyntaxNodeTagsMap['DEFER'];
  body: SyntaxNodeWithoutTag<SyntaxNodeTagsMap['FUNC_DECL'], ExprSyntaxNode>[];
}


type SyntaxNodeWithoutTag<T extends SyntaxNodeTag, BaseNode extends SyntaxNode = SyntaxNode> = Prettify<{
  [K in keyof BaseNode]: K extends 'tag'
  ? Exclude<SyntaxNodeTag, T>
  : BaseNode[K];
}>;
type SyntaxNodeWithTag<T extends SyntaxNodeTag, BaseNode extends SyntaxNode = SyntaxNode> = Prettify<{
  [K in keyof BaseNode]: K extends 'tag'
  ? Extract<SyntaxNodeTag, T>
  : BaseNode[K];
}>;

export type SimpSyntaxNode = SyntaxNodeWithoutTag<SyntaxNodeTagsMap['FUNC_ARG_DECL']>;
export type ExprSyntaxNode = SyntaxNodeWithTag<
  SyntaxNodeTagsMap['FUNC_DECL'] | SyntaxNodeTagsMap['FUNC_CALL'] | SyntaxNodeTagsMap['BIN_OP'] | SyntaxNodeTagsMap['EXPR'] | SyntaxNodeTagsMap['INT_LITERAL'] | SyntaxNodeTagsMap['FLT_LITERAL'] | SyntaxNodeTagsMap['STR_LITERAL'] | SyntaxNodeTagsMap['IDENT'] | SyntaxNodeTagsMap['PIPE_OP']
>;

