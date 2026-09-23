/**
 * The unit suites replace native modules with a jest.mock of the calls the
 * app makes, so a module whose API moves under an SDK upgrade stays green
 * there while the app throws on a device. SDK 54 and 56 did exactly that:
 * the package roots of expo-file-system and expo-media-library became object
 * APIs, and the functions src/lib/storage.ts and EditorScreen.tsx call are, at
 * those roots, stubs documented to throw at runtime. jest-expo mocks even the
 * legacy file system, so the real modules cannot be loaded here; this reads
 * what each installed package declares instead, and holds every name the app
 * imports from a mocked module, or reads off its namespace or default export
 * as `X.name`, to a declaration that exists and is not a stub. A default
 * export's members are read through the TypeScript checker, because the type
 * such an export names sits behind an import and an alias or two
 * (AsyncStorage is an AsyncStorageStatic from ./types, expo-constants' is a
 * Constants intersection), where a text search cannot follow it.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const root = path.join(__dirname, '..');
const read = (file: string) => fs.readFileSync(file, 'utf8');

/** Every source file (.js, .jsx, .ts, .tsx) under `dir`, split by whether it sits in a __tests__ folder. */
function sources(dir: string, out: { app: string[]; tests: string[] } = { app: [], tests: [] }, inTests = false) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out, inTests || entry.name === '__tests__');
    else if (/\.[jt]sx?$/.test(entry.name)) (inTests ? out.tests : out.app).push(full);
  }
  return out;
}
const { app, tests } = sources(path.join(root, 'src'));
app.push(path.join(root, 'App.tsx'), path.join(root, 'index.ts'));
tests.push(...sources(path.join(root, '__tests__'), undefined, true).tests);

/** The package a specifier belongs to: `expo-file-system/legacy` is expo-file-system's. */
const packageOf = (specifier: string) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

/**
 * The packages a unit suite replaces. Every import the app makes from one of
 * them is checked, whichever entry point it names, so an import moved back to
 * a package root is checked against that root rather than slipping past.
 */
const mocked = new Set<string>();
for (const file of tests) {
  // Each pattern's groups are not optional, so a match always has them.
  for (const [, specifier = ''] of read(file).matchAll(/jest\.mock\('([^'.][^']*)'/g)) mocked.add(packageOf(specifier));
}

/** specifier -> the names the app reads off it. */
const calls = new Map<string, string[]>();
/** specifier -> the names the app reads off its default export. */
const defaultMembers = new Map<string, string[]>();
const note = (specifier: string, names: string[], into = calls) => {
  if (!mocked.has(packageOf(specifier))) return;
  into.set(specifier, [...new Set([...(into.get(specifier) || []), ...names])]);
};
/** Every `alias.name` in `src`. */
const membersOf = (src: string, alias: string) =>
  [...src.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))].map(([, name = '']) => name);
for (const file of app) {
  const src = read(file);
  // `import X from` and `import X, { ... } from`; `import type X` is erased, and the
  // pattern cannot match it (the word after `type` is neither `,` nor `from`).
  for (const [, alias = '', specifier = ''] of src.matchAll(/import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+'([^']+)'/g)) {
    note(specifier, membersOf(src, alias), defaultMembers);
  }
  for (const [, alias = '', specifier = ''] of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)'/g)) {
    note(specifier, membersOf(src, alias));
  }
  for (const [, list = '', specifier = ''] of src.matchAll(/import\s*(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s+'([^']+)'/g)) {
    note(
      specifier,
      list
        .split(',')
        .map((n) => n.trim().split(/\s+as\s+/)[0])
        .filter((n): n is string => Boolean(n))
    );
  }
}

/** The declaration file a specifier resolves to, by the package's own `exports` or `types`. */
function typesOf(specifier: string): string {
  const name = packageOf(specifier);
  const sub = specifier.slice(name.length);
  const dir = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(read(path.join(dir, 'package.json')));
  const entry = pkg.exports?.[`.${sub}`];
  const types = (entry && typeof entry === 'object' && entry.types) || (!sub && (pkg.types || pkg.typings));
  if (!types) throw new Error(`${specifier} declares no types to check against`);
  return path.join(dir, types);
}

/** A declaration file with every `export * from` it re-exports appended. */
function declarations(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return '';
  seen.add(file);
  const text = read(file);
  let out = text;
  for (const [, from = ''] of text.matchAll(/^export \* from '([^']+)';/gm)) {
    const base = path.resolve(path.dirname(file), from);
    const next = [`${base}.d.ts`, path.join(base, 'index.d.ts')].find((f) => fs.existsSync(f));
    if (next) out += `\n${declarations(next, seen)}`;
  }
  return out;
}

