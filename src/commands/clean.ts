import {checkbox, confirm} from '@inquirer/prompts'
import {Args, Command, Flags} from '@oclif/core'
import {readFile, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {collectionModulesDir, configPath, modulePath} from '../lib/paths.js'
import type {SavedConfig} from '../lib/types.js'

export default class Clean extends Command {
  static override args = {
    collection: Args.string({description: 'The collection (CLI name) to clean up, e.g. msg91', required: true}),
  }
  static override description = [
    'Uninstall modules from a collection, or the entire collection.',
    'By default shows a checklist of the collection\'s installed modules to remove.',
    '`--all` targets the whole collection instead; combine with `--force` to skip the confirmation prompt.',
  ].join('\n')
  static override examples = [
    '<%= config.bin %> <%= command.id %> msg91                # pick modules to remove from "msg91"',
    '<%= config.bin %> <%= command.id %> msg91 --all           # remove the whole "msg91" collection (asks to confirm)',
    '<%= config.bin %> <%= command.id %> msg91 --all --force   # remove the whole "msg91" collection without asking',
  ]
  static override flags = {
    all: Flags.boolean({description: 'Remove the entire collection instead of picking modules'}),
    force: Flags.boolean({description: 'Skip the confirmation prompt (only relevant with --all)'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Clean)

    let savedConfig: SavedConfig
    try {
      savedConfig = JSON.parse(await readFile(configPath(), 'utf8')) as SavedConfig
    } catch {
      this.error('No installed modules found. Run `docstar-cli init <domain>` first.')
    }

    const collection = savedConfig.collections.find((c) => c.cliName === args.collection)
    if (!collection) {
      this.error(`Collection "${args.collection}" isn't installed. Run \`docstar-cli list\` to see installed collections.`)
    }

    if (flags.all) {
      if (!flags.force) {
        const shouldDelete = await confirm({
          default: false,
          message: `Delete the entire "${collection.cliName}" collection and all ${collection.modules.length} installed module(s)?`,
        })

        if (!shouldDelete) {
          this.log('Aborted, nothing was removed.')
          return
        }
      }

      await rm(collectionModulesDir(collection.cliName), {force: true, recursive: true})
      await rm(join(this.config.root, 'dist', 'commands', collection.cliName), {force: true, recursive: true})

      savedConfig.collections = savedConfig.collections.filter((c) => c.cliName !== collection.cliName)
      await writeFile(configPath(), JSON.stringify(savedConfig, null, 2))

      this.log(`Removed collection "${collection.cliName}" and its ${collection.modules.length} module(s).`)
      return
    }

    if (collection.modules.length === 0) {
      this.log(`Collection "${collection.cliName}" has no installed modules.`)
      return
    }

    const SELECT_ALL = '__select_all__'

    const rawSelection = await checkbox({
      choices: [
        ...collection.modules.map((module) => ({checked: false, name: `${module.name} (${module.path})`, value: module.path})),
        {checked: false, name: '➤ Select all modules', value: SELECT_ALL},
      ],
      message: `Select modules to remove from "${collection.cliName}" (space to toggle, enter to confirm)`,
    })

    const selectedPaths = rawSelection.includes(SELECT_ALL) ? collection.modules.map((module) => module.path) : rawSelection

    if (selectedPaths.length === 0) {
      this.log('No modules selected, nothing removed.')
      return
    }

    for (const path of selectedPaths) {
      // eslint-disable-next-line no-await-in-loop
      await rm(modulePath(collection.cliName, path), {force: true})
      // eslint-disable-next-line no-await-in-loop
      await rm(join(this.config.root, 'dist', 'commands', collection.cliName, path), {force: true, recursive: true})
      this.log(`  removed: ${collection.cliName} ${path}`)
    }

    collection.modules = collection.modules.filter((module) => !selectedPaths.includes(module.path))

    if (collection.modules.length === 0) {
      await rm(collectionModulesDir(collection.cliName), {force: true, recursive: true})
      savedConfig.collections = savedConfig.collections.filter((c) => c.cliName !== collection.cliName)
      this.log(`Collection "${collection.cliName}" has no modules left, removed it entirely.`)
    }

    await writeFile(configPath(), JSON.stringify(savedConfig, null, 2))

    this.log(`Removed ${selectedPaths.length} module(s) from "${collection.cliName}".`)
  }
}
