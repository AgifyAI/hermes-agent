import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { FanMenu } from './fan-menu'

afterEach(cleanup)

it('dims a disabled disc once the fan has opened, and leaves an enabled one solid', async () => {
  render(
    <FanMenu
      hub={{ id: 'hub', icon: 'H', label: 'Hub', onSelect: vi.fn() }}
      items={[
        { id: 'on', icon: 'A', label: 'Enabled', onSelect: vi.fn() },
        { disabled: true, id: 'off', icon: 'B', label: 'Disabled', onSelect: vi.fn() }
      ]}
      label="Fan"
    />
  )

  fireEvent.pointerEnter(screen.getByRole('button', { name: 'Hub' }))

  const enabled = await screen.findByRole('button', { name: 'Enabled' })
  const disabled = screen.getByRole('button', { name: 'Disabled' })

  await waitFor(() => expect(enabled.style.opacity).toBe('1'))
  expect(Number(disabled.style.opacity)).toBeLessThan(1)
})
