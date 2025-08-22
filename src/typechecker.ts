import type { Prettify, SourcePosition } from './utils';
import { $todo, Result, get_current_line, pipe, unreachable } from './utils';
import type { AstNode, EoFNode, FnDArgNode, FnDeclNode, KeywordNode, SimpNode, VarDeclNode } from './parser';
import { Lex, TokenKind } from './lexer';
import { AstNodeKind, is_cmp_operator, is_logic_operator, is_math_operator, node_debug_fmt } from './parser';

export interface TypeDef {
  origin: SourcePosition | null; // null means define by compiler
  methods: Array<{ name: string; type: FuncType }>;
  properties: Array<{ name: string; type: LangType }>;
}

export interface AnyType extends TypeDef {
  kind: 'any';
  origin: null;
}

export interface VoidType extends TypeDef {
  kind: 'void';
  origin: null;
}

export interface PrimitiveType extends TypeDef {
  kind: 'primitive';
  base: 'si8' | 'ui8' | 'si32' | 'ui32' | 'sisz' | 'uisz' | 'ptr' | 'flt32' | 'flt64' | 'string' | 'bool' | 'null';
}

export interface IntType extends PrimitiveType {
  base: 'si8' | 'ui8' | 'si32' | 'ui32' | 'sisz' | 'uisz' | 'ptr';
}

export interface FltType extends PrimitiveType {
  base: 'flt32' | 'flt64';
}

export interface ArrayType extends TypeDef {
  kind: 'array';
  origin: null;
  base: LangType;
  size: number | null;
}

export interface StructType extends TypeDef {
  kind: 'struct';
  name: string;
  fields: Array<{ name: string; type: LangType; }>;
}

export interface FuncType extends TypeDef {
  kind: 'func';
  name: string;
  args: Array<{ name: string; type: LangType; }>;
  returns: LangType;
  variadic: null | { name: string; type: null | LangType };
}

export interface EnumType extends TypeDef {
  kind: 'enum';
  name: string;
  values: Array<{ name: string; value: number; }>;
}

export interface TaggedUnionType extends TypeDef {
  kind: 'tagged-union';
  name: string;
  values: Array<{ name: string; type: LangType }>;
}

export interface LangTypesMap {
  Any: AnyType;
  Void: VoidType;
  Primitive: PrimitiveType;
  Array: ArrayType;
  Struct: StructType;
  Func: FuncType;
  Enum: EnumType;
  TaggedUnion: TaggedUnionType;
}


export type LangType = LangTypesMap[keyof LangTypesMap];

type BaseTypeBuilder<T extends LangType, Extra extends {}, Buildable extends boolean> = Prettify<{
  add_method(func: FuncType): BaseTypeBuilder<T, Extra, Buildable>;
  add_method_alias(alias: string, func: FuncType): BaseTypeBuilder<T, Extra, Buildable>;
  add_property(name: string, prop: Exclude<LangType, { kind: 'func' }>): BaseTypeBuilder<T, Extra, Buildable>;
} & Extra & (Buildable extends true ? { build(): T; } : {})>;

type TypeBuilder<Kind extends LangType['kind'], Buildable extends boolean = false> =
  Kind extends 'primitive'
  ? BaseTypeBuilder<PrimitiveType, {
    T(base: PrimitiveType['base']): TypeBuilder<Kind, true>;
  }, Buildable>
  : Kind extends 'array'
  ? BaseTypeBuilder<ArrayType, {
    T(base: LangType): TypeBuilder<Kind, true>;
    sized(sz: number | null): TypeBuilder<Kind, Buildable>;
  }, Buildable>
  : Kind extends 'struct'
  ? BaseTypeBuilder<StructType, {
    set_name(name: string): TypeBuilder<Kind, true>;
    add_field(name: string, field: LangType): TypeBuilder<Kind, Buildable>;
    originates(origins: FuncType['origin']): TypeBuilder<Kind, Buildable>;
  }, Buildable>
  : Kind extends 'func'
  ? BaseTypeBuilder<FuncType, {
    set_name(name: string): TypeBuilder<Kind, true>;
    add_arg(name: string, arg: LangType): TypeBuilder<Kind, Buildable>;
    set_return(ret: LangType | null): TypeBuilder<Kind, Buildable>;
    variadic(vargs: FuncType['variadic']): TypeBuilder<Kind, Buildable>;
    originates(origins: FuncType['origin']): TypeBuilder<Kind, Buildable>;
  }, Buildable>
  : Kind extends 'enum'
  ? BaseTypeBuilder<EnumType, {
    set_name(name: string): TypeBuilder<Kind, true>;
    add_value(name: string): TypeBuilder<Kind, Buildable>;
    add_value(name: string, value: number): TypeBuilder<Kind, Buildable>;
    originates(origins: FuncType['origin']): TypeBuilder<Kind, Buildable>;
  }, Buildable>
  : never
  ;


type TypesContextVar = {
  name: string;
  loc: SourcePosition | null;
  decl: VarDeclNode | FnDeclNode | FnDArgNode | null;
  type: LangType;
};
class TypesContext {
  readonly parent: TypesContext | null;
  private types: Map<string, LangType>;
  private vars: Map<string, TypesContextVar>;
  readonly input_path: string;
  private static global_types: Map<string, LangType> = new Map();
  private static global_vars: Map<string, TypesContextVar> = new Map();

  constructor(input_path: string, parent: TypesContext | null = null) {
    this.input_path = input_path;
    this.parent = parent ?? null;
    this.types = new Map();
    this.vars = new Map();
  }

  vars_list = (): [string, TypesContextVar][] => {
    const held = this.vars.entries().toArray();
    const parent = this.parent ? this.parent.vars_list() : TypesContext.global_vars.entries().toArray();
    return held.concat(parent);
  }

  new_child_ctx = (input: string = this.input_path) => new TypesContext(input, this);

  get_type = (name: string): LangType | undefined => {
    let t = this.types.get(name);
    if (t == undefined) {
      if (this.parent) t = this.parent.get_type(name);
      if (!t) return TypesContext.global_types.get(name);
    }
    return t;
  };

  get_var = (name: string): TypesContextVar | undefined => {
    let t = this.vars.get(name);
    if (t == undefined) {
      if (this.parent) return this.parent.get_var(name);
      else return TypesContext.global_vars.get(name);
    }
    return t;
  };

  add_type = (name: string, type: LangType): TypesContext => {
    this.types.set(name, type);
    return this;
  };

  has_type = (name: string): boolean => {
    return this.types.has(name);
  };
  type_exists = (name: string): boolean => {
    if (!this.parent) return this.types.has(name);
    return this.types.has(name) || this.parent.type_exists(name) || TypesContext.global_types.has(name);
  };

  add_var = (var_t: TypesContextVar): TypesContext => {
    this.vars.set(var_t.name, var_t);
    return this;
  }

  has_var = (name: string) => {
    return this.vars.has(name);
  };
  var_exists = (name: string): boolean => {
    if (!this.parent) return this.vars.has(name);
    return this.vars.has(name) || this.parent.var_exists(name) || TypesContext.global_vars.has(name);
  }
  set_global_var = TypesContext.set_global_var.bind(TypesContext);
  set_global_type = TypesContext.set_global_type.bind(TypesContext);

  static set_global_var(var_t: TypesContextVar) {
    TypesContext.global_vars.set(var_t.name, var_t);
    return this;
  }
  static set_global_type(name: string, type: LangType) {
    TypesContext.global_types.set(name, type);
    return this;
  }
}

const AnyType: AnyType = {
  kind: 'any',
  origin: null,
  methods: [],
  properties: [],
};

const VoidType: VoidType = {
  kind: 'void',
  origin: null,
  methods: [],
  properties: [],
};

const NullType: PrimitiveType = {
  kind: 'primitive',
  base: 'null',
  origin: null,
  methods: [],
  properties: [],
};

