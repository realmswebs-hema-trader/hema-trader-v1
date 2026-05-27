import { spawn } from 'node:child_process';

const isRenderRuntime =
  process.env.RENDER === 'true' &&
  process.env.RENDER_SERVICE_TYPE === 'web' &&
  Boolean(process.env.WEB_CONCURRENCY || process.env.RENDER_WEB_CONCURRENCY);

const run = (command, args) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  child.on('exit', code => {
    process.exit(code ?? 0);
  });

  child.on('error', error => {
    console.error(error);
    process.exit(1);
  });
};

if (isRenderRuntime) {
  console.warn(
    'Render runtime invoked npm run build. Starting the web server instead so a port is opened.'
  );
  run('npm', ['run', 'start']);
} else {
  run(process.execPath, [
    '--max-old-space-size=384',
    './node_modules/vite/bin/vite.js',
    'build'
  ]);
}
