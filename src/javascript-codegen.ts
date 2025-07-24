import { AstNodeKind, pipe_node_to_fn_call_node, type AstNode } from './parser';
import {
  ensure_valid_output_path_from_input_path,
  get_current_line,
  compiler_logger,
  pipe,
  type CodeGen,
  type TargetCodeGen,
  type TargetCodeGenSetupConfig,
} from './utils';

const get_indent_from_lvl = (lvl: number) => lvl <= 0 ? '' : Array.from({ length: lvl }).map(() => '  ').join('');

class JavascriptCodegen implements TargetCodeGen {
  private cg: CodeGen | null;

  constructor() {
    this.cg = null;
  }

  setup_codegen(cfg: TargetCodeGenSetupConfig): boolean {
    const { nodes } = cfg;
    const output_path = ensure_valid_output_path_from_input_path(cfg.input_path, cfg.output_path, '.js');

    const imports = new Set<string>();
    const vars = [] as CodeGen['vars'];
    const funcs = [] as CodeGen['funcs'];

    for (const node of nodes) {
      if (node.kind == AstNodeKind.EOF) break;

      if (node.kind == AstNodeKind.VarDecl) {
        vars.push(node);
        continue;
      }

      if (node.kind == AstNodeKind.FuncDecl) {
        funcs.push(node);
        continue;
      }
    }

    let buf = '';
    this.cg = {
      imports,
      vars,
      funcs,
      output_path,
      write(code) { buf += code; },
      async flush() {
        const file = Bun.file(output_path);
        const bytes = new TextEncoder().encode(buf);
        const wrote = await file.write(bytes);
        return wrote != bytes.length;
      }
    };
    return false;
  }

  node_to_code(node: AstNode | null, indent_lvl = 0): string | Error {
    const indent = get_indent_from_lvl(indent_lvl);
    if (!node) return `${indent}null`;
    const node_to_code = this.node_to_code.bind(this);

    let code: string | null = null;
    switch (node.kind) {
      case AstNodeKind.EOF: code = ''; break;
      case AstNodeKind.Ident: code = node.ident; break;
      case AstNodeKind.FuncDclArg: code = node.name; break;
      case AstNodeKind.Literal: {
        if (node.type == 'int') {
          code = node.value.toString(10);
        } else {
          code = JSON.stringify(node.value);
        }
      } break;

      case AstNodeKind.Binop: {
        const lhs = node_to_code(node.lhs);
        if (typeof lhs != 'string') return lhs;
        const rhs = node_to_code(node.rhs);
        if (typeof rhs != 'string') return rhs;
        const op = node.op;

        code = `${lhs} ${op} ${rhs}`;
      } break;

      case AstNodeKind.Keyword: {
        code = node.word;
        if (node.expr) {
          const expr = node_to_code(node.expr);
          if (typeof expr != 'string') return expr;
          code += ' ' + expr;
        }
      } break;

      case AstNodeKind.Expr: {
        const expr = node_to_code(node.item);
        if (typeof expr != 'string') return expr;
        code = !node.item ? '()' : `(${expr})`;
      } break;

      case AstNodeKind.VarDecl: {
        const init = node_to_code(node.init);
        if (typeof init != 'string') return init;
        code = `let ${node.name} = ${init}`;
      } break;

      case AstNodeKind.FuncCall: {
        const args: string[] = [];
        for (const a of node.args) {
          const ac = node_to_code(a, -1);
          if (typeof ac != 'string') return ac;
          args.push(ac);
        }
        code = pipe(
          [node.name, args.join(', ')] as const,
          ([name, args]) => `(yield* ${name}(${args}))`
        );
      } break;

      case AstNodeKind.PipeOp: {
        const res = pipe(
          node,
          pipe_node_to_fn_call_node,
          fncall => fncall
            ? node_to_code(fncall, indent_lvl)
            : new Error('Failed to produce function call sequence from pipe operator chain')
        );
        if (typeof res != 'string') return res;
        code = res;
      } break;

      case AstNodeKind.FuncDecl: {
        const args = [] as string[];
        for (const a of node.args) {
          const ac = node_to_code(a);
          if (typeof ac != 'string') return ac;
          args.push(ac);
        }
        const body = [] as string[];
        let full_body: string;
        const last_stmt = node.body[node.body.length - 1]!
        const tailcalling = (last_stmt.kind == 'fncal' && last_stmt.name == node.name && last_stmt.args.length == node.args.length);

        if (tailcalling) {
          for (const b of node.body.slice(0, node.body.length - 1)) {
            const bc = node_to_code(b, indent_lvl + 2);
            if (typeof bc != 'string') return bc;
            body.push(bc);
          }

          const body_indent = get_indent_from_lvl(indent_lvl + 1);

          for (let i = 0; i < node.args.length; ++i) {
            const a = node.args[i]!.name;
            const b = node_to_code(last_stmt.args[i]!);
            if (typeof b != 'string') return b;
            body.push(get_indent_from_lvl(indent_lvl + 2) + `${a} = ${b}`);
          }

          full_body = pipe(body.join(';\n') + ';', b => `${body_indent}while (true) {\n${b}\n${body_indent}}`);
        } else {
          for (const b of node.body) {
            const bc = node_to_code(b, indent_lvl + (tailcalling ? 2 : 1));
            if (typeof bc != 'string') return bc;
            body.push(bc);
          }

          full_body = body.join(';\n') + ';';
        }

        code = pipe(
          [node.name, args.join(', '), full_body] as const,
          ([name, args, body]) => `function* ${name}(${args}) {\n${body}\n${indent}}`,
        );
      } break;

      case AstNodeKind.IfElse: {
        const if_body: string[] = [];
        for (const b of node.body) {
          const bc = node_to_code(b, indent_lvl + 1);
          if (typeof bc != 'string') return bc;
          if_body.push(bc);
        }

        const cond = node_to_code(node.cond);
        if (typeof cond != 'string') return cond;
        if (!node.else) {
          code = pipe(
            [cond, if_body.join(';\n')] as const,
            ([cond, body]) => `if (${cond}) {\n${body}\n${indent}}`,
          );
          break;
        }

        const else_body: string[] = [];
        for (const b of node.else) {
          const bc = node_to_code(b, indent_lvl + 1);
          if (typeof bc != 'string') return bc;
          else_body.push(bc);
        }

        code = pipe(
          [cond, if_body.join(';\n'), else_body.join(';\n')] as const,
          ([cond, ifb, elseb]) => `if (${cond}) {${ifb}\n${indent}} else {\n${elseb}\n${indent}}`
        );
      } break;
    }

    if (code != null) {
      return indent + code;
    }

    compiler_logger.error(get_current_line(), 'Do not know how to handle node of kind ' + node.kind + ' in js codegen');
    console.log((new Error()).stack);
    return new Error('Do not know how to handle node of kind ' + node.kind + ' in js codegen');
  }