function type_builder<Kind extends LangType['kind']>(k: Kind): TypeBuilder<Kind, false> {
  const methods: TypeDef['methods'] = [];
  const properties: TypeDef['properties'] = [];
  switch (k) {
    case 'primitive': {
      let base: PrimitiveType['base'] = 'null';
      const builder: TypeBuilder<'primitive', true> = {
        add_method_alias(name, type) {
          methods.push({ name, type });
          return builder;
        },
        add_method(type) {
          methods.push({ name: type.name, type });
          return builder;
        },
        add_property(name, type) {
          properties.push({ name, type });
          return builder;
        },
        T(b) {
          base = b;
          return builder;
        },
        build() {
          return {
            kind: 'primitive',
            origin: null,
            base, methods, properties,
          };
        },
      };
      return builder as any;
    };

    case 'array': {
      let base: ArrayType['base'] = null as any;
      let size: number | null = null;
      const builder: TypeBuilder<'array', true> = {
        add_method_alias(name, type) {
          methods.push({ name, type });
          return builder;
        },
        add_method(type) {
          methods.push({ name: type.name, type });
          return builder;
        },
        add_property(name, type) {
          properties.push({ name, type });
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
            origin: null,
            methods, properties,
          };
        },
      };
      return builder as any;
    };

    case 'struct': {
      const fields: StructType['fields'] = [];
      let name: string = '';
      let origin: TypeDef['origin'] = null;
      const builder: TypeBuilder<'struct', true> = {
        add_method_alias(name, type) {
          methods.push({ name, type });
          return builder;
        },
        add_method(type) {
          methods.push({ name: type.name, type });
          return builder;
        },
        add_property(name, type) {
          properties.push({ name, type });
          return builder;
        },
        set_name(n: string) {
          name = n;
          return builder;
        },
        originates(origins) {
          origin = origins;
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
            origin,
            methods, properties,
          };
        },
      };
      return builder as any;
    };

    case 'func': {
      let name = '';
      let variadic_t: FuncType['variadic'] = null;
      const args: FuncType['args'] = [];
      let returns: FuncType['returns'] = VoidType;
      let origin: TypeDef['origin'] = null;
      const builder: TypeBuilder<'func', true> = {
        add_method_alias(name, type) {
          methods.push({ name, type });
          return builder;
        },
        add_method(type) {
          methods.push({ name: type.name, type });
          return builder;
        },
        add_property(name, type) {
          properties.push({ name, type });
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
        originates(origins: FuncType['origin']) {
          origin = origins;
          return builder;
        },
        set_return(ret) {
          if (ret == null) {
            returns = VoidType;
          } else {
            returns = ret;
          }
          return builder;
        },
        variadic(vargs) {
          variadic_t = vargs;
          return builder;
        },
        build() {
          return {
            kind: 'func',
            origin,
            name, args, returns,
            methods, properties,
            variadic: variadic_t,
          };
        },
      };
      return builder as any;
    };

    case 'enum': {
      let iota = 0;
      let values: EnumType['values'] = [];
      let name = '';
      let origin: TypeDef['origin'] = null;
      const builder: TypeBuilder<'enum', true> = {
        add_method_alias(name, type) {
          methods.push({ name, type });
          return builder;
        },
        add_method(fn) {
          methods.push({ name: fn.name, type: fn });
          return builder;
        },
        add_property(name, type) {
          properties.push({ name, type });
          return builder;
        },
        set_name(n: string) {
          name = n;
          return builder;
        },
        originates(origins: FuncType['origin']) {
          origin = origins;
          return builder;
        },
        add_value(name, value?: number) {
          if (typeof value !== 'number') {
            value = ++iota;
          } else {
            iota = value;
          }
          values.push({ name, value });
          return builder;
        },
        build() {
          return {
            kind: 'enum',
            methods, properties,
            name, origin,
            values,
          };
        },
      };
      return builder as any;
    };
  }

  throw new Error(`No existing type builder for '${k}'`);
}

export function get_type_name(t: LangType): string {
  if (t.kind === 'any' || t.kind === 'void') return t.kind;
  if (t.kind === 'primitive') return t.base;
  if (t.kind === 'array') return get_type_name(t.base) + '[' + (t.size == null ? '' : t.size.toString(10)) + ']';
  if (t.kind === 'enum') return 'Enum:' + t.name;
  if (t.kind === 'struct') return 'struct ' + t.name;
  if (t.kind === 'tagged-union') return 'TagUnion:' + t.name;
  if (t.kind === 'func') {
    return `fn(${t.args.map((arg) => get_type_name(arg.type)).join(', ')}) -> ${get_type_name(t.returns)}`;
  }
  return 'unknown'
}


function get_function_returns(ctx: TypesContext, body: Array<Exclude<AstNode, EoFNode>>): Result<LangType[], string> {
  const returns: LangType[] = [];
  for (const n of body) {
    if (n.kind == 'iffi') {
      const result = get_function_returns(ctx, n.body);
      if (!result.ok) return result;
      returns.push(...result.value);
      if (n.else) {
        const result = get_function_returns(ctx, n.else);
        if (!result.ok) return result;
        returns.push(...result.value);
      }
      continue;
    }
    if (n.kind == 'kword' && n.word == 'return') {
      if (!n.expr) {
        returns.push(T.void);
        continue;
      }
      const result = get_type(ctx, n.expr);
      if (!result.ok) return Result.Err(result.error);
      returns.push(result.value);
    }
  }
  return Result.Ok(returns);
}


function ensure_return_type(ctx: TypesContext, t: LangType, body: Array<Exclude<AstNode, EoFNode>>, fn_body: boolean = false): string[] {
  const errors: string[] = [];

  let returns_count = 0;
  for (const n of body) {
    if (n.kind == 'iffi') {
      errors.push(...ensure_return_type(ctx, t, n.body));
      if (n.else) {
        errors.push(...ensure_return_type(ctx, t, n.else));
      }
      continue;
    }
    if (n.kind == 'kword') {
      if (n.word != 'return') continue;
      returns_count++;
      const result = get_type(ctx, n);
      if (result.ok) {
        const b = result.value ?? T.null;
        if (!types_are_equivalent(t, b)) {
          const exp_name = get_type_name(t);
          const got_name = get_type_name(b);
          errors.push(`Expected \`${exp_name}\` but got \`${got_name}\``);
        }
      }
      continue;
    }
  }

  if (returns_count == 0 && fn_body) {
    const b = T.void;
    if (!types_are_equivalent(t, b)) {
      const exp_name = get_type_name(t);
      const got_name = get_type_name(b);
      errors.push(`Expected \`${exp_name}\` but got \`${got_name}\``);
    }
  }

  return errors;
}

