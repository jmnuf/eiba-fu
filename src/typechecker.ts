import type { Prettify, CursorPosition } from './utils';
import { Result } from './utils';
import type { AstNode, EoFNode, FnDeclNode } from './parser';
import { AstNodeKind } from './parser';

interface AnyType {
  methods: Array<FuncType>;
  properties: Array<LangType>;
}

interface PrimitiveType extends AnyType {
  kind: 'primitive';
  base: 'i8' | 'u8' | 'i32' | 'u32' | 'isz' | 'usz' | 'ptr' | 'string' | 'bool' | 'void' | 'null';
}

interface ArrayType extends AnyType {
  kind: 'array';
  base: LangType;
  size: number | null;
}

interface StructType extends AnyType {
  kind: 'struct';
  name: string;
  fields: Array<{ name: string; type: LangType; }>;
}

interface FuncType extends AnyType {
  kind: 'func';
  name: string;
  args: Array<{ name: string; type: LangType; }>;
  returns: LangType;
}

interface LangTypesMap {
  Primitive: PrimitiveType;
  Array: ArrayType;
  Struct: StructType;
  Func: FuncType;
}

type LangType = LangTypesMap[keyof LangTypesMap];

// interface TypedNodesMap {
//   FuncDecl: {
//     kind: 'funcdecl';
//     args: Array<TypedNodesMap['FuncArg']>;
//     returns: LangType;
//   };
//   FuncArg: 'funcarg',
//   FuncCall: 'fncal',
//   VarDecl: 'vardcl',
//   Binop: 'binop',
//   PipeOp: 'pop',
//   Expr: 'expr',
//   Keyword: 'kword',
//   IfElse: 'iffi',
//   Ident: 'idnt',
//   Literal: 'lit',
// }

type BaseTypeBuilder<T extends LangType, Buildable extends boolean> = Prettify<{
  add_method(func: FuncType): BaseTypeBuilder<T, Buildable>;
  add_property(prop: Exclude<LangType, { kind: 'func' }>): BaseTypeBuilder<T, Buildable>;
} & (Buildable extends true ? { build(): T; } : {})>;

type TypeBuilder<Kind extends LangType['kind'], Buildable extends boolean = false> =
  Kind extends 'primitive'
  ? Prettify<
    {
      T(base: PrimitiveType['base']): TypeBuilder<Kind, true>;
    } & BaseTypeBuilder<PrimitiveType, Buildable>
  >
  : Kind extends 'array'
  ? Prettify<
    {
      T(base: LangType): TypeBuilder<Kind, true>;
      sized(sz: number | null): TypeBuilder<Kind, Buildable>;
    } & BaseTypeBuilder<ArrayType, Buildable>
  >
  : Kind extends 'struct'
  ? Prettify<
    {
      set_name(name: string): TypeBuilder<Kind, true>;
      add_field(name: string, field: LangType): TypeBuilder<Kind, Buildable>;
    } & BaseTypeBuilder<StructType, Buildable>
  >
  : Kind extends 'func'
  ? Prettify<
    {
      set_name(name: string): TypeBuilder<Kind, true>;
      add_arg(name: string, arg: LangType): TypeBuilder<Kind, Buildable>;
      set_return(ret: LangType | null): TypeBuilder<Kind, Buildable>;
    } & BaseTypeBuilder<FuncType, Buildable>
  >
  : never
  ;

interface TypesContext {
  global_types: Map<string, LangType>;
  local_types: Map<string, LangType>;
  local_vars: Map<string, LangType>;
}

function type_builder<Kind extends LangType['kind']>(k: Kind): TypeBuilder<Kind, false> {
  const methods: AnyType['methods'] = [];
  const properties: AnyType['properties'] = [];
  switch (k) {
    case 'primitive': {
      let base: PrimitiveType['base'] = 'void';
      const builder: TypeBuilder<'primitive', true> = {
        add_method(fn) {
          methods.push(fn);
          return builder;
        },
        add_property(p) {
          properties.push(p);
          return builder;
        },
        T(b) {
          base = b;
          return builder;
        },
        build() {
          return {
            kind: 'primitive',
            base, methods, properties,
          };
        },
      };
      return builder as any;
    } break;

    case 'array': {
      let base: ArrayType['base'] = null as any;
      let size: number | null = null;
      const builder: TypeBuilder<'array', true> = {
        add_method(fn) {
          methods.push(fn);
          return builder;
        },
        add_property(p) {
          properties.push(p);
          return builder;
        },
        T(b) {
          base = b;
          return builder;
        },
        sized(sz) {
          size = sz;
          return builder;
        },
        build() {
          return {
            kind: 'array',
            base, size,
            methods, properties,
          };
        },
      };
      return builder as any;
    } break;

    case 'struct': {
      const fields: StructType['fields'] = [];
      let name: string = '';
      const builder: TypeBuilder<'struct', true> = {
        add_method(fn) {
          methods.push(fn);
          return builder;
        },
        add_property(p) {
          properties.push(p);
          return builder;
        },
        set_name(n: string) {
          name = n;
          return builder;
        },
        add_field(name, type) {
          fields.push({ name, type });
          return builder;
        },
        build() {
          return {
            kind: 'struct',
            name, fields,
            methods, properties,
          };
        },
      };
      return builder as any;
    } break;

    case 'func': {
      let name = '';
      const args: FuncType['args'] = [];
      let returns: FuncType['returns'] = {
        kind: 'primitive',
        base: 'void',
        methods: [],
        properties: [],
      };
      const builder: TypeBuilder<'func', true> = {
        add_method(fn) {
          methods.push(fn);
          return builder;
        },
        add_property(p) {
          properties.push(p);
          return builder;
        },
        set_name(n: string) {
          name = n;
          return builder;
        },
        add_arg(name, type) {
          args.push({ name, type });
          return builder;
        },
        set_return(ret) {
          if (ret == null) {
            if (returns.kind != 'primitive' || returns.base != 'void') {
              returns = {
                kind: 'primitive',
                base: 'void',
                methods: [],
                properties: [],
              };
            }
          } else {
            returns = ret;
          }
          return builder;
        },
        build() {
          return {
            kind: 'func',
            name, args, returns,
            methods, properties,
          };
        },
      };
      return builder as any;
    } break;
  }

  throw new Error(`No existing type builder for '${k}'`);
}

