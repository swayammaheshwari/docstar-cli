import {Command} from '@oclif/core'

const scriptFor = (bin: string): string => {
  const fnName = `_${bin.replaceAll(/[^a-zA-Z0-9]/g, '_')}_complete`

  return `# zsh doesn't support the bash-style \`complete\` builtin used below until compinit (for
# compdef) and bashcompinit (for complete/compgen) are both loaded, in that order.
if [ -n "$ZSH_VERSION" ]; then
  autoload -Uz compinit && compinit -u
  autoload -U +X bashcompinit && bashcompinit
fi

${fnName}() {
  local cur collection module
  cur="\${COMP_WORDS[COMP_CWORD]}"
  collection="\${COMP_WORDS[1]}"
  module="\${COMP_WORDS[2]}"

  COMPREPLY=()

  if [ "$COMP_CWORD" -eq 2 ] && [ -n "$collection" ]; then
    COMPREPLY=( $(compgen -W "$(${bin} complete "$collection" 2>/dev/null)" -- "$cur") )
  elif [ "$COMP_CWORD" -eq 3 ] && [ -n "$collection" ] && [ -n "$module" ]; then
    COMPREPLY=( $(compgen -W "$(${bin} complete "$collection" "$module" 2>/dev/null)" -- "$cur") )
  fi
  # COMP_CWORD 0/1 (the binary name and the collection itself) intentionally get no
  # suggestions — the collection is always typed out by hand.
}
complete -F ${fnName} ${bin}
`
}

export default class CompletionScript extends Command {
  static override description = [
    'Print a shell completion function that completes ONLY module names (once a collection is typed) and endpoint names (once a collection and module are typed).',
    'It never completes the collection name itself, and never completes top-level commands like `list`/`init`/`mcp` — those are typed out by hand.',
  ].join('\n')
  static override examples = ['echo \'eval "$(<%= config.bin %> <%= command.id %>)"\' >> ~/.bashrc  # or ~/.zshrc']

  public async run(): Promise<void> {
    this.log(scriptFor(this.config.bin))
  }
}