/** What is wrong with `name` as `text` declares it, or null. */
function problemWith(text: string, name: string): string | null {
  const declared = new RegExp(
    `(/\\*\\*(?:(?!\\*/)[\\s\\S])*\\*/\\s*)?export declare (?:function|const|let|var|class|enum|namespace) ${name}\\b`
  ).exec(text);
  if (declared) {
    // Expo's wording on every stub its package roots kept for the old names.
    return /will throw in runtime/i.test(declared[1] || '') ? 'is a stub that throws at runtime' : null;
  }
  return new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\}`).test(text) ? null : 'is not exported';
}

/**
 * The members of each specifier's default export, as the checker sees them: the specifier
 * resolved from the project root under the app's own compiler options (expo/tsconfig.base's
 * bundler resolution and react-native condition), so the file and the type it follows are
 * the ones tsc follows when it checks the app. Undefined where nothing resolves or there is
 * no default export.
 */
function defaultExports(specifiers: string[]) {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), { types: [] }, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  if (!config) throw new Error('tsconfig.json did not parse');
  const resolve = (specifier: string) =>
    ts.resolveModuleName(specifier, path.join(root, 'index.ts'), config.options, ts.sys).resolvedModule?.resolvedFileName;
  const files = specifiers.map((specifier) => ({ specifier, file: resolve(specifier) }));
  const program = ts.createProgram(
    files.map(({ file }) => file).filter((file): file is string => Boolean(file)),
    config.options
  );
  const checker = program.getTypeChecker();
  const members = new Map<string, ts.Symbol[] | undefined>();
  for (const { specifier, file } of files) {
    const source = file ? program.getSourceFile(file) : undefined;
    const module = source && checker.getSymbolAtLocation(source);
    // getTypeOfSymbol follows `export default X` through the import that names X.
    const exported = module && checker.getExportsOfModule(module).find((s) => s.escapedName === 'default');
    members.set(specifier, exported && checker.getPropertiesOfType(checker.getTypeOfSymbol(exported)));
  }
  return { checker, members };
}

/** What is wrong with `name` as a member of a default export whose members are `members`, or null. */
function problemWithMember(checker: ts.TypeChecker, members: ts.Symbol[] | undefined, name: string): string | null {
  if (!members) return 'has no default export the checker can find';
  const member = members.find((m) => m.name === name);
  if (!member) return 'is not a member of the default export';
  const doc = [
    ts.displayPartsToString(member.getDocumentationComment(checker)),
    ...member.getJsDocTags(checker).map((tag) => ts.displayPartsToString(tag.text)),
  ].join('\n');
  return /will throw in runtime/i.test(doc) ? 'is a stub that throws at runtime' : null;
}

it('sees the calls the unit suites mock away', () => {
  // The scan has to find something for the check below to mean anything.
  expect(calls.get('expo-file-system/legacy')).toEqual(
    expect.arrayContaining(['documentDirectory', 'getInfoAsync', 'makeDirectoryAsync', 'copyAsync', 'deleteAsync'])
  );
  expect(calls.get('expo-media-library/legacy')).toEqual(
    expect.arrayContaining(['requestPermissionsAsync', 'saveToLibraryAsync'])
  );
  expect(calls.get('react-native-view-shot')).toEqual(expect.arrayContaining(['captureRef', 'releaseCapture']));
  expect(defaultMembers.get('@react-native-async-storage/async-storage')).toEqual(
    expect.arrayContaining(['getItem', 'setItem', 'removeItem'])
  );
  expect(defaultMembers.get('expo-constants')).toEqual(expect.arrayContaining(['expoConfig']));
});

it('calls nothing the installed module has dropped or turned into a stub', () => {
  const problems: string[] = [];
  for (const [specifier, names] of calls) {
    const text = declarations(typesOf(specifier));
    for (const name of names) {
      const problem = problemWith(text, name);
      if (problem) problems.push(`${specifier}: ${name} ${problem}`);
    }
  }
  const { checker, members } = defaultExports([...defaultMembers.keys()]);
  for (const [specifier, names] of defaultMembers) {
    for (const name of names) {
      const problem = problemWithMember(checker, members.get(specifier), name);
      if (problem) problems.push(`${specifier}: default.${name} ${problem}`);
    }
  }
  expect(problems).toEqual([]);
});
