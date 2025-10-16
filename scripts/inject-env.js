#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read environment variables
const posthogApiKey = process.env.POSTHOG_API_KEY;
const posthogApiHost = process.env.POSTHOG_API_HOST;

if (!posthogApiKey || !posthogApiHost) {
  console.error('Error: POSTHOG_API_KEY and POSTHOG_API_HOST environment variables are required');
  process.exit(1);
}

// Read the HTML file
const htmlPath = path.join(__dirname, '../public/index.html');
let htmlContent = fs.readFileSync(htmlPath, 'utf-8');

// Replace placeholders
htmlContent = htmlContent.replace('__POSTHOG_API_KEY__', posthogApiKey);
htmlContent = htmlContent.replace('__POSTHOG_API_HOST__', posthogApiHost);

// Write back
fs.writeFileSync(htmlPath, htmlContent, 'utf-8');

console.log('✓ Environment variables injected into public/index.html');
