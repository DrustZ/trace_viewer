import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ roots: vi.fn(), add: vi.fn() }))

vi.mock('../../api/dataRoots', () => ({
  useDataRoots: apiMocks.roots,
  useAddDataRoot: apiMocks.add,
}))

import { IMPORT_TABS } from './ImportDialog'
import { LocalFolderForm } from './LocalFolderForm'

describe('LocalFolderForm', () => {
  beforeEach(() => {
    apiMocks.roots.mockReset()
    apiMocks.add.mockReset()
    apiMocks.roots.mockReturnValue({
      data: {
        persistenceAvailable: false,
        roots: [
          {
            id: 'root-1',
            label: 'production',
            run: 'production',
            dynamic: false,
            persistent: true,
          },
          {
            id: 'root-2',
            label: 'live-run',
            run: 'live-run',
            dynamic: true,
            persistent: false,
          },
        ],
      },
    })
    apiMocks.add.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
    })
  })

  it('is discoverable as a Folder tab in the import dialog', () => {
    expect(IMPORT_TABS).toContainEqual({ id: 'folder', label: 'Folder' })
  })

  it('renders absolute-folder and optional-label inputs plus the watched-root list', () => {
    const html = renderToStaticMarkup(<LocalFolderForm />)

    expect(html).toContain('data-testid="data-root-path"')
    expect(html).toContain('data-testid="data-root-label"')
    expect(html).toContain('Add &amp; watch')
    expect(html).toContain('production')
    expect(html).toContain('this session')
    expect(html).not.toContain('/Users/private-account')
  })

  it('reports indexed trace count and warnings after a folder is added', () => {
    apiMocks.add.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: true,
      isError: false,
      data: {
        root: {
          id: 'root-2',
          label: 'live-run',
          run: 'live-run',
          dynamic: true,
          persistent: false,
        },
        indexedTraces: 12,
        warnings: 2,
      },
    })

    const html = renderToStaticMarkup(<LocalFolderForm />)
    expect(html).toContain('Watching live-run: 12 traces indexed (2 warnings).')
  })

  it('explains when UI-added folders will be restored after restart', () => {
    apiMocks.roots.mockReturnValue({
      data: {
        persistenceAvailable: true,
        roots: [
          {
            id: 'root-2',
            label: 'live-run',
            run: 'live-run',
            dynamic: true,
            persistent: true,
          },
        ],
      },
    })

    const html = renderToStaticMarkup(<LocalFolderForm />)
    expect(html).toContain('Saved privately on this machine')
    expect(html).toContain('saved locally')
  })

  it('shows the server validation message without exposing a raw JSON envelope', () => {
    apiMocks.add.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: true,
      error: new Error('{"error":"home directory is too broad"}'),
    })

    const html = renderToStaticMarkup(<LocalFolderForm />)
    expect(html).toContain('home directory is too broad')
    expect(html).not.toContain('&quot;error&quot;')
  })
})