function get_func_body_and_args_types(
  ctx: TypesContext,
  parsed_node: FnDeclNode
): Result<{ fn_ctx: TypesContext; args: FuncType['args']; returns: FuncType['returns'] }, string> {
  const fn_ctx = ctx.new_child_ctx();
  const args: { name: string; type: LangType }[] = [];
  for (const n of parsed_node.args) {
    if (n.type == '()') {
      return Result.Err(`${ctx.input_path}:${n.pos.line}:${n.pos.column}: No types provided for function argument ${n.name}`);
    }
    const type_result = parse_type_from_str(fn_ctx, n.type);
    if (!type_result.ok) return Result.Err(type_result.error);

    args.push({ name: n.name, type: type_result.value });

    fn_ctx.add_var({
      loc: null,
      name: n.name,
      type: type_result.value,
      decl: parsed_node,
    });
  }

  let returns: FuncType['returns'] | null = null;
  // console.log('user defined return type as', parsed_node.returns);
  if (parsed_node.returns != '()') {
    const parse_returns_result = parse_type_from_str(ctx, parsed_node.returns);
    if (!parse_returns_result.ok) return parse_returns_result;
    returns = parse_returns_result.value;
    const errors = ensure_return_type(fn_ctx, returns, parsed_node.body);
    if (errors.length > 0) {
      return Result.Err('Return type mismatches:\n  ' + errors.join('\n  '));
    }
  } else {
    // TODO: Implement reading body properly for inferring the return type
    // TODO: IDK how we end this section without properly reading the entire function 

    let returned: LangType[] = [];
    for (const n of parsed_node.body) {
      if (n.kind == 'vardcl') {
        const type_result = get_type(fn_ctx, n);
        if (!type_result.ok) {
          console.log(fn_ctx.input_path + ':' + n.pos.line + ':' + n.pos.column, '[INFO] Failed here');
          return Result.Err(type_result.error);
        }
        fn_ctx.add_var({
          loc: null,
          name: n.name,
          type: type_result.value,
          decl: n,
        });
        continue;
      }

      if (n.kind == AstNodeKind.IfElse) {
        const if_result = get_function_returns(fn_ctx, n.body);
        if (!if_result.ok) {
          return Result.Err(if_result.error);
        }
        returned.push(...if_result.value);

        if (n.else) {
          const else_result = get_function_returns(fn_ctx, n.else);
          if (!else_result.ok) {
            return Result.Err(else_result.error);
          }
          returned.push(...else_result.value);
        }

        continue;
      }
      if (n.kind != 'kword') continue;
      if (n.word != 'return') continue;
      if (!n.expr) {
        returned.push(T.void);
        continue;
      }
      const r = get_type(fn_ctx, n.expr);
      if (!r.ok) return Result.Err(r.error);
      returned.push(r.value);
    }
    if (returned.length === 0) {
      returns = T.void;
    } else if (returned.length === 1) {
      returns = returned[0]!;
    } else if (returned.length > 0) {
      const a = returned[0]!;
      for (const b of returned) {
        if (!types_are_equivalent(a, b)) {
          const a_name = get_type_name(a);
          const b_name = get_type_name(b);
          return Result.Err(`Type mismatch in return statement: Assumed \`${a_name}\` from first return but found \`${b_name}\``);
        }
      }
      returns = a;
    } else {
      returns = T.void;
    }
    // console.log('[DEBUG] In inference found', returned.length, 'return statements');
  }
  // console.log('[DEBUG] Inferred return of', get_type_name(returns), 'from the user', parsed_node.returns);

  if (returns == null) return Result.Err(`The return value is unable to be inferred`);

  return Result.Ok({ fn_ctx, args, returns });
}

function parse_type_from_str(ctx: TypesContext, str: string): Result<LangType, string> {
  const l = Lex(str);
  let tok = l.next();
  if (tok.kind !== TokenKind.Ident) return Result.Err('Provided type has an invalid name.');

  const base_name = l.get_ident();
  const base_t = ctx.get_type(base_name);
  if (!base_t) {
    console.log('[DEBUG] Registered types:', ctx.vars_list());
    return Result.Err(`No type with name '${base_name}' was found. Did you spell it right?`);
  }

  let array_t: LangType = base_t;
  while (true) {
    tok = l.next();
    if (tok.kind == TokenKind.EOF) break;
    if (tok.kind != TokenKind.Symbol) return Result.Err(`Unexpected ${tok.kind} when reading type name.`);

    let size: number | null = null;
    if (tok.sym != '[') return Result.Err(`Invalid symbol (${tok.sym}) in type name.`);
    tok = l.next();
    if (tok.kind != TokenKind.Symbol && tok.kind != TokenKind.Integer) return Result.Err(`Unexpected ${tok.kind} when reading type name. Expected symbol ']'`);
    if (tok.kind == TokenKind.Integer) {
      size = tok.int;
      tok = l.next();
      if (tok.kind != TokenKind.Symbol) return Result.Err(`Unexpected ${tok.kind} when reading type name. Expected symbol ']'`);
    }
    if (tok.sym != ']') return Result.Err(`Invalid symbol (${tok.sym}) in type name. Expected symbol ']'`);
    // @ts-ignore use before setting
    const base = array_t ? array_t : base_t;
    array_t = array_type_builder().T(base).sized(size).build();
  }

  return Result.Ok(array_t);
}

// TODO: Write a test to cover all cases of this function
function types_are_equivalent(a: LangType, b: LangType): boolean {
  if (a === b) return true;
  // If one of the two are 'any' then just call it equal as 'any' is equivalent to everything
  if (a.kind == 'any' || b.kind == 'any') return true;
  if (a.kind != b.kind) return false;
  // Nothing more to check on these types as they hold no information

  switch (a.kind) {
    case 'primitive': {
      const a_base = a.base;
      const b_base = (b as PrimitiveType).base;
      if (a_base == 'string' || a_base == 'bool' || a_base == 'null' || a_base == 'ptr') {
        return a_base == b_base;
      }
      if (b_base == 'string' || b_base == 'bool' || b_base == 'null' || b_base == 'ptr') {
        return false;
      }

      if (a_base == 'flt32' || a_base == 'flt64') {
        return b_base == 'flt32' || b_base == 'flt64';
      }
      if (b_base == 'flt32' || b_base == 'flt64') {
        return false;
      }

      // All numbers are castable to one another
      return true;
    };

    case 'func': {
      const fa = a as FuncType;
      const fb = b as FuncType;
      if (fa.args.length != fb.args.length) return false;
      if (fa.args.some((argA, idx) => !types_are_equivalent(argA.type, fb.args[idx]!.type))) return false;
      return types_are_equivalent(fa.returns, fb.returns);
    };

    case 'array': {
      const aa = a as ArrayType;
      const ab = b as ArrayType;
      return aa.size === ab.size && types_are_equivalent(aa.base, ab.base);
    };

    case 'struct': {
      const sa = a as StructType;
      const sb = b as StructType;
      if (sa.fields.length !== sb.fields.length) return false;
      return sa.fields.every((fa, idx) => {
        const fb = sb.fields[idx]!;
        return fa.name === fb.name && types_are_equivalent(fa.type, fb.type);
      });
    };

    case 'enum': {
      const ea = a as EnumType;
      const eb = b as EnumType;
      if (ea.name !== eb.name) {
        return false;
      }
      return ea.values.every((eai, i) =>
        eai.name === eb.values[i]!.name && eai.value === eb.values[i]!.value
      );
    };

    case 'tagged-union': {
      const ua = a as TaggedUnionType;
      const ub = b as TaggedUnionType;
      if (ua.name !== ub.name || ua.values.length !== ub.values.length) return false;
      return ua.values.every((va, i) =>
        va.name === ub.values[i]!.name && types_are_equivalent(va.type, ub.values[i]!.type)
      );
    };
  }

  return false;
}

const prim_type_builder = () => type_builder('primitive');
const fn_type_builder = () => type_builder('func');
// const struct_type_builder = () => type_builder('struct');
function array_type_builder(): TypeBuilder<'array', false> {
  return type_builder('array')
    .add_property('len', Ints.uisz);
}

const add_new_fn_to_type = (type: LangType, ...builders: Array<(builder: ReturnType<typeof fn_type_builder>) => FuncType>) => {
  while (builders.length > 0) {
    pipe(
      builders.shift()!,
      build => build(fn_type_builder()),
      fn => type.methods.push({ name: fn.name, type: fn }),
    );
  }
  return type;
}

// const add_fn_to_type_aliased = (type: LangType, name: string, fn: FuncType) =>
//   type.methods.push({ name, type: fn });

// const AnyType

const Ints = {
  ptr: prim_type_builder()
    .T('ptr')
    .build(),
  sisz: prim_type_builder()
    .T('sisz')
    .build(),
  uisz: prim_type_builder()
    .T('uisz')
    .build(),
  si32: prim_type_builder()
    .T('si32')
    .build(),
  ui32: prim_type_builder()
    .T('ui32')
    .build(),
  si8: prim_type_builder()
    .T('si8')
    .build(),
  ui8: prim_type_builder()
    .T('ui8')
    .build(),
} as const satisfies { [K in IntType['base']]: PrimitiveType };

