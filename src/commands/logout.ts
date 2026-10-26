import {Args, Command} from '@oclif/core'

import {removePendingSignIn, removeSignIn} from '../lib/auth.js'

export default class Logout extends Command {
  static override args = {
    collection: Args.string({description: 'The collection (slug) to sign out of, e.g. msg91', required: true}),
  }
  static override description = [
    'Sign out of a collection on this computer: deletes the tokens `login` saved, so its API calls stop using your account.',
    "To revoke the sign-in itself, remove the app's access in that platform's account settings.",
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %> msg91']

  public async run(): Promise<void> {
    const {args} = await this.parse(Logout)
    await removePendingSignIn(args.collection)
    const removed = await removeSignIn(args.collection)
    this.log(removed ? `Signed out of "${args.collection}" on this computer.` : `You weren't signed in to "${args.collection}".`)
  }
}
