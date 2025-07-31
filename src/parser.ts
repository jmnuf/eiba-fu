import type { Lexer, SymToken } from './lexer';
import type { CursorPosition } from './utils';
import { create_parser_logger, get_current_line, compiler_logger, pipe, } from './utils';
import { TokenKind, Keywords } from './lexer';

export const AstNodeKind = Object.freeze({
  EOF: 'eof',
  FuncDecl: 'fndcl',
  FuncDclArg: 'fndclarg',
  FuncCall: 'fncal',
  VarDecl: 'vardcl',
  Binop: 'binop',
  PipeOp: 'pop',
  Expr: 'expr',
  Keyword: 'kword',
  IfElse: 'iffi',
  Ident: 'idnt',
  Literal: 'lit',
} as const);
type AstNodeKindsMap = (typeof AstNodeKind);
type AstNodeKind = AstNodeKindsMap[keyof AstNodeKindsMap];

export interface EoFNode {
  kind: AstNodeKindsMap['EOF'];
}

export interface FnDeclNode {
  kind: AstNodeKindsMap['FuncDecl'];
  name: string;
  returns: string;
  args: FnDArgNode[];
  body: Exclude<AstNode, EoFNode | FnDArgNode>[];
  pos: CursorPosition;
}

export interface FnDArgNode {
  kind: AstNodeKindsMap['FuncDclArg'];
  name: string;
  type: string;
  pos: CursorPosition;
}

export interface FnCallNode {
  kind: AstNodeKindsMap['FuncCall'];
  pos: CursorPosition;
  name: string;
  args: Exclude<AstNode, EoFNode | FnDArgNode>[];
}

export interface BinopNode {
  kind: AstNodeKindsMap['Binop'];
  pos: CursorPosition;
  op: BinopOperator;
  lhs: AstNode;
  rhs: AstNode;
}

// type PipeChainables = IdentNode | FnCallNode;
export interface PipeOpNode {
  kind: AstNodeKindsMap['PipeOp'];
  pos: CursorPosition;
  val: AstExprNode;
  next: PipeOpNode | null;
}

export type LiteralNode = {
  kind: AstNodeKindsMap['Literal'];
  pos: CursorPosition;
  type: 'str';
  value: string;
} | {
  kind: AstNodeKindsMap['Literal'];
  pos: CursorPosition;
  type: 'int';
  value: number;
}

export interface ExprNode {
  kind: AstNodeKindsMap['Expr'];
  pos: CursorPosition;
  item: AstExprNode | null;
}

export interface KeywordNode {
  kind: AstNodeKindsMap['Keyword'];
  pos: CursorPosition;
  word: string;
  expr: AstNode | null;
}

export interface VarDeclNode {
  kind: AstNodeKindsMap['VarDecl'];
  pos: CursorPosition;
  name: string;
  type: {
    name: string;
    infer_pos: (CursorPosition & { file: string; }) | null;
  };
  init: AstExprNode | null;
}

export interface IdentNode {
  kind: AstNodeKindsMap['Ident'];
  pos: CursorPosition;
  ident: string;
}

export interface IfElseNode {
  kind: AstNodeKindsMap['IfElse'];
  pos: CursorPosition;
  cond: Exclude<AstExprNode, FnDeclNode>;
  body: Exclude<AstNode, EoFNode>[];
  else: null | Exclude<AstNode, EoFNode>[];
}

export type AstNode =
  | EoFNode
  | FnDeclNode
  | FnDArgNode
  | FnCallNode
  | VarDeclNode
  | BinopNode
  | ExprNode
  | LiteralNode
  | KeywordNode
  | IfElseNode
  | IdentNode
  | PipeOpNode
  ;

export type AstExprNode =
  | FnDeclNode
  | FnCallNode
  | BinopNode
  | ExprNode
  | LiteralNode
  | IdentNode
  | PipeOpNode
  ;

export type AstStmtNode = Exclude<AstNode, FnDArgNode | EoFNode>;

export type BinopItemNode = LiteralNode | IdentNode | FnCallNode | BinopNode;