const Flts = {
  flt32: prim_type_builder()
    .T('flt32')
    .build(),
  flt64: prim_type_builder()
    .T('flt64')
    .build(),
} as const satisfies { [K in FltType['base']]: PrimitiveType };

const StringType = prim_type_builder()
  .T('string')
  .add_property('len', Ints.uisz)
  .add_method(
    fn_type_builder()
      .set_name('bytes')
      .set_return(array_type_builder().T(Ints.ui8).build())
      .build(),
  )
  .build();

type Types = {
  [Key in Exclude<keyof LangTypesMap, 'Func' | 'Struct' | 'Enum' | 'Array' | 'TaggedUnion'> as LangTypesMap[Key] extends PrimitiveType ? LangTypesMap[Key]['base'] : Lowercase<Key>]: LangTypesMap[Key];
};
const T = Object.freeze({
  any: AnyType,
  void: VoidType,
  null: NullType,
  string: StringType,
  bool: prim_type_builder()
    .T('bool')
    .build(),
  ...Ints,
  ...Flts,
} as const satisfies Types);

add_new_fn_to_type(
  T.string,
  b =>
    b.set_name('append')
      .add_arg('other', T.string)
      .set_return(T.string)
      .build(),
)

function is_any_integer(t: LangType): t is IntType | EnumType {
  if (t.kind === 'primitive') {
    return Object.values(Ints).some(int => types_are_equivalent(t, int));
  } else if (t.kind === 'enum') {
    return true;
  }
  return false;
}


function is_number(t: LangType): t is IntType | FltType | EnumType {
  if (is_any_integer(t)) return true;
  return Object.values(Flts).some(flt => types_are_equivalent(t, flt));
}

export function create_global_context(input_path: string): TypesContext {
  const ctx = new TypesContext(input_path);

  if (!ctx.type_exists('any')) {
    for (const k of Object.keys(T) as Array<keyof typeof T>) {
      const t = T[k];
      ctx.set_global_type(k, t);
    }

    const printf_t = fn_type_builder()
      .set_name('printf')
      .add_arg('format_string', T.string)
      .add_arg('rest', T.void)
      .variadic({ name: 'rest', type: T.any })
      .set_return(T.sisz)
      .build();
    const printnf_t: FuncType = {
      ...printf_t,
      name: 'printnf',
    };

    const fmt_t = fn_type_builder()
      .set_name('fmt')
      .add_arg('format_string', T.string)
      .add_arg('rest', T.void)
      .variadic({ name: 'rest', type: T.any })
      .set_return(T.string)
      .build();

    ctx
      .set_global_var({ name: printf_t.name, loc: null, type: printf_t, decl: null })
      .set_global_var({ name: printnf_t.name, loc: null, type: printnf_t, decl: null })
      .set_global_var({ name: fmt_t.name, loc: null, type: fmt_t, decl: null });
  }

  return ctx;
}

function set_t_origin<T extends LangType>(ctx: TypesContext, t: T, n: Exclude<AstNode, EoFNode>) {
  return {
    ...t,
    origin: {
      file: ctx.input_path,
      line: n.pos.line,
      column: n.pos.column,
    } satisfies SourcePosition,
  } as T;
}

