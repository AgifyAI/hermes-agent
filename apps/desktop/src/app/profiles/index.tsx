import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CodeEditor } from '@/components/chat/code-editor'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProfileGlyph } from '@/components/ui/profile-glyph'
import { getProfileSoul, type ProfileInfo, updateProfileSoul } from '@/hermes'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { AlertTriangle, Save, Upload, X } from '@/lib/icons'
import { resolveProfileColor } from '@/lib/profile-color'
import { normalize } from '@/lib/text'
import { cn } from '@/lib/utils'
import { requestGatewayForProfile } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'
import {
  $profileColors,
  $profileNicknames,
  profileLabel,
  profileNickname,
  refreshProfiles,
  setProfileNickname
} from '@/store/profile'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import {
  Panel,
  PANEL_ERROR_NOTICE,
  PanelAddButton,
  PanelBody,
  PanelDetail,
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelListRow,
  type PanelMenuItem,
  PanelMeta,
  PanelPill,
  PanelSectionLabel,
  PanelTitle
} from '../overlays/panel'

import { CreateProfileDialog } from './create-profile-dialog'
import { DeleteProfileDialog } from './delete-profile-dialog'
import { RenameProfileDialog } from './rename-profile-dialog'

interface ProfilesViewProps {
  onClose: () => void
}

export function ProfilesView({ onClose }: ProfilesViewProps) {
  const { t } = useI18n()
  const p = t.profiles
  const [profiles, setProfiles] = useState<null | ProfileInfo[]>(null)
  const [selectedName, setSelectedName] = useState<null | string>(null)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingRename, setPendingRename] = useState<null | ProfileInfo>(null)
  const [pendingDelete, setPendingDelete] = useState<null | ProfileInfo>(null)

  // Nicknames are presentation-only Desktop preferences. Subscribe directly
  // so the list and detail labels change without waiting for a backend pull.
  useStore($profileNicknames)

  const refresh = useCallback(async () => {
    try {
      const list = await refreshProfiles()
      setProfiles(list)
      setSelectedName(current => {
        if (current && list.some(p => p.name === current)) {
          return current
        }

        return list.find(p => p.is_default)?.name ?? list[0]?.name ?? null
      })
    } catch (err) {
      notifyError(err, p.failedLoad)
    }
  }, [p])

  useRefreshHotkey(refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selected = useMemo(() => {
    if (!profiles) {
      return null
    }

    return profiles.find(p => p.name === selectedName) ?? profiles[0] ?? null
  }, [profiles, selectedName])

  const visibleProfiles = useMemo(() => {
    const q = normalize(query)

    if (!profiles || !q) {
      return profiles ?? []
    }

    return profiles.filter(
      profile => profile.name.toLowerCase().includes(q) || (profile.model ?? '').toLowerCase().includes(q)
    )
  }, [profiles, query])

  // The shared Create/Rename dialogs own the createProfile / renameProfile /
  // updateProfileSoul calls; the panel just selects the resulting profile and
  // re-pulls the list.
  const selectAndRefresh = useCallback(
    async (name: string) => {
      setSelectedName(name)
      await refresh()
    },
    [refresh]
  )

  return (
    <Panel closeLabel={p.close} onClose={onClose}>
      {!profiles ? (
        <PageLoader label={p.loading} />
      ) : profiles.length === 0 ? (
        <PanelEmpty
          action={<Button onClick={() => setCreateOpen(true)}>{p.newProfile}</Button>}
          description={p.createDesc}
          icon="organization"
          title={p.noProfiles}
        />
      ) : (
        <>
          <PanelHeader subtitle={p.count(profiles.length)} title={p.title} />
          <PanelBody>
            <PanelList
              onSearchChange={setQuery}
              searchLabel={p.search}
              searchPlaceholder={p.search}
              searchValue={query}
            >
              {visibleProfiles.map(profile => (
                <ProfileRow
                  active={selected?.name === profile.name}
                  key={profile.name}
                  menuItems={
                    profile.is_default
                      ? // Renaming the default profile sets a presentation-only
                        // display name (the canonical id stays "default").
                        [{ icon: 'edit', label: p.renameMenu, onSelect: () => setPendingRename(profile) }]
                      : [
                          { icon: 'edit', label: p.renameMenu, onSelect: () => setPendingRename(profile) },
                          {
                            icon: 'trash',
                            label: t.common.delete,
                            onSelect: () => setPendingDelete(profile),
                            tone: 'danger'
                          }
                        ]
                  }
                  onSelect={() => setSelectedName(profile.name)}
                  profile={profile}
                />
              ))}
              <PanelAddButton label={p.newProfile} onClick={() => setCreateOpen(true)} />
            </PanelList>

            {selected ? (
              <ProfileDetail key={selected.name} onUpdated={refresh} profile={selected} />
            ) : (
              <PanelEmpty description={p.selectPrompt} icon="account" />
            )}
          </PanelBody>
        </>
      )}

      <RenameProfileDialog
        currentName={pendingRename?.name ?? ''}
        isDefault={pendingRename?.is_default ?? false}
        onClose={() => setPendingRename(null)}
        onRenamed={selectAndRefresh}
        open={pendingRename !== null}
      />

      <CreateProfileDialog
        onClose={() => setCreateOpen(false)}
        onCreated={selectAndRefresh}
        open={createOpen}
        profiles={profiles ?? []}
      />

      <DeleteProfileDialog
        onClose={() => setPendingDelete(null)}
        onDeleted={async () => {
          setSelectedName(null)
          await refresh()
        }}
        open={pendingDelete !== null}
        profile={pendingDelete}
      />
    </Panel>
  )
}