const concat_arr = <const T, const U>(a: readonly T[], b: readonly U[]) => a.concat(b as any) as Array<T | U>;
const MATH_BINOPS = ['+', '-', '/', '*', '%'] as const;
export type MathOperator = typeof MATH_BINOPS[number];
const CMP_BINOPS = ['>', '<', '==', '<=', '>=', '!='] as const;
export type ComparisonOperator = typeof CMP_BINOPS[number];
const LOGIC_BINOPS = ['&&', '||'] as const;
export type LogicalOperator = typeof LOGIC_BINOPS[number];
const BINOPS = pipe(
  MATH_BINOPS,
  arr => concat_arr(arr, CMP_BINOPS),
  arr => concat_arr(arr, LOGIC_BINOPS),
);
export type BinopOperator = typeof BINOPS[number];

const is_binop = (v: string): v is BinopOperator => BINOPS.includes(v as any);
const binops_precedence = [
  ['&&', '||'],
  ['%'],
  ['>', '<', '==', '<=', '>=', '!='],
  ['-', '+'],
  ['*', '/']
] as const satisfies Array<BinopOperator[]>;
const get_binop_precedence = (op: BinopOperator): number => binops_precedence.findIndex((opset: BinopOperator[]) => opset.includes(op));

class SimpParser {
  logger: ReturnType<typeof create_parser_logger>;
  lexer: Lexer;
  readonly file_path: string;

  constructor(file_path: string, l: Lexer) {
    this.file_path = file_path;
    this.logger = create_parser_logger(file_path);
    this.lexer = l;
  }

  parse_statement = (): Exclude<AstNode, FnDArgNode> | null => {
    const {
      lexer, logger,
      parse_expr,
      parse_if_else,
      expect_ident,
      expect_symbol_next,
    } = this;
    const tok = lexer.peek();

    switch (tok.kind) {
      case TokenKind.Keyword: {
        if (tok.kword == Keywords.If) {
          lexer.next();
          return parse_if_else(tok.pos);
        }

        if (tok.kword == Keywords.Var) {
          lexer.next();
          if (expect_ident()) {
            logger.info(tok.pos, 'When declaring a variable a name must be given to it');
            return null;
          }

          const name = lexer.get_ident();
          let init: VarDeclNode['init'] = null;
          const type: VarDeclNode['type'] = {
            name: '()',
            infer_pos: null,
          };

          if (expect_symbol_next(';', ':')) {
            logger.info(tok.pos, 'Missing semi-colon or initialization for variable');
            return null;
          }

          if (lexer.get_symbol() == ':') {
            let peek = lexer.peek();
            if (peek.kind != TokenKind.Symbol && peek.kind != TokenKind.Ident) {
              logger.error(peek.pos, `Expected either the symbol '=' or a type name but got ${tok.kind}`);
              return null;
            }

            if (peek.kind == TokenKind.Ident) {
              lexer.next();
              type.name = lexer.get_ident();
              type.infer_pos = {
                ...lexer.get_pos(),
                file: this.file_path,
              };
            }

            if (expect_symbol_next('=')) return null;

            const expr = parse_expr();
            if (!expr) {
              logger.info(tok.pos, 'Invalid variable initialization');
              return null;
            }
            init = expr;
            if (type.name == '()' && expr.kind == AstNodeKind.Literal) {
              if (expr.type == 'str') {
                type.name = 'string';
              } else if (expr.type == 'int') {
                type.name = 'isz';
              }
            }
            if (type.infer_pos == null) {
              type.infer_pos = {
                ...init.pos,
                file: this.file_path,
              };
            }
          }

          if (expect_symbol_next(';')) {
            logger.info(tok.pos, 'Missing semi-colon');
            return null;
          }

          return {
            kind: AstNodeKind.VarDecl,
            pos: lexer.get_token().pos,
            type,
            name, init,
          };
        }

        if (tok.kword === Keywords.Ret) {
          lexer.next();
          const peeked = lexer.peek();
          let expr: AstNode | null = null;
          if (peeked.kind != 'Symbol' || peeked.sym != ';') {
            expr = parse_expr();
            if (!expr) return null;
          }

          if (expect_symbol_next(';')) {
            logger.info(tok.pos, 'Statement is missing ending semi-colon');
            return null;
          }

          return {
            kind: AstNodeKind.Keyword,
            expr,
            pos: tok.pos,
            word: tok.kword,
          };
        }

        if (tok.kword == Keywords.Func) {
          lexer.next();
          const func = this.parse_func();
          if (!func) return null;
          const peek = lexer.peek();
          if (peek.kind == TokenKind.Symbol && peek.sym == ';') {
            lexer.next();
          }
          return func;
        }
      } break;

      case TokenKind.Ident: {
        const expr = parse_expr();
        if (!expr) return null;

        if (expr.kind != AstNodeKind.FuncDecl) {
          if (expect_symbol_next(';')) {
            logger.info(tok.pos, 'Missing semicolon');
            return null;
          }
        }

        return expr;
      }

      case TokenKind.EOF:
        lexer.next();
        return {
          kind: AstNodeKind.EOF,
        };

      case TokenKind.Integer: {
        const expr = parse_expr();
        if (!expr) return null;
        if (expect_symbol_next(';')) return null;
        return expr;
      }
    }

    logger.error(tok.pos, `Unexpected token`, tok);
    return null;
  }