export function get_type(
  ctx: TypesContext,
  parsed_node: Exclude<AstNode, EoFNode> | null | undefined
): Result<LangType, 'NULL' | (string & {})> {
  if (!parsed_node) return Result.Err('NULL');

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

      typed_node = builder
        .originates({
          file: ctx.input_path,
          line: parsed_node.pos.line,
          column: parsed_node.pos.column,
        })
        .build();

      ctx.add_var({
        loc: {
          file: ctx.input_path,
          line: parsed_node.pos.line,
          column: parsed_node.pos.column,
        },
        name: typed_node.name,
        type: typed_node,
        decl: parsed_node,
      });
    } break;

    case AstNodeKind.FuncDclArg: {
      if (parsed_node.type == '()') return Result.Err('No type was provided for argument ' + parsed_node.name);
      const result = parse_type_from_str(ctx, parsed_node.type);
      if (!result.ok) return result;

      ctx.add_var({
        name: parsed_node.name,
        decl: parsed_node,
        type: result.value,
        loc: {
          file: ctx.input_path,
          line: parsed_node.pos.line,
          column: parsed_node.pos.column,
        },
      });

      return Result.Ok(result.value);
    };

    case AstNodeKind.Literal: {
      if (parsed_node.type == 'str') {
        typed_node = set_t_origin(ctx, T.string, parsed_node);
      } else if (parsed_node.type == 'int') {
        typed_node = set_t_origin(ctx, T.sisz, parsed_node);
      } else {
        // @ts-expect-error Node should be inferred to be never here
        const msg = `Unhandled literal type ${parsed_node.type}`;
        return Result.Err(msg);
      }
    } break;

    case AstNodeKind.FuncCall: {
      const fn_name = parsed_node.name;
      let ref = ctx.get_var(fn_name);
      if (!ref) return Result.Err(`Calling an undeclared function '${fn_name}'`);
      if (ref.type.kind != 'func') return Result.Err(`Attempting to call non-function variable '${fn_name}' as a function`);
      typed_node = ref.type.returns;
    } break;

    case AstNodeKind.VarDecl: {
      if (parsed_node.init) {
        if (parsed_node.type.name != '()') {
          const var_usr_decl_type_result = parse_type_from_str(ctx, parsed_node.type.name);
          if (!var_usr_decl_type_result.ok) {
            const error = var_usr_decl_type_result.error;
            return Result.Err(`Failed to read user provided type \`${parsed_node.type.name}\`: ${error}`);
          }
          const var_usr_decl_type = var_usr_decl_type_result.value;

          const init_type_result = get_type(ctx, parsed_node.init);
          if (!init_type_result.ok) {
            const error = init_type_result.error;
            if (error) return Result.Err(`Could not read the type of the variable initialization: ${error}`);
            return Result.Err(`Could not read the type of the variable initialization and errored with null`);
          }
          const init_type = init_type_result.value;
          // if (parsed_node.init.kind == 'pop') console.log(init_type, parsed_node);

          if (!types_are_equivalent(init_type, var_usr_decl_type)) return Result.Err(`Incompatible type at variable initialization`);

          ctx.add_var({
            loc: {
              file: ctx.input_path,
              line: parsed_node.pos.line,
              column: parsed_node.pos.column,
            },
            name: parsed_node.name,
            type: var_usr_decl_type,
            decl: parsed_node,
          });
          return Result.Ok(var_usr_decl_type);
        } else {
          const init_type_result = get_type(ctx, parsed_node.init);
          if (!init_type_result.ok) {
            const error = init_type_result.error;
            if (error) return Result.Err(`Could not read the type of the variable initialization: ${error}`);
            return Result.Err(`Could not read the type of the variable initialization and errored with null`);
          }
          const init_type = init_type_result.value;
          ctx.add_var({
            loc: {
              file: ctx.input_path,
              line: parsed_node.pos.line,
              column: parsed_node.pos.column,
            },
            name: parsed_node.name,
            type: init_type,
            decl: parsed_node,
          });
          if (parsed_node.type.general == 'number') {
            if (!is_number(init_type)) {
              return Result.Err('Initialization should be a number');
            }
          }
          parsed_node.type.name = get_type_name(init_type);
          parsed_node.type.infer_pos = {
            file: parsed_node.type.infer_pos?.file ?? ctx.input_path,
            line: parsed_node.type.infer_pos?.line ?? parsed_node.init.pos.line,
            column: parsed_node.type.infer_pos?.column ?? parsed_node.init.pos.column,
          };
          return Result.Ok(init_type);
        }

      } else {
        if (parsed_node.type.name === '()') {
          return Result.Err(`Declared variable's type requires forward checking which is not implemented`);
        }
        const result = parse_type_from_str(ctx, parsed_node.type.name);
        if (!result.ok) {
          const error = result.error;
          return Result.Err(`Failed to read user provided type \`${parsed_node.type.name}\`: ${error}`);
        }
        ctx.add_var({
          loc: {
            file: ctx.input_path,
            line: parsed_node.pos.line,
            column: parsed_node.pos.column,
          },
          name: parsed_node.name,
          type: result.value,
          decl: parsed_node,
        });
        typed_node = result.value;
      }
    } break;

    case AstNodeKind.PipeOp: {
      let pipe = parsed_node;
      // TODO: Check types of sequence instead of just finding the last item and returning its type
      while (pipe.next) {
        pipe = pipe.next;
      }
      switch (pipe.val.kind) {
        case AstNodeKind.FuncCall: {
          const t_result = get_type(ctx, pipe.val);
          if (!t_result.ok) return Result.Err(`Failed to read type\n${t_result.error}`);
          const t = t_result.value as FuncType;
          typed_node = t.returns;
          break;
        }
        case AstNodeKind.Ident:
        case AstNodeKind.Expr:
        case AstNodeKind.Literal: {
          const t_result = get_type(ctx, pipe.val);
          if (!t_result.ok) return Result.Err(`Failed to read type: ${t_result.error}`);
          const t = t_result.value;

          if (t.kind == 'func') return Result.Ok(t.returns);
          typed_node = t;
        } break;
        default: {
          $todo('Handle pipe expression type', pipe.val.kind);
        }
      }
    } break;

    case AstNodeKind.Binop: {
      const { op, lhs: lhs_node, rhs: rhs_node } = parsed_node;
      const lhs_t_result = get_type(ctx, lhs_node);
      const rhs_t_result = get_type(ctx, rhs_node);
      if (!lhs_t_result.ok) {
        if (lhs_t_result.error) return Result.Err(`Failed to read binop branch: ${lhs_t_result.error}`);
        return Result.Err('Failed to read binop branch: ' + lhs_node.kind);
      }
      const lhs_t = lhs_t_result.value;

      if (!rhs_t_result.ok) {
        if (rhs_t_result.error) return Result.Err(`Failed to read binop branch: ${rhs_t_result.error}`);
        return Result.Err('Failed to read binop branch: ' + rhs_node.kind);
      }
      const rhs_t = rhs_t_result.value;

      if (is_math_operator(op)) {
        if (!is_number(lhs_t)) {
          return Result.Err('Left side of math operation is not a number but has type `' + get_type_name(lhs_t) + '`');
        }
        if (!is_number(rhs_t)) {
          return Result.Err('Right side of math operation is not a number but has type `' + get_type_name(rhs_t) + '`');
        }
        if (rhs_t.kind != 'enum' && lhs_node.kind == 'idnt') {
          const lhs_v = ctx.get_var(lhs_node.ident);
          if (lhs_v && lhs_v.decl && lhs_v.decl.kind == 'vardcl') {
            if (lhs_v.decl.type.general == 'number') {
              lhs_v.decl.type.name = get_type_name(rhs_t);
              lhs_v.decl.type.general = null;
            }
          }
        }
        if (lhs_t.kind != 'enum' && rhs_node.kind == 'idnt') {
          const rhs_v = ctx.get_var(rhs_node.ident);
          if (rhs_v && rhs_v.decl && rhs_v.decl.kind == 'vardcl') {
            if (rhs_v.decl.type.general == 'number') {
              rhs_v.decl.type.name = get_type_name(lhs_t);
              rhs_v.decl.type.general = null;
            }
          }
        }

        typed_node = rhs_t.kind === 'primitive' ? ctx.get_type(rhs_t.base)! : Ints.uisz;
        return Result.Ok(typed_node);
      }

      if (is_logic_operator(op)) {
        if (!types_are_equivalent(lhs_t, T.bool)) {
          return Result.Err('Left side of logical operator is not of type `bool` but has type `' + get_type_name(lhs_t) + '`');
        }
        if (!types_are_equivalent(rhs_t, T.bool)) {
          return Result.Err('Right side of logical operator is not of type `bool` but has type `' + get_type_name(rhs_t) + '`');
        }
        return Result.Ok(T.bool);
      }

      if (is_cmp_operator(op)) {
        if (!is_number(lhs_t)) {
          const lhs_name = get_type_name(lhs_t);
          return Result.Err('Left side of comparison operator must be a number, but it has type `' + lhs_name + '`');
        }
        if (is_any_integer(lhs_t) && !is_any_integer(rhs_t)) {
          const rhs_name = get_type_name(rhs_t);
          return Result.Err('Right side of integer comparison is not an integer, but it has a type of `' + rhs_name + '`');
        }
        if (!is_number(rhs_t)) {
          const rhs_name = get_type_name(rhs_t);
          return Result.Err('Right side of comparison operator must be a number, but it has type `' + rhs_name + '`');
        }

        if (rhs_t.kind != 'enum' && lhs_node.kind == 'idnt') {
          const lhs_v = ctx.get_var(lhs_node.ident);
          if (lhs_v && lhs_v.decl && lhs_v.decl.kind == 'vardcl') {
            if (lhs_v.decl.type.general == 'number') {
              lhs_v.decl.type.name = get_type_name(rhs_t);
              lhs_v.decl.type.general = null;
            }
          }
        }
        if (lhs_t.kind != 'enum' && rhs_node.kind == 'idnt') {
          const rhs_v = ctx.get_var(rhs_node.ident);
          if (rhs_v && rhs_v.decl && rhs_v.decl.kind == 'vardcl') {
            if (rhs_v.decl.type.general == 'number') {
              rhs_v.decl.type.name = get_type_name(lhs_t);
              rhs_v.decl.type.general = null;
            }
          }
        }

        return Result.Ok(T.bool);
      }
    } break;

    case AstNodeKind.Keyword: {
      if (parsed_node.word !== 'return') break;

      if (parsed_node.expr == null) return Result.Ok(T.void);
      const ret_t_result = get_type(ctx, parsed_node.expr);
      if (!ret_t_result.ok) {
        const error = ret_t_result.error;
        if (!error) break;
        return Result.Err('Failed to read type of returned expression: ' + error);
      }
      const ret_t = ret_t_result.value;
      typed_node = ret_t;
    } break;

    case AstNodeKind.Ident: {
      const name = parsed_node.ident;
      const usr_var = ctx.get_var(name);
      if (!usr_var) {
        let error = `No variable or function found with name '${name}'`;
        // const existing_vars = ctx.vars_list();
        // if (existing_vars.length > 0) {
        //   error += '\n  Existing variables are:';
        //   for (const [var_name, var_node] of existing_vars) {
        //     error += `\n    ${var_name}: ${get_type_name(var_node.type)}`;
        //   }
        // } else {
        //   error += '\n  No variables exist in the current context';
        // }
        return Result.Err(error);
      }
      typed_node = usr_var.type;
    } break;

    case AstNodeKind.Expr: {
      if (!parsed_node.item) return Result.Ok(T.void);
      const result = get_type(ctx, parsed_node.item);
      if (!result.ok) return Result.Err(result.error);
      typed_node = result.value;
    } break;

    default: {
      throw new Error(`Unhandled parse node kind attempting to get type: ${parsed_node.kind}`);
    };
  }

  if (!typed_node) return Result.Err('Unable to figure out type for node ' + node_debug_fmt(parsed_node));

  return Result.Ok(typed_node);
}




const sprint = (file_path: string, pos: { line: number; column: number; }, ...data: [any, ...any[]]) =>
  `${file_path}:${pos.line}:${pos.column}: ${data.join(' ')}`;
