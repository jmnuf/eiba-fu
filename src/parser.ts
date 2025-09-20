import type { LexerTokensMap } from './tags';
import {
  LexerTokenKind,
  LexerTokenKind as TokenKind,

  type ParserNodesMap,
  type ParserNode,
  type BinopItemParserNode,
  type ExprParserNode,
  type BinopOperator,
  BinopOperators,
  ParserNodeKind,

  Keyword,

  binop_checker,
  parser_node_debug_fmt,
} from './tags';
import type { Lexer } from './lexer';
import type { CursorPosition } from './utils';
import { create_parser_logger, get_current_line, compiler_logger, } from './utils';

type SymToken = LexerTokensMap['Symbol'];
type FnDeclNode = ParserNodesMap['FuncDecl'];
type FnDArgNode = ParserNodesMap['FuncArgDecl'];
type VarDeclNode = ParserNodesMap['VarDecl'];
type LiteralNode = ParserNodesMap['Literal'];
type ExprNode = ParserNodesMap['Grouped'];
type IdentNode = ParserNodesMap['Identifier'];
type FnCallNode = ParserNodesMap['FuncCall'];
type BinopNode = ParserNodesMap['Binop'];
type IfElseNode = ParserNodesMap['IfElse'];
type PipeOpHeadNode = ParserNodesMap['PipeOperatorHead'];
type PipeOpTailNode = ParserNodesMap['PipeOperatorTail'];

// Listed from lowest to highest precedence
const binops_precedence = [
  ['&&', '||'],
  ['>', '<', '==', '<=', '>=', '!='],
  ['-', '+'],
  ['*', '/', '%'],
] as const satisfies Array<BinopOperator[]>;
const get_binop_precedence = (op: BinopOperator): number => binops_precedence.findIndex((opset: BinopOperator[]) => opset.includes(op));
const ALL_BINOPS = Object.freeze(Object.values(BinopOperators).reduce((acc, val) => acc.concat(val), [] as Array<BinopOperator>));

class SimpParser {
  logger: ReturnType<typeof create_parser_logger>;
  lexer: Lexer;
  readonly file_path: string;

  constructor(file_path: string, l: Lexer) {
    this.file_path = file_path;
    this.logger = create_parser_logger(file_path);
    this.lexer = l;
  }