  parse_func = (): FnDeclNode | null => {
    const {
      lexer, logger,
      parse_statement,
      expect_symbol_next,
      expect_ident,
    } = this;

    const pos = lexer.get_pos();
    if (expect_ident()) return null;
    const name = lexer.get_ident();

    let returns = null as string | null;
    const body = [] as FnDeclNode['body'];
    const args = [] as Array<FnDArgNode>;

    if (expect_symbol_next('(')) return null;
    // Parse arguments
    let tok = lexer.peek();
    while (tok.kind == TokenKind.Ident || tok.kind == TokenKind.Symbol) {
      if (tok.kind == TokenKind.Symbol) {
        if (tok.sym != ')') {
          logger.error(tok.pos, `Unexpected Symbol: expected ')' but got '${tok.sym}'`);
          return null;
        }
        break;
      }

      if (tok.kind == TokenKind.Ident) {
        lexer.next();
        const vname = tok.ident;
        const vpos = tok.pos;
        let type_name = '()';
        let peek = lexer.peek();
        if (peek.kind == TokenKind.Symbol && peek.sym == ':') {
          lexer.next();
          if (expect_ident()) {
            logger.info(tok.pos, 'Expected the type name for function argument', vname);
            return null;
          }
          type_name = lexer.get_ident();
        }
        // if (expect_symbol_next(',', ':')) return null;
        args.push({
          kind: AstNodeKind.FuncDclArg,
          name: vname,
          pos: vpos,
          type: type_name,
        });
      }

      if (expect_symbol_next(')', ',')) return null;
      tok = lexer.get_token() as SymToken;
      if (tok.sym == ')') break;
      tok = lexer.peek();
    }
    if (tok.kind != TokenKind.Symbol) {
      logger.error(tok.pos, `Unexpected ${tok.kind} in function arguments declaration`);
      return null;
    }

    if (args.length == 0 && expect_symbol_next(')')) return null;
    if (expect_symbol_next('{', '->')) return null;
    if (lexer.get_symbol() == '->') {
      if (expect_ident()) return null;
      returns = lexer.get_ident();
      if (expect_symbol_next('{')) return null;
    }

    tok = lexer.peek();
    while (tok.kind != TokenKind.Symbol || tok.sym != '}') {
      if (tok.kind === TokenKind.EOF) {
        logger.error(tok.pos, 'Expected symbol \'}\' but got EoF');
        return null;
      }

      const stmt = parse_statement();
      if (!stmt) {
        // logger.error(tok.pos, `Failed to parse token`, tok);
        return null;
      }

      if (stmt.kind === AstNodeKind.EOF) {
        logger.error(pos, 'Function is missing a closing brace before the end of file');
        return null;
      }

      body.push(stmt);

      tok = lexer.peek();
    }
    lexer.next();

    return {
      kind: AstNodeKind.FuncDecl,
      name, pos,
      args,
      body, returns: returns ?? '()',
    };
  }

