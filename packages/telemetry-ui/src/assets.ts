/// <reference types="node" />
// Node-only entry (`@dtp/telemetry-ui/assets`): where the built pages live, for
// servers that serve them as static files.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of `dist/www` (index.html, styles.css, app/*.js). */
export const telemetryAssetsDir: string = join(dirname(fileURLToPath(import.meta.url)), 'www')