function ProfileRow({
  active,
  menuItems,
  onSelect,
  profile
}: {
  active: boolean
  menuItems: PanelMenuItem[]
  onSelect: () => void
  profile: ProfileInfo
}) {
  const colors = useStore($profileColors)

  return (
    <PanelListRow
      active={active}
      lead={
        <ProfileGlyph
          aria-hidden="true"
          color={resolveProfileColor(profile.name, colors)}
          isDefault={profile.is_default}
          name={profile.name}
        />
      }
      menuItems={menuItems}
      menuLabel={profileLabel(profile)}
      onSelect={onSelect}
      rowKey={profile.name}
      title={profileLabel(profile)}
    />
  )
}

function ProfileDetail({ onUpdated, profile }: { onUpdated: () => Promise<void>; profile: ProfileInfo }) {
  const { t } = useI18n()
  const p = t.profiles

  return (
    <PanelDetail>
      <header className="space-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PanelTitle>{profileLabel(profile)}</PanelTitle>
            {profile.is_default && <PanelPill tone="good">{p.defaultBadge}</PanelPill>}
            {profile.has_env && <PanelPill tone="muted">.env</PanelPill>}
          </div>
          <p
            className="mt-1 truncate font-mono text-xs text-(--linear-text-tertiary)"
            title={displayPath(profile.path)}
          >
            {displayPath(profile.path)}
          </p>
        </div>

        <PanelMeta
          rows={[
            {
              label: p.modelLabel,
              value: profile.model ? (
                <span className="font-mono">
                  {profile.model}
                  {profile.provider ? (
                    <span className="text-(--linear-text-tertiary)"> · {profile.provider}</span>
                  ) : null}
                </span>
              ) : (
                <span className="text-(--linear-text-tertiary)">{p.notSet}</span>
              )
            },
            { label: p.skillsLabel, value: profile.skill_count }
          ]}
        />
      </header>

      <ProfileIdentityEditor onUpdated={onUpdated} profile={profile} />
      <SoulEditor profileName={profile.name} />
    </PanelDetail>
  )
}

function readProfileNickname(profile: ProfileInfo): string {
  return profileNickname(profile)
}