  parse_expr = (): AstExprNode | null => {
    const {
      lexer, logger,
      parse_fn_call,
      parse_binop,
      parse_func,
      parse_pipe_op,
      parse_expr,
      expect_symbol_next,
    } = this;

    let tok = lexer.next();
    if (tok.kind == TokenKind.EOF) {
      logger.error(tok.pos, 'Unexpected end of file while attempting to parse expression');
      return null;
    }
    if (tok.kind == TokenKind.Keyword) {
      logger.error(tok.pos, 'Unexpected keyword ' + tok.kword + ' while attempting to parse expression');
      return null;
    }

    if (tok.kind == TokenKind.String) {
      const str: LiteralNode = {
        kind: AstNodeKind.Literal,
        type: 'str',
        value: tok.string,
        pos: tok.pos,
      };

      if ((lexer.peek() as SymToken).sym == '|>') {
        return parse_pipe_op(str);
      }

      return str;
    }

    if (tok.kind == TokenKind.Ident) {
      if (tok.ident == Keywords.Func) {
        return parse_func();
      }

      const peek = lexer.peek();
      if (peek.kind == TokenKind.Symbol && peek.sym == '(') {
        const fncall = parse_fn_call({
          kind: AstNodeKind.Ident,
          ident: tok.ident,
          pos: tok.pos,
        });

        if (!fncall) return null;

        const next = lexer.peek();

        if (next.kind == TokenKind.Symbol) {
          if (next.sym == '|>') {
            return parse_pipe_op(fncall);
          }
          if (is_binop(next.sym)) {
            return parse_binop(fncall);
          }
        }

        return fncall;
      }
    }

    if (tok.kind == TokenKind.Integer || tok.kind == TokenKind.Ident) {
      const base = tok;
      tok = lexer.peek();
      if (tok.kind != TokenKind.Symbol) {
        if (base.kind == TokenKind.Integer) {
          return {
            kind: AstNodeKind.Literal,
            type: 'int',
            value: base.int,
            pos: tok.pos,
          };
        } else if (base.kind == TokenKind.Ident) {
          return {
            kind: AstNodeKind.Ident,
            pos: tok.pos,
            ident: base.ident,
          };
        } else {
          // @ts-expect-error Base should always be of type never
          compiler_logger.error(get_current_line(), `Unhandled token kind ${base.kind}`);
          return null;
        }
      }

      let lhs: BinopItemNode;
      switch (base.kind) {
        case TokenKind.Ident:
          lhs = {
            kind: AstNodeKind.Ident,
            pos: base.pos,
            ident: base.ident,
          };
          break;

        case TokenKind.Integer:
          lhs = {
            kind: AstNodeKind.Literal,
            pos: base.pos, type: 'int',
            value: base.int,
          };
          break;
      }


      if (tok.sym == '|>') {
        return parse_pipe_op(lhs);
      }

      if (!is_binop(tok.sym)) return lhs;

      return parse_binop(lhs);
    }

    if (tok.sym == '"') {
      logger.error(tok.pos, `Unexpected symbol '${tok.sym}'`);
      logger.info(tok.pos, 'If you are trying to write a string literal we use the following syntax for it: `string content\'');
      return null;
    }

    if (tok.sym == '(') {
      const expr = parse_expr();
      if (expect_symbol_next(')')) {
        logger.info(lexer.get_pos(), 'Expected end of grouped expression to end with \')\'');
        return null;
      }
      const grouped: ExprNode = {
        kind: AstNodeKind.Expr,
        pos: tok.pos,
        item: expr,
      };

      if ((lexer.peek() as SymToken).sym == '|>') {
        return parse_pipe_op(grouped);
      }

      return grouped;
    }

    logger.error(tok.pos, 'Parser mishap');
    compiler_logger.info(get_current_line(), `Parser Mishap: Unhandled token kind ${tok.kind}`);
    console.log('stacktrace', (new Error()).stack);
    return null;
  }