const eprintln = (file_path: string, pos: { line: number; column: number; }, ...data: [any, ...any[]]) =>
  console.error(`${file_path}:${pos.line}:${pos.column}: [ERROR]`, ...data);
const println = (file_path: string, pos: { line: number; column: number; }, ...data: [any, ...any[]]) =>
  console.log(`${file_path}:${pos.line}:${pos.column}: [INFO]`, ...data);


function register_variable(ctx: TypesContext, parsed_node: VarDeclNode): Result<LangType, string> {
  if (parsed_node.init) {
    if (parsed_node.type.name != '()') {
      const var_usr_decl_type_result = parse_type_from_str(ctx, parsed_node.type.name);
      if (!var_usr_decl_type_result.ok) {
        const error = var_usr_decl_type_result.error;
        return Result.Err(`Failed to read user provided type \`${parsed_node.type.name}\`: ${error}`);
      }
      const var_usr_decl_type = var_usr_decl_type_result.value;

      const init_type_result = get_type(ctx, parsed_node.init);
      if (!init_type_result.ok) {
        const error = init_type_result.error;
        if (error) return Result.Err(`Could not read the type of the variable initialization: ${error}`);
        return Result.Err(`Could not read the type of the variable initialization and errored with null`);
      }
      const init_type = init_type_result.value;
      // if (parsed_node.init.kind == 'pop') console.log(init_type, parsed_node);

      if (!types_are_equivalent(init_type, var_usr_decl_type)) return Result.Err(`Incompatible type at variable initialization`);

      ctx.add_var({
        loc: {
          file: ctx.input_path,
          line: parsed_node.pos.line,
          column: parsed_node.pos.column,
        },
        name: parsed_node.name,
        type: var_usr_decl_type,
        decl: parsed_node,
      });

      return Result.Ok(var_usr_decl_type);
    }

    const init_type_result = get_type(ctx, parsed_node.init);
    if (!init_type_result.ok) {
      const error = init_type_result.error;
      if (error) return Result.Err(`Could not read the type of the variable initialization: ${error}`);
      return Result.Err(`Could not read the type of the variable initialization and errored with null`);
    }

    const init_type = init_type_result.value;
    ctx.add_var({
      loc: {
        file: ctx.input_path,
        line: parsed_node.pos.line,
        column: parsed_node.pos.column,
      },
      name: parsed_node.name,
      type: init_type,
      decl: parsed_node,
    });
    if (parsed_node.type.general == 'number') {
      if (!is_number(init_type)) {
        return Result.Err('Initialization should be a number');
      }
    }

    parsed_node.type.name = get_type_name(init_type);
    parsed_node.type.infer_pos = {
      file: parsed_node.type.infer_pos?.file ?? ctx.input_path,
      line: parsed_node.type.infer_pos?.line ?? parsed_node.init.pos.line,
      column: parsed_node.type.infer_pos?.column ?? parsed_node.init.pos.column,
    };
    return Result.Ok(init_type);

  }

  if (parsed_node.type.name === '()') {
    return Result.Err(`Declared variable's type requires forward checking which is not implemented`);
  }

  const result = parse_type_from_str(ctx, parsed_node.type.name);
  if (!result.ok) {
    const error = result.error;
    return Result.Err(`Failed to read user provided type \`${parsed_node.type.name}\`: ${error}`);
  }
  const parsed_type = result.value;

  ctx.add_var({
    loc: {
      file: ctx.input_path,
      line: parsed_node.pos.line,
      column: parsed_node.pos.column,
    },
    name: parsed_node.name,
    type: parsed_type,
    decl: parsed_node,
  });

  return Result.Ok(parsed_type);
}


function find_returns(ctx: TypesContext, body: SimpNode[], found: Array<KeywordNode> = []): Result<typeof found, string> {
  for (const n of body) {
    if (n.kind == AstNodeKind.VarDecl) {
      const result = register_variable(ctx, n);
      if (!result.ok) return result;
      continue;
    }

    if (n.kind == AstNodeKind.IfElse) {
      const result = find_returns(ctx.new_child_ctx(), n.body, found);
      if (!result.ok) return result;
      if (n.else) {
        const result = find_returns(ctx.new_child_ctx(), n.else, found);
        if (!result.ok) return result;
      }
      continue;
    }
    if (n.kind == AstNodeKind.Keyword && n.word == 'return') {
      found.push(n);
      continue;
    }
  }
  return Result.Ok(found);
}