  emit_code(): boolean {
    const node_to_code = this.node_to_code.bind(this);
    const cg = this.cg;
    if (!cg) {
      compiler_logger.error(get_current_line(), 'Attempting to emit golang code without having setup the js codegen')
      return true;
    }

    cg.write('"use strict";\n');

    if (cg.imports.size > 0) {
      compiler_logger.error(get_current_line(), 'Imports are not supported in js codegen yet');
      return true;
    }

    cg.write(`
globalThis.$$EibaFu = (function() {
globalThis.printf = function*(fmt, ...args) {
  let buf = globalThis.printf.__buffer ?? '';
  args.reverse();

  for (let i = 0; i < fmt.length; ++i) {
    let ch = fmt[i];
    if (ch != '%') {
      buf += ch;
      continue;
    }

    if (fmt[i+1] == 'v') {
      buf += String(args.pop());
      i++;
      continue;
    }
  }

  let idx = buf.lastIndexOf('\\n');
  if (idx != -1) {
    const subbuf = buf.substring(0, idx);
    buf = buf.substring(idx + 1);
    console.log(subbuf);
  }

  globalThis.printf.__buffer = buf;
};
globalThis.printnf = (fmt, ...args) => globalThis.printf(fmt + '\\n', ...args);

async function exec(fn) {
  const it = fn();
  let step = it.next();
  if (step.value instanceof Promise) step.value = await step.value;
  while (!step.done) {
    step = it.next(step.value);
    if (step.value instanceof Promise) step.value = await step.value;
  }
  return step.value;
}

return { exec };
})();
`);

    for (const vdcl of cg.vars) {
      const code = node_to_code(vdcl);
      if (typeof code != 'string') {
        compiler_logger.error(get_current_line(), code.message);
        if (code.stack) console.log(code.stack);
        return true;
      }

      cg.write(`\n${code};\n`);
    }

    for (const fdcl of cg.funcs) {
      const code = node_to_code(fdcl);
      if (typeof code != 'string') {
        compiler_logger.error(get_current_line(), code.message);
        if (code.stack) console.log(code.stack);
        return true;
      }

      cg.write(`\n${code}\n`);
    }

    cg.write(`\n$$EibaFu.exec(main);\n`);

    return false;
  }

  get_mod() {
    return this.cg;
  }
}

export default new JavascriptCodegen();

