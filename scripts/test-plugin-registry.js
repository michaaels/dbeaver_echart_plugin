'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cliArgs = process.argv.slice(2);
const pdeOutput = cliArgs.includes('--pde-output');
const home = path.resolve(cliArgs.find(value => value !== '--pde-output') || path.join(root, '.dev/dbeaver-26.2.2/dbeaver'));
const javaHome = process.env.ECHARTS_RUNTIME_JDK || 'C:/Program Files/Java/jdk-26.0.1';
const java = name => path.join(javaHome, 'bin', name + '.exe');
const output = path.join(root, '.dev/registry-test-' + Date.now());
const classes = pdeOutput ? path.join(root, 'plugins/org.example.dbeaver.echarts/bin') : path.join(output, 'classes');
fs.mkdirSync(output, { recursive: true });
if (!pdeOutput) fs.mkdirSync(classes);
const plugins = path.join(home, 'plugins');
const entries = fs.readdirSync(plugins);
const framework = path.join(plugins, entries.find(name => /^org\.eclipse\.osgi_[\d]/.test(name)));
const configurator = path.join(plugins, entries.find(name => name.startsWith('org.eclipse.equinox.simpleconfigurator_')));
const info = path.join(output, 'bundles.info');
fs.writeFileSync(info, fs.readFileSync(path.join(home, 'configuration/org.eclipse.equinox.simpleconfigurator/bundles.info'), 'utf8')
  .split(/\r?\n/).map(line => {
    if (!line || line.startsWith('#')) return line;
    const fields = line.split(',');
    // This harness uses the JVM application loader, without legacy PDE resolver extensions.
    if (fields[0] === 'org.eclipse.osgi.compatibility.state') return '';
    fields[2] = require('node:url').pathToFileURL(path.join(home, fields[2])).href;
    if (fields[0].startsWith('org.jkiss.')) fields[4] = 'false';
    return fields.join(',');
  }).join('\n'));
function run(command, args) {
  const result = cp.spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status) throw new Error(`${path.basename(command)} exited ${result.status}`);
}
const source = path.join(root, 'plugins/org.example.dbeaver.echarts');
const sources = fs.readdirSync(path.join(source, 'src/org/example/dbeaver/echarts'))
  .filter(name => name.endsWith('.java')).map(name => path.join(source, 'src/org/example/dbeaver/echarts', name));
if (pdeOutput) {
  for (const file of sources) {
    const compiled = path.join(classes, 'org/example/dbeaver/echarts', path.basename(file, '.java') + '.class');
    if (!fs.existsSync(compiled)) throw new Error(`PDE output is incomplete: ${path.basename(compiled)} is missing. Refresh and clean the project in Eclipse.`);
  }
  function checkClasses(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) checkClasses(file);
      else if (entry.name.endsWith('.class')) {
        const bytes = fs.readFileSync(file);
        if (bytes.includes(Buffer.from('Unresolved compilation problem'))) {
          throw new Error(`PDE output contains a compilation error stub: ${path.relative(classes, file)}. Refresh and clean the project in Eclipse.`);
        }
        if (bytes.readUInt16BE(6) > 65) {
          throw new Error(`PDE output requires Java newer than 21: ${path.relative(classes, file)}. Refresh project settings and clean the project in Eclipse.`);
        }
      }
    }
  }
  checkClasses(classes);
  console.log('Testing actual Eclipse PDE output: ' + classes);
} else {
  run(java('javac'), ['--release', '21', '-encoding', 'UTF-8', '-cp', path.join(plugins, '*'), '-d', classes, ...sources]);
}
const pluginJar = path.join(output, 'echarts-test.jar');
run(java('jar'), ['cfm', pluginJar, path.join(source, 'META-INF/MANIFEST.MF'), '-C', classes, '.', '-C', source, 'plugin.xml', '-C', source, 'web']);
const harness = path.join(output, 'harness');
fs.mkdirSync(harness);
run(java('javac'), ['-cp', framework, '-d', harness, 'scripts/tests/PluginRegistryTest.java']);
run(java('java'), ['--enable-native-access=ALL-UNNAMED', '-Djava.library.path=' + home,
  '-cp', harness + path.delimiter + framework, 'PluginRegistryTest', home,
  path.join(output, 'configuration'), configurator, info, pluginJar]);