// Return whether the types are ok and print type errors if any
export function check_types(
  ctx: TypesContext,
  node: Exclude<AstNode, EoFNode> | null | undefined,
  parent: SimpNode | null = null,
): node is (Exclude<AstNode, EoFNode> & { typing: LangType }) | null | undefined {
  if (!node) return true;
  // console.log('[DEBUG] Type checking node', node.kind);
  const Ref: { value: LangType } = {} as any;
  Object.defineProperty(Ref, 'value', {
    set(v: LangType) { (node as any).typing = v; },
  });

  switch (node.kind) {
    case AstNodeKind.Literal:
      Ref.value = get_type(ctx, node).unwrap();
      return true;

    case AstNodeKind.VarDecl: {
      if (ctx.has_var(node.name)) {
        const v = ctx.get_var(node.name)!;
        if (v.loc?.line !== node.pos.line || v.loc?.column !== node.pos.column) {
          eprintln(ctx.input_path, node.pos, `Re-declaring variable ${node.name}`);
          if (v.loc) println(ctx.input_path, v.loc, 'Originally declared here');
          else console.log('[INFO] Original declaration was not preserved');
          return false;
        }
        // const cur_pos = get_current_line();
        // println(__filename, { line: cur_pos.line, column: cur_pos.char }, 'We have hit the same variable declaration twice');
        return true;
      }

      const usr_type_name = node.type.name;
      if (!node.init) {
        const type_result = parse_type_from_str(ctx, usr_type_name);
        if (!type_result.ok) {
          const error = type_result.error;
          eprintln(__filename, node.pos, error);
          return false;
        }

        ctx.add_var({
          name: node.name,
          type: type_result.value,
          decl: node,
          loc: {
            file: ctx.input_path,
            line: node.pos.line,
            column: node.pos.column,
          },
        });
        return true;
      } else {
        const init_t_result = get_type(ctx, node.init);
        if (!init_t_result.ok) {
          const error = init_t_result.error ?? 'Unknown error when type checking variable initialization';
          eprintln(ctx.input_path, node.pos, error);
          return false;
        }
        if (usr_type_name == '()') {
          ctx.add_var({
            name: node.name,
            type: init_t_result.value,
            decl: node,
            loc: {
              file: ctx.input_path,
              line: node.pos.line,
              column: node.pos.column,
            },
          });
          return true;
        }
        const init_t = init_t_result.value;
        if (usr_type_name == 'number') {
          if (!is_number(init_t)) {
            eprintln(ctx.input_path, node.pos, 'Expected initialization value to be a valid number');
            return false;
          }

          ctx.add_var({
            name: node.name,
            type: init_t,
            decl: node,
            loc: {
              file: ctx.input_path,
              line: node.pos.line,
              column: node.pos.column,
            },
          });
          return true;
        }

        const type_result = parse_type_from_str(ctx, usr_type_name);
        if (!type_result.ok) {
          const error = type_result.error;
          eprintln(ctx.input_path, node.pos, 'UnknownType: ' + error);
          return false;
        }

        const var_t = type_result.value;
        if (!types_are_equivalent(var_t, init_t)) {
          const init_t_name = get_type_name(init_t);
          const var_t_name = get_type_name(var_t);
          eprintln(ctx.input_path, node.pos, `Initialization value \`${init_t_name}\` does not match provided type \`${var_t_name}\``);
          return false;
        }

        ctx.add_var({
          name: node.name,
          type: var_t,
          decl: node,
          loc: {
            file: ctx.input_path,
            line: node.pos.line,
            column: node.pos.column,
          },
        });
        return true;
      }
    };

    case AstNodeKind.Keyword: {
      const fn = (parent as FnDeclNode);
      const returns_result = parse_type_from_str(ctx, fn.returns);
      if (!returns_result.ok) unreachable('Parsing function return should be safe: ' + String(returns_result.error));
      const returns = returns_result.value;
      if (node.expr == null && returns.kind == 'void') return true;
      if (!node.expr) {
        const returns_name = get_type_name(returns);
        eprintln(ctx.input_path, node.pos, `Expected return of '${returns_name}' but are returning 'void'`);
        return false;
      }

      const returning_result = get_type(ctx, node.expr);
      if (!returning_result.ok) {
        const error = returning_result.error;
        eprintln(ctx.input_path, node.expr.pos, `Type is unreadable by type checker: ${error}`);
        return false;
      }

      const returning = returning_result.value;
      if (!types_are_equivalent(returning, returns)) {
        const returns_name = get_type_name(returns);
        const returning_name = get_type_name(returning);
        eprintln(ctx.input_path, node.expr.pos, `Expected return of '${returns_name}' but are returning '${returning_name}'`);
        return false;
      }

      return true;
    };

    case AstNodeKind.IfElse: {
      const cond_t_result = get_type(ctx, node.cond);
      if (!cond_t_result.ok) {
        eprintln(ctx.input_path, node.cond.pos, cond_t_result.error ?? 'Failed to evaluate type of if condition');
        return false;
      }
      const cond_t = cond_t_result.value;
      if (!types_are_equivalent(cond_t, T.bool)) {
        const cond_t_name = '`' + get_type_name(cond_t) + '`';
        eprintln(ctx.input_path, node.cond.pos, 'If condition must evaluate to a `bool` type but it is currently of type', cond_t_name);
        return false;
      }

      for (const n of node.body) {
        if (!check_types(ctx.new_child_ctx(), n, parent)) return false;
      }
      for (const n of node.else ?? []) {
        if (!check_types(ctx.new_child_ctx(), n, parent)) return false;
      }
      return true;
    };

    case AstNodeKind.PipeOp: {
      let prv_result = get_type(ctx, node.val);
      if (!prv_result.ok) {
        eprintln(ctx.input_path, node.pos, prv_result.error ?? 'Failed to assume type of ' + node_debug_fmt(node.val));
        return false;
      }
      let held = { T: prv_result.value, pos: node.val.pos };
      let piper = node.next;
      while (piper) {
        const pipe = piper;
        piper = piper.next;
        const prv = held;

        if (pipe.val.kind == 'fncal') {
          const call_node = pipe.val;
          const fn_var = ctx.get_var(pipe.val.name);
          if (!fn_var) {
            eprintln(ctx.input_path, call_node.pos, `Attempting to call non-existent function '${pipe.val.name}', did you spell it right?`);
            return false;
          }
          const fn_t = fn_var.type;
          if (fn_t.kind != 'func') {
            const t_name = get_type_name(fn_var.type);
            eprintln(ctx.input_path, call_node.pos, `Attempting to call '${t_name}' as a function '${pipe.val.name}', what are you scheming?`);
            return false;
          }

          if (fn_t.args.length != call_node.args.length + 1) {
            const t_name = get_type_name(fn_var.type);
            if (fn_t.args.length < call_node.args.length + 1 && !fn_t.variadic) {
              eprintln(ctx.input_path, call_node.pos, `Too many arguments passed to function ${call_node.name} of type \`${t_name}\``);
              return false;
            }
            if (fn_t.args.length - (fn_t.variadic ? 1 : 0) > call_node.args.length + 1) {
              eprintln(ctx.input_path, call_node.pos, `Insufficient arguments passed to function ${call_node.name} of type \`${t_name}\``);
              return false;
            }
          }
          if (fn_t.variadic) {
            let failed = false;
            for (let i = 0; i <= call_node.args.length; ++i) {
              let carg_t: LangType;
              let pos: { line: number; column: number };
              if (i < call_node.args.length) {
                const call_arg = call_node.args[i]!;
                const carg_result = get_type(ctx, call_arg);
                if (!carg_result.ok) {
                  eprintln(ctx.input_path, call_arg.pos, carg_result.error ?? ('Failed to assume type of ' + node_debug_fmt(call_arg)));
                  failed = true;
                  continue;
                }
                carg_t = carg_result.value;
                pos = call_arg.pos;
              } else {
                carg_t = prv.T;
                pos = prv.pos;
              }
              const earg_t = i >= fn_t.args.length - 1 ? fn_t.variadic.type ?? T.any : fn_t.args[i]!.type;
              if (!types_are_equivalent(earg_t, carg_t)) {
                const e_t = get_type_name(earg_t);
                const c_t = get_type_name(carg_t);
                eprintln(ctx.input_path, pos, `Invalid type used in function call, expected type '${e_t}' but got '${c_t}'`);
                failed = true;
                continue;
              }
            }
            if (failed) return false;
            held = {
              T: fn_t.returns,
              pos: call_node.pos,
            };
            continue;
          }

          if (fn_t.args.length != call_node.args.length + 1) {
            const line_pos = get_current_line();
            eprintln(__filename, { line: line_pos.line, column: line_pos.char }, 'Should have failed early cause function arity differs');
            return false;
          }
          let failed = false;
          for (let i = 0; i < call_node.args.length; ++i) {
            const call_arg = call_node.args[i]!;
            const carg_result = get_type(ctx, call_arg);
            if (!carg_result.ok) {
              eprintln(ctx.input_path, call_arg.pos, carg_result.error ?? ('Failed to assume type of ' + node_debug_fmt(call_arg)));
              failed = true;
              continue;
            }
            const carg_t = carg_result.value;
            const earg_t = fn_t.args[i]!.type;
            if (!types_are_equivalent(earg_t, carg_t)) {
              const e_t = get_type_name(earg_t);
              const c_t = get_type_name(carg_t);
              eprintln(ctx.input_path, call_arg.pos, `Invalid type used in function call, expected type '${e_t}' but got '${c_t}'`);
              failed = false;
              continue;
            }
          }
          if (failed) return false;
          held = {
            T: fn_t.returns,
            pos: call_node.pos,
          };

          continue;
        }

        const val_node = pipe.val;
        const val_result = get_type(ctx, val_node);
        if (!val_result.ok) {
          eprintln(ctx.input_path, val_node.pos, val_result.error);
          return false;
        }

        const val_t = val_result.value;
        if (val_t.kind != 'func') {
          const v_t = get_type_name(val_t);
          eprintln(ctx.input_path, val_node.pos, `Invalid pipe to: Attempting to pipe to non-function of type '${v_t}'`);
          return false;
        }

        if (val_t.args.length === 0) {
          eprintln(ctx.input_path, val_node.pos, `Function arity mismatch: expected NO arguments but got 1`);
          return false;
        }

        if (val_t.args.length !== 1) {
          if (val_t.variadic) {
            if (val_t.args.length > 2) {
              const min_count = val_t.args.length - 1;
              eprintln(ctx.input_path, val_node.pos, `Function arity mismatch: expected at least ${min_count} arguments but only got 1`);
              return false;
            }
          } else {
            const expected_count = val_t.args.length;
            eprintln(ctx.input_path, val_node.pos, `Function arity mismatch: expected ${expected_count} arguments but got 1`);
            return false;
          }
        }

        if (!types_are_equivalent(val_t.args[0]!.type, prv.T)) {
          const earg_t = get_type_name(val_t.args[0]!.type);
          const carg_t = get_type_name(prv.T);
          eprintln(ctx.input_path, prv.pos, `Invalid type used in function call, expected type '${earg_t}' but got '${carg_t}'`);
          return false;
        }

        held = {
          T: val_t.returns,
          pos: val_node.pos,
        };
      }

      Ref.value = held.T;
      return true;
    };

    case AstNodeKind.FuncCall: {
      const fn = ctx.get_var(node.name);
      if (!fn) {
        const { line, column } = node.pos;
        console.error(`${ctx.input_path}:${line}:${column}: Attempting to call undeclared function '${node.name}'`);
        return false;
      }
      if (fn.type.kind != 'func') {
        const { line, column } = node.pos;
        const type_name = get_type_name(fn.type);
        console.error(`${ctx.input_path}:${line}:${column}: Attempting to call ${type_name} variable '${node.name}' as a function`);
        return false;
      }

      const fn_t = fn.type;
      if (node.args.length !== fn_t.args.length && fn_t.variadic == null) {
        const { line, column } = node.pos;
        const err = node.args.length < fn.type.args.length ? 'Insufficient arguments' : 'Too many arguments';
        console.error(`${ctx.input_path}:${line}:${column}: ${err} for calling function '${node.name}'`);
        return false;
      }
      if (fn_t.variadic) {
        const minArgs = Math.max(0, fn_t.args.length - 1);
        if (node.args.length < minArgs) {
          const { line, column } = node.pos;
          console.error(
            `${ctx.input_path}:${line}:${column}: Insufficient arguments for variadic function '${node.name}' (expects at least ${minArgs})`
          );
          return false;
        }
      }
      for (let i = 0; i < node.args.length; ++i) {
        const passed_node = node.args[i]!;
        const expects_arg = fn_t.variadic && i >= fn_t.args.length - 1 ? fn_t.variadic.type ?? T.any : fn_t.args[i]!.type;
        const result = get_type(ctx, passed_node);
        if (!result.ok) {
          const { line, column } = node.pos;
          console.error(`${ctx.input_path}:${line}:${column}: ${result.error}`);
          return false;
        }
        const passed_arg = result.value;
        if (!types_are_equivalent(expects_arg, passed_arg)) {
          const { line, column } = node.args[i]!.pos;
          const e_t = get_type_name(expects_arg);
          const g_t = get_type_name(passed_arg);
          console.error(`${ctx.input_path}:${line}:${column}: Argument expected to be '${e_t}' but got '${g_t}'`);
          return false;
        }
        if (is_number(expects_arg) && is_number(passed_arg) && passed_arg.origin != null) {
          // Second part of condition written for typescript, it logically won't ever yield a different value than the first check
          if (passed_arg.kind == 'enum' || expects_arg.kind == 'enum') {
            continue
          }

          if (passed_arg.base !== expects_arg.base) {
            passed_arg.origin = null;
            passed_arg.base = expects_arg.base;
            continue;
          }
        }
      }
      Ref.value = fn_t.returns;
      return true;
    };

    case AstNodeKind.FuncDecl: {
      const fn_type_result = get_type(ctx, node) as Result<FuncType, string>;
      if (!fn_type_result.ok) {
        console.error(fn_type_result.error);
        return false;
      }

      const fn_type = fn_type_result.value;
      ctx.add_var({
        loc: {
          file: ctx.input_path,
          line: node.pos.line,
          column: node.pos.column,
        },
        name: node.name,
        type: fn_type,
        decl: node,
      });

      if (node.returns == '()') node.returns = get_type_name(fn_type.returns);

      const decl_result = get_func_body_and_args_types(ctx.new_child_ctx(), node);
      if (!decl_result.ok) {
        console.error(decl_result.error);
        return false;
      }
      const { fn_ctx } = decl_result.value;

      for (const n of node.body) {
        if (n.kind == AstNodeKind.VarDecl) {
          // console.log('[DEBUG] Type checking node', node.kind);
          const tr = get_type(fn_ctx, n);
          if (!tr.ok) {
            console.error(tr.error ?? 'Failed to read of variable declaration and result has error set to null');
            return false;
          }
          const t = tr.value;
          n.type.name = get_type_name(t);
          continue;
        }
        if (!check_types(fn_ctx, n, node)) return false;
      }

      Ref.value = fn_type;
      return true;
    };
  }

  console.error('TypeChecker::check_types has no support for node ' + node_debug_fmt(node));
  return false;
}

