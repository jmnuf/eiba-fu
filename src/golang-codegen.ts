import {
  type AstNode,
  AstNodeKind,
  pipe_node_to_fn_call_node,
  node_debug_fmt,
} from './parser';
import type {
  CodeGen,
  TargetCodeGen,
  TargetCodeGenSetupConfig,
} from './utils';
import { compiler_logger, ensure_valid_output_path_from_input_path, get_current_line, pipe } from './utils';

function replace_print_calls(n: AstNode | null | undefined): boolean {
  if (!n) return false;

  switch (n.kind) {
    case AstNodeKind.EOF: case 'fndclarg': case 'lit': return false;
    case AstNodeKind.FuncDecl: return n.body.map(replace_print_calls).some(r => r);
    case AstNodeKind.VarDecl: return replace_print_calls(n.init);
    case AstNodeKind.Expr: return replace_print_calls(n.item);
    case AstNodeKind.Keyword: return replace_print_calls(n.expr);
    case AstNodeKind.Binop: {
      const lhs = replace_print_calls(n.lhs);
      const rhs = replace_print_calls(n.rhs);
      return lhs || rhs;
    }
    case AstNodeKind.PipeOp: {
      const start = replace_print_calls(n.val);
      const next = replace_print_calls(n.next);
      return start || next;
    }

    case AstNodeKind.IfElse: {
      const cond = replace_print_calls(n.cond);
      const body = n.body.map(replace_print_calls).some(r => r);
      const othw = n.else ? n.else.map(replace_print_calls).some(r => r) : false;
      return cond || body || othw;
    }

    case AstNodeKind.Ident: {
      if (n.ident == 'printf') {
        n.ident = 'fmt.Printf';
        return true;
      }
      if (n.ident == 'printnf') {
        n.ident = 'fmt.Printf';
        return true;
      }
      return false;
    };

    case AstNodeKind.FuncCall: {
      const replaced = n.args.map(replace_print_calls).some(r => r);
      if (n.name == 'printf') {
        n.name = 'fmt.Printf';
        return true;
      }

      if (n.name == 'printnf') {
        n.name = 'fmt.Printf';
        const first_arg = n.args[0];
        if (!first_arg) {
          n.args.push({
            kind: 'lit',
            type: 'str',
            value: '\n',
            pos: { line: n.pos.line, column: n.pos.column + 9, },
          });
        } else {
          let added_newline = false;
          if (first_arg.kind == 'lit') {
            if (first_arg.type == 'str') {
              first_arg.value += '\n';
              added_newline = true;
            }
          }

          if (!added_newline) {
            const args = n.args;
            n.args = [{
              kind: 'fncal',
              args, name: 'fmt.Sprintf',
              pos: { ...n.pos },
            }];
            n.name = 'fmt.Println';
          }
        }

        return true;
      }

      return replaced;
    }
  }

  // @ts-ignore
  throw new Error('Missing to handle kind ' + n.kind);
}

class GoCodegen implements TargetCodeGen {
  private cg: CodeGen | null;

  constructor() {
    this.cg = null;
  }

  setup_codegen(cfg: TargetCodeGenSetupConfig): boolean {
    const { nodes, parser } = cfg;
    const log = parser.logger;
    const output_path = ensure_valid_output_path_from_input_path(cfg.input_path, cfg.output_path, '.go');

    const imports = new Set<string>();
    const vars = [] as CodeGen['vars'];
    const funcs = [] as CodeGen['funcs'];

    for (const node of nodes) {
      if (replace_print_calls(node)) {
        imports.add('fmt');
      }

      this.adapt_node_native_type_names(node);

      if (node.kind == 'eof') break;

      if (node.kind == 'vardcl') {
        vars.push(node);
        continue;
      }

      if (node.kind == 'fndcl') {
        funcs.push(node);

        // This is just a way of unhandling missing types but the type system is written this should be an error
        for (const arg of node.args) {
          if (arg.type === '()') arg.type = 'int';
        }

        continue;
      }

      log.error(node.pos, `Unsupported code emission for top level node: ${node_debug_fmt(node)}`);
      return true;
    }

    let buf = '';

    this.cg = {
      imports,
      vars,
      funcs,
      output_path,
      write(code) {
        buf += code;
      },
      async flush() {
        const file = Bun.file(output_path);
        const bytes = new TextEncoder().encode(buf);
        const wrote = await file.write(bytes);
        return wrote != bytes.length;
      }
    };

    return false;
  }

  adapt_native_type_name(type_name: string) {
    switch (type_name) {
      case 'u8': return 'uint8';
      case 'i8': return 'int8';

      case 'u32': return 'uint32';
      case 'i32': return 'int32';

      case 'u64': return 'uint64';
      case 'i64': return 'int64';

      case 'usz': return 'uint';
      case 'isz': return 'int';

      // case '()': return '';
    }
    return type_name;
  }

  adapt_node_native_type_names(node: AstNode | null) {
    if (!node) return;
    const adapt_native_type_name = this.adapt_native_type_name.bind(this);
    const adapt_node_native_type_names = this.adapt_node_native_type_names.bind(this);

    switch (node.kind) {
      case AstNodeKind.EOF: break;
      case AstNodeKind.FuncDclArg: {
        // TODO: Once TypeChecker is made remove this conditionally added int type
        node.type = node.type == '()' ? 'int' : adapt_native_type_name(node.type);
      } break;
      case AstNodeKind.FuncDecl: {
        node.returns = adapt_native_type_name(node.returns);
        for (const n of node.args) adapt_node_native_type_names(n);
        for (const n of node.body) adapt_node_native_type_names(n);
      } break;
      case AstNodeKind.VarDecl: {
        node.type.name = adapt_native_type_name(node.type.name);
        adapt_node_native_type_names(node.init);
      } break;
      case AstNodeKind.IfElse: {
        adapt_node_native_type_names(node.cond);
        for (const n of node.body) adapt_node_native_type_names(n);
        if (node.else) for (const n of node.else) adapt_node_native_type_names(n);
      } break;
    }
  }

