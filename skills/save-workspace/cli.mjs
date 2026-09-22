// Shim: resolve this skill's real location (through symlinks/junctions) and run the shared CLI.
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = realpathSync.native(dirname(fileURLToPath(import.meta.url)));
await import(pathToFileURL(join(here, '..', '..', 'scripts', 'workspace-tools.mjs')).href);
