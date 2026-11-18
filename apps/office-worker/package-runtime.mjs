// Build an inert worker release from reviewed local files. No installs, database
// connections, credentials, task registration or worker activation occur here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const worker = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(worker, '../..');
const backoffice = path.join(project, 'apps/backoffice');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(path.sep).join('/');
const exists = value => { try { fs.lstatSync(value); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const excluded = /^(?:node_modules|test|tests|__tests__|fixtures|__fixtures__|benchmark|benchmarks|coverage|\.git|\.github|\.husky|\.env.*|\.npmrc|\.yarnrc.*|tsconfig.*|vitest.*|jest.*|eslint.*|prettier.*)$/i;
const excludedFile = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|\.tsbuildinfo$)/i;

function canonical(value) {
  let current = path.resolve(value);
  const tail = [];
  while (!exists(current)) { const parent = path.dirname(current); if (parent === current) throw new Error('Destination ancestor is unavailable'); tail.unshift(path.basename(current)); current = parent; }
  return path.join(fs.realpathSync.native(current), ...tail);
}

export function assertNewDestination(destination, sourceRoot = project) {
  if (!destination || !path.isAbsolute(destination)) throw new Error('Supply a new absolute runtime destination');
  const target = canonical(destination);
  const source = canonical(sourceRoot);
  if (inside(source, target) || inside(target, source)) throw new Error('Runtime destination overlaps the source workspace');
  if (exists(destination) || exists(target)) throw new Error('Runtime destination already exists');
  if (!exists(path.dirname(destination))) throw new Error('Create and protect the destination parent first');
  return target;
}

function installedPackage(name, fromDirectory) {
  const resolve = createRequire(path.join(fromDirectory, 'package.json')).resolve;
  let resolved;
  try { resolved = resolve(`${name}/package.json`); }
  catch { resolved = resolve(name); }
  let directory = path.dirname(resolved);
  for (;;) {
    const manifestPath = path.join(directory, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name === name) {
        const real = fs.realpathSync.native(directory);
        if (![path.join(worker, 'node_modules'), path.join(backoffice, 'node_modules')].some(root => inside(canonical(root), real))) throw new Error(`Dependency is outside the reviewed installed trees: ${name}`);
        return { name, directory: real, manifest };
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate installed dependency: ${name}`);
    directory = parent;
  }
}

function planDependencies(names, sourceDirectory, targetPrefix, copies, packages, ancestors = []) {
  for (const name of [...names].sort()) {
    const dependency = installedPackage(name, sourceDirectory);
    if (ancestors.some(item => item.directory === dependency.directory)) throw new Error(`Cyclic dependency requires explicit packaging review: ${name}`);
    const relative = path.join(targetPrefix, 'node_modules', ...name.split('/'));
    copies.push({ from: dependency.directory, relative, tree: true });
    packages.push({ path: slash(relative), name, version: dependency.manifest.version });
    const required = Object.keys(dependency.manifest.dependencies || {});
    const optional = Object.keys(dependency.manifest.optionalDependencies || {}).filter(optionalName => {
      try { installedPackage(optionalName, dependency.directory); return true; }
      catch (error) { if (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return false; throw error; }
    });
    planDependencies([...new Set([...required, ...optional])], dependency.directory, relative, copies, packages, [...ancestors, dependency]);
  }
}

function filesWithin(directory, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const file = path.join(directory, entry.name);
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Runtime packages must not contain links');
    if (entry.isDirectory()) result.push(...filesWithin(file, name));
    else if (entry.isFile()) result.push({ path: slash(name), bytes: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) });
    else throw new Error('Unexpected runtime file type');
  }
  return result;
}

function copyReviewed(from, to, tree = false) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) throw new Error('Source links require explicit packaging review');
  if (stat.isDirectory()) {
    if (!tree) throw new Error('Unexpected source directory');
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from).sort()) {
      if (excluded.test(name) || excludedFile.test(name)) continue;
      copyReviewed(path.join(from, name), path.join(to, name), true);
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    if (sha256(fs.readFileSync(from)) !== sha256(fs.readFileSync(to))) throw new Error('Runtime copy digest mismatch');
  } else throw new Error('Unexpected reviewed source type');
}

export function packageRuntime(destination) {
  const target = assertNewDestination(destination);
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(worker, 'package.json'), 'utf8'));
  const copies = [
    ['src/index.ts', worker, 'apps/office-worker'],
    ['start-office-worker.ps1', worker, 'apps/office-worker'],
    ['install-office-worker-task.ps1', worker, 'apps/office-worker'],
    ['office-role.example.sql', worker, 'apps/office-worker'],
    ['tsconfig.json', worker, 'apps/office-worker'],
    ...['index.ts', 'safety.ts', 'demo-adapter.ts', 'openai.ts', 'live-adapter.ts', 'live-pricing.ts'].map(file => [`src/lib/office-runtime/${file}`, backoffice, 'apps/backoffice']),
    ...['index.ts', 'response-presets.json'].map(file => [`src/lib/office-contracts/${file}`, backoffice, 'apps/backoffice']),
  ].map(([name, source, prefix]) => ({ from: path.join(source, name), relative: path.join(prefix, name) }));
  const packages = [];
  planDependencies(Object.keys(sourceManifest.dependencies), worker, 'apps/office-worker', copies, packages);
  // These imports resolve from the backoffice subtree, not worker/node_modules.
  planDependencies(['postgres', 'zod'], backoffice, 'apps/backoffice', copies, packages);
  for (const item of copies) if (!fs.existsSync(item.from)) throw new Error('Reviewed runtime input is missing');
  fs.mkdirSync(target);
  for (const item of copies) copyReviewed(item.from, path.join(target, item.relative), item.tree);
  const exactDependencies = Object.fromEntries(Object.keys(sourceManifest.dependencies).sort().map(name => [name, packages.find(item => item.path === `apps/office-worker/node_modules/${name}`).version]));
  const generated = { name: sourceManifest.name, version: sourceManifest.version, private: true, type: 'module', scripts: { start: 'node --import ./node_modules/tsx/dist/loader.mjs src/index.ts' }, dependencies: exactDependencies };
  fs.writeFileSync(path.join(target, 'apps/office-worker/package.json'), JSON.stringify(generated, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(target, 'apps/backoffice/package.json'), JSON.stringify({ name: '@enztronic/office-runtime-contracts', private: true, type: 'module' }) + '\n', { flag: 'wx' });
  const manifest = {
    formatVersion: 1, createdAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    nodeMinimumMajor: 20, entry: 'apps/office-worker/src/index.ts', loader: 'apps/office-worker/node_modules/tsx/dist/loader.mjs',
    supervisor: 'apps/office-worker/start-office-worker.ps1', configurationIncluded: false, workerActivated: false,
    reviewedWorkerPackageSha256: sha256(fs.readFileSync(path.join(worker, 'package.json'))),
    reviewedWorkerLockSha256: sha256(fs.readFileSync(path.join(worker, 'pnpm-lock.yaml'))),
    dependencies: packages, files: filesWithin(target),
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'runtime-manifest.json'), bytes, { flag: 'wx' });
  fs.writeFileSync(path.join(target, 'runtime-manifest.sha256'), sha256(bytes) + '\n', { flag: 'wx' });
  return { destination: target, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), manifestSha256: sha256(bytes), dependencies: packages };
}

export function verifyRuntimePackage(destination) {
  if (!destination || !path.isAbsolute(destination) || !exists(destination)) throw new Error('Supply an existing absolute runtime package');
  if (fs.lstatSync(destination).isSymbolicLink()) throw new Error('Runtime package root must not be a link');
  const target = fs.realpathSync.native(destination);
  const bytes = fs.readFileSync(path.join(target, 'runtime-manifest.json'));
  const expectedHash = fs.readFileSync(path.join(target, 'runtime-manifest.sha256'), 'utf8').trim();
  if (sha256(bytes) !== expectedHash) throw new Error('Runtime manifest digest mismatch');
  const manifest = JSON.parse(bytes);
  if (manifest.formatVersion !== 1 || manifest.workerActivated !== false || manifest.configurationIncluded !== false || !Array.isArray(manifest.files)) throw new Error('Invalid inert-runtime manifest');
  const actual = filesWithin(target).filter(file => !['runtime-manifest.json', 'runtime-manifest.sha256'].includes(file.path));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('Runtime package file inventory or digest mismatch');
  for (const name of [manifest.entry, manifest.loader, manifest.supervisor]) if (!actual.some(file => file.path === name)) throw new Error('Runtime entry metadata is not in the verified inventory');
  return { destination: target, verified: true, files: actual.length, manifestSha256: expectedHash };
}

function minimalEnvironment() {
  return Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
}

export function smokeRuntimePackage(destination, nodeExecutable = process.execPath) {
  const verified = verifyRuntimePackage(destination);
  const target = verified.destination;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'enztronic-worker-package-check-'));
  const trace = path.join(temporary, 'imports.jsonl');
  const preflight = path.join(temporary, 'preflight.cjs');
  const loader = path.join(temporary, 'isolation-loader.mjs');
  const bootstrap = path.join(temporary, 'bootstrap.mjs');
  const constants = `const root=${JSON.stringify(target)},temporary=${JSON.stringify(temporary)},trace=${JSON.stringify(trace)};`;
  try {
    fs.writeFileSync(preflight, `const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');${constants}\nconst original=Module._resolveFilename;Module._resolveFilename=function(...args){const file=original.apply(this,args);if(path.isAbsolute(file)){const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative)){if(!file.startsWith(temporary+path.sep))throw new Error('OUTSIDE_RUNTIME_IMPORT');}else fs.appendFileSync(trace,JSON.stringify({kind:'cjs',file})+'\\n');}return file;};require('node:net').Socket.prototype.connect=function(){throw new Error('NETWORK_FORBIDDEN_IN_PACKAGE_CHECK');};`);
    fs.writeFileSync(loader, `import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';let root,temporary,trace;export function initialize(data){({root,temporary,trace}=data);}export async function resolve(specifier,context,next){const result=await next(specifier,context);if(result.url.startsWith('file:')){const file=fileURLToPath(result.url),relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative)){if(!file.startsWith(temporary+path.sep))throw new Error('OUTSIDE_RUNTIME_IMPORT');}else fs.appendFileSync(trace,JSON.stringify({kind:'esm',file})+'\\n');}return result;}`);
    fs.writeFileSync(bootstrap, `import {register} from 'node:module';register(${JSON.stringify(pathToFileURL(loader).href)},{parentURL:import.meta.url,data:${JSON.stringify({ root: target, temporary, trace })}});`);
    const env = { ...minimalEnvironment(), OFFICE_ENABLED: 'false', OFFICE_DEMO_WORKER: 'false', OFFICE_WORKER_CONCURRENCY: '1', OFFICE_WORKER_DATABASE_URL: 'postgresql://unconfigured@127.0.0.1:1/office_package_preflight_test', TSX_DISABLE_CACHE: '1' };
    const child = spawnSync(nodeExecutable, ['--require', preflight, '--import', pathToFileURL(path.join(target, 'apps/office-worker/node_modules/tsx/dist/loader.mjs')).href, '--import', pathToFileURL(bootstrap).href, path.join(target, 'apps/office-worker/src/index.ts'), '--once'], { cwd: target, env, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    if (child.status !== 1 || !child.stderr.includes('configuration_required:') || /OUTSIDE_RUNTIME_IMPORT|NETWORK_FORBIDDEN|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/.test(child.stderr)) throw new Error('Packaged worker failed its isolated, network-forbidden configuration check');
    const imports = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    for (const expected of ['apps/office-worker/src/index.ts', 'apps/backoffice/src/lib/office-runtime/index.ts', 'apps/backoffice/src/lib/office-contracts/index.ts']) if (!imports.some(item => slash(path.relative(target, item.file)) === expected)) throw new Error('Expected packaged runtime import was not observed');
    return { ...verified, smokePassed: true, expectedExitCode: 1, activationRejected: true, networkForbidden: true, importsConfinedToPackage: true, importedFiles: [...new Set(imports.map(item => slash(path.relative(target, item.file))))].sort() };
  } finally {
    // Only the four known verification files and trace in our new temporary directory.
    for (const name of [preflight, loader, bootstrap, trace]) if (exists(name)) fs.unlinkSync(name);
    fs.rmdirSync(temporary);
  }
}

export function typecheckRuntimePackage(destination) {
  const verified = verifyRuntimePackage(destination);
  const tsc = path.join(worker, 'node_modules/typescript/bin/tsc');
  const types = path.join(worker, 'node_modules/@types');
  if (!exists(tsc) || !exists(types)) throw new Error('Separate installed verification tooling is unavailable');
  const child = spawnSync(process.execPath, [tsc, '--project', path.join(verified.destination, 'apps/office-worker/tsconfig.json'), '--typeRoots', types, '--noEmit'], { cwd: verified.destination, env: minimalEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  if (child.status !== 0) { process.stderr.write(child.stdout || ''); process.stderr.write(child.stderr || ''); throw new Error('Packaged source typecheck failed'); }
  return { ...verified, typecheckPassed: true, tooling: 'separate installed TypeScript and Node types; not included in runtime' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && !args[0].startsWith('--')) console.log(JSON.stringify(packageRuntime(args[0])));
    else if (args.length === 2 && args[0] === '--verify') console.log(JSON.stringify(verifyRuntimePackage(args[1])));
    else if (args.length === 2 && args[0] === '--smoke') console.log(JSON.stringify(smokeRuntimePackage(args[1])));
    else if (args.length === 2 && args[0] === '--typecheck') console.log(JSON.stringify(typecheckRuntimePackage(args[1])));
    else throw new Error('Usage: node package-runtime.mjs [--verify|--smoke|--typecheck] <absolute destination>');
  } catch (error) { console.error(JSON.stringify({ failed: true, message: error.message })); process.exitCode = 1; }
}
