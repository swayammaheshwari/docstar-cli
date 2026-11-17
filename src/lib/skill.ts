// The skill `setup` gives AI agents for one collection: when to use its API and how, through the collection's MCP tools
// or this CLI. Written to ~/.docstar/skills/<name>/SKILL.md, then copied into each agent by the `skills` installer.
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {CollectionListResponse} from './types.js'

import {configDir} from './paths.js'

// Agent skill names: lowercase letters, digits and dashes
export const skillNameOf = (slug: string): string => `${slug.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '')}-api`

export const skillDirOf = (slug: string): string => join(configDir(), 'skills', skillNameOf(slug))

const MAX_MODULES_LISTED = 40

export const renderSkill = (slug: string, collection: CollectionListResponse, bin = 'docstar-cli'): string => {
  const name = collection.collection?.name || slug
  const modules = collection.modules || []
  const listed = modules.slice(0, MAX_MODULES_LISTED).map((module) => `- \`${module.path}\`: ${module.name}`)
  if (modules.length > MAX_MODULES_LISTED) listed.push(`- ...and ${modules.length - MAX_MODULES_LISTED} more: run \`${bin} ${slug}\``)
  if ((collection.rootEndpoints || []).length > 0) listed.push(`- endpoints at the top level: \`${bin} ${slug} <endpoint>\``)

  const signIn =
    collection.auth === null
      ? ''
      : `\n## Sign-in\n\nCalls that need the person's account use their ${name} sign-in. If a command exits saying they aren't signed in, run \`${bin} login ${slug} --no-wait\`, give them the link it prints, and once they say they signed in run \`${bin} login ${slug} --continue\`. Never ask them to paste a token into the chat.\n`

  return `---
name: ${skillNameOf(slug)}
description: Call or look up the ${name} API (${slug}), documented on DocStar. Use when the person wants to do something with ${name}, or asks how its API works, which endpoint to use or what parameters it takes.
---

# ${name} API

${name}'s API is documented on DocStar under the slug \`${slug}\`. There are two ways to use it; prefer the first.

## 1. MCP tools (when the ${name} MCP server is connected)

If you have tools from the \`${slug}\` MCP server, start with its quickstart tool: it explains which tool to use when. Search the docs before calling an endpoint, and read an endpoint's docs before calling it.

## 2. docstar-cli (from a terminal)

- \`${bin} ${slug}\`: list the modules
- \`${bin} ${slug} <module>\`: list a module's endpoints
- \`${bin} ${slug} <module> <endpoint> --help\`: an endpoint's flags
- \`${bin} ${slug} <module> <endpoint> --<flag> <value>\`: call it; the response is printed

The docs are read live on every call, so they are always current. A missing required value is asked for in a terminal; in a script, pass every required flag.
${signIn}
## Modules

${listed.join('\n') || `Run \`${bin} ${slug}\` to see them.`}

## Rules

- Never print or repeat API keys or tokens: the CLI keeps them in ~/.docstar and never shows them.
- If an API key is needed, don't ask for it in the chat: run \`${bin} key request\` and follow what it prints, so the key goes straight to this computer.
`
}

export const writeSkill = async (slug: string, collection: CollectionListResponse, bin?: string): Promise<string> => {
  const dir = skillDirOf(slug)
  await mkdir(dir, {recursive: true})
  await writeFile(join(dir, 'SKILL.md'), renderSkill(slug, collection, bin))
  return dir
}
