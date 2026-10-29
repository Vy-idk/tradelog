import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Goes back in history when there is somewhere to go back to (keeping the
 * journal's filters), otherwise to the journal, e.g. after opening a deep link.
 */
export function useGoBack(): () => void {
  const navigate = useNavigate()
  const { key } = useLocation()
  return useCallback(() => {
    if (key !== 'default') navigate(-1)
    else navigate('/', { replace: true })
  }, [key, navigate])
}
