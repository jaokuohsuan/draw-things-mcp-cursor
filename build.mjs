#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// create temporary directory
const tempDir = 'dist-temp';
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

try {
  // first step: use SWC to translate TypeScript to JavaScript (keep the original build command logic)
  console.log('step 1: use SWC to translate TypeScript to JavaScript...');
  execSync(`rimraf ${tempDir} && swc src -d ${tempDir} --strip-leading-paths`, { 
    stdio: 'inherit' 
  });

  // second step: use Rollup to package as a single file
  console.log('step 2: use Rollup to package as a single file...');
  execSync('rimraf dist && rollup -c', { 
    stdio: 'inherit' 
  });

  // third step: ensure dist/index.js has execution permission (because it is a bin file)
  console.log('step 3: set execution permission...');
  fs.chmodSync('dist/index.js', '755');

  // fourth step: clean temporary directory
  console.log('step 4: clean temporary directory...');
  execSync(`rimraf ${tempDir}`, { 
    stdio: 'inherit' 
  });

  console.log('build completed! output: dist/index.js');
} catch (error) {
  console.error('error occurred during the build process:', error);
  process.exit(1);
} 