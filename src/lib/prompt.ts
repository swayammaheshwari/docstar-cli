import {input} from '@inquirer/prompts'

export const promptForMissingParams = async (
  required: string[],
  provided: Record<string, string>,
): Promise<Record<string, string>> => {
  const collected: Record<string, string> = {}
  for (const key of required) {
    if (provided[key] !== undefined) continue
    // eslint-disable-next-line no-await-in-loop
    collected[key] = await input({message: `Enter value for ${key}`})
  }

  return collected
}
