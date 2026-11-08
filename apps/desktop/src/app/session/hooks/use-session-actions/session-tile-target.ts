import { projectProfile } from '@/store/projects'

interface TileProfileOptions {
  cwd?: null | string
  profile?: string
}

export function resolveTileProfiles(options: TileProfileOptions): {
  optionProfile?: string
  projectOwnerProfile?: string
} {
  const projectOwnerProfile =
    options.profile === undefined && typeof options.cwd === 'string' ? (projectProfile() ?? undefined) : undefined

  return {
    optionProfile: options.profile ?? projectOwnerProfile,
    projectOwnerProfile
  }
}