  parse_fn_call = (ident: IdentNode): FnCallNode | null => {
    const {
      lexer: l, logger,
      parse_expr,
      expect_symbol_next,
    } = this;

    const args = [] as FnCallNode['args'];
    if (expect_symbol_next('(')) {
      compiler_logger.error(get_current_line(), `Compiler attempting to parse function call when missing '('`);
      return null;
    }

    let tok = l.peek();
    while (tok.kind != TokenKind.EOF) {
      if (tok.kind == TokenKind.Symbol && tok.sym == ')') break;
      const expr = parse_expr();
      if (!expr) return null;
      args.push(expr);
      if (expect_symbol_next(')', ',')) return null;
      tok = l.get_token() as SymToken;
    }
    if (tok.kind == TokenKind.EOF) {
      logger.error(ident.pos, 'Unexpectede end of file while parsing function call');
      return null;
    }

    return {
      kind: AstNodeKind.FuncCall,
      name: ident.ident,
      pos: ident.pos,
      args,
    };
  }

  parse_binop = (lhs: Exclude<BinopItemNode, BinopNode>): BinopNode | null => {
    const {
      lexer, logger,
      parse_expr,
      expect_symbol_next,
    } = this;

    if (expect_symbol_next(...BINOPS)) {
      compiler_logger.error(get_current_line(), 'Attempting to parse binop but no binop symbol in lexer');
      return null;
    }
    const op = lexer.get_symbol() as typeof BINOPS[number];
    const pos = lexer.get_pos();

    let rhs_expr = parse_expr();
    if (!rhs_expr) {
      logger.info(pos, 'Right side of binop is missing');
      return null;
    }

    let pipe: PipeOpNode | null = null;
    if (rhs_expr.kind == AstNodeKind.PipeOp) {
      pipe = rhs_expr;
      rhs_expr = pipe.val;
    }

    if (
      rhs_expr.kind != AstNodeKind.Literal
      && rhs_expr.kind != AstNodeKind.Ident
      && rhs_expr.kind != AstNodeKind.Binop
      && rhs_expr.kind != AstNodeKind.FuncCall
    ) {
      logger.error(pos, 'Right side of binop is of an invalid type', rhs_expr.kind);
      return null;
    }

    const rhs: BinopItemNode = rhs_expr;

    if (rhs.kind == AstNodeKind.Binop) {
      if (get_binop_precedence(rhs.op) < get_binop_precedence(op)) {
        const binop: BinopNode = {
          kind: AstNodeKind.Binop,
          op, pos,
          lhs, rhs: rhs.lhs,
        };
        rhs.lhs = binop;
        return rhs;
      }
    }

    return {
      kind: AstNodeKind.Binop,
      op, pos,
      lhs, rhs,
    };
  }

  parse_pipe_op = (start: AstExprNode): PipeOpNode | null => {
    const {
      lexer, logger,
      parse_expr,
      expect_symbol_next,
    } = this;
    if (expect_symbol_next('|>')) {
      compiler_logger.error(get_current_line(), 'Attempting to parse pipe operator when there the symbol is not in the lexer');
      return null;
    }
    const pos = lexer.get_pos();

    let expr = parse_expr();
    if (!expr) return null;
    if (expr.kind != AstNodeKind.Ident && expr.kind != AstNodeKind.FuncCall && expr.kind != AstNodeKind.PipeOp) {
      logger.error(expr.pos, 'Invalid pipe target. Can only pipe towards functions and partial function calls');
      return null;
    }

    if (expr.kind == 'pop') {
      return {
        kind: AstNodeKind.PipeOp,
        pos,
        val: start,
        next: expr,
      };
    }

    return {
      kind: AstNodeKind.PipeOp,
      pos,
      val: start,
      next: {
        kind: AstNodeKind.PipeOp,
        pos: expr.pos,
        val: expr,
        next: null,
      },
    };
  }

