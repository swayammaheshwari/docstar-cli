import {Args, Command} from '@oclif/core'
import {completeEndpoints, completeModules} from '../lib/complete.js'

// Hidden helper invoked by the shell completion function (see `completion-script`), not meant to
// be run directly. Prints one suggestion per line: module names for `docstar-cli complete
// <collection>`, endpoint command names/aliases for `docstar-cli complete <collection> <module>`.
// Never suggests a collection name or a top-level command — completion only starts once the
// collection has already been typed.
export default class Complete extends Command {
  static override args = {
    collection: Args.string({required: true}),
    module: Args.string({required: false}),
  }
  static override hidden = true

  public async run(): Promise<void> {
    const {args} = await this.parse(Complete)

    const suggestions = args.module ? await completeEndpoints(args.collection, args.module) : await completeModules(args.collection)

    for (const suggestion of suggestions) this.log(suggestion)
  }
}
