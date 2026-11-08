import { LOCAL_CONNECTION_ID } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type ComponentProps, useEffect, useState } from 'react'

import { ProfileGlyph } from '@/components/ui/profile-glyph'
import { requestGatewayForAgent, requestGatewayForProfile } from '@/store/gateway'

const avatarCache = new Map<string, string>()
const avatarRequests = new Map<string, Promise<null | string>>()
// A cache invalidation must also wake already-mounted avatars.  The profile
// register keeps `has_avatar` true when a photo is replaced, so changing only
// the Map would leave those components subscribed to an old result.
export const $profileAvatarRevisions = atom<Record<string, number>>({})

function avatarKey(name: string, connectionId?: null | string): string {
  return `${connectionId || LOCAL_CONNECTION_ID}\u0000${name.trim() || 'default'}`
}

export function invalidateProfileAvatar(name: string, connectionId?: null | string): void {
  const key = avatarKey(name, connectionId)
  avatarCache.delete(key)
  // Detach an in-flight read of the previous image. Its completion is ignored
  // below, and the next render starts a fresh read of the newly saved image.
  avatarRequests.delete(key)
  const revisions = $profileAvatarRevisions.get()
  $profileAvatarRevisions.set({ ...revisions, [key]: (revisions[key] ?? 0) + 1 })
}

async function loadAvatar(name: string, connectionId?: null | string): Promise<null | string> {
  const request =
    connectionId && connectionId !== LOCAL_CONNECTION_ID
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
  const revision = useStore($profileAvatarRevisions)[key] ?? 0
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
    }

    void request.then(next => {
      // An invalidation may have started a newer request while this one was
      // still in flight. Do not let its stale result repopulate the cache.
      if (avatarRequests.get(key) !== request) {
        return
      }

      if (next) {
        avatarCache.set(key, next)
      } else {
        // A failed or empty response must remain retryable. In particular, a
        // temporary gateway error must not become a permanent cached null.
        avatarCache.delete(key)
      }

      if (live) {
        setAvatar(next)
      }
    })

    void request.finally(() => {
      if (avatarRequests.get(key) === request) {
        avatarRequests.delete(key)
      }
    })

    return () => {
      live = false
    }
  }, [connectionId, enabled, key, name, revision])

  return avatar
}

type ProfileAvatarProps = Omit<
  ComponentProps<typeof ProfileGlyph>,
  'className' | 'color' | 'image' | 'isDefault' | 'name'
> & {
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

  return (
    <ProfileGlyph {...props} className={className} color={color} image={avatar} isDefault={isDefault} name={name} />
  )
}
