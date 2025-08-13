import fs from 'node:fs';

import { Lex } from "./lexer";
import { node_debug_fmt, Parse, type AstNode } from './parser';
import { compiler_logger, get_current_line, type TargetCodeGen } from "./utils";

function dir_exists(path: string) {
  try {
    fs.readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

type CliArgs = {
  run: boolean;
  help: boolean;
  emit_ir: boolean;
  target: 'javascript' | 'golang';
  runtime: 'node' | 'bun' | 'deno';
  output: string;
};

const opt: CliArgs = {
  run: false,
  help: false,
  emit_ir: false,
  output: './build/',
  target: 'golang',
  runtime: 'node',
};

function usage() {
  console.log('Usage: eibafuc [FLAGS] <input-file>');
  console.log('   -target <(go|js)>    --- Specify transpilation target, only go and js supported. Defaults to go (abbrv: -t)');
  console.log('   -out <output-path>   --- Specify output path for transpiled code. Defaults to ./build/ (abbrv: -o)');
  console.log('   -run                 --- Attempt to run code after transpiling/compiling (abbrv: -r)');
  console.log('   -runtime             --- Specify what runtime to use when target is js. Defaults to node');
  console.log('   -debug-ir            --- Emit a debug IR representation, stops regular output production');
  console.log('   -help                --- Display this help menu (abbrv: -h)');
}

const args = Bun.argv.slice(2);
let input_path = undefined;
for (let i = 0; i < args.length; ++i) {
  const arg = args[i]!;
  if (arg == '-run' || arg == '-r') {
    opt.run = true;
    continue;
  }

  if (arg == '-help' || arg == '-h') {
    opt.help = true;
    continue;
  }

  if (arg == '-o' || arg == '-output') {
    let out = args[++i];
    if (!out) {
      console.error('No path was passed next to output flag');
      usage();
      process.exit(1);
    }

    out = out.replaceAll('\\', '/');
    if (!out.endsWith('/') && dir_exists(out)) {
      opt.output = out + '/';
    }

    opt.output = out;
    continue;
  }

  if (arg == '-debug-ir') {
    opt.emit_ir = true;
    continue;
  }

  if (arg == '-t' || arg == '-target') {
    const t = args[++i];
    if (!t) {
      console.error('No proper target was passed next to target flag');
      console.log('Known targets are golang (go) and javascript (js)')
      usage();
      process.exit(1);
    }

    switch (t) {
      case 'go':
        opt.target = 'golang';
        break;
      case 'js':
        opt.target = 'javascript';
        break;
      default:
        console.error('Unknown target', t, 'was passed');
        console.log('Known targets are golang (go) and javascript (js)')
        process.exit(1);
    }

    continue;
  }

  if (arg == '-runtime') {
    const rt = args[++i];
    if (!rt) {
      console.error('No proper runtime was passed next to runtime flag');
      console.log('Known runtimes are node, bun and deno');
      usage();
      process.exit(1);
    }
    switch (rt) {
      case 'node':
        opt.runtime = 'node';
        break;
      case 'bun':
        opt.runtime = 'bun';
        break;
      case 'deno':
        opt.runtime = 'deno';
        break;
    }
    continue;
  }

  input_path = arg;
}

if (opt.help) {
  usage();
  process.exit(0);
}

if (!input_path) {
  console.error('No file path provided');
  usage();
  process.exit(1);
}

const file = Bun.file(input_path);
if (!await file.exists()) {
  console.error('Provided input path does not point to an existing file');
  console.log(opt);
  process.exit(1);
}

const content = await file.text();
const lexer = Lex(content);
const parser = Parse(input_path, lexer);

let node: AstNode | null = null;
const top_level = [] as Exclude<AstNode, { kind: 'eof' }>[];
let errored = false;
while (node?.kind !== 'eof') {
  node = parser.parse_statement();
  if (node == null) {
    const tok = lexer.get_token();
    // praser.logger.error(tok.pos, `Failed to parse a statement from token ${tok.kind}`);
    compiler_logger.info(get_current_line(), `Failed to parse a statement from token ${tok.kind}`);

    errored = true;
    break;
  }

  if (node.kind != 'eof') top_level.push(node);
}

if (errored) {
  console.error('Parsing failed');
  process.exit(1);
}

if (opt.emit_ir) {
  let buf = '';
  for (const node of top_level) {
    const str = node_debug_fmt(node);
    buf += str + '\n';
  }
  console.log(buf);
  process.exit(0);
}

const target_codegen = await (async (t: CliArgs['target']): Promise<TargetCodeGen | null> => {
  switch (t) {
    case 'golang':
      return (await import('./golang-codegen')).default;
    case 'javascript':
      return (await import('./javascript-codegen')).default;
    default:
      return null;
  }
})(opt.target);

if (!target_codegen) {
  console.log('Target', opt.target, 'is not supported yet');
  process.exit(1);
}

errored = target_codegen.setup_codegen({
  input_path, output_path: opt.output,
  nodes: top_level,
  parser,
});

if (errored) {
  console.error('Setting up codegen failed');
  process.exit(1);
}

errored = target_codegen.emit_code();
if (errored) {
  console.error('Emitting code to buffer failed');
  process.exit(1);
}

const codegen = target_codegen.get_mod()!;

const output_path = codegen.output_path;
const last_slash_idx = output_path.lastIndexOf('/');
if (last_slash_idx != -1) {
  const output_dir = output_path.substring(0, last_slash_idx);
  if (!dir_exists(output_dir)) {
    try {
      fs.mkdirSync(output_dir, {
        recursive: true,
      });
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  }
}

if (await codegen.flush()) {
  console.error('Failed to write onto output path:', codegen.output_path);
  process.exit(1);
} else {
  console.log('Succesfully transpiled onto:', codegen.output_path);
}

if (opt.run) {
  switch (opt.target) {
    case 'golang':
      await Bun.$`go run ${codegen.output_path}`;
      break;

    case 'javascript':
      switch (opt.runtime) {
        case 'node':
          console.log(`$ node ${codegen.output_path}`);
          await Bun.$`node ${codegen.output_path}`;
          break;
        case 'bun':
          console.log(`$ bun run ${codegen.output_path}`);
          await Bun.$`bun run ${codegen.output_path}`;
          break;
        case 'deno':
          console.log(`$ deno run ${codegen.output_path}`);
          await Bun.$`deno run ${codegen.output_path}`;
          break;
      }
      break;
  }
}

