import npath from 'node:path';
import pkg from './package.json';

const $ = Bun.$.cwd(__dirname).throws(true);

function failed(task: string): never {
  console.error("❌ Failed task:", task);
  process.exit(1);
}

function Cmd(strings: TemplateStringsArray, ...expressions: Bun.ShellExpression[]) {
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


if ((await Cmd`bun run build`).exitCode != 0) {
  failed("Build compiler");
}


for (const script_name of Object.keys(pkg.scripts) as Array<keyof typeof pkg['scripts']>) {
  if (!script_name.startsWith("check:")) continue;
  const result = await Cmd`bun run ${script_name}`;
  if (result.exitCode != 0) {
    failed(script_name);
  }
}

console.log("✅ All checks passed");
