import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SectionHeading, SettingsBreadcrumbContext } from './primitives'

describe('SectionHeading count', () => {
  it('renders nothing under the breadcrumb rather than a count with no title', () => {
    const { container } = render(
      <SettingsBreadcrumbContext.Provider value>
        <SectionHeading meta="1" page title="Custom Endpoints" />
      </SettingsBreadcrumbContext.Provider>
    )

    expect(container.textContent).toBe('')
  })

  it('keeps the title and its count when embedded without a breadcrumb', () => {
    render(<SectionHeading meta="1" page title="Custom Endpoints" />)

    expect(screen.getByRole('heading', { name: 'Custom Endpoints' })).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
  })
})
