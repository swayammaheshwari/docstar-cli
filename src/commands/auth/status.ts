import {Command} from '@oclif/core'

import {readSignIns, type SignIn} from '../../lib/auth.js'

const expiryText = (signIn: SignIn, now: number): string => {
  if (!signIn.expiresAt) return 'no expiry given'
  const minutes = Math.round((signIn.expiresAt - now) / 60_000)
  if (minutes > 0) return `token expires in ${minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`}${signIn.refreshToken ? ', refreshed automatically' : ''}`
  return signIn.refreshToken ? 'token expired, refreshed on the next call' : 'expired: run `login` again'
}

export default class AuthStatus extends Command {
  static override description = 'Show which collections you are signed in to with `login` (tokens are never shown).'
  static override examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    const signIns = Object.entries(await readSignIns())
    if (signIns.length === 0) {
      this.log(`Not signed in to any collection. Run \`${this.config.bin} login <collection>\` to sign in.`)
      return
    }

    const now = Date.now()
    for (const [slug, signIn] of signIns) {
      this.log(`${slug}\n  ${signIn.name}, signed in ${signIn.signedInAt.slice(0, 10)}\n  ${expiryText(signIn, now)}\n  token sent as: ${signIn.tokenHeader}${signIn.tokenPrefix ? ` (${signIn.tokenPrefix})` : ''}`)
    }
  }
}
