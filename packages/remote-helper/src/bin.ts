#!/usr/bin/env node
console.error('[bin] using ts entry')
import { runHelper } from './index.js';
runHelper().catch(e => { console.error(e); process.exit(1); });
