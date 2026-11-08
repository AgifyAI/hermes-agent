import { LOCAL_CONNECTION_ID } from '@hermes/shared'
import { type ComponentProps, useEffect, useState } from 'react'

import { ProfileGlyph } from '@/components/ui/profile-glyph'
import { requestGatewayForAgent, requestGatewayForProfile } from '@/store/gateway'

const avatarCache = new Map<string, null | string>()
const avatarRequests = new Map<string, Promise<null | string>>()

function avatarKey(name: string, connectionId?: null | string): string {
  return `${connectionId || LOCAL_CONNECTION_ID}\u0000${name.trim() || 'default'}`
}

export function invalidateProfileAvatar(name: string, connectionId?: null | string): void {
  avatarCache.delete(avatarKey(name, connectionId))
}

async function loadAvatar(name: string, connectionId?: null | string): Promise<null | string> {
  const request = connectionId && connectionId !== LOCAL_CONNECTION_ID
    ? requestGatewayForAgent<{ data?: string; found?: boolean }>(connectionId, name, 'profiles.get_asset', {
        asset: 'avatar',
        name
      })
    : requestGatewayForProfile<{ data?: string; found?: boolean }>(name, 'profiles.get_asset', {
        asset: 'avatar',
        name
      })

  const result = await request

  return result.found && result.data ? result.data : null
}

/** Read the same profile asset used by Manage Profiles, once per connection/profile. */
export function useProfileAvatar(name: string, connectionId?: null | string, enabled = false): null | string {
  const key = avatarKey(name, connectionId)
  const [avatar, setAvatar] = useState<null | string>(() => avatarCache.get(key) ?? null)

  useEffect(() => {
    if (!enabled) {
      setAvatar(null)

      return
    }

    const cached = avatarCache.get(key)

    if (avatarCache.has(key)) {
      setAvatar(cached ?? null)

      return
    }

    let live = true
    let request = avatarRequests.get(key)

    if (!request) {
      request = loadAvatar(name, connectionId).catch(() => null)
      avatarRequests.set(key, request)
      void request.finally(() => avatarRequests.delete(key))
    }

    void request.then(next => {
      avatarCache.set(key, next)

      if (live) {
        setAvatar(next)
      }
    })

    return () => {
      live = false
    }
  }, [connectionId, enabled, key, name])

  return avatar
}

type ProfileAvatarProps = Omit<ComponentProps<typeof ProfileGlyph>, 'className' | 'color' | 'image' | 'isDefault' | 'name'> & {
  className?: string
  color: null | string
  connectionId?: null | string
  hasAvatar?: boolean
  isDefault: boolean
  name: string
}

export function ProfileAvatar({
  className,
  color,
  connectionId,
  hasAvatar = false,
  isDefault,
  name,
  ...props
}: ProfileAvatarProps) {
  const avatar = useProfileAvatar(name, connectionId, hasAvatar)

  return <ProfileGlyph {...props} className={className} color={color} image={avatar} isDefault={isDefault} name={name} />
}