  parse_if_else = (pos: CursorPosition): IfElseNode | null => {
    const {
      lexer, logger,
      parse_expr,
      parse_statement,
      expect_symbol_next,
    } = this;
    // if (expect_symbol_next('(')) return null;
    const cond = parse_expr();
    if (!cond) return null;
    if (cond.kind == AstNodeKind.FuncDecl) {
      logger.error(cond.pos, 'Cannot set a function declaration as an if statement\'s condition');
      return null;
    }
    // if (expect_symbol_next(')')) return null;
    const body: IfElseNode['body'] = [];
    let tok = lexer.peek();
    if (tok.kind == TokenKind.Symbol && tok.sym == '{') {
      if (expect_symbol_next('{')) return null;
      while (tok.kind != TokenKind.Symbol || tok.sym != '}') {
        const stmt = parse_statement();
        if (!stmt) return null;
        if (stmt.kind == AstNodeKind.EOF) {
          logger.info(lexer.get_pos(), 'Missing to close if block');
          logger.info(pos, 'Start of if block');
          return null;
        }
        body.push(stmt);
        tok = lexer.peek();
      }
      if (expect_symbol_next('}')) {
        logger.info(lexer.get_pos(), 'Missing to close if block');
        logger.info(pos, 'Start of if block');
        return null;
      }
    } else {
      const expr = parse_statement();
      if (!expr) return null;
      if (expr.kind == AstNodeKind.EOF) {
        logger.info(lexer.get_pos(), 'Unexpected end of file when attempting to read body of if block');
        logger.info(pos, 'Start of if block');
        return null;
      }
      body.push(expr);
    }
    tok = lexer.peek();
    let othr: IfElseNode['else'] = null;
    if (tok.kind == 'Identifier' && tok.ident == 'else') {
      lexer.next();
      const else_pos = tok.pos;
      othr = [];
      tok = lexer.peek();
      if (tok.kind == TokenKind.Symbol && tok.sym == '{') {
        if (expect_symbol_next('{')) return null;
        while (tok.kind != TokenKind.Symbol || tok.sym != '}') {
          const stmt = parse_statement();
          if (!stmt) return null;
          if (stmt.kind == AstNodeKind.EOF) {
            logger.info(lexer.get_pos(), 'Missing to close else block');
            logger.info(else_pos, 'Start of else');
            return null;
          }
          othr.push(stmt);
          tok = lexer.peek();
        }
        if (expect_symbol_next('}')) {
          logger.info(lexer.get_pos(), 'Missing to close else block');
          logger.info(else_pos, 'Start of else');
          return null;
        }
      } else {
        const expr = parse_statement();
        if (!expr) return null;
        if (expr.kind == AstNodeKind.EOF) {
          logger.info(lexer.get_pos(), 'Unexpected end of file when attempting to read body of else block');
          logger.info(pos, 'Start of if block');
          return null;
        }
        othr.push(expr);
      }
    }

    return {
      kind: AstNodeKind.IfElse,
      pos,
      cond,
      body,
      else: othr,
    };
  }

  expect_kind = (k: TokenKind, ...ekinds: TokenKind[]) => {
    const { lexer, logger } = this;
    const tok = lexer.next();
    if (tok.kind == k) return false;

    if (ekinds.length == 0) {
      logger.error(tok.pos, `Expected ${k} but got ${tok.kind}`);
      return true;
    }

    for (const kind of ekinds) {
      if (tok.kind == kind) return false;
    }
    logger.error(tok.pos, `Expected either of ${k},${ekinds} but got ${tok.kind}`);
    return true;
  }

  expect_int = () => {
    const { lexer, logger } = this;
    const tok = lexer.next();
    if (tok.kind != TokenKind.Integer) {
      logger.error(tok.pos, 'Expected integer');
      return true;
    }
    return false;
  }

  expect_symbol_next = (...symbols: string[]) => {
    const { lexer, logger } = this;

    const tok = lexer.next();
    if (tok.kind !== TokenKind.Symbol) {
      if (symbols.length == 0) {
        logger.error(tok.pos, `Expected symbol but got ${tok.kind}`);
        return true;
      }

      if (symbols.length == 1) {
        logger.error(tok.pos, `Expected symbol ('${symbols[0]!}') but got ${tok.kind}`);
        return true;
      }

      const str_symbols = symbols.map(s => `'${s}'`).join(', ');
      logger.error(tok.pos, `Expected one of the following symbols (${str_symbols}) but got ${tok.kind}`);
      return true;
    }

    if (symbols.length > 0) {
      if (symbols.length == 1) {
        const sym = symbols[0]!;
        if (tok.sym != sym) {
          logger.error(tok.pos, `Expected symbol '${sym}' but got symbol ${tok.sym}`);
          return true;
        }

        return false;
      }

      for (const sym of symbols) {
        if (tok.sym === sym) return false;
      }

      const str_symbols = symbols.map(s => `'${s}'`).join(', ');
      logger.error(tok.pos, `Expected one of the following symbols (${str_symbols}) but found the symbol '${tok.sym}'`);
      return true;
    }

    return false;
  }

