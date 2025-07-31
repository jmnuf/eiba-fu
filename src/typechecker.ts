import type { Prettify, SourcePosition } from './utils';
import { Result, pipe } from './utils';
import type { AstNode, EoFNode, FnDeclNode } from './parser';
import { Lex, TokenKind } from './lexer';
import { AstNodeKind } from './parser';

interface TypeDef {
  origin: SourcePosition | null; // null means define by compiler
  methods: Array<{ name: string; type: FuncType }>;
  properties: Array<{ name: string; type: LangType }>;
}

interface AnyType extends TypeDef {
  kind: 'any';
  origin: null;
}

interface VoidType extends TypeDef {
  kind: 'void';
  origin: null;
}

interface PrimitiveType extends TypeDef {
  kind: 'primitive';
  origin: null;
  base: 'i8' | 'u8' | 'i32' | 'u32' | 'isz' | 'usz' | 'ptr' | 'string' | 'bool' | 'null';
}

interface ArrayType extends TypeDef {
  kind: 'array';
  origin: null;
  base: LangType;
  size: number | null;
}

interface StructType extends TypeDef {
  kind: 'struct';
  name: string;
  fields: Array<{ name: string; type: LangType; }>;
}

interface FuncType extends TypeDef {
  kind: 'func';
  name: string;
  args: Array<{ name: string; type: LangType; }>;
  returns: LangType;
  variadic: null | { name: string; type: null | LangType };
}

interface EnumType extends TypeDef {
  kind: 'enum';
  name: string;
  values: Array<{ name: string; value: number; }>;
}

interface TaggedUnionType extends TypeDef {
  kind: 'tagged-union';
  name: string;
  values: Array<{ name: string; type: LangType }>;
}

interface LangTypesMap {
  Any: AnyType;
  Void: VoidType;
  Primitive: PrimitiveType;
  Array: ArrayType;
  Struct: StructType;
  Func: FuncType;
  Enum: EnumType;
  TaggedUnion: TaggedUnionType;
}


type LangType = LangTypesMap[keyof LangTypesMap];

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
  type: LangType;
};
class TypesContext {
  readonly parent: TypesContext | null;
  private types: Map<string, LangType>;
  private vars: Map<string, TypesContextVar>;

  constructor(parent: TypesContext | null = null) {
    this.parent = parent ?? null;
    this.types = new Map();
    this.vars = new Map();
  }

  get_type = (name: string): LangType | undefined => {
    let t = this.types.get(name);
    if (t == undefined && this.parent) return this.parent.get_type(name);
    return t;
  };

  get_var = (name: string): TypesContextVar | undefined => {
    let t = this.vars.get(name);
    if (t == undefined && this.parent) return this.parent.get_var(name);
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
    return this.types.has(name) || this.parent.type_exists(name);
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
    return this.vars.has(name) || this.parent.var_exists(name);
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

function get_func_body_and_args_types(
  ctx: TypesContext,
  parsed_node: FnDeclNode
): Result<{ args: FuncType['args']; returns: FuncType['returns'] }, string> {
  let returns: FuncType['returns'] | null = null;
  if (parsed_node.returns != '()') {
    const parse_returns_result = parse_type_from_str(ctx, parsed_node.returns);
    if (!parse_returns_result.ok) return parse_returns_result;
    returns = parse_returns_result.value;
  }

  if (returns == null) return Result.Err(`The return value is unabled to be inferred`);
  throw new Error('TODO: Implement get_func_body_and_args_types');
}

function parse_type_from_str(ctx: TypesContext, str: string): Result<LangType, string> {
  const l = Lex(str);
  let tok = l.next();
  if (tok.kind !== TokenKind.Ident) return Result.Err('Provided type has an invalid name.');

  const base_name = l.get_ident();
  const base_t = ctx.get_type(base_name);
  if (!base_t) return Result.Err(`No type with name '${base_name}' was found. Did you spell it right?`);

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

function types_are_equivalent(a: LangType, b: LangType) {
  if (a === b) return true;
  if (a.kind != b.kind) return false;
  // Nothing more to check on these types as they hold no information
  if (a.kind == 'any' || a.kind == 'void') return true;

  switch (a.kind) {
    case 'primitive': {
      const a_base = a.base;
      const b_base = (b as PrimitiveType).base;
      if (a_base == 'string' || a_base == 'bool' || a_base == 'null' || a_base == 'ptr') {
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

const prim_type_builder = () => type_builder('primitive');
const fn_type_builder = () => type_builder('func');
// const struct_type_builder = () => type_builder('struct');
const array_type_builder = (): TypeBuilder<'array', false> =>
  type_builder('array')
    .add_property('len', T.usz)
  ;

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
  isz: prim_type_builder()
    .T('isz')
    .build(),
  usz: prim_type_builder()
    .T('usz')
    .build(),
  i32: prim_type_builder()
    .T('i32')
    .build(),
  u32: prim_type_builder()
    .T('u32')
    .build(),
  i8: prim_type_builder()
    .T('i8')
    .build(),
  u8: prim_type_builder()
    .T('u8')
    .build(),
} as const;

const StringType = prim_type_builder()
  .T('string')
  .add_property('len', Ints.usz)
  .add_method(
    fn_type_builder()
      .set_name('bytes')
      .set_return(array_type_builder().T(Ints.u8).build())
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
} as const satisfies Types);

add_new_fn_to_type(
  T.string,
  b =>
    b.set_name('append')
      .add_arg('other', T.string)
      .set_return(T.string)
      .build(),
)


export function create_global_context(): TypesContext {
  const ctx = new TypesContext();

  for (const k of Object.keys(T) as Array<keyof typeof T>) {
    const t = T[k];
    ctx.add_type(k, t);
  }

  const printf_t = fn_type_builder()
    .set_name('printf')
    .add_arg('format_string', T.string)
    .add_arg('rest', T.void)
    .variadic({ name: 'rest', type: T.any })
    .set_return(T.isz)
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

  ctx.add_var({ name: printf_t.name, loc: null, type: printf_t });
  ctx.add_var({ name: printnf_t.name, loc: null, type: printnf_t });
  ctx.add_var({ name: fmt_t.name, loc: null, type: fmt_t });

  return ctx;
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
        typed_node = T.string;
      } else if (parsed_node.type == 'int') {
        typed_node = T.isz;
      } else {
        // @ts-expect-error Node should be inferred to be never here
        const msg = `Unhandled literal type ${parsed_node.type}`;
        return Result.Err(msg);
      }
    } break;

    case AstNodeKind.FuncCall: {
      const fn_name = parsed_node.name;
      let ref = ctx.get_var(fn_name);
      if (!ref) return Result.Err(`Calling an undeclared function: ${fn_name}`);
      if (ref.type.kind != 'func') return Result.Err(`Attempting to call non-function variable '${fn_name}' as a function`);
      typed_node = ref.type;
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