function ProfileIdentityEditor({ onUpdated, profile }: { onUpdated: () => Promise<void>; profile: ProfileInfo }) {
  const { t } = useI18n()
  const p = t.profiles
  const [nickname, setNickname] = useState(() => readProfileNickname(profile))
  const [avatar, setAvatar] = useState<null | string>(null)
  const [initialAvatar, setInitialAvatar] = useState<null | string>(null)
  const [loadingAvatar, setLoadingAvatar] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setNickname(readProfileNickname(profile))
    setError(null)
    setAvatar(null)
    setInitialAvatar(null)

    let live = true
    setLoadingAvatar(true)
    void requestGatewayForProfile<{ data?: string; found?: boolean }>(
      profile.name,
      'profiles.get_asset',
      { asset: 'avatar', name: profile.name }
    )
      .then(result => {
        if (live) {
          const image = result?.found && result.data ? result.data : null
          setAvatar(image)
          setInitialAvatar(image)
        }
      })
      .catch(() => undefined)
      .finally(() => live && setLoadingAvatar(false))

    return () => {
      live = false
    }
  }, [profile])

  const chooseAvatar = () => inputRef.current?.click()

  const handleImage = async (file: File | undefined) => {
    if (!file) {
      return
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError(p.avatarFormat)

      return
    }

    try {
      const data = await readProfileImage(file, p.avatarFailedRead)
      setAvatar(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : p.avatarFailedRead)
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)

    try {
      if (nickname.trim() !== readProfileNickname(profile)) {
        setProfileNickname(profile.name, nickname)
      }

      if (avatar && avatar !== initialAvatar) {
        await requestGatewayForProfile(
          profile.name,
          'profiles.set_asset',
          { asset: 'avatar', data: avatar, name: profile.name }
        )
      } else if (!avatar && initialAvatar) {
        await requestGatewayForProfile(
          profile.name,
          'profiles.set_asset',
          { asset: 'avatar', clear: true, name: profile.name }
        )
      }

      await onUpdated()
      notify({ kind: 'success', title: p.identitySaved, message: profileLabel({ ...profile, display_name: nickname.trim() }) })
    } catch (err) {
      setError(err instanceof Error ? err.message : p.identitySaveFailed)
    } finally {
      setSaving(false)
    }
  }

  const dirty = nickname.trim() !== readProfileNickname(profile) || avatar !== initialAvatar

  return (
    <section className="grid gap-3 border-y border-(--linear-border-panel) py-4">
      <div className="flex items-center gap-3">
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-(--linear-bg-tertiary)">
          {loadingAvatar ? <span className="text-xs text-(--linear-text-tertiary)">…</span> : avatar ? <img alt="" className="size-full object-cover" src={avatar} /> : <ProfileGlyph color={null} isDefault={profile.is_default} name={profile.name} />}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={chooseAvatar} size="xs" type="button" variant="secondary">
            <Upload />
            {p.chooseAvatar}
          </Button>
          {avatar && <Button aria-label={p.removeAvatar} onClick={() => setAvatar(null)} size="xs" type="button" variant="ghost"><X /></Button>}
          <input accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void handleImage(event.target.files?.[0])} ref={inputRef} type="file" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <label className="text-xs font-medium text-(--linear-text-primary)" htmlFor="profile-nickname">{p.nicknameLabel}</label>
        <Input aria-describedby="profile-nickname-hint" id="profile-nickname" onChange={event => setNickname(event.target.value)} placeholder={profile.name} value={nickname} />
        <p className="text-xs text-(--linear-text-tertiary)" id="profile-nickname-hint">{p.nicknameHint}</p>
      </div>
      {error && <div className={cn(PANEL_ERROR_NOTICE, 'px-3 py-2 text-xs')}>{error}</div>}
      <div className="flex justify-end">
        <Button disabled={!dirty || saving} onClick={() => void save()} size="sm">
          {saving ? p.saving : p.saveIdentity}
        </Button>
      </div>
    </section>
  )
}

function readProfileImage(file: File, failureMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(failureMessage))

    reader.onload = () => {
      const source = typeof reader.result === 'string' ? reader.result : ''

      if (!source) {
        reject(new Error(failureMessage))

        return
      }

      const image = new Image()
      image.onerror = () => reject(new Error(failureMessage))

      image.onload = () => {
        const edge = 256
        const side = Math.min(image.naturalWidth, image.naturalHeight)
        const canvas = document.createElement('canvas')
        canvas.width = edge
        canvas.height = edge
        canvas.getContext('2d')?.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, edge, edge)
        resolve(canvas.toDataURL('image/png'))
      }

      image.src = source
    }

    reader.readAsDataURL(file)
  })
}

function SoulEditor({ profileName }: { profileName: string }) {
  const { t } = useI18n()
  const p = t.profiles
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const requestRef = useRef<string>(profileName)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    requestRef.current = profileName
    setLoading(true)
    setError(null)
    setContent('')
    setOriginal('')
    setMissing(false)

    void (async () => {
      try {
        const soul = await getProfileSoul(profileName)

        if (requestRef.current === profileName) {
          setContent(soul.content)
          setOriginal(soul.content)
          setMissing(soul.exists === false)
        }
      } catch (err) {
        if (requestRef.current === profileName) {
          setError(err instanceof Error ? err.message : p.failedLoadSoul)
        }
      } finally {
        if (requestRef.current === profileName) {
          setLoading(false)
        }
      }
    })()
  }, [p, profileName])

  const dirty = content !== original

  async function handleSave() {
    setSaving(true)
    setError(null)

    try {
      await updateProfileSoul(profileName, content)
      setOriginal(content)
      setMissing(false)
      notify({ kind: 'success', title: p.soulSaved, message: profileName })
    } catch (err) {
      setError(err instanceof Error ? err.message : p.failedSaveSoul)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <PanelSectionLabel>SOUL.md</PanelSectionLabel>
          <p className="text-xs font-[450] text-(--linear-text-tertiary)">{missing ? p.soulMissing : p.soulDesc}</p>
        </div>
        {dirty && <span className="text-xs text-(--linear-text-tertiary)">{p.unsavedChanges}</span>}
      </div>

      {loading ? (
        <PageLoader className="min-h-44" label={p.loadingSoul} />
      ) : (
        <div className="min-h-48">
          <CodeEditor
            filePath="SOUL.md"
            framed
            initialValue={content}
            key={profileName}
            onChange={setContent}
            onSave={() => void handleSave()}
          />
        </div>
      )}

      {error && (
        <div className={cn(PANEL_ERROR_NOTICE, 'flex items-start gap-2 px-3 py-2 text-xs')}>
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button disabled={!dirty || saving || loading} onClick={() => void handleSave()}>
          <Save />
          {saving ? p.saving : p.saveSoul}
        </Button>
      </div>
    </section>
  )
}