  node_to_code(node: AstNode | null, indent_lvl = 0): string | Error {
    const indent = indent_lvl == 0 ? '' : Array.from({ length: indent_lvl }).map(() => '\t').join('');
    if (!node) return `${indent}nil`;
    const node_to_code = this.node_to_code.bind(this);

    switch (node.kind) {
      case AstNodeKind.EOF: return '';
      case AstNodeKind.FuncCall: {
        const args = [] as string[];
        for (const a of node.args) {
          const code = node_to_code(a);
          if (typeof code != 'string') return code;
          args.push(code);
        }
        return `${indent}${node.name}(${args.join(', ')})`;
      }

      case AstNodeKind.FuncDecl: {
        const args = [] as string[];
        for (const a of node.args) {
          const ac = node_to_code(a);
          if (typeof ac != 'string') return ac;
          args.push(ac);
        }
        const body = [] as string[];
        for (const b of node.body) {
          const bc = node_to_code(b, indent_lvl + 1);
          if (typeof bc != 'string') return bc;
          body.push(bc);
        }
        const ret = node.returns == 'void' || node.returns == '()' ? '' : ' ' + node.returns;
        return `${indent}func ${node.name}(${args.join(', ')})${ret} {\n${body.join('\n')}\n${indent}}`;
      }

      case AstNodeKind.FuncDclArg: {
        return `${indent}${node.name} ${node.type}`;
      }

      case AstNodeKind.Literal: {
        if (node.type == 'int') {
          return indent + node.value.toString(10);
        }
        return indent + JSON.stringify(node.value);
      }

      case AstNodeKind.Binop: return node_to_code(node.lhs) + node.op + node_to_code(node.rhs);
      case AstNodeKind.Keyword: return indent + node.word + (node.expr ? ' ' + node_to_code(node.expr) : '');
      case AstNodeKind.Ident: return indent + node.ident;

      case AstNodeKind.VarDecl: {
        if (!node.init) return `${indent}var ${node.name} int`;
        const init = node_to_code(node.init);
        if (typeof init != 'string') return init;
        if (node.type.name == '()' && indent_lvl > 0) {
          return indent + `${node.name} := ${init}`;
        }
        const type_name = node.type.name == '()' ? 'int' : node.type.name;
        return `${indent}var ${node.name} ${type_name} = ${init}`;
      }

      case AstNodeKind.IfElse: {
        const cond = node_to_code(node.cond);
        const body: string[] = [];
        for (const n of node.body) {
          const nc = node_to_code(n, indent_lvl + 1);
          if (typeof nc != 'string') return nc;
          body.push(nc);
        }

        if (!node.else) return `${indent}if (${cond}) {\n${body.join('\n')}\n${indent}}`;

        const othw: string[] = [];
        for (const n of node.else) {
          const nc = node_to_code(n, indent_lvl + 1);
          if (typeof nc != 'string') return nc;
          othw.push(nc);
        }

        return `${indent}if (${cond}) {\n${body.join('\n')}\n${indent}} else {\n${othw.join('\n')}\n${indent}}`;
      }

      case AstNodeKind.PipeOp: {
        const fncall = pipe_node_to_fn_call_node(node);
        if (!fncall) return new Error('Failed to produce function call sequence from pipe operator chain');
        return node_to_code(fncall, indent_lvl);
      }

      case AstNodeKind.Expr: return pipe(
        node.item,
        node_to_code,
        expr => typeof expr == 'string' ? `(${expr})` : expr,
      );

    }

    // @ts-expect-error node should be of type never
    const kind: string = node.kind;
    compiler_logger.error(get_current_line(), 'Do not know how to handle node of kind ' + kind + ' in go codegen');
    return new Error('Do not know how to handle node of kind ' + kind + ' in go codegen');
  }

  emit_code(): boolean {
    const node_to_code = this.node_to_code.bind(this);
    const cg = this.cg;
    if (!cg) {
      compiler_logger.error(get_current_line(), 'Attempting to emit golang code without having setup the golang codegen')
      return true;
    }

    cg.write('package main\n\n');

    if (cg.imports.size > 0) {
      if (cg.imports.size == 1) {
        const imp = cg.imports.values().next().value!;
        cg.write(`import "${imp}"\n`);
      } else {
        cg.write('import (');
        for (const imp of cg.imports) {
          cg.write(`\n\t"${imp}"`);
        }
        cg.write('\n)\n');
      }
    }

    for (const vrdcl of cg.vars) {
      const code = node_to_code(vrdcl);
      if (typeof code != 'string') {
        compiler_logger.error(get_current_line(), code.message);
        console.log(code.stack);
        return true;
      }
      cg.write(`\n${code}\n`);
    }

    for (const func of cg.funcs) {
      const code = node_to_code(func);
      if (typeof code != 'string') {
        compiler_logger.error(get_current_line(), code.message);
        console.log(code.stack);
        return true;
      }
      cg.write('\n' + code + '\n');
    }

    return false;
  }

  get_mod() {
    return this.cg;
  }
}

export default new GoCodegen();