  parse_statement = (): Exclude<ParserNode, FnDArgNode> | null => {
    const {
      lexer, logger,
      parse_expr,
      parse_if_else,
      expect_ident,
      expect_symbol_next,
    } = this;
    const tok = lexer.peek();
    if (!tok) return null;

    switch (tok.kind) {
      case TokenKind.Keyword: {
        if (tok.word == Keyword.If) {
          lexer.next();
          return parse_if_else(tok.pos);
        }

        if (tok.word == Keyword.Let) {
          lexer.next();
          if (expect_ident()) {
            logger.info(tok.pos, 'When declaring a variable a name must be given to it');
            return null;
          }

          const name = lexer.get_ident();
          let init: VarDeclNode['init'] = null;
          const type: VarDeclNode['type'] = {
            name: '()',
            general: null,
            infer_pos: null,
          };

          if (expect_symbol_next(';', ':')) {
            logger.info(tok.pos, 'Missing semi-colon or initialization for variable');
            return null;
          }

          if (lexer.get_symbol() == ':') {
            let peek = lexer.peek();
            if (!peek) {
              // TODO: Error reporting
              return null;
            }

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
            if (type.name == '()' && expr.kind == ParserNodeKind.Literal) {
              if (expr.type == 'str') {
                type.name = 'string';
              } else if (expr.type == 'int') {
                type.general = 'number';
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
            kind: ParserNodeKind.VarDecl,
            pos: lexer.get_token().pos,
            type,
            name, init,
          };
        }

        if (tok.word === Keyword.Return) {
          lexer.next();
          const peeked = lexer.peek();
          if (!peeked) return null;
          let expr: ParserNode | null = null;
          if (peeked.kind != 'symbol' || peeked.sym != ';') {
            expr = parse_expr();
            if (!expr) return null;
          }

          if (expect_symbol_next(';')) {
            logger.info(tok.pos, 'Statement is missing ending semi-colon');
            return null;
          }

          return {
            kind: ParserNodeKind.Keyword,
            expr,
            pos: tok.pos,
            word: tok.word,
          };
        }

        if (tok.word == Keyword.Fn || tok.word == Keyword.Function) {
          lexer.next();
          const func = this.parse_func();
          if (!func) return null;
          const peek = lexer.peek();
          // TODO: Error reporting
          if (!peek) return null;
          if (peek.kind == TokenKind.Symbol && peek.sym == ';') {
            lexer.next();
          }
          return func;
        }
      } break;

      case TokenKind.Ident: {
        const expr = parse_expr();
        if (!expr) return null;

        if (expr.kind != ParserNodeKind.FuncDecl) {
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
          kind: ParserNodeKind.EOF,
        };

      case TokenKind.Number: {
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
    // TODO: Error reporitng
    if (tok == null) return null;
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
        if (!peek) return null;
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
          kind: ParserNodeKind.FuncArgDecl,
          name: vname,
          pos: vpos,
          type: type_name,
        });
      }

      if (expect_symbol_next(')', ',')) return null;
      tok = lexer.get_token() as SymToken;
      if (tok.sym == ')') break;
      tok = lexer.peek();
      if (!tok) return null;
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
    if (!tok) return null;
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

      if (stmt.kind === ParserNodeKind.EOF) {
        logger.error(pos, 'Function is missing a closing brace before the end of file');
        return null;
      }

      body.push(stmt);

      tok = lexer.peek();
      if (!tok) return null;
    }
    lexer.next();

    return {
      kind: ParserNodeKind.FuncDecl,
      name, pos,
      args,
      body, returns: returns ?? '()',
    };
  }

  parse_expr = (): ExprParserNode | null => {
    const {
      lexer, logger,
      parse_fn_call,
      parse_binop,
      parse_func,
      parse_pipe_op,
      parse_expr,
      expect_symbol_next,
    } = this;

    let pos = lexer.get_pos();
    let tok_result = lexer.next();
    if (!tok_result.ok) {
      logger.error(pos, tok_result.error);
      return null;
    }
    let tok = tok_result.value;
    if (tok.kind == TokenKind.EOF) {
      logger.error(tok.pos, 'Unexpected end of file while attempting to parse expression');
      return null;
    }
    if (tok.kind == TokenKind.Keyword) {
      logger.error(tok.pos, 'Unexpected keyword ' + tok.word + ' while attempting to parse expression');
      return null;
    }

    if (tok.kind == TokenKind.String) {
      const str: LiteralNode = {
        kind: ParserNodeKind.Literal,
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
      if (tok.ident == Keyword.Fn || tok.ident == Keyword.Function) {
        return parse_func();
      }

      const peek = lexer.peek();
      if (!peek) return null;
      if (peek.kind == TokenKind.Symbol && peek.sym == '(') {
        const fncall = parse_fn_call({
          kind: ParserNodeKind.Identifier,
          ident: tok.ident,
          pos: tok.pos,
        });

        if (!fncall) return null;

        const next = lexer.peek();
        if (!next) return null;

        if (next.kind == TokenKind.Symbol) {
          if (next.sym == '|>') {
            return parse_pipe_op(fncall);
          }
          if (binop_checker.is_binop(next.sym)) {
            return parse_binop(fncall);
          }
        }

        return fncall;
      }
    }

    if (tok.kind == TokenKind.Number || tok.kind == TokenKind.Ident) {
      const base = tok;
      tok = lexer.peek()!;
      if (!tok) return null;
      if (tok.kind != TokenKind.Symbol) {
        if (base.kind == TokenKind.Number) {
          if (base.is_float) {
            // TODO: Handle float literals
            return null;
          }
          return {
            kind: ParserNodeKind.Literal,
            type: 'int',
            value: base.num,
            pos: tok.pos,
          };
        } else if (base.kind == TokenKind.Ident) {
          return {
            kind: ParserNodeKind.Identifier,
            pos: tok.pos,
            ident: base.ident,
          };
        }
        // @ts-expect-error Base should always be of type never
        compiler_logger.error(get_current_line(), `Unhandled token kind ${base.kind}`);
        return null;
      }

      let lhs: BinopItemParserNode;
      switch (base.kind) {
        case TokenKind.Ident:
          lhs = {
            kind: ParserNodeKind.Identifier,
            pos: base.pos,
            ident: base.ident,
          };
          break;

        case TokenKind.Number:
          if (base.is_float) return null;
          lhs = {
            kind: ParserNodeKind.Literal,
            pos: base.pos, type: 'int',
            value: base.num,
          };
          break;
      }


      if (tok.sym == '|>') {
        return parse_pipe_op(lhs);
      }

      if (!binop_checker.is_binop(tok.sym)) return lhs;

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
        kind: ParserNodeKind.Grouped,
        pos: tok.pos,
        item: expr,
      };

      if ((lexer.peek() as SymToken).sym == '|>') {
        return parse_pipe_op(grouped);
      }

      return grouped;
    }

    const stacktrace = (new Error()).stack; logger.error(tok.pos, 'Parser mishap');
    compiler_logger.error(get_current_line(), `Parser Mishap: Unhandled token kind ${tok.kind}`);
    console.log('stacktrace', stacktrace);
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
    if (!tok) return null;
    if (tok.kind != TokenKind.Symbol || tok.sym != ')') {
      while (tok.kind != TokenKind.EOF) {
        if (tok.kind == TokenKind.Symbol && tok.sym == ')') break;
        const expr = parse_expr();
        if (!expr) return null;
        args.push(expr);
        if (expect_symbol_next(')', ',')) return null;
        tok = l.get_token() as SymToken;
      }
    } else {
      const pos = l.get_pos();
      const result = l.next();
      if (!result.ok) {
        logger.error(pos, result.error);
        return null;
      }
      tok = result.value;
    }

    if (tok.kind == TokenKind.EOF) {
      logger.error(ident.pos, 'Unexpected end of file while parsing function call');
      return null;
    }

    return {
      kind: ParserNodeKind.FuncCall,
      name: ident.ident,
      pos: ident.pos,
      args,
    };
  }

  parse_binop = (lhs: Exclude<BinopItemParserNode, BinopNode>): BinopNode | null => {
    const {
      lexer, logger,
      parse_expr,
      expect_symbol_next,
    } = this;

    if (expect_symbol_next(...ALL_BINOPS)) {
      compiler_logger.error(get_current_line(), 'Attempting to parse binop but no binop symbol in lexer');
      return null;
    }
    const op = lexer.get_symbol() as BinopOperator;
    const pos = lexer.get_pos();

    let rhs_expr = parse_expr();
    if (!rhs_expr) {
      logger.info(pos, 'Right side of binop is missing');
      return null;
    }

    if (rhs_expr.kind == ParserNodeKind.PipeOperatorHead) {
      rhs_expr = rhs_expr.val;
    }

    if (
      rhs_expr.kind != ParserNodeKind.Literal
      && rhs_expr.kind != ParserNodeKind.Identifier
      && rhs_expr.kind != ParserNodeKind.Binop
      && rhs_expr.kind != ParserNodeKind.FuncCall
    ) {
      logger.error(pos, 'Right side of binop is of an invalid type', rhs_expr.kind);
      return null;
    }

    const rhs: BinopItemParserNode = rhs_expr;

    if (rhs.kind == ParserNodeKind.Binop) {
      if (get_binop_precedence(rhs.op) < get_binop_precedence(op)) {
        const binop: BinopNode = {
          kind: ParserNodeKind.Binop,
          op, pos,
          lhs, rhs: rhs.lhs,
        };
        rhs.lhs = binop;
        return rhs;
      }
    }

    return {
      kind: ParserNodeKind.Binop,
      op, pos,
      lhs, rhs,
    };
  }

  parse_pipe_op = (start: PipeOpHeadNode['val']): PipeOpHeadNode | null => {
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
    if (expr.kind != ParserNodeKind.Identifier && expr.kind != ParserNodeKind.FuncCall && expr.kind != ParserNodeKind.PipeOperatorHead) {
      logger.error(expr.pos, 'Invalid pipe target. Can only pipe towards functions by name and partial function calls');
      return null;
    }

    if (expr.kind == ParserNodeKind.PipeOperatorHead) {
      if (expr.val.kind != ParserNodeKind.Identifier && expr.val.kind != ParserNodeKind.FuncCall) {
        logger.error(expr.pos, 'Invalid pipe target. Can only pipe towards functions by name and partial function calls');
        return null;
      }

      const next = expr as unknown as PipeOpTailNode;
      next.kind = ParserNodeKind.PipeOperatorTail;
      return {
        kind: ParserNodeKind.PipeOperatorHead,
        pos,
        val: start,
        next,
      };
    }

    return {
      kind: ParserNodeKind.PipeOperatorHead,
      pos,
      val: start,
      next: {
        kind: ParserNodeKind.PipeOperatorTail,
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
    if (cond.kind == ParserNodeKind.FuncDecl) {
      logger.error(cond.pos, 'Cannot set a function declaration as an if statement\'s condition');
      return null;
    }
    // if (expect_symbol_next(')')) return null;
    const body: IfElseNode['if_body'] = [];
    let tok = lexer.peek();
    if (!tok) return null;
    if (tok.kind == TokenKind.Symbol && tok.sym == '{') {
      if (expect_symbol_next('{')) return null;
      while (tok.kind != TokenKind.Symbol || tok.sym != '}') {
        const stmt = parse_statement();
        if (!stmt) return null;
        if (stmt.kind == ParserNodeKind.EOF) {
          logger.info(lexer.get_pos(), 'Missing to close if block');
          logger.info(pos, 'Start of if block');
          return null;
        }
        body.push(stmt);
        tok = lexer.peek();
        if (!tok) return null;
      }
      if (expect_symbol_next('}')) {
        logger.info(lexer.get_pos(), 'Missing to close if block');
        logger.info(pos, 'Start of if block');
        return null;
      }
    } else {
      const expr = parse_statement();
      if (!expr) return null;
      if (expr.kind == ParserNodeKind.EOF) {
        logger.info(lexer.get_pos(), 'Unexpected end of file when attempting to read body of if block');
        logger.info(pos, 'Start of if block');
        return null;
      }
      body.push(expr);
    }
    tok = lexer.peek();
    if (!tok) return null;
    let othr: IfElseNode['else_body'] = null;
    if (tok.kind == LexerTokenKind.Ident && tok.ident == 'else') {
      lexer.next();
      const else_pos = tok.pos;
      othr = [];
      tok = lexer.peek();
      if (!tok) return null;
      if (tok.kind == TokenKind.Symbol && tok.sym == '{') {
        if (expect_symbol_next('{')) return null;
        while (tok.kind != TokenKind.Symbol || tok.sym != '}') {
          const stmt = parse_statement();
          if (!stmt) return null;
          if (stmt.kind == ParserNodeKind.EOF) {
            logger.info(lexer.get_pos(), 'Missing to close else block');
            logger.info(else_pos, 'Start of else');
            return null;
          }
          othr.push(stmt);
          tok = lexer.peek();
          if (!tok) return null;
        }
        if (expect_symbol_next('}')) {
          logger.info(lexer.get_pos(), 'Missing to close else block');
          logger.info(else_pos, 'Start of else');
          return null;
        }
      } else {
        const expr = parse_statement();
        if (!expr) return null;
        if (expr.kind == ParserNodeKind.EOF) {
          logger.info(lexer.get_pos(), 'Unexpected end of file when attempting to read body of else block');
          logger.info(pos, 'Start of if block');
          return null;
        }
        othr.push(expr);
      }
    }

    return {
      kind: ParserNodeKind.IfElse,
      pos,
      cond,
      if_body: body,
      else_body: othr,
    };
  }

  expect_kind = (k: TokenKind, ...ekinds: TokenKind[]) => {
    const { lexer, logger } = this;
    const lex_result = lexer.next();
    if (!lex_result.ok) return false;
    const tok = lex_result.value;
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

  expect_number = () => {
    const { lexer, logger } = this;
    const lex_result = lexer.next();
    if (!lex_result.ok) {
      logger.error(lexer.get_pos(), lex_result.error);
      return false;
    }
    const tok = lex_result.value;
    if (tok.kind != TokenKind.Number) {
      logger.error(tok.pos, 'Expected number');
      return true;
    }
    return false;
  }

  expect_int = () => {
    const { lexer, logger } = this;
    const lex_result = lexer.next();
    if (!lex_result.ok) {
      logger.error(lexer.get_pos(), lex_result.error);
      return false;
    }
    const tok = lex_result.value;
    if (tok.kind != TokenKind.Number || !tok.is_float) {
      logger.error(tok.pos, 'Expected integer');
      return true;
    }
    return false;
  }

  expect_symbol_next = (...symbols: string[]) => {
    const { lexer, logger } = this;

    const lex_result = lexer.next();
    if (!lex_result.ok) return false;
    const tok = lex_result.value;
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

    const pos = lexer.get_pos();
    const lex_result = lexer.next();
    if (!lex_result.ok) {
      logger.error(pos, lex_result.error);
      return false;
    }
    const tok = lex_result.value;
    if (tok.kind !== TokenKind.Ident) {
      logger.error(tok.pos, `Expected an identifier but got ${tok.kind}`);
      return true;
    }

    return false;
  }

}

export function pipe_node_to_list(head: PipeOpHeadNode) {
  const list: [head: PipeOpHeadNode, ...tail: Array<PipeOpTailNode>] = [head];
  let node: PipeOpTailNode | null = head.next;
  while (node) {
    list.push(node);
    node = node.next;
  }
  return list;
}

export function pipe_node_to_fn_call_node(head: PipeOpHeadNode) {
  if (head.next == null) return null;

  let first = true;
  let prv: ExprParserNode = null as any;
  for (const node of pipe_node_it(head)) {
    if (first) {
      first = false;
      prv = node.val;
      continue;
    }

    const val = node.val;
    if (val.kind != ParserNodeKind.FuncCall && val.kind != ParserNodeKind.Identifier) {
      compiler_logger.info(get_current_line(), 'Invalid node kind in pipe chain');
      return null;
    }

    if (val.kind == ParserNodeKind.Identifier) {
      const subcall: FnCallNode = {
        kind: ParserNodeKind.FuncCall,
        args: [prv],
        name: val.ident,
        pos: val.pos,
      };
      prv = subcall;
      continue;
    }

    if (val.kind == ParserNodeKind.FuncCall) {
      const subcall: FnCallNode = {
        kind: ParserNodeKind.FuncCall,
        args: [...val.args, prv],
        name: val.name,
        pos: val.pos,
      };
      prv = subcall;
      continue;
    }

    compiler_logger.info(get_current_line(), 'Unhandled node val kind', parser_node_debug_fmt(val));
    return null;
  }

  if (prv.kind != ParserNodeKind.FuncCall) return null;
  return prv;
}

export function* pipe_node_it(head: PipeOpHeadNode) {
  let node: PipeOpHeadNode | PipeOpTailNode | null = head;
  while (node) {
    yield node;
    node = node.next;
  }
}

export const Parse = (file_path: string, l: Lexer) => new SimpParser(file_path, l);
export type Parser = ReturnType<typeof Parse>;