export function register_global(ctx: TypesContext, node: SimpNode): Result<boolean, [string, ...string[]]> {
  switch (node.kind) {
    case AstNodeKind.FuncDecl: {
      const builder = fn_type_builder()
        .set_name(node.name)
        .originates({
          file: ctx.input_path,
          line: node.pos.line,
          column: node.pos.column,
        })
        .set_return(T.void);
      const errors = [] as unknown as [string, ...string[]];
      const fn_ctx = ctx.new_child_ctx();
      for (const arg_node of node.args) {
        if (arg_node.type == '()') {
          const { line, column } = arg_node.pos;
          errors.push(`${ctx.input_path}:${line}:${column}: Argument ${arg_node.name} has no provided type`);
          continue;
        }
        const type_parse_result = parse_type_from_str(ctx, arg_node.type);
        if (!type_parse_result.ok) {
          const { line, column } = arg_node.pos;
          errors.push(`${ctx.input_path}:${line}:${column}: Failed to read type of argument ${arg_node.name}: ${type_parse_result.error}`);
          continue;
        }
        if (errors.length > 0) continue;

        const arg_t = type_parse_result.value;
        builder.add_arg(arg_node.name, arg_t);

        fn_ctx.add_var({
          decl: arg_node,
          name: arg_node.name,
          type: arg_t,
          loc: {
            file: ctx.input_path,
            line: arg_node.pos.line,
            column: arg_node.pos.column,
          },
        });
      }
      if (errors.length > 0) {
        return Result.Err(errors);
      }

      const returns_result = find_returns(fn_ctx, node.body);
      if (!returns_result.ok) {
        errors.push(returns_result.error);
        return Result.Err(errors);
      }
      const returns = returns_result.value;

      if (returns.length > 0 && returns.every(r => r.expr && r.expr.kind == 'fncal' && r.expr.name == node.name)) {
        const { line, column } = node.pos;
        return Result.Err([
          `${ctx.input_path}:${line}:${column}: Cannot infer return type of an infinitely recursive function`
        ]);
      }

      for (const ret_node of returns) {
        if (!ret_node.expr) {
          builder.set_return(T.void);
          break;
        }

        const expr = ret_node.expr;

        if (expr.kind == AstNodeKind.Literal) {
          const t = get_type(fn_ctx, expr).unwrap();
          builder.set_return(t);
          break;
        }

        if (expr.kind == AstNodeKind.FuncCall) {
          if (!fn_ctx.var_exists(expr.name)) {
            if (expr.name === node.name) continue;
            const { line, column } = expr.pos;
            errors.push(`${ctx.input_path}:${line}:${column}: Attempting to call non-existent function ${expr.name}`);
            continue;
          }

          const fn_var = fn_ctx.get_var(expr.name)!;
          if (fn_var.type.kind != 'func') {
            const { line, column } = expr.pos;
            const tname = get_type_name(fn_var.type);
            errors.push(`${ctx.input_path}:${line}:${column}: Attempting to call ${tname} as function ${expr.name}`);
            continue;
          }
          builder.set_return(fn_var.type.returns);
          break;
        }

        const t_result = get_type(fn_ctx, expr);
        if (!t_result.ok) return Result.Err([sprint(ctx.input_path, expr.pos, t_result.error ?? 'Failed to assume type')]);
        const t = t_result.value;
        builder.set_return(t);
        break;
      }

      if (errors.length > 0) {
        return Result.Err(errors);
      }

      ctx.set_global_var({
        decl: node,
        name: node.name,
        type: builder.build(),
        loc: {
          file: ctx.input_path,
          line: node.pos.line,
          column: node.pos.column,
        },
      });
      return Result.Ok(true);
    };

    case AstNodeKind.VarDecl: {
      const result = register_variable(ctx, node);
      if (!result.ok) return Result.Err([result.error]);
      return Result.Ok(true);
    };
  }
  return Result.Ok(false);
}

