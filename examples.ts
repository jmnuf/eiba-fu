import path from 'node:path';
import fs from 'node:fs/promises';

async function $$exec(fn: (args: string[]) => Generator<any, number>): Promise<never> {
  const args = Bun.argv.slice(2);
  const it = fn(args);
  let step = it.next();
  step.value = await step.value;
  while (!step.done) {
    step = it.next(step.value);
    step.value = await step.value;
  }
  return process.exit(step.value);
}
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E; };
function* $Y<T>(promise: Promise<T>): Generator<Promise<T>, T, T> {
  return yield promise;
}
$Y.try = function*<T>(promise: Promise<T>): Generator<Promise<Result<T, unknown>>, Result<T, unknown>> {
  return yield (
    promise
      .then(value => ({ ok: true, value } as const))
      .catch(error => ({ ok: false, error }))
  );
}

const $ = Bun.$.cwd(__dirname).nothrow();

function Cmd(strings: TemplateStringsArray, ...args: string[]) {
  let usr_cmd = '';
  for (let i = 0; i < strings.length; ++i) {
    const str = strings[i];
    usr_cmd += str;
    if (i >= args.length) continue;
    const arg = args[i]!;
    usr_cmd += arg;
  }
  console.log('[CMD]', usr_cmd);
  return $Y($(strings, ...args));
}

function CmdSilent(strings: TemplateStringsArray, ...args: string[]) {
  let usr_cmd = '';
  for (let i = 0; i < strings.length; ++i) {
    const str = strings[i];
    usr_cmd += str;
    if (i >= args.length) continue;
    const arg = args[i]!;
    if (arg.length > __dirname.length && arg.startsWith(__dirname)) {
      usr_cmd += '.' + arg.substring(__dirname.length);
      continue;
    }
    usr_cmd += arg;
  }
  console.log('[CMD]', usr_cmd);
  return $Y($(strings, ...args).quiet());
}


$$exec(function* main(args) {
  const opt = {
    recording: false,
    silent: false,
    rebuild_compiler: false,
  };

  const usr_requested_examples: string[] = [];
  while (args.length) {
    const arg = args.shift()!;
    if (arg == '-rec') {
      opt.recording = true;
      continue;
    }
    if (arg == '-s') {
      opt.silent = true;
      continue;
    }
    if (arg == '-rbc') {
      opt.rebuild_compiler = true;
      continue;
    }
    if (arg[0] == '-') {
      console.error(`Unknown cli argument passed: ${arg}`)
      return 1;
    }
    usr_requested_examples.push(arg);
  }

  const compiler_path = './build/eibafuc';
  const compiler = Bun.file(compiler_path);
  let exists = yield* $Y(compiler.exists());
  if (!exists) {
    console.warn('Compiler has not been built');
    const index_path = './src/index.ts';
    const result = yield* Cmd`bun build --compile --outfile=${compiler_path} ${index_path}`;
    if (result.exitCode != 0) return 1;
  } else if (opt.rebuild_compiler) {
    const index_path = './src/index.ts';
    const result = yield* Cmd`bun build --compile --outfile=${compiler_path} ${index_path}`;
    if (result.exitCode != 0) return 1;
  }
  const examples_path = './examples';

  const dir_res = yield* $Y.try(fs.readdir(examples_path));
  if (!dir_res.ok) {
    console.error('Failed to read examples folder', dir_res);
    return 1;
  }

  const dir_entries = dir_res.value;
  const examples_paths: [string, string][] = [];
  if (usr_requested_examples.length > 0) {
    for (const entry of dir_entries) {
      if (!entry.endsWith('.efu')) continue;
      const entry_path = path.join('./examples', entry);
      const name = entry.substring(0, entry.lastIndexOf('.'));
      if (!usr_requested_examples.includes(name) && !usr_requested_examples.includes(entry)) continue;
      examples_paths.push([entry_path, name]);
    }
  } else {
    for (const entry of dir_entries) {
      if (!entry.endsWith('.efu')) continue;
      const entry_path = path.join('./examples', entry);
      const name = entry.substring(0, entry.lastIndexOf('.'));
      examples_paths.push([entry_path, name]);
    }
  }

  const output_dir = path.join(__dirname, 'efu');
  console.log(output_dir);

  const snap_path = path.join(__dirname, './examples.snap.json');

  type Status = 'untested' | 'build fail' | 'run fail' | 'ok';
  const targets = [
    { ext: 'js', name: 'JavaScript' },
    { ext: 'go', name: 'GoLang' },
  ] as const satisfies Array<{ name: string; ext: string; }>;
  type TestsStatus = Record<string, { [K in typeof targets[number]['name']]: Status; }>;
  const success: TestsStatus = yield* (function*() {
    if (opt.recording) return {};
    const exists = (yield* $Y(Bun.file(snap_path).exists()));
    if (!exists) return {};
    return yield* $Y(Bun.file(snap_path).json());
  })();
  const executed: TestsStatus = {};
  for (const [input_path, test_name] of examples_paths) {
    if (!(test_name in success)) {
      success[test_name] = {
        GoLang: 'untested',
        JavaScript: 'untested',
      };
    }
    executed[test_name] = {
      GoLang: 'untested',
      JavaScript: 'untested',
    };
    for (const { ext, name } of targets) {
      const output_path = path.join(output_dir, test_name + '.' + ext);
      let output = yield* Cmd`${compiler_path} -o ${output_path} -t ${ext} ${input_path}`;
      if (output.exitCode != 0) {
        executed[test_name][name] = 'build fail';
        continue;
      }

      const Exec = opt.silent ? CmdSilent : Cmd;
      switch (ext) {
        case 'js':
          output = yield* Exec`bun run ${output_path}`;
          break;

        case 'go':
          output = yield* Exec`go run ${output_path}`;
          break;

        default:
          throw new Error(`No runner is setup for target ${name}`);
      }
      executed[test_name][name] = output.exitCode == 0 ? 'ok' : 'run fail';
    }
  }

  if (opt.recording) {
    const f = Bun.file(path.join(__dirname, './examples.snap.json'));
    const result = yield* $Y.try(f.write(JSON.stringify(executed, undefined, '  ')));
    if (!result.ok) {
      console.error('Failed to write onto output file');
      console.info(result.error);
      return 1;
    }
    console.log('Succesfully wrote recording onto file');
    return 0;
  }

  for (const test_name of Object.keys(executed)) {
    const test = success[test_name]!;
    let buf = `${test_name}:`;
    for (const target of Object.keys(test) as Array<keyof typeof test>) {
      const success_status = test[target]!;
      const executd_status = executed[test_name]![target];
      const status: 'untested' | 'ok' | 'failed' = success_status == 'untested'
        ? (executd_status == 'untested' ? 'untested' : executd_status == 'ok' ? 'ok' : 'failed')
        : executd_status == success_status
          ? 'ok'
          : 'failed'
        ;

      buf += `\n  - ${target}: ${status}`;

      if (success_status == 'untested') {
        buf += ' <- Previously untested';
        continue;
      }
      if (status == 'failed') {
        buf += ` <- Got '${executd_status}' but Expected '${success_status}'`;
      }
    }
    console.log('[INFO]', buf);
  }

  return 0;
});

