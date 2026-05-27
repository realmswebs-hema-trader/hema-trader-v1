import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const indexPath = path.join(process.cwd(), 'dist', 'index.html');
const isRenderRuntime =
  process.env.RENDER === 'true' &&
  process.env.RENDER_SERVICE_TYPE === 'web' &&
  Boolean(process.env.WEB_CONCURRENCY || process.env.RENDER_WEB_CONCURRENCY);

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });

    child.on('exit', code => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });

    child.on('error', reject);
  });

const buildFrontend = () =>
  run(process.execPath, [
    '--max-old-space-size=384',
    './node_modules/vite/bin/vite.js',
    'build'
  ]);

try {
  if (isRenderRuntime) {
    if (!existsSync(indexPath)) {
      console.warn(
        'Render runtime started without dist/index.html. Building frontend before opening the web port.'
      );
      await buildFrontend();
    }

    console.warn(
      'Render runtime invoked npm run build. Starting the web server so a port is opened.'
    );
    await run('npm', ['run', 'start']);
  } else {
    await buildFrontend();
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