function get_func_body_and_args_types(
  ctx: TypesContext,
  parsed_node: FnDeclNode
): Result<{ args: FuncType['args']; returns: FuncType['returns'] }, string> {
  if (parsed_node.returns != '()') {
    const parse_returns_result = parse_type_from_str(ctx, parsed_node.returns);
    if (!parse_returns_result.ok) return parse_returns_result;
  } else {
  }

  throw new Error('TODO: Implement get_func_body_and_args_types');
}

declare function parse_type_from_str(ctx: TypesContext, str: string): Result<LangType | null, string>;

function types_are_equivalent(a: LangType, b: LangType) {
  if (a === b) return true;
  if (a.kind != b.kind) return false;

  switch (a.kind) {
    case 'primitive': {
      const a_base = a.base;
      const b_base = (b as PrimitiveType).base;
      if (a_base == 'string' || a_base == 'void' || a_base == 'bool' || a_base == 'null' || a_base == 'ptr') {
        return a_base == b_base;
      }
      // All numbers are castable to one another
      return true;
    };

    case 'func': {
      const fa = a;
      const fb = b as FuncType;
      if (fa.args.length != fb.args.length) return false;
      if (fa.args.some((argA, idx) => argA.type == fb.args[idx]!.type)) return false;
      return types_are_equivalent(fa.returns, fb.returns);
    };

    case 'struct': {
      const sa = a;
      const sb = b as StructType;
      return sa.fields.every((fa, idx) => fa.type == sb.fields[idx]!.type);
    };
  }
  return false;
}

export function get_type(
  ctx: TypesContext,
  parsed_node: Exclude<AstNode, EoFNode> | null | undefined
): Result<LangType | null, string | undefined> {
  if (!parsed_node) return Result.Ok(null);

  let typed_node: LangType | null = null;
  switch (parsed_node.kind) {
    case AstNodeKind.FuncDecl: {
      const result = get_func_body_and_args_types(ctx, parsed_node);
      if (!result.ok) return result;
      const info = result.value;

      const builder = type_builder('func')
        .set_name(parsed_node.name)
        .set_return(info.returns);

      for (const { name, type } of info.args) {
        builder.add_arg(name, type);
      }

      typed_node = builder.build();
    } break;

    case AstNodeKind.Literal: {
      if (parsed_node.type == 'str') {
        typed_node = ctx.global_types.get('string')!;
      } else if (parsed_node.type == 'int') {
        typed_node = ctx.global_types.get('isz')!;
      } else {
        // @ts-expect-error Node should be inferred to be never here
        const msg = `Unhandled literal type ${parsed_node.type}`;
        return Result.Err(msg);
      }
    } break;

    case AstNodeKind.FuncCall: {
      const fn_name = parsed_node.name;
      let ref = ctx.local_vars.get(fn_name);
      if (!ref) ref = ctx.global_types.get(fn_name);
      if (!ref) return Result.Err(`Calling an undeclared function: ${fn_name}`);
      if (ref.kind != 'func') return Result.Err(`Attempting to call non-function variable '${fn_name}' as a function`);
      typed_node = ref;
    } break;

    case AstNodeKind.VarDecl: {
      if (parsed_node.init) {
        const var_usr_decl_type_result = parse_type_from_str(ctx, parsed_node.type.name);
        if (!var_usr_decl_type_result.ok) return var_usr_decl_type_result;
        const var_usr_decl_type = var_usr_decl_type_result.value;
        if (!var_usr_decl_type && parsed_node.type.name != '()') break;

        const init_type_result = get_type(ctx, parsed_node.init);
        if (!init_type_result.ok) return init_type_result;
        const init_type = init_type_result.value;
        if (!init_type && var_usr_decl_type) {
          typed_node = var_usr_decl_type;
          break;
        }

        if (init_type && var_usr_decl_type) {
          if (!types_are_equivalent(init_type, var_usr_decl_type)) {
            return Result.Err(`Incompatible type at variable initialization`);
          }
        }

      } else {
        const result = parse_type_from_str(ctx, parsed_node.type.name);
        if (!result.ok) return result;
        typed_node = result.value;
        if (!typed_node) return Result.Err(`Declared variable's type requires forward checking for type`);
      }
    } break;

    default: {
      return Result.Err(`Unhandled parse node kind attempting to get type: ${parsed_node.kind}`);
    };
  }

  return Result.Ok(typed_node);
}

