import {spawn} from 'node:child_process'

// Opens an http(s) link in the default browser, without waiting for it. Returns false when there's no way to (e.g. a
// server without a desktop); the caller has printed the link anyway.
export const openInBrowser = (url: string): boolean => {
  if (!/^https?:\/\//i.test(url)) return false
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(command, args, {detached: true, stdio: 'ignore'})
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
