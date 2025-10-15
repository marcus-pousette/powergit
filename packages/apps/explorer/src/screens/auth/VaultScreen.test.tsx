import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VaultScreen } from './VaultScreen'

const PASSPHRASE = 'correct-horse-battery-staple'

describe('VaultScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new vault when none exists', async () => {
    const onCreateVault = vi.fn().mockResolvedValue(undefined)
    const onUnlockVault = vi.fn()
    const onSignOut = vi.fn()

    render(
      <VaultScreen
        hasVault={false}
        status="needsSetup"
        onCreateVault={onCreateVault}
        onUnlockVault={onUnlockVault}
        onSignOut={onSignOut}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Choose a strong passphrase'), { target: { value: PASSPHRASE } })
    fireEvent.change(screen.getByPlaceholderText('Confirm passphrase'), { target: { value: PASSPHRASE } })

    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }))

    await waitFor(() => {
      expect(onCreateVault).toHaveBeenCalledWith(PASSPHRASE)
      expect(onUnlockVault).not.toHaveBeenCalled()
    })
  })

  it('unlocks an existing vault and supports clearing', async () => {
    const onCreateVault = vi.fn()
    const onUnlockVault = vi.fn().mockResolvedValue(undefined)
    const onSignOut = vi.fn()
    const onClearVault = vi.fn().mockResolvedValue(undefined)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <VaultScreen
        hasVault
        status="locked"
        onCreateVault={onCreateVault}
        onUnlockVault={onUnlockVault}
        onSignOut={onSignOut}
        onClearVault={onClearVault}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Passphrase'), { target: { value: PASSPHRASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }))

    await waitFor(() => {
      expect(onUnlockVault).toHaveBeenCalledWith(PASSPHRASE)
      expect(onCreateVault).not.toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear vault' }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(onClearVault).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('vault-sign-out-button'))
    expect(onSignOut).toHaveBeenCalledTimes(1)

    confirmSpy.mockRestore()
  })
})

