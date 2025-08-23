# eiba-fu

A simple transpiler that done for personal research/testing purposes and for fun.
If you want to try it out, [Bun](https://bun.sh) v1.2.19 or higher is required to build/run the compiler.

You can see the examples presented in the ./examples/ folder to garner a look at what can be done in this toy language.
Here is also an example showcase on how the language looks:

```efu
fn fizz(n: isz) -> u8 {
  if (n % 3 == 0) {
    printf(`Fizz');
	return 1;
  }
  return 0;
}
fn buzz(n: isz) -> u8 {
  if (n % 5 == 0) {
    printf(`Buzz');
	return 1;
  }
  return 0;
}
fn fizzbuzz(i: isz, end: isz) {
  if (i > end) return;
  let x := fizz(i) + buzz(i);
  if (x == 0) printf(`%v', i);
  printf(`\n');
  fizzbuzz(i + 1, end);
}
fn main() {
  fizzbuzz(0, 30);
}
```

## Build Compiler

- Install dependencies:
```terminal
$ bun install
```

- Run build script:
```terminal
$ bun run build
```

- Build fizzbuzz example:
```terminal
$ ./build/eibafuc -o ./efu/ -t js -run -runtime bun ./examples/fizzbuzz.efu
```

