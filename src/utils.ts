// @ts-ignore
import getCurrentLine from 'get-current-line';

import type { AstNode, Parser, VarDeclNode, FnDeclNode } from './parser';

export type Prettify<T> = { [K in keyof T]: T[K] } & unknown;

export type Result<T, E> = { ok: true; value: T; } | { ok: false; error: E; };

export const Result = Object.freeze({
  Ok: <T, E>(value: T): Result<T, E> => ({ ok: true, value }),
  Err: <T, E>(error: E): Result<T, E> => ({ ok: false, error }),
});

export type LogLevel = 'ERROR' | 'INFO' | 'WARN';

export type CursorPosition = { line: number; column: number; };

export const create_parser_logger = (file_path: string) => ({
  info(pos: CursorPosition, ...stuff: any[]) {
    console.log(`${file_path}:${pos.line}:${pos.column}: [INFO]`, ...stuff);
  },
  warn(pos: CursorPosition, ...stuff: any[]) {
    console.warn(`${file_path}:${pos.line}:${pos.column}: [WARN]`, ...stuff);
  },
  error(pos: CursorPosition, ...stuff: any[]) {
    console.error(`${file_path}:${pos.line}:${pos.column}: [ERROR]`, ...stuff);
    console.log((new Error()).stack);
  },
});

export type CurrentLinePos = { method: string; file: string; line: number; char: number; };
export const get_current_line = (): CurrentLinePos => getCurrentLine();

export const compiler_logger = {
  info: (pos: CurrentLinePos, ...stuff: any[]) => console.log(`${pos.file}:${pos.line}:${pos.char}: [INFO]`, ...stuff),

  warn: (pos: CurrentLinePos, ...stuff: any[]) => {
    console.warn(`${pos.file}:${pos.line}:${pos.char}: [WARN]`, ...stuff);
    console.log((new Error()).stack);
  },

  error: (pos: CurrentLinePos, ...stuff: any[]) => {
    console.error(`${pos.file}:${pos.line}:${pos.char}: [ERROR]`, ...stuff);
    console.log((new Error()).stack);
  },
};

export interface CodeGen {
  imports: Set<string>;
  vars: Array<VarDeclNode>;
  funcs: Array<FnDeclNode>;
  output_path: string;
  write(code: string): void;
  flush(): Promise<boolean>;
}

export type TargetCodeGenSetupConfig = {
  input_path: string;
  output_path: string;
  nodes: AstNode[];
  parser: Parser;
};

export interface TargetCodeGen {
  setup_codegen(cfg: TargetCodeGenSetupConfig): boolean;
  node_to_code(node: AstNode | null): string | Error;
  node_to_code(node: AstNode | null, indent_level: number): string | Error;
  emit_code(): boolean;
  get_mod(): CodeGen | null;
}

type Fn<Args extends any[], Ret> = (...args: Args) => Ret;

export function pipe<A, B>(a: A, b: Fn<[A], B>): B;
export function pipe<A, B, C>(a: A, b: Fn<[A], B>, c: Fn<[B], C>): C;
export function pipe<A, B, C, D>(a: A, b: Fn<[A], B>, c: Fn<[B], C>, e: Fn<[C], D>): D;
export function pipe<A, B, C, D, E>(a: A, b: Fn<[A], B>, c: Fn<[B], C>, d: Fn<[C], D>, e: Fn<[D], E>): E;
export function pipe<A, B, C, D, E, F>(a: A, b: Fn<[A], B>, c: Fn<[B], C>, d: Fn<[C], D>, e: Fn<[D], E>, f: Fn<[E], F>): F;
export function pipe<A, B, C, D, E, F, G>(
  a: A, b: Fn<[A], B>, c: Fn<[B], C>, d: Fn<[C], D>,
  e: Fn<[D], E>, f: Fn<[E], F>, g: Fn<[F], G>
): G;
export function pipe(a: any, ...fns: Fn<[any], any>[]) {
  let val: any = a;
  for (let i = 0; i < fns.length; ++i) {
    const f = fns[i]!;
    val = f(val);
  }
  return val;
}

export function ensure_valid_output_path_from_input_path(input_path: string, output_path: string, ext: string) {
  if (!output_path.endsWith(ext)) {
    if (!output_path.endsWith('/')) {
      output_path += ext;
    } else {
      const i = input_path!.lastIndexOf('/') + 1;
      let j = input_path!.lastIndexOf('.');
      if (j == -1) j = input_path!.length;
      output_path += input_path!.substring(i, j) + ext;
    }
  }

  return output_path;
}
