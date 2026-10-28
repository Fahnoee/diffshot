#!/usr/bin/env node
import { main, UsageError } from '../src/cli.js';

main(process.argv.slice(2)).catch((err) => {
  console.error(`diffshot: ${err instanceof UsageError ? err.message : err.stack}`);
  process.exit(1);
});
