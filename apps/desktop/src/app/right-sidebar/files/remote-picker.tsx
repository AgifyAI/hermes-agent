import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FieldHint } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { createRemoteDir, readDesktopDir, setDesktopFsRemotePicker } from '@/lib/desktop-fs'
import { displayPath, pathLeaf } from '@/lib/display-path'
import { isSubmitEnter } from '@/lib/ime'
import { cn } from '@/lib/utils'

function clean(path: string) {
  return path.replace(/\/+$/, '') || '/'
}

function parentDir(path: string) {
  const value = clean(path)

  if (value === '/') {
    return '/'
  }

  const parent = value.slice(0, value.lastIndexOf('/'))

  return parent || '/'
}

function pathName(path: string) {
  return pathLeaf(path) || path
}

// One path segment only: the new folder goes directly under the current one.
function validFolderName(name: string) {
  return Boolean(name) && name !== '.' && name !== '..' && !/[/\\]/.test(name)
}

function childPath(parent: string, name: string) {
  const base = clean(parent)

  return base === '/' ? `/${name}` : `${base}/${name}`
}

interface PendingSelection {
  defaultPath: string
  resolve: (paths: string[]) => void
  title: string
}

export function RemoteFolderPicker() {
  const { t } = useI18n()
  const r = t.rightSidebar
  const [pending, setPending] = useState<PendingSelection | null>(null)
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // null = not naming a new folder; a string is the name being typed.
  const [newFolderName, setNewFolderName] = useState<string | null>(null)
  const [newFolderError, setNewFolderError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setDesktopFsRemotePicker({
      selectPaths: options =>
        new Promise(resolve => {
          const defaultPath = clean(options?.defaultPath || '/')
          setCurrentPath(defaultPath)
          setNewFolderName(null)
          setNewFolderError(null)
          setPending({ defaultPath, resolve, title: options?.title || r.remotePickerTitle })
        })
    })

    return () => setDesktopFsRemotePicker(null)
  }, [r.remotePickerTitle])

  useEffect(() => {
    if (!pending) {
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    void readDesktopDir(currentPath)
      .then(result => {
        if (!active) {
          return
        }

        if (result.error) {
          setError(result.error)
          setEntries([])

          return
        }

        setEntries(
          result.entries.filter(entry => entry.isDirectory).map(entry => ({ name: entry.name, path: entry.path }))
        )
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
          setEntries([])
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [currentPath, pending])

  const crumbs = useMemo(() => {
    const parts = clean(currentPath).split('/').filter(Boolean)
    const out = [{ label: '/', path: '/' }]
    let acc = ''

    for (const part of parts) {
      acc += `/${part}`
      out.push({ label: part, path: acc })
    }

    return out
  }, [currentPath])

  const cancelNewFolder = () => {
    setNewFolderName(null)
    setNewFolderError(null)
  }

  const navigate = (path: string) => {
    cancelNewFolder()
    setCurrentPath(path)
  }

  const close = (paths: string[] = []) => {
    pending?.resolve(paths)
    setPending(null)
    setEntries([])
    setError(null)
    cancelNewFolder()
  }

  const createFolder = async () => {
    const name = (newFolderName ?? '').trim()

    if (creating) {
      return
    }

    if (!validFolderName(name)) {
      setNewFolderError(r.remotePickerInvalidFolderName)

      return
    }

    setCreating(true)
    setNewFolderError(null)

    try {
      const created = await createRemoteDir(childPath(currentPath, name))
      navigate(clean(created))
    } catch (err) {
      setNewFolderError(r.remotePickerCreateFolderFailed(err instanceof Error ? err.message : String(err)))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog onOpenChange={open => !open && close()} open={Boolean(pending)}>
      <DialogContent
        bodyClassName="flex min-h-0 flex-col gap-0 overflow-hidden p-0"
        className="h-[min(36rem,calc(100vh-4rem))] max-w-lg"
        onEscapeKeyDown={event => {
          // One cancel gesture does one thing: Escape abandons the name first.
          if (newFolderName !== null) {
            event.preventDefault()
            cancelNewFolder()
          }
        }}
      >
        <div className="grid shrink-0 gap-1 border-b-[0.5px] border-(--linear-border-primary) px-5 pt-4 pb-3">
          <DialogTitle>{pending?.title || r.remotePickerTitle}</DialogTitle>
          <DialogDescription className="text-[0.8125rem]">{r.remotePickerDescription}</DialogDescription>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 flex flex-wrap items-center gap-1 border-b-[0.5px] border-(--linear-border-primary) px-3 py-2 text-xs font-medium text-(--linear-text-tertiary)">
            {crumbs.map((crumb, index) => (
              <button
                className={cn(
                  'cursor-pointer rounded-(--linear-radius-control) px-1.5 py-0.5 hover:bg-(--linear-hover-row) hover:text-(--linear-text-primary)',
                  index === crumbs.length - 1 && 'text-(--linear-text-primary)'
                )}
                key={crumb.path}
                onClick={() => navigate(crumb.path)}
                type="button"
              >
                {crumb.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <FolderRow disabled={currentPath === '/'} name=".." onClick={() => navigate(parentDir(currentPath))} />
            {newFolderName !== null && (
              <div className="px-2 py-1">
                <div className="flex items-center gap-2">
                  <Codicon className="text-(--linear-icon)" name="new-folder" size="0.875rem" />
                  <Input
                    aria-invalid={Boolean(newFolderError)}
                    aria-label={r.remotePickerFolderName}
                    autoFocus
                    disabled={creating}
                    onChange={event => {
                      setNewFolderName(event.target.value)
                      setNewFolderError(null)
                    }}
                    onKeyDown={event => {
                      if (isSubmitEnter(event)) {
                        event.preventDefault()
                        void createFolder()
                      }
                    }}
                    placeholder={r.remotePickerFolderName}
                    size="sm"
                    value={newFolderName}
                  />
                  <Button
                    aria-label={r.remotePickerCreateFolder}
                    disabled={creating}
                    onClick={() => void createFolder()}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Codicon name={creating ? 'loading' : 'check'} size="0.875rem" spinning={creating} />
                  </Button>
                </div>
                {newFolderError && (
                  <div className="mt-1 pl-6">
                    <FieldHint error>{newFolderError}</FieldHint>
                  </div>
                )}
              </div>
            )}
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-[0.8125rem] text-(--linear-text-tertiary)">
                <Codicon name="loading" size="0.875rem" spinning />
                {r.loadingFiles}
              </div>
            ) : error ? (
              <div className="px-2 py-3 text-[0.8125rem] text-(--linear-red)">{r.unreadableBody(error)}</div>
            ) : entries.length === 0 ? (
              <div className="px-2 py-3 text-[0.8125rem] text-(--linear-text-tertiary)">{r.emptyBody}</div>
            ) : (
              entries.map(entry => (
                <FolderRow key={entry.path} name={pathName(entry.path)} onClick={() => navigate(entry.path)} />
              ))
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 border-t-[0.5px] border-(--linear-border-primary) px-4 py-3">
          <div className="min-w-0 truncate text-xs text-(--linear-text-tertiary)">{displayPath(currentPath)}</div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              disabled={newFolderName !== null || Boolean(error)}
              onClick={() => setNewFolderName('')}
              variant="ghost"
            >
              <Codicon name="new-folder" size="0.875rem" />
              {r.remotePickerNewFolder}
            </Button>
            <Button onClick={() => close()} variant="ghost">
              {t.common.cancel}
            </Button>
            <Button onClick={() => close([currentPath])}>
              {r.remotePickerSelect}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FolderRow({ disabled = false, name, onClick }: { disabled?: boolean; name: string; onClick: () => void }) {
  return (
    <button
      className="row-hover flex h-8 w-full cursor-pointer items-center gap-2 rounded-(--linear-radius-control) px-2 text-left text-[0.8125rem] text-(--linear-text-secondary) hover:bg-(--linear-hover-row) hover:text-(--linear-text-primary) disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Codicon name="folder" size="0.875rem" />
      <span className="min-w-0 truncate">{name}</span>
    </button>
  )
}
