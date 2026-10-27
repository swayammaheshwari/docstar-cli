export const SLUG_PATTERN = /^[a-z0-9_-]{1,50}$/

// A collection's commands live under its slug (`docstar-cli <slug> ...`), so a slug equal to one of the CLI's own commands
// would hide them. Keep in line with hitman-api's RESERVED_SLUGS (utils/slug.js), which refuses them when a collection is made.
export const RESERVED_SLUGS = ['auth', 'clean', 'complete', 'completion', 'completion-script', 'config', 'help', 'init', 'key', 'list', 'login', 'logout', 'mcp']

export const isReservedSlug = (slug: string): boolean => RESERVED_SLUGS.includes(slug.toLowerCase())
