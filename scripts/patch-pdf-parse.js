#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find the pdf-parse module path
const pdfParsePath = path.join(__dirname, '../node_modules/.pnpm/pdf-parse@1.1.1/node_modules/pdf-parse/index.js');

if (fs.existsSync(pdfParsePath)) {
  let content = fs.readFileSync(pdfParsePath, 'utf8');
  
  // Replace the debug mode check to always be false
  content = content.replace(
    'let isDebugMode = !module.parent;',
    'let isDebugMode = false; // Patched to prevent debug mode'
  );
  
  fs.writeFileSync(pdfParsePath, content);
  console.log('✅ pdf-parse patched to disable debug mode');
} else {
  console.log('⚠️  pdf-parse module not found, skipping patch');
}