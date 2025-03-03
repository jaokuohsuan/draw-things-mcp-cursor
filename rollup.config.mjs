import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'dist-temp/index.js', // SWC translated entry file
  output: {
    file: 'dist/index.js',
    format: 'es',  // keep ES Module format
    sourcemap: false,
  },
  external: [
    // external dependencies, not packaged into the final file
    /@modelcontextprotocol\/.*/,
    'axios',
    'zod',
    'path',
    'fs',
    'os',
    'url',
    'util',
    'node:fs',
    'node:path',
    'node:os',
    'node:url',
    'node:util'
  ],
  plugins: [
    nodeResolve({
      exportConditions: ['node'],
      preferBuiltins: true,
    }),
  ]
}; 