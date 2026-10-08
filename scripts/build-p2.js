'use strict';

// Build from source, then let Equinox publish genuine installable P2 metadata.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const root = path.resolve(__dirname, '..');
const options = {};
const allowed = new Set(['eclipse', 'jdk', 'publisher-jdk', 'dbeaver', 'output', 'qualifier']);
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1]) throw new Error('Expected --option value');
  if (!allowed.has(process.argv[i].slice(2))) throw new Error('Unknown build option: ' + process.argv[i]);
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
if (!options.eclipse || !options.jdk) {
  throw new Error('Usage: node scripts/build-p2.js --eclipse <Eclipse SDK home> --jdk <JDK 21+ home> [--publisher-jdk <JDK home>] [--dbeaver <DBeaver home>] [--output <directory>] [--qualifier <qualifier>]');
}
const home = path.resolve(options.dbeaver || path.join(root, '.dev/dbeaver-26.2.2/dbeaver'));
const eclipse = path.resolve(options.eclipse);
const jdk = path.resolve(options.jdk);
const publisherJdk = path.resolve(options['publisher-jdk'] || jdk);
const bin = (jdkHome, name) => path.join(jdkHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
function run(command, args, capture = false) {
  const result = cp.spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (!capture && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited ${result.status}`);
  return result.stdout.trim();
}
const commit = run('git', ['rev-parse', 'HEAD'], true);
const commitDate = run('git', ['show', '-s', '--format=%cI', 'HEAD'], true);
const date = new Date(commitDate).toISOString().replace(/\.\d{3}Z$/, 'Z');
const qualifier = options.qualifier || 'v' + date.replace(/\D/g, '') + '_' + commit.slice(0, 8);
if (!/^[A-Za-z0-9_-]+$/.test(qualifier)) throw new Error('Qualifier must contain only letters, digits, underscores or hyphens');
const source = path.join(root, 'plugins/org.example.dbeaver.echarts');
const manifest = fs.readFileSync(path.join(source, 'META-INF/MANIFEST.MF'), 'utf8');
const base = manifest.match(/^Bundle-Version: (\d+\.\d+\.\d+)\.qualifier\s*$/m)?.[1];
if (!base) throw new Error('Expected a qualified source Bundle-Version');
const version = base + '.' + qualifier;
const output = path.resolve(options.output || path.join(root, 'dist'));
const repository = path.join(output, 'dbeaver-echarts-' + version);
const archive = repository + '.zip';
if (fs.existsSync(repository) || fs.existsSync(archive)) throw new Error('Release already exists; use another --output directory or qualifier');
fs.mkdirSync(path.join(root, '.dev'), { recursive: true });
const staging = fs.mkdtempSync(path.join(root, '.dev/p2-build-'));
const classes = path.join(staging, 'bundle');
fs.mkdirSync(classes);
const targetPlugins = path.join(home, 'plugins');
function files(directory, suffix) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file, suffix) : entry.name.endsWith(suffix) ? [file] : [];
  });
}
const sources = files(path.join(source, 'src'), '.java');
run(bin(jdk, 'javac'), ['--release', '21', '-encoding', 'UTF-8', '-cp', path.join(targetPlugins, '*'), '-d', classes, ...sources]);
for (const file of files(classes, '.class')) {
  const bytes = fs.readFileSync(file);
  if (bytes.readUInt16BE(6) !== 65 || bytes.includes(Buffer.from('Unresolved compilation problem'))) throw new Error('Invalid compiled class: ' + file);
}
for (const resource of ['plugin.xml', 'web', 'third-party', 'about.html']) {
  fs.cpSync(path.join(source, resource), path.join(classes, resource), { recursive: true });
}
for (const legal of ['LICENSE', 'NOTICE']) {
  if (fs.existsSync(path.join(root, legal))) fs.copyFileSync(path.join(root, legal), path.join(classes, legal));
}
const generatedManifest = path.join(staging, 'MANIFEST.MF');
fs.writeFileSync(generatedManifest, manifest.replace(base + '.qualifier', version));
fs.mkdirSync(path.join(repository, 'plugins'), { recursive: true });
fs.mkdirSync(path.join(repository, 'features'));
const pluginName = 'org.example.dbeaver.echarts_' + version + '.jar';
run(bin(jdk, 'jar'), ['--create', '--file', path.join(repository, 'plugins', pluginName), '--manifest', generatedManifest, '--date', date, '-C', classes, '.']);
const feature = path.join(staging, 'feature');
fs.mkdirSync(feature);
const featureXml = fs.readFileSync(path.join(root, 'features/org.example.dbeaver.echarts.feature/feature.xml'), 'utf8')
  .replace(/\d+\.\d+\.\d+\.qualifier/g, version).replace('version="0.0.0"', 'version="' + version + '"');
fs.writeFileSync(path.join(feature, 'feature.xml'), featureXml);
run(bin(jdk, 'jar'), ['--create', '--file', path.join(repository, 'features', 'org.example.dbeaver.echarts.feature_' + version + '.jar'), '--no-manifest', '--date', date, '-C', feature, '.']);
const category = path.join(staging, 'category.xml');
fs.writeFileSync(category, fs.readFileSync(path.join(root, 'sites/org.example.dbeaver.echarts.site/category.xml'), 'utf8').replace(/\d+\.\d+\.\d+\.qualifier/g, version));

// Use the SDK's bundles with a private configuration; never alter the developer's Eclipse profile.
const infoSource = path.join(eclipse, 'configuration/org.eclipse.equinox.simpleconfigurator/bundles.info');
const bundles = fs.readFileSync(infoSource, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
  const fields = line.split(',');
  const location = fields[2].startsWith('file:') ? fileURLToPath(fields[2]) : path.resolve(eclipse, fields[2]);
  fields[2] = pathToFileURL(location).href;
  return fields;
});
const bundle = name => {
  const entry = bundles.find(fields => fields[0] === name);
  if (!entry) throw new Error('Eclipse SDK is missing ' + name);
  return entry[2];
};
bundle('org.eclipse.equinox.p2.publisher.eclipse');
const configuration = path.join(staging, 'configuration');
fs.mkdirSync(configuration);
const info = path.join(configuration, 'bundles.info');
fs.writeFileSync(info, '#version=1\n' + bundles.map(fields => fields.join(',')).join('\n'));
const property = value => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
fs.writeFileSync(path.join(configuration, 'config.ini'), [
  'osgi.framework=' + property(bundle('org.eclipse.osgi')),
  'osgi.bundles=reference' + property(':' + bundle('org.eclipse.equinox.simpleconfigurator')) + '@1' + property(':start'),
  'osgi.bundles.defaultStartLevel=4',
  'org.eclipse.equinox.simpleconfigurator.configUrl=' + property(pathToFileURL(info).href),
  'osgi.configuration.cascaded=false'
].join('\n') + '\n');
function publish(application, args) {
  run(bin(publisherJdk, 'java'), ['-jar', fileURLToPath(bundle('org.eclipse.equinox.launcher')), '-nosplash', '-consoleLog',
    '-install', eclipse, '-configuration', configuration, '-data', path.join(staging, 'workspace'), '-application', application, ...args]);
}
publish('org.eclipse.equinox.p2.publisher.FeaturesAndBundlesPublisher', ['-metadataRepository', pathToFileURL(repository).href,
  '-artifactRepository', pathToFileURL(repository).href, '-source', repository, '-compress', '-publishArtifacts']);
publish('org.eclipse.equinox.p2.publisher.CategoryPublisher', ['-metadataRepository', pathToFileURL(repository).href,
  '-categoryDefinition', pathToFileURL(category).href, '-compress']);
for (const name of ['content.jar', 'artifacts.jar']) if (!fs.existsSync(path.join(repository, name))) throw new Error('Publisher did not produce ' + name);
const targetFeature = fs.readdirSync(targetPlugins).find(name => name.startsWith('org.jkiss.dbeaver.core_'));
const buildInfo = { version, commit, commitDate, workingTreeDirty: !!run('git', ['status', '--porcelain'], true),
  dbeaver: targetFeature, compiler: run(bin(jdk, 'javac'), ['-version'], true), sourceRelease: 21, classes: files(classes, '.class').length,
  installIU: 'org.example.dbeaver.echarts.feature.feature.group', signed: false };
fs.writeFileSync(path.join(repository, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');
run(bin(jdk, 'jar'), ['--create', '--file', archive, '--no-manifest', '--date', date, '-C', repository, '.']);
const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(archive + '.sha256', hash + '  ' + path.basename(archive) + '\n');
console.log(JSON.stringify({ repository, archive, sha256: hash, ...buildInfo }, null, 2));
