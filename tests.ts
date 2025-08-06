import npath from 'node:path';
import { readdir } from 'node:fs/promises';

const TESTS_FOLDER_NAME = 'ir-tests';
const TESTS_FOLDER_PATH = npath.join(__dirname, TESTS_FOLDER_NAME);

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E; };
const Result = {
  Ok<T, E>(value: T): Result<T, E> {
    return { ok: true, value };
  },
  Err<T, E>(error: E): Result<T, E> {
    return { ok: false, error };
  },
} as const;
const trySync = <T, E = unknown>(fn: () => T): Result<T, E> => {
  try {
    return Result.Ok(fn());
  } catch (e) {
    return Result.Err(e as E);
  }
};
const tryAsync = async <T, E = unknown>(fn: () => Promise<T>): Promise<Result<T, E>> => {
  try {
    return Result.Ok(await fn());
  } catch (e) {
    return Result.Err(e as E);
  }
}

const $ = Bun.$.cwd(__dirname).throws(true);

const log = {
  info(...args: [any, ...any[]]) {
    return console.log('[INFO]', ...args);
  },
  error(...args: [any, ...any[]]) {
    return console.error('[ERROR]', ...args);
  },
  cmd(strings: TemplateStringsArray, ...expressions: Bun.ShellExpression[]) {
    let cmd_str = '';
    for (let i = 0; i < strings.length; ++i) {
      cmd_str += strings[i]!;
      if (i >= expressions.length) continue;
      let expr = expressions[i];
      if (typeof expr == 'string' && expr.startsWith(__dirname + npath.sep)) {
        expr = '.' + expr.substring(__dirname.length);
      }
      cmd_str += String(expr);
    }
    console.log('[CMD]', cmd_str);
    return $(strings, ...expressions);
  }
};

const gen_path = (...paths: string[]) => npath.join(__dirname, ...paths);
const compiler_path = gen_path('build', 'eibafuc');

