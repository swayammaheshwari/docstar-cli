docstar-cli
=================

A new CLI generated with oclif


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/docstar-cli.svg)](https://npmjs.org/package/docstar-cli)
[![Downloads/week](https://img.shields.io/npm/dw/docstar-cli.svg)](https://npmjs.org/package/docstar-cli)


<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g docstar-cli
$ docstar-cli COMMAND
running command...
$ docstar-cli (--version)
docstar-cli/0.0.0 darwin-arm64 node-v22.22.3
$ docstar-cli --help [COMMAND]
USAGE
  $ docstar-cli COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`docstar-cli hello PERSON`](#docstar-cli-hello-person)
* [`docstar-cli hello world`](#docstar-cli-hello-world)
* [`docstar-cli help [COMMAND]`](#docstar-cli-help-command)
* [`docstar-cli plugins`](#docstar-cli-plugins)
* [`docstar-cli plugins add PLUGIN`](#docstar-cli-plugins-add-plugin)
* [`docstar-cli plugins:inspect PLUGIN...`](#docstar-cli-pluginsinspect-plugin)
* [`docstar-cli plugins install PLUGIN`](#docstar-cli-plugins-install-plugin)
* [`docstar-cli plugins link PATH`](#docstar-cli-plugins-link-path)
* [`docstar-cli plugins remove [PLUGIN]`](#docstar-cli-plugins-remove-plugin)
* [`docstar-cli plugins reset`](#docstar-cli-plugins-reset)
* [`docstar-cli plugins uninstall [PLUGIN]`](#docstar-cli-plugins-uninstall-plugin)
* [`docstar-cli plugins unlink [PLUGIN]`](#docstar-cli-plugins-unlink-plugin)
* [`docstar-cli plugins update`](#docstar-cli-plugins-update)

## `docstar-cli hello PERSON`

Say hello

```
USAGE
  $ docstar-cli hello PERSON -f <value>

ARGUMENTS
  PERSON  Person to say hello to

FLAGS
  -f, --from=<value>  (required) Who is saying hello

DESCRIPTION
  Say hello

EXAMPLES
  $ docstar-cli hello friend --from oclif
  hello friend from oclif! (./src/commands/hello/index.ts)
```

_See code: [src/commands/hello/index.ts](https://github.com/swayammaheshwari/docstar-cli/blob/v0.0.0/src/commands/hello/index.ts)_

## `docstar-cli hello world`

Say hello world

```
USAGE
  $ docstar-cli hello world

DESCRIPTION
  Say hello world

EXAMPLES
  $ docstar-cli hello world
  hello world! (./src/commands/hello/world.ts)
```

_See code: [src/commands/hello/world.ts](https://github.com/swayammaheshwari/docstar-cli/blob/v0.0.0/src/commands/hello/world.ts)_

## `docstar-cli help [COMMAND]`

Display help for docstar-cli.

```
USAGE
  $ docstar-cli help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for docstar-cli.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.58/src/commands/help.ts)_

## `docstar-cli plugins`

List installed plugins.

```
USAGE
  $ docstar-cli plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ docstar-cli plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.87/src/commands/plugins/index.ts)_

## `docstar-cli plugins add PLUGIN`

Installs a plugin into docstar-cli.

```
USAGE
  $ docstar-cli plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into docstar-cli.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the DOCSTAR_CLI_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the DOCSTAR_CLI_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ docstar-cli plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ docstar-cli plugins add myplugin

  Install a plugin from a github url.

    $ docstar-cli plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ docstar-cli plugins add someuser/someplugin
```

## `docstar-cli plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ docstar-cli plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ docstar-cli plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.87/src/commands/plugins/inspect.ts)_

## `docstar-cli plugins install PLUGIN`

Installs a plugin into docstar-cli.

```
USAGE
  $ docstar-cli plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into docstar-cli.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the DOCSTAR_CLI_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the DOCSTAR_CLI_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ docstar-cli plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ docstar-cli plugins install myplugin

  Install a plugin from a github url.

    $ docstar-cli plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ docstar-cli plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.87/src/commands/plugins/install.ts)_

## `docstar-cli plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ docstar-cli plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ docstar-cli plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.87/src/commands/plugins/link.ts)_

## `docstar-cli plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ docstar-cli plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ docstar-cli plugins unlink
  $ docstar-cli plugins remove

EXAMPLES
  $ docstar-cli plugins remove myplugin
```

## `docstar-cli plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ docstar-cli plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.87/src/commands/plugins/reset.ts)_

## `docstar-cli plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ docstar-cli plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ docstar-cli plugins unlink
  $ docstar-cli plugins remove

EXAMPLES
  $ docstar-cli plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.87/src/commands/plugins/uninstall.ts)_

## `docstar-cli plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ docstar-cli plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ docstar-cli plugins unlink
  $ docstar-cli plugins remove

EXAMPLES
  $ docstar-cli plugins unlink myplugin
```

## `docstar-cli plugins update`

Update installed plugins.

```
USAGE
  $ docstar-cli plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.87/src/commands/plugins/update.ts)_
<!-- commandsstop -->