  expect_ident = () => {
    const { lexer, logger } = this;

    const tok = lexer.next();
    if (tok.kind !== TokenKind.Ident) {
      logger.error(tok.pos, `Expected an identifier but got ${tok.kind}`);
      return true;
    }

    return false;
  }

}

export function pipe_node_to_list(head: PipeOpNode) {
  const list = [];
  let node: PipeOpNode | null = head;
  while (node) {
    list.push(node);
    node = node.next;
  }
  return list;
}

export function pipe_node_to_fn_call_node(head: PipeOpNode) {
  if (head.next == null) return null;

  let first = true;
  let prv: AstExprNode = null as any;
  for (const node of pipe_node_it(head)) {
    if (first) {
      first = false;
      prv = node.val;
      continue;
    }

    const val = node.val;
    if (val.kind != AstNodeKind.FuncCall && val.kind != AstNodeKind.Ident) {
      compiler_logger.info(get_current_line(), 'Invalid node kind in pipe chain');
      return null;
    }

    if (val.kind == AstNodeKind.Ident) {
      const subcall: FnCallNode = {
        kind: AstNodeKind.FuncCall,
        args: [prv],
        name: val.ident,
        pos: val.pos,
      };
      prv = subcall;
      continue;
    }

    if (val.kind == AstNodeKind.FuncCall) {
      const subcall: FnCallNode = {
        kind: AstNodeKind.FuncCall,
        args: [...val.args, prv],
        name: val.name,
        pos: val.pos,
      };
      prv = subcall;
      continue;
    }

    compiler_logger.info(get_current_line(), 'Unhandled node val kind', node_debug_fmt(val));
    return null;
  }

  if (prv.kind != AstNodeKind.FuncCall) return null;
  return prv;
}

export function* pipe_node_it(head: PipeOpNode) {
  let node: PipeOpNode | null = head;
  while (node) {
    yield node;
    node = node.next;
  }
}

export const Parse = (file_path: string, l: Lexer) => new SimpParser(file_path, l);
export type Parser = ReturnType<typeof Parse>;

// Passing through function calls just cause I was doing string interpolation with ``
// but I just like seeing the ts errors on fn calls better
export function node_debug_fmt(node: AstNode | undefined | null): string {
  if (!node) return `NULL`;

  switch (node.kind) {
    case AstNodeKind.EOF: return 'EoF{}';

    case AstNodeKind.Literal: return pipe(
      node.value,
      JSON.stringify,
      val => `Literal{${val}}`,
    );

    case AstNodeKind.Keyword: return pipe(
      [node.word, node.expr ? node_debug_fmt(node.expr) : '()'] as const,
      ([kword, expr]) => `Keyword{${kword}, (${expr})}`,
    );

    case AstNodeKind.Ident: return pipe(
      node.ident,
      ident => `Ident{${ident}}`
    );

    case AstNodeKind.FuncDecl: return pipe(
      [node.name, node.args.map(node_debug_fmt).join(', '), node.body.map(node_debug_fmt).join(', ')] as const,
      ([name, args, body]) => `FnDecl{${name}, Args{${args}}, Body{${body}}}`,
    );

    case AstNodeKind.FuncCall: return pipe(
      [node.name, node.args.map(node_debug_fmt).join(', ')] as const,
      ([name, args]) => `FnCall{${name}, (${args})}`,
    );

    case AstNodeKind.Binop: return pipe(
      [node_debug_fmt(node.lhs), node.op, node_debug_fmt(node.rhs)] as const,
      ([lhs, op, rhs]) => `BinOp{${lhs}, ${op}, ${rhs}}`,
    );

    case AstNodeKind.Expr: return pipe(
      node.item,
      node_debug_fmt,
      a => `Expr{${a}}`
    );

    case AstNodeKind.PipeOp: return pipe(
      node.val,
      node_debug_fmt,
      val => [val, node_debug_fmt(node.next)] as const,
      ([from, to]) => to == 'NULL' ? `${from}` : `Pipe{${from} |> ${to}}`,
    );
    default: return `${node.kind}{..}`;
  }
}