async function main(argv: string[]): Promise<number> {
  let recording = false;
  let quiet = false;
  const requested_tests: string[] = [];
  while (argv.length) {
    const arg = argv.shift()!;
    if (arg == '-rec') {
      recording = true;
      continue;
    }
    if (arg == '-q') {
      quiet = true;
      continue;
    }
    if (arg.startsWith('-')) {
      log.error('Unknown flag', arg, 'provided');
      return 1;
    }
    requested_tests.push(arg);
  }

  const compiler = Bun.file(compiler_path);
  if (!await compiler.exists()) {
    log.info('Compiler is missing. Compiling compiler...');
    const index_path = gen_path('src', 'index.ts');
    const result = await tryAsync<Bun.$.ShellOutput, Error>(async () => {
      const output = await log.cmd`bun build --compile --outfile=${compiler_path} ${index_path}`;
      if (output.exitCode != 0) {
        throw new Error('Build ended with non zero exit code');
      }
      return output;
    });
    if (!result.ok) {
      log.error(result.error.message);
      console.error(result.error);
      return 1;
    }
    log.info('Compiler was built');
  } else {
    log.info('Compiler already exists');
  }

  const source_paths: [string, string][] = [];

  if (requested_tests.length === 0) {
    log.info('Reading tests in folder:', './' + TESTS_FOLDER_NAME);
    const file_names = await readdir(TESTS_FOLDER_PATH);
    for (const fname of file_names) {
      if (!fname.endsWith('.efu')) continue;
      const file_path = npath.join(TESTS_FOLDER_PATH, fname);
      // ["<file name without extension>", "<absolute file path>"]
      source_paths.push([fname.substring(0, fname.length - 4), file_path]);
    }
  } else {
    // ["<file name without extension>", "<absolute file path>"]
    const requested_sources: Array<[string, string]> = requested_tests.map(test_name => [test_name, npath.join(TESTS_FOLDER_PATH, test_name + '.efu')]);
    for (const source of requested_sources) {
      if (!await Bun.file(source[1]).exists()) {
        log.error('Test', source[0], 'does not exist');
        continue;
      }
      source_paths.push(source);
    }
  }

  if (source_paths.length === 0) {
    log.info('No tests to run');
    return 0;
  }
  log.info('Tests to run:', source_paths.map(([t, _]) => JSON.stringify(t)).join(', '));

  type TestResult = {
    exit_code: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
  const test_results: Record<string, TestResult> = {};
  let recording_is_ok = true;

  for (const [test_name, file_path] of source_paths) {
    let output;
    if (quiet) {
      output = await log.cmd`${compiler_path} -debug-ir -o ${TESTS_FOLDER_PATH + '/'} ${file_path}`.nothrow().quiet();
    } else {
      output = await log.cmd`${compiler_path} -debug-ir -o ${TESTS_FOLDER_PATH + '/'} ${file_path}`.nothrow();
    }
    const result: TestResult = {
      exit_code: output.exitCode,
      stdout: output.stdout,
      stderr: output.stderr,
    };
    if (!recording) {
      test_results[test_name] = result;
      continue;
    }

    const snap_file_name = test_name + '.snap.bif';
    log.info(`Saving output of test ${test_name} to ${snap_file_name}...`);
    const snap_result = await tryAsync<void, Error>(async () => {
      const snapshot = Bun.file(npath.join(TESTS_FOLDER_PATH, snap_file_name));
      if (await snapshot.exists()) await snapshot.delete();
      const writer = snapshot.writer();
      writer.start();
      {
        writer.write(new TextEncoder().encode(`:i exit_code ${result.exit_code.toString(10)}\n`));
        writer.write(new TextEncoder().encode(`:b stdout ${result.stdout.byteLength}\n`));
        writer.write(result.stdout);
        writer.write(Uint8Array.from([10]));
        writer.write(new TextEncoder().encode(`:b stderr ${result.stderr.byteLength}\n`));
        writer.write(result.stderr);
        writer.write(Uint8Array.from([10]));
      }
      await writer.end();
    });

    if (snap_result.ok) {
      log.info('Snapshot saved in', snap_file_name);
      continue;
    }

    log.error(snap_result.error.message);
    console.error(snap_result.error);
    recording_is_ok = false;
  }

  if (recording) {
    if (!recording_is_ok) {
      log.error('Some snapshots failed to be recorded...');
      return 1;
    }
    log.info('All snapshots saved succesfully');
    return 0;
  }

  type Mismatcher = {
    code: false | {
      expected: number;
      received: number;
    };
    stdout: false | { kind: 'size'; r: number; e: number; } | {
      kind: 'bytes';
      diff: Array<[number, [number[], number[]]]>;
    };
    stderr: false | { kind: 'size'; r: number; e: number; } | {
      kind: 'bytes';
      diff: Array<[number, [number[], number[]]]>;
    };
  };

  // type TestCheckResultT = 'ok' | 'untested' | 'failure' | 'malformed-snapshot';
  type TestCheckResult = { t: 'ok' | 'untested' } | {
    t: 'failure';
    mismatch: Mismatcher;
  } | {
    t: 'malformed-snapshot';
    error: string;
  };
  const result = await tryAsync<Record<string, TestCheckResult>, Error>(async () => {
    const check_result: Record<string, TestCheckResult> = {};
    for (const test of Object.keys(test_results)) {
      const test_result = test_results[test]!;
      const snap_file_name = test + '.snap.bif';
      log.info('Saving output of test', test, 'to snapshot file', snap_file_name);
      const snapshot = Bun.file(npath.join(TESTS_FOLDER_PATH, snap_file_name));
      if (!await snapshot.exists()) {
        check_result[test] = { t: 'untested' };
        continue;
      }
      const reader = bif_reader(await snapshot.bytes());
      const result = trySync((): Mismatcher => {
        const mismatched: Mismatcher = {
          code: false,
          stdout: false,
          stderr: false,
        };
        while (true) {
          const step = reader.next();
          if (step.done) return mismatched;
          const field = step.value;
          if (field.kind == 'int' && field.name == 'exit_code') {
            const expected_exit_code = field.value;
            if (test_result.exit_code != expected_exit_code) {
              mismatched.code = {
                expected: expected_exit_code,
                received: test_result.exit_code,
              };
            } else {
              mismatched.code = false;
            }
            continue;
          }

          if (field.kind == 'blob') {
            if (field.name == 'stdout') {
              if (field.value.length != test_result.stdout.length) {
                mismatched.stdout = {
                  kind: 'size',
                  e: field.value.length,
                  r: test_result.stdout.length,
                };
                continue;
              }

              const diff: Array<[number, [number[], number[]]]> = [];
              for (let i = 0; i < field.value.length; ++i) {
                if (field.value[i]! === test_result.stdout[i]!) continue;
                const expected: number[] = [];
                const received: number[] = [];
                let si = i, ni = i;
                for (let j = i; j < field.value.length; ni = ++j) {
                  const a = field.value[j]!;
                  const b = test_result.stdout[j]!;
                  if (a === b) break;
                  expected.push(a);
                  received.push(b);
                }
                diff.push([si, [expected, received]]);
                i = ni;
              }

              if (diff.length === 0) {
                mismatched.stdout = false;
                continue;
              }

              mismatched.stdout = {
                kind: 'bytes',
                diff,
              };
              continue;
            }

            if (field.name == 'stderr') {
              if (field.value.length != test_result.stderr.length) {
                mismatched.stderr = {
                  kind: 'size',
                  e: field.value.length,
                  r: test_result.stdout.length,
                };
                continue;
              }

              const diff: Array<[number, [number[], number[]]]> = [];
              for (let i = 0; i < field.value.length; ++i) {
                if (field.value[i]! === test_result.stderr[i]!) continue;
                const expected: number[] = [];
                const received: number[] = [];
                let ni = i;
                let si = i;
                for (let j = i; j < field.value.length; ni = ++j) {
                  const a = field.value[j]!;
                  const b = test_result.stderr[j]!;
                  if (a == b) break;
                  expected.push(a);
                  received.push(b);
                }
                diff.push([si, [expected, received]]);
                i = ni;
              }

              if (diff.length === 0) {
                mismatched.stderr = false;
                continue;
              }

              mismatched.stderr = {
                kind: 'bytes',
                diff,
              };
              continue;
            }
          }
        }
      });
      if (!result.ok) {
        check_result[test] = {
          t: 'malformed-snapshot',
          error: result.error instanceof Error ? result.error.message : String(result.error),
        };
        continue;
      }
      const mismatch = result.value;
      if (mismatch.code === false && mismatch.stderr === false && mismatch.stdout === false) {
        check_result[test] = { t: 'ok' };
      } else {
        check_result[test] = { t: 'failure', mismatch };
      }
    }
    return check_result;
  });

  if (!result.ok) {
    log.error(result.error.message);
    console.error(result.error);
    return 1;
  }

  const checked_test = result.value;
  for (const test_name of Object.keys(checked_test)) {
    const test = checked_test[test_name]!;
    if (test.t !== 'failure') {
      if (test.t == 'malformed-snapshot') {
        console.log(`${test_name}: ${test.t}\n    ${test.error}`);
        continue;
      }
      console.log(`${test_name}: ${test.t}`);
      continue;
    }
    const buf = [`${test_name}: ${test.t}`];
    if (test.mismatch.code !== false) {
      const { expected, received } = test.mismatch.code;
      buf.push(`Got exit code '${received}' but expected '${expected}'`);
    }
    if (test.mismatch.stdout !== false) {
      const ms = test.mismatch.stdout;
      if (ms.kind == 'size') {
        const { e, r } = ms;
        buf.push(`StdOut is of a different size than expected. Generated size is ${r} but expected ${e}`);
      } else {
        buf.push('StdOut differs from the expected');
        let subbuf: string[] = [];
        for (const [index, [exp, got]] of ms.diff) {
          subbuf.push(`From index ${index}:\n            Expected: [${exp.join(', ')}]\n            Received: [${got.join(', ')}]`);
        }
        buf.push(subbuf.join('\n        '));
      }
    }
    if (test.mismatch.stderr !== false) {
      const ms = test.mismatch.stderr;
      if (ms.kind == 'size') {
        const { e, r } = ms;
        buf.push(`StdErr is of a different size than expected. Generated size is ${r} but expected ${e}`);
      } else {
        buf.push('StdErr differs from the expected');
        let subbuf: string[] = [];
        for (const [index, [exp, got]] of ms.diff) {
          subbuf.push(`From index ${index}:\n            Expected: [${exp.join(', ')}]\n            Received: [${got.join(', ')}]`);
        }
        buf.push(subbuf.join('\n        '));
      }
    }
    console.log(buf.join('\n    '));
  }

  return 0;
}



process.exit(await main(Bun.argv.slice(2)));







function* bif_reader(bytes: Uint8Array) {
  let i = 0;

  // const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const FIELD_STARTER = 0x3A;      // same as `encoder.encode(':')[0]!;`
  const FIELD_SPACE_DELIM = 0x20;  // same as `encoder.encode(' ')[0]!;`
  const FIELD_DIVISOR = 0x0A;      // same as `encoder.encode('\n')[0]!;`
  const INT_FIELD_DELIM = 0x69;    // same as `encoder.encode('i')[0]!;`
  const BLOB_FIELD_DELIM = 0x62;   // same as `encoder.encode('b')[0]!;`
  const ASCII_INT_0 = 0x30;        // same as `encoder.encode('0')[0]!;`
  const ASCII_INT_9 = 0x39;        // same as `encoder.encode('9')[0]!;`

  const read_name = () => {
    const data: number[] = [];
    while (bytes[i] != FIELD_SPACE_DELIM) {
      const b = bytes[i++];
      if (b === undefined) {
        throw new Error('Reached end of file while attempting to read field name');
      }
      data.push(b);
    }
    i++;
    return decoder.decode(Uint8Array.from(data));
  };

  const read_ascii_integer = (delim: number): Result<number, 'EOF' | 'missing' | 'NaN' | `${number}`> => {
    const data: number[] = [];
    while (bytes[i] != delim) {
      const b = bytes[i++];
      if (b === undefined) {
        return Result.Err('EOF');
      }
      if (ASCII_INT_0 <= b && b <= ASCII_INT_9) {
        data.push(b);
        continue;
      }
      return Result.Err(`${b}` as `${number}`);
    }
    if (data.length == 0) {
      return Result.Err('missing');
    }
    i++;
    const str = decoder.decode(Uint8Array.from(data));
    const num = Number.parseInt(str, 10);
    if (Number.isNaN(num)) return Result.Err('NaN');
    return Result.Ok(num);
  };

  while (i < bytes.length) {
    if (bytes[i++] != FIELD_STARTER) {
      throw new Error("BiF field does not start with ':' symbol");
    }
    const kind = bytes[i++];
    switch (kind) {
      case INT_FIELD_DELIM: {
        if (bytes[i++] != FIELD_SPACE_DELIM) {
          throw new Error('BiF is not dividing field kind and field name with a space');
        }
        const name = read_name();
        const num_read_result = read_ascii_integer(FIELD_DIVISOR);
        if (!num_read_result.ok) {
          let message: string;
          if (num_read_result.error == 'EOF') {
            message = 'BiF integer field unexpectedly hit the end of file while reading value';
          } else if (num_read_result.error == 'missing') {
            message = 'BiF integer field is missing the integer value as an ASCII number';
          } else if (num_read_result.error == 'NaN') {
            message = 'BiF integer field was unable to parse a valid integer value';
          } else {
            message = 'BiF integer field holds an invalid byte: ' + num_read_result.error;
          }
          throw new Error(message);
        }
        const value = num_read_result.value;

        yield { kind: 'int', name, value } as const;
      } break;
      case BLOB_FIELD_DELIM: {
        if (bytes[i++] != FIELD_SPACE_DELIM) {
          throw new Error('BiF is not dividing field kind and field name with a space');
        }
        const name = read_name();
        const num_read_result = read_ascii_integer(FIELD_DIVISOR);
        if (!num_read_result.ok) {
          let message: string;
          if (num_read_result.error == 'EOF') {
            message = 'BiF blob field unexpectedly hit the end of file while reading the blob size';
          } else if (num_read_result.error == 'missing') {
            message = 'BiF blob field is missing the blob size as an ASCII number';
          } else if (num_read_result.error == 'NaN') {
            message = 'BiF integer field was unable to parse a valid integer value';
          } else {
            message = 'BiF blob field size data holds an invalid byte: ' + num_read_result.error;
          }
          throw new Error(message);
        }
        const size = num_read_result.value;
        const value = bytes.slice(i, i + size);
        i += size + 1;
        if (bytes[i - 1] != FIELD_DIVISOR) {
          throw new Error('BiF blob field does not end with newline byte');
        }

        yield { kind: 'blob', name, value } as const;
      } break;
      default:
        throw new Error("Provided BiF field kind " + kind);
    }
  }
}

