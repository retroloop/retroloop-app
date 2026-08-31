#!/usr/bin/env bun
import { run } from '#main'

/**
 * The binary. Everything it does lives in `run`, so the only thing that is not
 * covered by the in-process suite is this line — and this line is the only place
 * in the CLI that may end the process.
 */
process.exit(await run(process.argv.slice(2)))
