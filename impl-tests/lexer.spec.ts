import { test, describe, expect } from 'bun:test';
import { char } from '../src/ctype';
import {
  lexer_init,
  lexer_next,
  TOKEN_CHAR,
  TOKEN_FLOAT,
  TOKEN_INTEGER,
  TOKEN_STRING,
} from '../src/base-lexer';

const hello_example_file_path = 'examples/hello_world.efu';
const hello_example_bun_file = Bun.file(hello_example_file_path);
const hello_example_buffer = await hello_example_bun_file.bytes();

describe('Create Lexer', () => {
  test('Initialize with buffer', () => {
    const l = lexer_init(hello_example_file_path, hello_example_buffer)!;
    expect(l).toBeDefined()
    expect(l.buf).toBe(hello_example_buffer);
    expect(l.fd).toBeNull();
  });

  test('Initialize without buffer', () => {
    const l = lexer_init(hello_example_file_path)!;
    expect(l).toBeDefined()
    expect(l.buf).toBeDefined();
    expect(l.fd).toBeDefined();
  });
});

describe('Basic lexing', () => {
  const encoder = new TextEncoder();
  test('Math', () => {
    const source_code = '5 + 6.0 * 20 / 0.5';
    const source_buf = encoder.encode(source_code);
    const l = lexer_init('math.efu', source_buf)!;
    expect(l).toBeDefined();
    let result: boolean;

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(TOKEN_INTEGER);
    expect(l.number).toEqual(5);

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(char('+'));

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(TOKEN_FLOAT);
    expect(l.number).toEqual(6);

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(char('*'));

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(TOKEN_INTEGER);
    expect(l.number).toEqual(20);

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(char('/'));

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(TOKEN_FLOAT);
    expect(l.number).toEqual(0.5);
  });

  test('String literal', () => {
    const source_code = '"Hello,` "World!\\n` "foo\nbar` "KingStone A"';
    const source_buf = encoder.encode(source_code);
    const l = lexer_init('string_literals.efu', source_buf)!;
    expect(l).toBeDefined();
    let result: boolean;

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(TOKEN_STRING);
    expect(l.string.as_str()).toEqual('Hello,');

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(TOKEN_STRING);
    expect(l.string.as_str()).toEqual('World!\\n');

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.error.length).toEqual(0);
    expect(l.token_kind).toEqual(TOKEN_STRING);
    expect(l.string.as_str()).toEqual('foo\nbar');

    result = lexer_next(l);
    expect(result).toBeFalse();
    expect(l.error.length).toBeGreaterThan('error'.length);
  });

  test('Character literal', () => {
    const source_code = `'a' '0' '"' '\\'' '\\n' '\\t' '\\r'`;
    const source_buf = encoder.encode(source_code);
    const l = lexer_init('char_literals.efu', source_buf)!;
    expect(l).toBeDefined();
    let result: boolean;

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.token_kind).toEqual(TOKEN_CHAR);
    expect(l.string.as_str()).toEqual('a');
    expect(l.number).toEqual(char('a'));

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.token_kind).toEqual(TOKEN_CHAR);
    expect(l.string.as_str()).toEqual('0');
    expect(l.number).toEqual(char('0'));

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.token_kind).toEqual(TOKEN_CHAR);
    expect(l.string.as_str()).toEqual('"');
    expect(l.number).toEqual(char('"'));

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.token_kind).toEqual(TOKEN_CHAR);
    expect(l.string.as_str()).toEqual('\\\'');
    expect(l.number).toEqual(char('\''));

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.token_kind).toEqual(TOKEN_CHAR);
    expect(l.string.as_str()).toEqual('\\n');
    expect(l.number).toEqual(char('\n'));

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.token_kind).toEqual(TOKEN_CHAR);
    expect(l.string.as_str()).toEqual('\\t');
    expect(l.number).toEqual(char('\t'));

    result = lexer_next(l);
    expect(result).toBeTrue();
    expect(l.token_kind).toEqual(TOKEN_CHAR);
    expect(l.string.as_str()).toEqual('\\r');
    expect(l.number).toEqual(char('\r'));
  });
});

