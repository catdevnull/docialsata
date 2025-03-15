#!/usr/bin/env bun
/**
 * CLI tool to import Twitter accounts from a text file to the Twitter Scraper API
 *
 * Usage:
 *   bun import-accounts.ts accounts.txt [format] [api-url]
 *
 * Arguments:
 *   accounts.txt - Path to the text file containing account information
 *   format - Optional format string (default: username:password:email:emailPassword:authToken:twoFactorSecret)
 *   api-url - Optional API URL (default: http://localhost:3000)
 *
 * Example:
 *   bun import-accounts.ts ../accounts.txt "username:password:email:emailPassword:authToken:ANY" http://localhost:3000
 */

import fs from 'fs';
import path from 'path';
import { parseAccountList, defaultAccountListFormat } from '../account-manager';

try {
  // Parse command line arguments
  const filePath = process.argv[2];
  const format = process.argv[3] || defaultAccountListFormat;
  const apiUrl = process.argv[4] || 'http://localhost:3000';

  if (!filePath) {
    console.error('Error: File path is required');
    console.log(
      'Usage: bun import-accounts.ts accounts.txt [format] [api-url]',
    );
    process.exit(1);
  }

  // Read and parse the account file
  const fullPath = path.resolve(filePath);
  console.log(`Reading accounts from: ${fullPath}`);

  if (!fs.existsSync(fullPath)) {
    console.error(`Error: File ${fullPath} does not exist`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(fullPath, 'utf8');
  console.log(`Parsing accounts using format: ${format}`);

  const accounts = parseAccountList(fileContent, format);
  console.log(`Found ${accounts.length} accounts`);

  // Send the parsed accounts to the API
  const endpoint = `${apiUrl}/api/accounts/import`;
  console.log(`Sending accounts to API: ${endpoint}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accounts }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `API request failed with status ${response.status}: ${errorText}`,
    );
  }

  const result = await response.json();
  console.log('API Response:');
  console.log(JSON.stringify(result, null, 2));

  console.log(`Successfully imported ${accounts.length} accounts`);
} catch (error) {
  console.error(
    'Error:',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
